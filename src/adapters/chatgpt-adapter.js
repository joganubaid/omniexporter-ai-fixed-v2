// OmniExporter AI - ChatGPT Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

var ChatGPTAdapter = window.ChatGPTAdapter = window.ChatGPTAdapter || {
    name: "ChatGPT",

    // Cache for pagination
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    // Cache for Bearer token
    _accessToken: null,
    _tokenExpiry: 0,
    _tokenFetchPromise: null, // Dedup concurrent token fetches

    extractUuid: (url) => {
        return platformConfig.extractUuid('ChatGPT', url);
    },

    // ============================================
    // HAR-VERIFIED: Read cookie value by name
    // ============================================
    _getCookie: (name) => {
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    },

    // ============================================
    // HAR-VERIFIED: Fetch Bearer token from session API
    // ChatGPT requires Authorization: Bearer <token> on all backend-api calls
    // ============================================
    _getAccessToken: async () => {
        // Return cached token if still valid (with 60s buffer)
        if (ChatGPTAdapter._accessToken && Date.now() < ChatGPTAdapter._tokenExpiry - 60000) {
            return ChatGPTAdapter._accessToken;
        }

        // Dedup concurrent token fetch requests
        if (ChatGPTAdapter._tokenFetchPromise) {
            return ChatGPTAdapter._tokenFetchPromise;
        }

        ChatGPTAdapter._tokenFetchPromise = (async () => {
            try {
                const response = await fetch('https://chatgpt.com/api/auth/session', {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json',
                        'Cache-Control': 'no-cache'
                    }
                });

                if (!response.ok) {
                    console.warn('[ChatGPT] Session API returned:', response.status);
                    return null;
                }

                const data = await response.json().catch((e) => { console.warn('[ChatGPT] Failed to parse session response:', e.message); return null; });
                if (data && data.accessToken) {
                    ChatGPTAdapter._accessToken = data.accessToken;
                    // Token typically expires in ~1 hour; cache for 55 minutes
                    ChatGPTAdapter._tokenExpiry = Date.now() + 55 * 60 * 1000;
                    console.log('[ChatGPT] ✓ Bearer token acquired');
                    return data.accessToken;
                }

                console.warn('[ChatGPT] No accessToken in session response');
                return null;
            } catch (e) {
                console.error('[ChatGPT] Failed to fetch access token:', e.message);
                return null;
            } finally {
                ChatGPTAdapter._tokenFetchPromise = null;
            }
        })();

        return ChatGPTAdapter._tokenFetchPromise;
    },

    // ============================================
    // HAR-VERIFIED: Anti-bot headers matching real browser requests
    // Headers: Authorization, OAI-Device-Id, OAI-Language, OAI-Client-Version, OAI-Client-Build-Number
    // ============================================
    _getHeaders: async () => {
        const headers = {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };

        // Add Bearer token (CRITICAL - HAR shows this on every request)
        const token = await ChatGPTAdapter._getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Read OAI-Device-Id from cookie (HAR: oai-did cookie)
        const deviceId = ChatGPTAdapter._getCookie('oai-did');
        if (deviceId) {
            headers['OAI-Device-Id'] = deviceId;
        }

        headers['OAI-Language'] = 'en-US';

        // Add OAI-Client-Version and OAI-Client-Build-Number
        // Try extracting from page scripts, fall back to reasonable defaults
        try {
            const nextData = extractFromNextData();
            const buildId = nextData?.buildId;
            if (buildId) {
                headers['OAI-Client-Version'] = `prod-${buildId}`;
            }
            // (Removed: a `<meta name="build-number">` selector for the
            // OAI-Client-Build-Number header. ChatGPT does NOT ship that
            // meta tag — the selector was always falsy and the header
            // never got set. If a future ChatGPT build adds it, re-add
            // the lookup. The header itself is optional; requests succeed
            // without it.)
        } catch (e) {
            // Ignore extraction errors
        }

        return headers;
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;
        const baseHeaders = await ChatGPTAdapter._getHeaders();
        const headers = { ...baseHeaders, ...options.headers };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });

                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to ChatGPT');
                }

                if (response.status === 429) {
                    // Rate limited - wait longer
                    const waitTime = Math.pow(2, attempt + 2) * 1000;
                    console.warn(`[ChatGPT] Rate limited, waiting ${waitTime}ms`);
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
        const allThreads = [];
        let offset = 0;
        const limit = 50;
        const seenIds = new Set();

        try {
            do {
                const result = await ChatGPTAdapter.getThreadsWithOffset(offset, limit);

                result.threads.forEach(t => {
                    if (!seenIds.has(t.uuid)) {
                        seenIds.add(t.uuid);
                        allThreads.push(t);
                    }
                });

                if (progressCallback) {
                    progressCallback(allThreads.length, result.hasMore);
                }

                offset += limit;

                if (!result.hasMore) break;
                if (allThreads.length > 5000) break; // Safety limit

                await new Promise(r => setTimeout(r, 300)); // Rate limit

            } while (true);

            // Update cache
            ChatGPTAdapter._allThreadsCache = allThreads;
            ChatGPTAdapter._cacheTimestamp = Date.now();

            return allThreads;
        } catch (error) {
            console.error('[ChatGPT] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    getThreadsWithOffset: async (offset = 0, limit = 50) => {
        // Check cache validity
        const cacheValid = ChatGPTAdapter._cacheTimestamp > Date.now() - ChatGPTAdapter._cacheTTL;

        if (cacheValid && ChatGPTAdapter._allThreadsCache.length > 0 && offset < ChatGPTAdapter._allThreadsCache.length) {
            const threads = ChatGPTAdapter._allThreadsCache.slice(offset, offset + limit);
            return {
                threads,
                offset,
                hasMore: offset + limit < ChatGPTAdapter._allThreadsCache.length,
                total: ChatGPTAdapter._allThreadsCache.length
            };
        }

        try {
            const baseUrl = platformConfig.getBaseUrl('ChatGPT');
            const endpoint = platformConfig.buildEndpoint('ChatGPT', 'conversations');
            // Include is_archived & is_starred params (HAR-verified)
            const url = `${baseUrl}${endpoint}?offset=${offset}&limit=${limit}&order=updated&is_archived=false&is_starred=false`;

            const response = await ChatGPTAdapter._fetchWithRetry(url);
            const data = await response.json();

            const threads = (data.items || []).map(t => ({
                uuid: t.id,
                title: DataExtractor.extractTitle(t, 'ChatGPT'),
                last_query_datetime: t.update_time,
                platform: 'ChatGPT'
            }));

            // Fix hasMore: use total field when available
            const total = data.total || -1;
            const hasMore = total > 0
                ? (offset + threads.length < total)
                : (data.has_missing_conversations || threads.length === limit);

            return {
                threads,
                offset,
                hasMore,
                total
            };
        } catch (error) {
            console.error('[ChatGPT] getThreadsWithOffset error:', error);
            throw error;
        }
    },

    // Standard page-based (backwards compatible)
    getThreads: async (page, limit) => {
        // NetworkInterceptor (passively-captured real API responses) is the only
        // acceptable fallback — DOM scraping was removed because the sidebar is
        // virtualized and would silently return a tiny subset of the user's history.
        if (window.NetworkInterceptor && window.NetworkInterceptor.getChatList().length > 0) {
            const all = window.NetworkInterceptor.getChatList();
            const start = (page - 1) * limit;
            return {
                threads: all.slice(start, start + limit),
                hasMore: start + limit < all.length,
                page
            };
        }

        const offset = (page - 1) * limit;
        const result = await ChatGPTAdapter.getThreadsWithOffset(offset, limit);
        return {
            threads: result.threads,
            hasMore: result.hasMore,
            page
        };
    },

    // ============================================
    // ENTERPRISE: Resilient thread detail fetching
    // FIXED: Added multiple endpoint fallbacks and better error handling
    // ============================================
    getThreadDetail: async (uuid) => {
        // Strategy 1: API fetch with retry (multiple endpoint attempts)
        const endpoints = [
            platformConfig.buildEndpoint('ChatGPT', 'conversationDetail', { uuid }), // Primary: /backend-api/conversation/{uuid}
            `/backend-api/conversation/${uuid}`, // Explicit fallback (Singular) - Verified by HAR
            `/api/conversation/${uuid}`         // Secondary fallback
        ];

        for (const endpoint of endpoints) {
            try {
                const baseUrl = platformConfig.getBaseUrl('ChatGPT');
                const url = `${baseUrl}${endpoint}`;
                console.log(`[ChatGPT] Trying endpoint: ${endpoint}`);

                const response = await ChatGPTAdapter._fetchWithRetry(url, {}, 2);
                const data = await response.json();

                // Validate response structure
                if (!data || (!data.mapping && !data.messages && !data.conversation)) {
                    console.warn('[ChatGPT] Invalid response structure from:', endpoint);
                    continue;
                }

                const entries = transformChatGPTData(data);

                if (entries.length > 0) {
                    console.log(`[ChatGPT] ✓ API success: ${entries.length} entries for ${uuid}`);
                    return {
                        uuid,
                        entries,
                        title: data.title || 'ChatGPT Chat',
                        platform: 'ChatGPT',
                        model: data.default_model_slug || '',
                        gizmo_id: data.gizmo_id || '',
                        create_time: data.create_time || null
                    };
                }
            } catch (error) {
                console.warn(`[ChatGPT] Endpoint ${endpoint} failed:`, error.message);
                continue;
            }
        }

        // Strategy 2: Return helpful error if API fails
        console.error('[ChatGPT] All API endpoints failed for conversation:', uuid);
        return {
            uuid,
            title: 'Unable to fetch - API error',
            platform: 'ChatGPT',
            entries: [],
            error: 'All API endpoints failed. Please check your login status.'
        };
    },

    getSpaces: async () => [],
};

function transformChatGPTData(data) {
    // ChatGPT returns either a tree structure (mapping) or a linear list (messages/conversation)
    const entries = [];

    try {
        let orderedMessages = [];

        // Strategy 1: Mapping (Tree Structure) - Standard for web interface
        if (data.mapping) {
            console.log('[ChatGPT] Transforming using Tree Strategy (mapping)');
            const mapping = data.mapping;

            // Find root
            let currentNodeId = null;
            for (const [id, node] of Object.entries(mapping)) {
                if (!node.parent) {
                    currentNodeId = id;
                    break;
                }
            }
            if (!currentNodeId && Object.keys(mapping).length > 0) {
                currentNodeId = Object.keys(mapping)[0];
            }

            const visited = new Set();
            while (currentNodeId && !visited.has(currentNodeId)) {
                visited.add(currentNodeId);
                const node = mapping[currentNodeId];
                if (node?.message) {
                    orderedMessages.push(node.message);
                }
                if (node?.children && node.children.length > 0) {
                    // Follow the LAST child: ChatGPT appends a new child for each
                    // regeneration, so the last child is the most recently selected branch.
                    // Using children[0] (first) would always export the original/stale answer.
                    currentNodeId = node.children[node.children.length - 1];
                } else {
                    break;
                }
            }

            // Fallback: if traversal failed but we have mapping
            if (orderedMessages.length === 0) {
                // console.warn('[ChatGPT] Tree traversal yielded 0 messages, using fallback sort');
                Object.values(mapping).forEach(node => {
                    if (node?.message) orderedMessages.push(node.message);
                });
                orderedMessages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
            }
        }
        // Strategy 2: Linear Messages - Common in some API responses or exports
        else if (data.messages && Array.isArray(data.messages)) {
            console.log('[ChatGPT] Transforming using Linear Strategy (messages)');
            orderedMessages = [...data.messages];
            orderedMessages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
        }
        // Strategy 3: Conversation Object (Wrapper)
        else if (data.conversation && data.conversation.messages) {
            console.log('[ChatGPT] Transforming using Conversation Strategy');
            orderedMessages = [...data.conversation.messages];
            orderedMessages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
        }
        else {
            console.warn('[ChatGPT] Unknown data structure:', Object.keys(data));
        }

        // Helper to safely extract text content.
        // Content types observed in HAR (2026-05): text, multimodal_text, code,
        // execution_output, tether_browsing_display, tether_quote,
        // model_editable_context, system_error, thoughts, reasoning_recap.
        const extractContent = (msg) => {
            const contentType = msg.content?.content_type;
            // Skip only truly non-exportable system types
            const skipTypes = ['model_editable_context', 'system_error'];
            if (contentType && skipTypes.includes(contentType)) {
                return '';
            }

            // GPT-5 reasoning models emit `thoughts` (full chain-of-thought as
            // an array of {summary, content} steps) and `reasoning_recap` (a
            // short timing summary like "Thought for 12s"). Both were silently
            // dropped before. Render thoughts as a blockquoted reasoning block
            // so it doesn't visually compete with the answer; skip the recap
            // entirely (it's just a time tag with no content).
            if (contentType === 'thoughts' && Array.isArray(msg.content?.thoughts)) {
                const steps = msg.content.thoughts
                    .map(t => {
                        const summary = t.summary ? `**${t.summary}**\n` : '';
                        const body = (t.content || '').trim();
                        return `${summary}${body}`.trim();
                    })
                    .filter(Boolean);
                if (steps.length === 0) return '';
                const blockquoted = steps.join('\n\n').replace(/\n/g, '\n> ');
                return `\n> 💭 **Reasoning:**\n> ${blockquoted}\n`;
            }
            if (contentType === 'reasoning_recap') {
                // Just a timing tag ("Thought for 12s"). Not worth surfacing.
                return '';
            }

            // Handle tool/function call results with structured output
            if (contentType === 'code' && msg.content?.text) {
                // Code interpreter execution result
                return `\n\`\`\`\n${msg.content.text}\n\`\`\`\n`;
            }

            if (contentType === 'execution_output' && msg.content?.text) {
                return `\n> **Code output:**\n\`\`\`\n${msg.content.text}\n\`\`\`\n`;
            }

            if (contentType === 'tether_browsing_display' && msg.content?.result) {
                // Browsing result — include source URL and snippet
                const result = msg.content.result;
                return `\n> 🌐 **Browsing:** ${result.title || ''}\n> ${result.url || ''}\n> ${result.snippet || ''}\n`;
            }

            if (contentType === 'tether_quote' && msg.content?.text) {
                // Quote from browsing — include as blockquote
                return `\n> 📝 ${msg.content.text}\n`;
            }

            // Multimodal text content (text mixed with images/files)
            if (contentType === 'multimodal_text' && msg.content?.parts) {
                const parts = [];
                for (const p of msg.content.parts) {
                    if (typeof p === 'string') {
                        parts.push(p);
                    } else if (p && typeof p === 'object') {
                        if (p.content_type === 'image_asset_pointer') {
                            const desc = p.metadata?.dalle?.prompt || 'Generated image';
                            parts.push(`🖼️ [Image: ${desc}]`);
                        } else if (p.content_type === 'file_asset_pointer') {
                            const fileName = p.metadata?.file_name || p.name || 'Uploaded file';
                            parts.push(`📎 [File: ${fileName}]`);
                        } else if (p.text) {
                            parts.push(p.text);
                        }
                    }
                }
                return parts.join('\n');
            }

            if (msg.content?.parts && Array.isArray(msg.content.parts)) {
                const textParts = [];
                for (const p of msg.content.parts) {
                    if (typeof p === 'string') {
                        textParts.push(p);
                    } else if (p && typeof p === 'object') {
                        // Handle structured parts (image metadata, file references, etc.)
                        if (p.content_type === 'image_asset_pointer') {
                            const desc = p.metadata?.dalle?.prompt || 'Generated image';
                            textParts.push(`🖼️ [Image: ${desc}]`);
                        } else if (p.text) {
                            textParts.push(p.text);
                        }
                    }
                }
                return textParts.join('\n');
            }
            if (msg.content?.text) return msg.content.text;
            if (typeof msg.content === 'string') return msg.content;
            return '';
        };

        // Process ordered messages into Q&A pairs
        let currentEntry = null;
        orderedMessages.forEach(msg => {
            const role = msg.author?.role || msg.role;
            const content = extractContent(msg);

            // Skip system messages or empty content
            if (!content.trim()) return;

            if (role === 'user') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: content.trim(),
                    blocks: []
                };
            } else if ((role === 'assistant' || role === 'tool') && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: content.trim() }
                });
            }
        });

        if (currentEntry) entries.push(currentEntry);

        console.log(`[ChatGPT] Extracted ${entries.length} entries from ${orderedMessages.length} messages`);

    } catch (e) {
        console.error('[OmniExporter] ChatGPT transform error:', e);
    }

    return entries;
}

/**
 * Extract data from Next.js hydration data (ChatGPT)
 * Valid "HTML Page" source that is not DOM scraping
 */
function extractFromNextData() {
    try {
        const script = document.getElementById('__NEXT_DATA__');
        if (!script) return null;
        return JSON.parse(script.textContent);
    } catch (e) {
        return null;
    }
}

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
window.ChatGPTAdapter = ChatGPTAdapter;
