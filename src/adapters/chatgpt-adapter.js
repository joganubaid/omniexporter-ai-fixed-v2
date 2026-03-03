// OmniExporter AI - ChatGPT Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

const ChatGPTAdapter = {
    name: "ChatGPT",

    // Cache for pagination
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    // Cache for Bearer token
    _accessToken: null,
    _tokenExpiry: 0,

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
        }
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

        // Fix #1: Add Bearer token (CRITICAL - HAR shows this on every request)
        const token = await ChatGPTAdapter._getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Fix #3: Read OAI-Device-Id from cookie (HAR: oai-did cookie)
        const deviceId = ChatGPTAdapter._getCookie('oai-did');
        if (deviceId) {
            headers['OAI-Device-Id'] = deviceId;
        }

        headers['OAI-Language'] = 'en-US';

        // Fix #2: Add OAI-Client-Version and OAI-Client-Build-Number
        // Try extracting from page scripts, fall back to reasonable defaults
        try {
            const nextData = extractFromNextData();
            const buildId = nextData?.buildId;
            if (buildId) {
                headers['OAI-Client-Version'] = `prod-${buildId}`;
            }
            // Try to extract build number from page scripts
            const buildNumMeta = document.querySelector('meta[name="build-number"]');
            if (buildNumMeta) {
                headers['OAI-Client-Build-Number'] = buildNumMeta.content;
            }
        } catch (e) {
            // Ignore extraction errors
        }

        return headers;
    },

    /**
     * Restore Auth from __NEXT_DATA__ if needed
     */
    _refreshAuth: () => {
        const nextData = extractFromNextData();
        if (nextData?.props?.pageProps?.user?.id) {
            console.log('[ChatGPT] Verified Next.js Auth User:', nextData.props.pageProps.user.id);
        }
        return true;
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
            // Fix #4: Include is_archived & is_starred params (HAR-verified)
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
        try {
            // Check NetworkInterceptor first
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
            try {
                const result = await ChatGPTAdapter.getThreadsWithOffset(offset, limit);
                return {
                    threads: result.threads,
                    hasMore: result.hasMore,
                    page
                };
            } catch (apiError) {
                console.warn('[ChatGPT] API failed, trying DOM fallback:', apiError.message);

                // DOM Fallback - Scrape sidebar
                const threads = [];
                const seenUuids = new Set();

                // Selectors for sidebar items
                const selectors = [
                    'a[href^="/c/"]',
                    'a[href^="/chat/"]',
                    'li a[href*="/c/"]',
                    'nav a'
                ];

                document.querySelectorAll(selectors.join(', ')).forEach(a => {
                    const href = a.getAttribute('href');
                    const match = href.match(/\/(?:c|chat)\/([a-zA-Z0-9-]+)/);
                    if (match && match[1]) {
                        const uuid = match[1];
                        if (!seenUuids.has(uuid)) {
                            // Try to get title from text content, clean up newlines/extra spaces
                            let title = a.textContent.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                            // Fallback if title is empty or "New Chat"
                            if (!title || title === 'New Chat') title = 'ChatGPT Thread';

                            threads.push({
                                uuid,
                                title: title,
                                last_query_datetime: new Date().toISOString(), // Approximation
                                platform: 'ChatGPT'
                            });
                            seenUuids.add(uuid);
                        }
                    }
                });

                console.log(`[ChatGPT] DOM fallback found ${threads.length} threads`);

                // Simple pagination for DOM results
                const start = (page - 1) * limit;
                return {
                    threads: threads.slice(start, start + limit),
                    hasMore: start + limit < threads.length,
                    page
                };
            }
        } catch (error) {
            console.error('[ChatGPT] getThreads failed completely:', error);
            throw error;
        }
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
                    return { uuid, entries, title: data.title || 'ChatGPT Chat', platform: 'ChatGPT' };
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

    getSpaces: async () => []
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
                    currentNodeId = node.children[0];
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

        // Helper to safely extract text content
        const extractContent = (msg) => {
            // Fix #5: Skip known non-text content types (blocklist approach)
            const contentType = msg.content?.content_type;
            const skipTypes = ['model_editable_context', 'system_error', 'tether_browsing_display', 'tether_quote'];
            if (contentType && skipTypes.includes(contentType)) {
                return '';
            }
            if (msg.content?.parts && Array.isArray(msg.content.parts)) {
                return msg.content.parts.filter(p => typeof p === 'string').join('\n');
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
