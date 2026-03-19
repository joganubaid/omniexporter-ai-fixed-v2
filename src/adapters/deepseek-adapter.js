// OmniExporter AI - DeepSeek Adapter (Enterprise Edition)
// Support for DeepSeek AI (chat.deepseek.com)
// Enterprise-level implementation matching Perplexity quality
// VERIFIED API: /api/v0/chat_session/fetch_page (discovered 2026-01-10)
// NOW USES: platformConfig for centralized configuration
"use strict";

var DeepSeekAdapter = window.DeepSeekAdapter = window.DeepSeekAdapter || {
    name: "DeepSeek",

    // ============================================
    // ENTERPRISE: Use platformConfig for endpoints
    // ============================================
    get config() {
        return typeof platformConfig !== 'undefined'
            ? platformConfig.getConfig('DeepSeek')
            : null;
    },

    get apiBase() {
        const config = this.config;
        return config ? config.baseUrl + '/api/v0' : 'https://chat.deepseek.com/api/v0';
    },

    // Cursor cache for pagination (enables Load All and offset-based fetching)
    _cursorCache: [],
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 300000, // MIN-10 FIX: 5 minute cache (was 1 minute — too short for paginated access)
    _cachedToken: null, // PERF-2 FIX: In-memory token cache to avoid localStorage scan on every call
    _tokenFetchPromise: null, // Dedup concurrent API token fetches

    /**
     * Extract conversation UUID from the current page URL.
     * @param {string} url - The full page URL
     * @returns {string|null} The extracted UUID, or null if not found
     */
    extractUuid: (url) => {
        // Try platformConfig patterns first
        if (typeof platformConfig !== 'undefined') {
            const uuid = platformConfig.extractUuid('DeepSeek', url);
            if (uuid) return uuid;
        }

        // Fallback patterns
        // Pattern 1: /a/chat/s/{uuid} or /chat/s/{uuid}
        const chatMatch = url.match(/chat\.deepseek\.com(?:\/a)?\/chat\/s?\/([a-zA-Z0-9-]+)/);
        if (chatMatch) return chatMatch[1];

        // Pattern 2: session parameter
        const sessionMatch = url.match(/[?&](?:s|session|chat_session_id)=([a-zA-Z0-9-]+)/);
        if (sessionMatch) return sessionMatch[1];

        // Pattern 3: UUID in URL
        const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) return uuidMatch[1];

        return null;
    },

    // ============================================
    // ENTERPRISE: Get auth token from localStorage
    // DeepSeek stores token as JSON: {value: "...", ...}
    // FIXED: Added multiple token source attempts
    // ============================================
    _getAuthToken: () => {
        // PERF-2 FIX: Return cached token first to avoid repeated localStorage scanning.
        if (DeepSeekAdapter._cachedToken) return DeepSeekAdapter._cachedToken;

        try {
            // HAR-VERIFIED (2026-02-17): Token is in localStorage under 'userToken'
            // It's a plain string, NOT JSON: "1N55fnYvy+9Zfj5q2Gsk35FZKeph5IU1tfwSRwTb..."
            // Also returned in /api/v0/users/current as biz_data.token
            const tokenKeys = [
                'userToken',
                'deepseek_token',
                'auth_token',
                'access_token',
                'ds_token',
                'token'
            ];

            for (const key of tokenKeys) {
                try {
                    const tokenData = localStorage.getItem(key);
                    if (!tokenData) continue;

                    // Try parsing as JSON first (some versions store as {value: "..."})
                    try {
                        const parsed = JSON.parse(tokenData);
                        const token = parsed.value || parsed.token || parsed.access_token || parsed.biz_data?.token;
                        if (token && token.length > 10) {
                            console.log(`[DeepSeek] Found JSON token in localStorage key: ${key}`);
                            DeepSeekAdapter._cachedToken = token;
                            return token;
                        }
                    } catch {
                        // Plain string token (HAR-verified format)
                        if (tokenData.length > 10) {
                            console.log(`[DeepSeek] Found plain token in localStorage key: ${key}`);
                            DeepSeekAdapter._cachedToken = tokenData;
                            return tokenData;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            // BUG-3 FIX: Removed broad localStorage scan that matched ANY base64-ish string.
            // The scan was too permissive — it could return Stripe keys, analytics tokens, etc.
            // as a Bearer token. The proper async fallback is _fetchTokenFromAPI().

            // HAR-verified fallback: try reading token from cookies (specific patterns only)
            try {
                const cookiePatterns = ['ds_auth', 'user_token', 'auth_token', 'deepseek_token', 'token'];
                for (const name of cookiePatterns) {
                    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
                    if (match && match[1] && match[1].length > 10) {
                        console.log(`[DeepSeek] Found token in cookie: ${name}`);
                        const token = decodeURIComponent(match[1]);
                        DeepSeekAdapter._cachedToken = token;
                        return token;
                    }
                }
            } catch (e) {
                // Cookie access may fail — ignore
            }

            console.warn('[DeepSeek] No auth token found in localStorage or cookies');
            return null;
        } catch (e) {
            console.error('[DeepSeek] Error reading auth token:', e.message);
            return null;
        }
    },

    // HAR-VERIFIED: Token is also returned by /api/v0/users/current as biz_data.token
    // Use this as ultimate async fallback when _getAuthToken() returns null
    _fetchTokenFromAPI: async () => {
        // Dedup concurrent API token fetch requests
        if (DeepSeekAdapter._tokenFetchPromise) {
            return DeepSeekAdapter._tokenFetchPromise;
        }

        DeepSeekAdapter._tokenFetchPromise = (async () => {
            try {
                const resp = await fetch('https://chat.deepseek.com/api/v0/users/current', {
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json',
                        'x-client-platform': 'web',
                        'x-client-version': '1.7.1',
                        'x-client-locale': 'en_US',
                        'x-app-version': '20241129.1'
                    }
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                const token = data?.data?.biz_data?.token || data?.biz_data?.token;
                if (token) {
                    console.log('[DeepSeek] Token retrieved from /users/current API');
                    // SEC-3 FIX: Cache in-memory only — do NOT write back to localStorage.
                    // Any injected script on the same origin can read localStorage.
                    DeepSeekAdapter._cachedToken = token;
                }
                return token || null;
            } catch (e) {
                console.warn('[DeepSeek] Could not fetch token from API:', e.message);
                return null;
            } finally {
                DeepSeekAdapter._tokenFetchPromise = null;
            }
        })();

        return DeepSeekAdapter._tokenFetchPromise;
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff + Auth
    // HAR-verified: DeepSeek requires x-client-* headers on ALL requests
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;

        // HAR-verified: token is plain string like "1N55fnYvy+9Zfj5..."
        // Try localStorage first, fall back to live API fetch
        let token = DeepSeekAdapter._getAuthToken();
        if (!token) {
            console.log('[DeepSeek] No token in storage, trying live API fetch...');
            token = await DeepSeekAdapter._fetchTokenFromAPI();
        }

        const headers = {
            'Accept': 'application/json',
            // HAR-verified (2026-03-16): DeepSeek requires these headers on every API call
            'x-client-platform': 'web',
            'x-client-version': '1.7.1',
            'x-client-locale': 'en_US',
            'x-client-timezone-offset': String(-(new Date().getTimezoneOffset())),
            'x-app-version': '20241129.1',
            ...options.headers
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });
                if (response.ok) return response;
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to DeepSeek');
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
    // ENTERPRISE: Fetch single page with cursor
    // ============================================
    _fetchPage: async (cursor = null, limit = 50) => {
        // HAR-VERIFIED (2026-02-17):
        // URL: /api/v0/chat_session/fetch_page?lte_cursor.pinned=false
        // For pagination: add &lte_cursor.updated_at={last_session.updated_at}&lte_cursor.id={last_session.id}
        // Response: { data: { biz_data: { chat_sessions: [...], has_more: bool } } }
        // NO cursor field returned — derive next cursor from last session's updated_at + id
        let url = `${DeepSeekAdapter.apiBase}/chat_session/fetch_page?lte_cursor.pinned=false`;
        if (cursor) {
            // cursor is an object: { updated_at, id }
            // Note: typeof null === 'object', so guard against null explicitly
            if (cursor !== null && typeof cursor === 'object') {
                url += `&lte_cursor.updated_at=${cursor.updated_at}&lte_cursor.id=${cursor.id}`;
            } else {
                url += `&lte_cursor.updated_at=${encodeURIComponent(cursor)}`;
            }
        }

        const response = await DeepSeekAdapter._fetchWithRetry(url);
        const data = await response.json();

        // HAR-verified path: data.data.biz_data.chat_sessions + data.data.biz_data.has_more
        const bizData = data.data?.biz_data || data.biz_data || data.data || data;
        const sessions = bizData.chat_sessions || bizData.sessions || [];
        // HAR-verified: has_more is direct boolean in biz_data (no cursor field)
        const hasMore = bizData.has_more === true;
        // Next cursor = last session's { updated_at, id }
        const nextCursor = hasMore && sessions.length > 0
            ? { updated_at: sessions[sessions.length - 1].updated_at,
                id: sessions[sessions.length - 1].id }
            : null;

        const threads = sessions.map(chat => ({
            uuid: chat.id || chat.chat_session_id || chat.session_id,
            title: chat.title || chat.name || 'DeepSeek Chat',
            platform: 'DeepSeek',
            // updated_at is a Unix timestamp float (e.g. 1771315969.783)
            last_query_datetime: chat.updated_at != null
                ? new Date(chat.updated_at * 1000).toISOString()
                : new Date().toISOString()
        }));

        return { threads, nextCursor, hasMore };
    },

    // ============================================
    // ENTERPRISE: Fetch ALL threads (Load All)
    // ============================================
    getAllThreads: async (progressCallback = null) => {
        const allThreads = [];
        let cursor = null;
        let pageNum = 0;
        const seenIds = new Set();

        try {
            do {
                const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(cursor, 50);

                // Dedupe threads
                threads.forEach(t => {
                    if (!seenIds.has(t.uuid)) {
                        seenIds.add(t.uuid);
                        allThreads.push(t);
                    }
                });

                // Store cursor for later offset-based access
                if (cursor) {
                    DeepSeekAdapter._cursorCache.push({ cursor, index: allThreads.length - threads.length });
                }

                cursor = nextCursor;
                pageNum++;

                // Progress callback for UI
                if (progressCallback) {
                    progressCallback(allThreads.length, hasMore);
                }

                // Safety limit
                if (pageNum > 100 || allThreads.length > 5000) break;

                // Rate limiting
                if (hasMore) await new Promise(r => setTimeout(r, 300));

            } while (cursor);

            // Update cache
            DeepSeekAdapter._allThreadsCache = allThreads;
            DeepSeekAdapter._cacheTimestamp = Date.now();

            return allThreads;
        } catch (error) {
            console.error('[DeepSeekAdapter] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching (for options.js)
    // ============================================
    /**
     * Fetch threads using offset-based pagination with cursor caching.
     * @param {number} offset - Number of threads to skip
     * @param {number} limit - Maximum number of threads to return
     * @returns {Promise<{threads: Array, offset: number, hasMore: boolean, total: number}>}
     */
    getThreadsWithOffset: async (offset = 0, limit = 50) => {
        // Check cache validity
        const cacheValid = DeepSeekAdapter._cacheTimestamp > Date.now() - DeepSeekAdapter._cacheTTL;

        if (cacheValid && DeepSeekAdapter._allThreadsCache.length > 0) {
            // Return from cache
            const threads = DeepSeekAdapter._allThreadsCache.slice(offset, offset + limit);
            return {
                threads,
                offset,
                hasMore: offset + limit < DeepSeekAdapter._allThreadsCache.length,
                total: DeepSeekAdapter._allThreadsCache.length
            };
        }

        // First call - fetch first page and cache
        if (offset === 0) {
            const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(null, limit);
            DeepSeekAdapter._cursorCache = [{ cursor: null, index: 0 }];
            if (nextCursor) {
                DeepSeekAdapter._cursorCache.push({ cursor: nextCursor, index: limit });
            }
            return { threads, offset: 0, hasMore, total: hasMore ? -1 : threads.length };
        }

        // Find closest cursor for this offset
        let closestCursor = null;
        let closestIndex = 0;
        for (const cached of DeepSeekAdapter._cursorCache) {
            if (cached.index <= offset && cached.index > closestIndex) {
                closestIndex = cached.index;
                closestCursor = cached.cursor;
            }
        }

        // Fetch pages until we reach the offset
        let currentIndex = closestIndex;
        let cursor = closestCursor;
        let resultThreads = [];

        while (currentIndex < offset + limit) {
            const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(cursor, 50);

            // Add to cursor cache
            if (nextCursor && !DeepSeekAdapter._cursorCache.find(c => c.cursor === nextCursor)) {
                DeepSeekAdapter._cursorCache.push({ cursor: nextCursor, index: currentIndex + threads.length });
            }

            // Collect threads in range
            threads.forEach((t, i) => {
                const globalIndex = currentIndex + i;
                if (globalIndex >= offset && globalIndex < offset + limit) {
                    resultThreads.push(t);
                }
            });

            currentIndex += threads.length;
            cursor = nextCursor;

            if (!hasMore || !cursor) break;
            await new Promise(r => setTimeout(r, 200));
        }

        return {
            threads: resultThreads,
            offset,
            hasMore: cursor !== null,
            total: -1
        };
    },

    // ============================================
    // Standard getThreads (page-based, backwards compatible)
    // ============================================
    /**
     * Fetch a page of conversation threads (page-based, backwards compatible).
     * @param {number} page - One-based page number
     * @param {number} limit - Maximum threads per page
     * @param {string|null} spaceId - Optional space/workspace filter
     * @returns {Promise<{threads: Array, hasMore: boolean, page: number}>}
     * @throws {Error} If the API request fails
     */
    getThreads: async (page = 1, limit = 50, spaceId = null) => {
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

        // Use offset-based internally
        const offset = (page - 1) * limit;
        const result = await DeepSeekAdapter.getThreadsWithOffset(offset, limit);

        return {
            threads: result.threads,
            hasMore: result.hasMore,
            page
        };
    },

    // ============================================
    // Thread Detail - FIXED: Multiple endpoint attempts and better parsing
    // Messages are in data.biz_data.chat_messages
    // Role is 'USER' or 'ASSISTANT' (uppercase)
    // ============================================
    /**
     * Fetch full message detail for a conversation by UUID.
     * @param {string} uuid - The chat session UUID
     * @returns {Promise<object>} Structured conversation data with entries array
     * @throws {Error} If the conversation cannot be fetched or has no content
     */
    getThreadDetail: async (uuid) => {
        console.log(`[DeepSeek] Fetching thread detail for UUID: ${uuid}`);

        // ── Helper: extract text content from any message shape ──────────
        // HAR-VERIFIED (2026-02-17): DeepSeek messages do NOT use a 'content' field.
        // Real structure: { role, fragments: [{type:"text",content:"..."},...], ... }
        // content field is always empty string ""; real text is in fragments[].content
        // HAR-VERIFIED 2026-03-16: DeepSeek R1 uses <think>...</think> tags for reasoning
        const dsExtractContent = (msg) => {
            try {
                // PRIMARY: fragments array (HAR-verified real structure)
                // fragments = [{type: "text", content: "..."}, {type: "thinking", content: "..."}, ...]
                if (Array.isArray(msg.fragments) && msg.fragments.length > 0) {
                    const parts = [];
                    for (const f of msg.fragments) {
                        const text = f?.content ?? f?.text ?? f?.body ?? f?.value ?? '';
                        const fragText = typeof text === 'string' ? text : '';
                        if (!fragText) continue;

                        // Handle thinking/reasoning fragments separately
                        if (f?.type === 'thinking' || f?.type === 'reasoning') {
                            parts.push(`\n> 💭 **Thinking:**\n> ${fragText.replace(/\n/g, '\n> ')}\n`);
                        } else {
                            parts.push(fragText);
                        }
                    }
                    if (parts.length > 0) {
                        let result = parts.join('').trim();
                        // Handle inline <think> tags in content (DeepSeek R1 format)
                        result = result.replace(/<think>([\s\S]*?)<\/think>/g, (_, thinkContent) => {
                            return `\n> 💭 **Thinking:**\n> ${thinkContent.trim().replace(/\n/g, '\n> ')}\n`;
                        });
                        return result;
                    }
                }

                // SECONDARY: content field (may be non-empty in some API versions)
                const raw = msg.content ?? msg.text ?? msg.message ?? '';
                if (typeof raw === 'string' && raw.trim()) {
                    // Handle <think> tags in raw content too
                    let result = raw.trim();
                    result = result.replace(/<think>([\s\S]*?)<\/think>/g, (_, thinkContent) => {
                        return `\n> 💭 **Thinking:**\n> ${thinkContent.trim().replace(/\n/g, '\n> ')}\n`;
                    });
                    return result;
                }
                if (Array.isArray(raw) && raw.length > 0) {
                    return raw.map(b => (typeof b === 'string' ? b : (b?.text ?? b?.content ?? ''))).filter(Boolean).join('\n').trim();
                }
                if (raw && typeof raw === 'object') {
                    const t = raw.text ?? raw.content ?? raw.value ?? '';
                    if (t) return t.toString().trim();
                }

                return '';
            } catch (e) { return ''; }
        };

        // ── Helper: build entries from raw messages ────────────────────────
        const dsParseMessages = (messages) => {
            const entries = [];
            let pendingQuery = '';
            messages.forEach((msg, idx) => {
                const role = (msg.role ?? msg.author ?? msg.sender ?? msg.type ?? '').toString().toLowerCase();
                const content = dsExtractContent(msg);
                if (idx === 0) {
                    const fragCount = Array.isArray(msg.fragments) ? msg.fragments.length : 0;
                    const fragPreview = fragCount > 0 ? JSON.stringify(msg.fragments[0]).substring(0, 80) : 'none';
                    console.log(`[DeepSeek] msg[0] keys=${Object.keys(msg).join(',')}, role="${role}", fragments=${fragCount}, frag[0]="${fragPreview}", extracted="${content.substring(0,60)}"`);
                }
                if (!content) return;
                const isUser = role === 'user' || role === 'human' || (role === '' && idx % 2 === 0);
                const isAsst = role === 'assistant' || role === 'bot' || role === 'ai' || (role === '' && idx % 2 === 1);
                if (isUser) { pendingQuery = content; }
                else if (isAsst) { entries.push({ query: pendingQuery || `[msg ${idx}]`, answer: content }); pendingQuery = ''; }
            });
            // Fallback: if no pairs parsed, use alternating positions
            if (entries.length === 0 && messages.length > 0) {
                console.warn(`[DeepSeek] No pairs from role parsing — using positional fallback`);
                for (let i = 0; i < messages.length; i += 2) {
                    const q = dsExtractContent(messages[i]);
                    const a = i + 1 < messages.length ? dsExtractContent(messages[i + 1]) : '';
                    if (q || a) entries.push({ query: q || `[msg ${i+1}]`, answer: a || '[no response]' });
                }
            }
            // Last resort: one entry per message
            if (entries.length === 0) {
                messages.forEach((msg, idx) => {
                    const c = dsExtractContent(msg);
                    if (c) entries.push({ query: `[Message ${idx + 1}]`, answer: c });
                });
            }
            return entries;
        };

        // HAR-verified primary endpoint: /api/v0/chat/history_messages?chat_session_id={uuid}&cache_version=2
        // Fallback endpoints removed — they are 404 and waste time
        const endpoints = [
            `/chat/history_messages?chat_session_id=${uuid}&cache_version=2`,
            `/chat/history_messages?chat_session_id=${uuid}`,
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`[DeepSeek] Trying endpoint: ${endpoint}`);
                const response = await DeepSeekAdapter._fetchWithRetry(
                    `${DeepSeekAdapter.apiBase}${endpoint}`, {}, 2
                );
                const data = await response.json();
                console.log(`[DeepSeek] Response received for ${endpoint}`);

                // HAR-verified path: data.data.biz_data.chat_messages
                const biz = data?.data?.biz_data ?? data?.biz_data ?? data?.data ?? data ?? {};
                const messages = biz.chat_messages ?? biz.messages ?? biz.chat ?? null;
                const sessionInfo = biz.chat_session ?? biz.session ?? null;

                // Empty conversation (valid state — new chat)
                if (!messages || messages.length === 0) {
                    if (sessionInfo) {
                        const t = sessionInfo.title ?? `DeepSeek Thread ${uuid.slice(0, 8)}`;
                        console.log(`[DeepSeek] Empty conversation: ${t}`);
                        return { uuid, title: t, platform: 'DeepSeek', entries: [] };
                    }
                    console.warn(`[DeepSeek] No messages and no session in ${endpoint}`);
                    continue;
                }

                console.log(`[DeepSeek] Found ${messages.length} messages — parsing...`);
                const entries = dsParseMessages(messages);
                const title = sessionInfo?.title
                    ?? data?.data?.title ?? data?.title
                    ?? entries[0]?.query?.substring(0, 100)
                    ?? `DeepSeek Thread ${uuid.slice(0, 8)}`;

                console.log(`[DeepSeek] ✓ Done: ${entries.length} Q&A pairs, title="${title}"`);
                // Extract model from session info if available
                const model = sessionInfo?.model || sessionInfo?.agent_mode || data?.data?.model || '';
                return { uuid, title, platform: 'DeepSeek', model: model || 'DeepSeek', entries };

            } catch (e) {
                console.warn(`[DeepSeek] Endpoint ${endpoint} failed: ${e.message}`);
            }
        }

        // All endpoints failed
        const message = 'DeepSeek API unreachable - Check login or try refreshing';
        console.error(`[DeepSeek] All API endpoints failed`);
        if (typeof Logger !== 'undefined') {
            Logger.error('DeepSeekAdapter', 'getThreadDetail failed', { error: message, uuid });
        }
        throw new Error(message);
    },




    getSpaces: async () => []
};

window.DeepSeekAdapter = DeepSeekAdapter;
