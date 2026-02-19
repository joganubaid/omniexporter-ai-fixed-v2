// OmniExporter AI - Grok Adapter (Enterprise Edition)
// Support for xAI Grok (grok.com and x.com/i/grok)
// Enterprise-level matching Perplexity quality
// NOW USES: platformConfig for centralized configuration

const GrokAdapter = {
    name: "Grok",

    // ============================================
    // ENTERPRISE: Use platformConfig for endpoints
    // ============================================
    get config() {
        return typeof platformConfig !== 'undefined'
            ? platformConfig.getConfig('Grok')
            : null;
    },

    get apiBase() {
        const config = this.config;
        return config ? config.baseUrl + '/rest/app-chat' : 'https://grok.com/rest/app-chat';
    },

    // Cache for pagination
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    extractUuid: (url) => {
        // Try platformConfig patterns first
        if (typeof platformConfig !== 'undefined') {
            const uuid = platformConfig.extractUuid('Grok', url);
            if (uuid) return uuid;
        }

        // Fallback patterns
        const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) return uuidMatch[1];

        const chatMatch = url.match(/grok\.com\/(?:chat|c)\/([a-zA-Z0-9_-]+)/);
        if (chatMatch) return chatMatch[1];

        const xMatch = url.match(/x\.com\/i\/grok\/([a-zA-Z0-9_-]+)/);
        if (xMatch) return xMatch[1];

        return null;
    },

    // ============================================
    // ENTERPRISE: Anti-bot headers (HAR-verified)
    // Grok uses cookie-based auth (sso + sso-rw cookies)
    // No extra auth headers needed — cookies sent via credentials:'include'
    // ============================================
    _getHeaders: () => {
        return {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;
        const headers = { ...GrokAdapter._getHeaders(), ...options.headers };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });

                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to Grok');
                }

                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 2) * 1000;
                    console.warn(`[Grok] Rate limited, waiting ${waitTime}ms`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }

                lastError = new Error(`HTTP ${response.status}`);
            } catch (e) {
                lastError = e;
            }

            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
        throw lastError;
    },

    // ============================================
    // ENTERPRISE: Get ALL threads (Load All feature)
    // ============================================
    getAllThreads: async (progressCallback = null) => {
        try {
            // HAR-verified: ?pageSize=60 is required to get full list
            const response = await GrokAdapter._fetchWithRetry(
                `${GrokAdapter.apiBase}/conversations?pageSize=60`
            );
            const data = await response.json();
            // HAR-verified: response is { conversations: [{conversationId, title, createTime, modifyTime, ...}] }
            const chats = data.conversations || data.data || data.items || [];

            const threads = chats.map(chat => ({
                // HAR-verified: field is 'conversationId' not 'id'
                uuid: chat.conversationId || chat.id || chat.uuid,
                title: chat.title || chat.name || 'Grok Chat',
                platform: 'Grok',
                // HAR-verified: fields are 'modifyTime' and 'createTime'
                last_query_datetime: chat.modifyTime || chat.createTime || chat.updatedAt || new Date().toISOString()
            }));

            // Update cache
            GrokAdapter._allThreadsCache = threads;
            GrokAdapter._cacheTimestamp = Date.now();

            if (progressCallback) {
                progressCallback(threads.length, false);
            }

            return threads;
        } catch (error) {
            console.error('[Grok] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    getThreadsWithOffset: async (offset = 0, limit = 50) => {
        // Check cache validity
        const cacheValid = GrokAdapter._cacheTimestamp > Date.now() - GrokAdapter._cacheTTL;

        if (!cacheValid || GrokAdapter._allThreadsCache.length === 0) {
            await GrokAdapter.getAllThreads();
        }

        const threads = GrokAdapter._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < GrokAdapter._allThreadsCache.length,
            total: GrokAdapter._allThreadsCache.length
        };
    },

    // Standard page-based (backwards compatible)
    getThreads: async (page = 0, limit = 50) => {
        // Check NetworkInterceptor first
        if (window.NetworkInterceptor && window.NetworkInterceptor.getChatList().length > 0) {
            const all = window.NetworkInterceptor.getChatList();
            const start = page * limit;
            return {
                threads: all.slice(start, start + limit),
                hasMore: start + limit < all.length,
                page
            };
        }

        try {
            const result = await GrokAdapter.getThreadsWithOffset(page * limit, limit);
            return {
                threads: result.threads,
                hasMore: result.hasMore,
                page
            };
        } catch (e) {
            console.error('[Grok] API fetch failed:', e);
            throw e;
        }
    },

    // ============================================
    // ENTERPRISE: Resilient thread detail fetching
    // HAR-VERIFIED 3-step flow:
    //   1. GET /conversations/{uuid}/response-node?includeThreads=true → gets responseIds[]
    //   2. POST /conversations/{uuid}/load-responses {responseIds:[...]} → gets messages
    //   Messages use sender:"human"/"assistant" and message:"..." fields
    // ============================================
    getThreadDetail: async (uuid) => {
        console.log(`[Grok] Fetching thread detail for: ${uuid}`);

        try {
            // ── STEP 1: Get response node IDs ──────────────────────────────
            const nodeUrl = `${GrokAdapter.apiBase}/conversations/${uuid}/response-node?includeThreads=true`;
            console.log('[Grok] Step 1: Fetching response nodes:', nodeUrl);

            const nodeResponse = await GrokAdapter._fetchWithRetry(nodeUrl, {}, 2);
            const nodeData = await nodeResponse.json();

            // Extract response IDs from node data
            // HAR-VERIFIED (2026-02-17): nodeData.responseNodes = [{responseId, sender, parentResponseId?}]
            // Top-level keys: responseNodes, inflightResponses
            let responseIds = [];
            if (Array.isArray(nodeData.responseNodes)) {
                // PRIMARY: HAR-verified structure
                responseIds = nodeData.responseNodes.map(r => r.responseId || r.id).filter(Boolean);
            } else if (Array.isArray(nodeData.responseIds)) {
                // Fallback: flat array of IDs
                responseIds = nodeData.responseIds;
            } else if (Array.isArray(nodeData.responses)) {
                // Fallback: responses array
                responseIds = nodeData.responses.map(r => r.responseId || r.id).filter(Boolean);
            } else if (Array.isArray(nodeData)) {
                // Fallback: root is array
                responseIds = nodeData.map(r => r.responseId || r.id).filter(Boolean);
            }

            console.log(`[Grok] Step 1 complete: ${responseIds.length} response IDs found`);

            // ── STEP 2: Load actual messages via POST load-responses ────────
            if (responseIds.length === 0) {
                console.warn('[Grok] No response IDs, trying direct conversation fetch');
                throw new Error('No response IDs found in response-node');
            }

            const loadUrl = `${GrokAdapter.apiBase}/conversations/${uuid}/load-responses`;
            console.log('[Grok] Step 2: Loading responses:', loadUrl);

            const loadResponse = await GrokAdapter._fetchWithRetry(loadUrl, {
                method: 'POST',
                body: JSON.stringify({ responseIds })
            }, 2);
            const loadData = await loadResponse.json();

            // HAR-verified: response is { responses: [{responseId, message, sender:"human"/"assistant", createTime}] }
            const rawMessages = loadData.responses || loadData.messages || loadData.items || [];

            console.log(`[Grok] Step 2 complete: ${rawMessages.length} messages loaded`);

            // ── STEP 3: Transform messages into entries ─────────────────────
            const entries = [];
            let currentQuery = '';

            rawMessages.forEach(msg => {
                // HAR-verified: sender is "human" or "assistant" (lowercase)
                const sender = (msg.sender || msg.role || msg.author || '').toLowerCase();
                // HAR-verified: content field is "message" (not "content" or "text")
                const content = msg.message || msg.content || msg.text || '';

                if (!content.trim()) return;

                if (sender === 'human' || sender === 'user') {
                    currentQuery = content.trim();
                } else if ((sender === 'assistant' || sender === 'grok' || sender === 'ai') && currentQuery) {
                    entries.push({
                        query_str: currentQuery,
                        query: currentQuery,
                        blocks: [{
                            intended_usage: 'ask_text',
                            markdown_block: { answer: content.trim() }
                        }]
                    });
                    currentQuery = '';
                }
            });

            // Handle trailing user message with no assistant response
            if (currentQuery && entries.length === 0) {
                entries.push({
                    query_str: currentQuery,
                    query: currentQuery,
                    blocks: [{ intended_usage: 'ask_text', markdown_block: { answer: '' } }]
                });
            }

            // Get title — try conversations_v2 metadata or fall back to first query
            let title = entries[0]?.query_str?.substring(0, 100) || `Grok Conversation`;
            try {
                // HAR-verified: response is {conversation: {conversationId, title, ...}} OR {}
                const metaUrl = `${GrokAdapter.apiBase}/conversations_v2/${uuid}?includeWorkspaces=true&includeTaskResult=true`;
                const metaResp = await GrokAdapter._fetchWithRetry(metaUrl, {}, 1);
                const metaData = await metaResp.json();
                // HAR-verified key path: metaData.conversation.title
                const metaTitle = metaData?.conversation?.title || metaData?.title;
                if (metaTitle && metaTitle.trim()) {
                    title = metaTitle.trim();
                }
            } catch (e) {
                // Title metadata is optional — not critical
                console.log('[Grok] Could not fetch title metadata, using first query');
            }

            console.log(`[Grok] ✓ Success: ${entries.length} entries for: ${title}`);
            return { uuid, title, platform: 'Grok', entries };

        } catch (error) {
            console.error(`[Grok] getThreadDetail failed for ${uuid}:`, error.message);
            // Return empty rather than throwing so bulk export can continue
            return {
                uuid,
                title: `Grok Conversation (${uuid.slice(0, 8)})`,
                platform: 'Grok',
                entries: [],
                error: error.message
            };
        }
    },



    getSpaces: async () => []
};

window.GrokAdapter = GrokAdapter;
