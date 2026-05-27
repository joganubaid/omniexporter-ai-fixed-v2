// OmniExporter AI - Gemini Adapter
// Talks to Google Gemini via the batchexecute RPC layer (rpcids MaZiqc for the
// chat list, hNvQHb for message detail). Session params (bl, f.sid, at) are
// pulled from the page via the gemini-inject.js content-script bridge.
"use strict";

// The historic page-world XHR interceptor (gemini-page-interceptor.js) used to
// bump Gemini's hNvQHb message-limit from 20 → 100. As of the 2026-05 builds
// Gemini's own frontend already sends 100, so the interceptor was a no-op and
// has been removed. The direct adapter call (getThreadDetail below) now sends
// 100 explicitly. If Gemini ever lowers the default again, re-introduce the
// interceptor as a web-accessible page-world script.

// =============================================
// MESSAGE BRIDGE - Connect to gemini-inject.js
// Listens for messages from page context scripts
// =============================================
var GeminiBridge = window.GeminiBridge = window.GeminiBridge || {
    pendingRequests: new Map(),
    isReady: false,
    // Cache session params to avoid repeated postMessage calls.
    // TTL is 60 s — short enough that a Gemini deploy (which changes the `bl` build-label)
    // won't leave stale params cached for long and cause 404s on every batchexecute call.
    // The cache is also invalidated explicitly when a batchexecute call returns 404.
    _sessionParamsCache: null,
    _sessionParamsCacheTime: 0,
    _sessionParamsCacheTTL: 60000,

    init() {
        // Mark as initialized immediately so the outer guard works correctly
        this._listenerAdded = true;
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            // Security: Only accept messages from Gemini origin
            if (event.origin !== 'https://gemini.google.com') return;
            if (!event.data || event.data.type !== 'OMNIEXPORTER_GEMINI') return;
            if (event.data.direction !== 'to-content') return;

            this.handleMessage(event.data);
        });
        console.log('[Gemini] Message bridge initialized');
    },

    handleMessage(message) {
        const { action, requestId, success, data, error } = message;

        switch (action) {
            case 'INJECT_READY':
                this.isReady = true;
                console.log('[Gemini] gemini-inject.js is ready');
                break;
            case 'RESPONSE':
                const pending = this.pendingRequests.get(requestId);
                if (pending) {
                    this.pendingRequests.delete(requestId);
                    if (success) {
                        pending.resolve(data);
                    } else {
                        pending.reject(new Error(error || 'Unknown error'));
                    }
                }
                break;
        }
    },

    // Send request to page context (gemini-inject.js)
    sendRequest(action, data = {}) {
        return new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 10000);

            // use specific origin instead of '*' to prevent token interception
            window.postMessage({
                type: 'OMNIEXPORTER_GEMINI',
                direction: 'to-page',
                requestId,
                action,
                data
            }, 'https://gemini.google.com');
        });
    },

    // Get auth token from page context
    async getAuthToken() {
        if (!this.isReady) return null;
        try {
            const result = await this.sendRequest('GET_AUTH_TOKEN');
            return result?.token || null;
        } catch {
            return null;
        }
    },

    // Get session parameters (at, bl, f.sid) from page context
    // These are required for every batchexecute call
    async getSessionParams() {
        // Return cache if valid
        const now = Date.now();
        if (this._sessionParamsCache && (now - this._sessionParamsCacheTime) < this._sessionParamsCacheTTL) {
            return this._sessionParamsCache;
        }

        if (!this.isReady) {
            console.warn('[Gemini] Bridge not ready, cannot get session params');
            return { at: null, bl: null, fsid: null };
        }

        try {
            const params = await this.sendRequest('GET_SESSION_PARAMS');
            if (params && params.at) {
                this._sessionParamsCache = params;
                this._sessionParamsCacheTime = now;
                console.log('[Gemini] Session params acquired:', {
                    at: '✓',
                    bl: params.bl || '✗',
                    fsid: params.fsid || '✗'
                });
            }
            return params || { at: null, bl: null, fsid: null };
        } catch (e) {
            console.warn('[Gemini] Failed to get session params:', e.message);
            return { at: null, bl: null, fsid: null };
        }
    },

    // Get global data from page context  
    async getGlobalData() {
        if (!this.isReady) return null;
        try {
            return await this.sendRequest('GET_GLOBAL_DATA');
        } catch {
            return null;
        }
    }
};

// Guard init() so only one window message listener is ever added.
// On SPA re-injection, window.GeminiBridge already exists (preserved by window.X || guard).
// Without this guard, each re-injection adds another listener, causing messages to be handled twice.
if (!GeminiBridge._listenerAdded) {
    GeminiBridge.init();
}

var GeminiAdapter = window.GeminiAdapter = window.GeminiAdapter || {
    name: "Gemini",

    // Request counter for _reqid parameter (HAR shows incrementing by 100000)
    _reqCounter: Math.floor(Math.random() * 100) * 100000,

    // ============================================
    // Use platformConfig for endpoints
    // ============================================
    get config() {
        return typeof platformConfig !== 'undefined'
            ? platformConfig.getConfig('Gemini')
            : null;
    },

    get apiBase() {
        const config = this.config;
        return config ? config.baseUrl + '/_/BardChatUi/data/batchexecute' : 'https://gemini.google.com/_/BardChatUi/data/batchexecute';
    },

    // Cache for pagination cursors
    _cursorCache: [],
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000,

    /**
     * Extract conversation UUID from the current page URL.
     * @param {string} url - The full page URL
     * @returns {string} The extracted UUID, or a stable fallback (never timestamp-based)
     */
    extractUuid: (url) => {
        // Normalise: Gemini's URL strips the `c_` prefix (/app/7703f71cf4997935)
        // but the RPC layer uses the prefixed form (c_7703f71cf4997935). Dedup
        // requires consistent keys, so we always return the prefixed form.
        const normalise = (id) => id && (id.startsWith('c_') ? id : `c_${id}`);

        if (typeof platformConfig !== 'undefined') {
            const uuid = platformConfig.extractUuid('Gemini', url);
            if (uuid) return normalise(uuid);
        }

        // Adapter-level fallback (used if platformConfig failed to load).
        // 16 hex chars after /app|chat|gem/, optional c_ prefix. Slugs like
        // /app/google-gemini and /app/download are agent/static pages, not chats.
        const chatMatch = url.match(/gemini\.google\.com\/(?:app|chat|gem)\/(c_[a-f0-9]{16}|[a-f0-9]{16})\b/);
        if (chatMatch) return normalise(chatMatch[1]);

        // No match → empty string (NOT a timestamp-based fallback, which would
        // generate a different "UUID" on every call and break dedup).
        return '';
    },

    // ============================================
    // Required headers for batchexecute
    // Source: HAR capture 2026-02-16
    // ============================================
    _getHeaders: () => {
        return {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-Same-Domain': '1',                                          // CRITICAL: Required by Gemini
            'x-goog-ext-73010989-jspb': '[0]',                            // HAR-verified extension header
            'x-goog-ext-525001261-jspb': '[1,null,null,null,null,null,null,null,[4]]', // HAR-verified
            'Origin': 'https://gemini.google.com',
            'Referer': 'https://gemini.google.com/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };
    },

    // ============================================
    // Get ALL threads (Load All feature)
    // Loop with cursor pagination instead of single page fetch
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const allThreads = [];
            const seenUuids = new Set();
            let cursor = null;
            let hasMore = true;
            let pageNum = 0;

            while (hasMore && pageNum < 100) { // Safety limit of 100 pages
                pageNum++;
                console.log(`[Gemini] Fetching page ${pageNum}, cursor=${cursor || 'none'}`);

                const result = await this.getThreads(pageNum, 100, cursor);

                // Add unique threads to allThreads
                for (const thread of result.threads) {
                    if (!seenUuids.has(thread.uuid)) {
                        seenUuids.add(thread.uuid);
                        allThreads.push(thread);
                    }
                }

                hasMore = result.hasMore && result.nextCursor;
                cursor = result.nextCursor;

                if (progressCallback) {
                    progressCallback(allThreads.length, hasMore);
                }

                // Exit if no more pages
                if (!hasMore) break;

                // Add a small delay between pages to avoid rate limiting
                await new Promise(r => setTimeout(r, 300));
            }

            // Update cache
            GeminiAdapter._allThreadsCache = allThreads;
            GeminiAdapter._cacheTimestamp = Date.now();

            console.log(`[Gemini] getAllThreads complete: ${allThreads.length} conversations`);
            return allThreads;
        } catch (error) {
            console.error('[Gemini] getAllThreads failed:', error);
            throw error;
        }
    },

    // (getThreadsWithOffset is defined further down — kept there because it
    // groups with the other offset/cursor pagination helpers.)

    // ============================================
    // Build batchexecute request body
    // f.req payload: [[[rpcid, JSON.stringify(payload), null, "generic"]]]
    // at param: XSRF token appended to body
    // ============================================
    _buildBatchRequest: (rpcid, payload, atToken = null) => {
        // f.req must be TRIPLE-nested [[[rpcid, data, null, "generic"]]]
        const inner = [[[rpcid, JSON.stringify(payload), null, "generic"]]];
        const reqData = JSON.stringify(inner);
        let body = `f.req=${encodeURIComponent(reqData)}`;
        if (atToken) {
            body += `&at=${encodeURIComponent(atToken)}&`;
        } else {
            body += '&';
        }
        return body;
    },

    // ============================================
    // Build batchexecute URL with all query params
    // Params from HAR: rpcids, source-path, bl, f.sid, hl, _reqid, rt
    //
    // TODO(v6): This URL is built by hand with 7 dynamic query params instead
    // of going through `platformConfig.buildEndpoint('Gemini', ...)`. Unlike
    // Grok/DeepSeek, the dynamic-param density here (bl from page bridge,
    // f.sid from page bridge, _reqid counter, source-path from page URL) may
    // make a generic registry expression awkward. If you do migrate, consider
    // adding template-variable support to platform-config.js first.
    // See README "Architecture Roadmap".
    // ============================================
    _buildBatchUrl: function (rpcid, sessionParams = {}) {
        const params = new URLSearchParams();
        params.set('rpcids', rpcid);
        // HAR-verified: Gemini's own frontend sends the current page path as
        // source-path (e.g. /app/<chatId> when on a specific chat). Mirror it
        // to look indistinguishable from real frontend traffic; falls back to
        // /app for non-chat contexts.
        params.set('source-path',
            (typeof window !== 'undefined' && window.location?.pathname) || '/app');

        // `bl` (build label) is required — Gemini 404s on every batchexecute
        // call without a valid current value. Don't silently fall back to a
        // hardcoded stale value: that just turns a clear "session params
        // missing" failure into a confusing 404 on the next call. Fail loud
        // so the user sees an actionable error and refreshes the tab.
        if (!sessionParams.bl) {
            throw new Error(
                'Gemini session not ready — could not read build label (bl) from page. ' +
                'Refresh the Gemini tab and try again.'
            );
        }
        params.set('bl', sessionParams.bl);

        // f.sid (session ID) — from WIZ_global_data.FdrFJe
        if (sessionParams.fsid) {
            params.set('f.sid', sessionParams.fsid);
        }

        // hl (language) — always "en" for English
        params.set('hl', 'en');

        // _reqid (request counter) — incrementing value 
        GeminiAdapter._reqCounter += 100000;
        params.set('_reqid', String(GeminiAdapter._reqCounter));

        // rt (response type) — always "c"
        params.set('rt', 'c');

        return `${GeminiAdapter.apiBase}?${params.toString()}`;
    },

    // ============================================
    // Retry wrapper for batchexecute calls. Mirrors the pattern in
    // ClaudeAdapter/GrokAdapter/ChatGPTAdapter so a single transient network
    // blip doesn't fail the whole export.
    //   401/403   → throws immediately (auth-required, retrying won't help)
    //   429       → exponential backoff (4s, 8s, 16s)
    //   5xx/other → exponential backoff (1s, 2s, 4s)
    // ============================================
    _fetchWithRetry: async function (url, options = {}, maxRetries = 3) {
        let lastError;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await Logger.tracedFetch(url, options,
                    { module: 'Gemini', label: `batchexecute attempt ${attempt + 1}/${maxRetries}` });
                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to Gemini');
                }

                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 2) * 1000;
                    console.warn(`[Gemini] Rate limited, waiting ${waitTime}ms`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }

                lastError = new Error(`Gemini API error: ${response.status}`);
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
    // Make batchexecute API call (uses _fetchWithRetry for resilience).
    // ============================================
    _batchExecute: async function (rpcid, payload) {
        // Get session params from page context
        const sessionParams = await GeminiBridge.getSessionParams();

        const url = this._buildBatchUrl(rpcid, sessionParams);
        const body = GeminiAdapter._buildBatchRequest(rpcid, payload, sessionParams.at);

        try {
            console.log(`[Gemini] Calling batchexecute: rpcid=${rpcid}, bl=${sessionParams.bl || 'fallback'}`);

            const response = await GeminiAdapter._fetchWithRetry(url, {
                method: 'POST',
                credentials: 'include',
                headers: GeminiAdapter._getHeaders(),
                body
            });

            const text = await response.text();
            console.log(`[Gemini] Raw response length: ${text.length} chars`);

            // Parse Google's batchexecute response format
            // Format: ")]}'\n\n<length>\n<JSON array>\n<length>\n<JSON array>\n..."
            return GeminiAdapter._parseBatchResponse(text, rpcid);
        } catch (error) {
            console.error('[Gemini] _batchExecute failed:', error.message);
            throw error;
        }
    },

    // ============================================
    // Parse batchexecute response
    // Response format: ")]}'\n\n105\n[[...JSON...]]\n25\n[[...JSON...]]\n"
    // The data line is the one containing ["wrb.fr", rpcid, dataStr, ...]
    // ============================================
    _parseBatchResponse: (text, rpcid) => {
        // Strip the XSSI prevention prefix
        const cleaned = text.replace(/^\)\]\}'/, '').trim();

        // Split into lines and find the JSON arrays
        const lines = cleaned.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('[')) continue;

            try {
                const parsed = JSON.parse(trimmed);

                // Look for the wrb.fr response matching our rpcid
                // Format: [["wrb.fr", "MaZiqc", "<data_json_string>", null, null, null, "generic"], ...]
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcid) {
                            console.log(`[Gemini] ✓ Found wrb.fr response for ${rpcid}`);
                            // item[2] is the JSON string containing the actual data
                            if (item[2]) {
                                try {
                                    return JSON.parse(item[2]);
                                } catch (parseErr) {
                                    console.warn('[Gemini] Failed to parse inner data:', parseErr.message);
                                    return item[2]; // Return raw string if parse fails
                                }
                            }
                            return null; // Empty response (e.g., "[]")
                        }
                    }
                }
            } catch (e) {
                // Not a valid JSON line, skip
            }
        }

        console.warn('[Gemini] No wrb.fr response found for rpcid:', rpcid);
        return null;
    },

    // ============================================
    // Get thread list via MaZiqc RPC
    // Payload: [13, null, [0, null, 1]]  (13 = category for conversations)
    // Response: [null, null, [[id, title, null, null, null, [secs, nanos], ...], ...]]
    // ============================================
    /**
     * Fetch a page of conversation threads via the MaZiqc batchexecute RPC.
     * @param {number} page - One-based page number
     * @param {number} limit - Maximum threads per page
     * @param {string|null} cursor - Pagination cursor from a previous response
     * @returns {Promise<{threads: Array, hasMore: boolean, page: number}>}
     * @throws {Error} If no threads can be retrieved from the API or DOM
     */
    // TODO(v6): The third arg (`cursor`) is platform-specific — Perplexity
    // takes `spaceId` here, other adapters take nothing. Standardise to
    // `getThreads(page, limit, options = {})` across all 6 adapters, with
    // `options.cursor` here. See README "Architecture Roadmap" → "Standardise
    // the getThreads() adapter signature".
    getThreads: async function (page = 1, limit = 20, cursor = null) {
        const threads = [];

        // FIX: Try the MaZiqc API FIRST (not NetworkInterceptor).
        // Previously, NetworkInterceptor was checked first — if it had intercepted even
        // a handful of threads (e.g. 13 from the sidebar), getThreads returned immediately
        // with that tiny subset and never called the API. This caused "Load All" to stop
        // at 13 threads regardless of how many the user actually had.
        // NetworkInterceptor is now used only as a fallback when the API fails.
        try {
            // HAR-verified payload: [13, null, [0, null, 1]]
            // 13 = conversation category ID (fixed)
            // null/cursor = pagination cursor
            // [0, null, 1] = sort/filter params
            const payload = [13, cursor, [0, null, 1]];
            console.log(`[Gemini] Fetching thread list with MaZiqc, cursor=${cursor || 'none'}`);

            const data = await GeminiAdapter._batchExecute('MaZiqc', payload);

            if (data) {
                // HAR-verified response structure:
                // data[0] = null (reserved)
                // data[1] = next cursor string (null if no more pages)
                // data[2] = conversations array [[id, title, null, null, null, [ts_secs, ts_nanos], ...], ...]
                let conversations = null;

                if (Array.isArray(data[2])) {
                    conversations = data[2];
                } else if (Array.isArray(data[0])) {
                    conversations = data[0];
                } else if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && typeof data[0][0] === 'string') {
                    conversations = data;
                }

                if (conversations && conversations.length > 0) {
                    conversations.forEach(conv => {
                        if (!Array.isArray(conv)) return;
                        const uuid = conv[0] || '';
                        const title = conv[1] || 'Gemini Chat';
                        let datetime = new Date().toISOString();
                        if (Array.isArray(conv[5]) && conv[5][0]) {
                            try {
                                datetime = new Date(conv[5][0] * 1000).toISOString();
                            } catch (e) { /* keep default */ }
                        }
                        if (uuid) {
                            threads.push({
                                uuid,
                                title: title.slice(0, 100),
                                platform: 'Gemini',
                                last_query_datetime: datetime
                            });
                        }
                    });

                    if (threads.length > 0) {
                        console.log(`[Gemini] ✓ Found ${threads.length} conversations via MaZiqc`);
                        // data[1] is the next-page cursor; null means no more pages.
                        const nextCursor = data[1] || null;
                        return {
                            threads,
                            hasMore: !!nextCursor,
                            nextCursor,
                            page
                        };
                    }
                }
            }
        } catch (e) {
            const message = e?.message || 'Unknown error';
            console.warn('[Gemini] MaZiqc API failed:', message);
            if (typeof Logger !== 'undefined') {
                Logger.error('Gemini', 'getThreads failed', { error: message });
            }
        }

        // Fallback: NetworkInterceptor (only used when API is unavailable/fails)
        if (window.NetworkInterceptor && window.NetworkInterceptor.getChatList().length > 0) {
            const all = window.NetworkInterceptor.getChatList();
            const start = (page - 1) * limit;
            return {
                threads: all.slice(start, start + limit),
                hasMore: start + limit < all.length,
                page
            };
        }

        return { threads, hasMore: false, page };
    },

    // ============================================
    // Offset-based fetching (mirrors ClaudeAdapter pattern)
    // Builds a full in-memory cache via cursor pagination, then slices.
    // Used by handleGetThreadListOffset for correct "Load All" behaviour.
    // ============================================
    /**
     * Fetch threads using offset-based addressing backed by cursor-paginated cache.
     * @param {number} offset - Number of threads to skip
     * @param {number} limit - Maximum number of threads to return
     * @returns {Promise<{threads: Array, offset: number, hasMore: boolean, total: number}>}
     */
    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        const cacheValid = GeminiAdapter._cacheTimestamp > Date.now() - GeminiAdapter._cacheTTL;

        if (!cacheValid || GeminiAdapter._allThreadsCache.length === 0) {
            // Build full cache using cursor pagination
            await GeminiAdapter.getAllThreads();
        }

        const threads = GeminiAdapter._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < GeminiAdapter._allThreadsCache.length,
            total: GeminiAdapter._allThreadsCache.length
        };
    },

    // ============================================
    // Get thread detail via hNvQHb RPC.
    // Payload (HAR-verified 2026-05): [chatId, 100, null, 1, [1], [4], null, 1]
    //   [0] chatId        — c_<16 hex>, REQUIRED prefix
    //   [1] messageLimit  — 100 matches what Gemini's own frontend sends; 10
    //                       (previous value) silently truncated long chats
    //   [2] cursor        — null = first page (see TRUNCATION note below)
    //   [3] 1, [4] [1], [5] [4], [6] null, [7] 1 — fixed flags
    //
    // Response structure (data[0] = array of conversation turns):
    //   turn[2]: user message,  turn[2][0][0] = query text,  turn[2][5] = role
    //   turn[3]: model response, turn[3][0][0][1][0] = answer markdown
    //   Timestamp: last element of each turn [unixSeconds, nanos]
    //
    // ⚠ KNOWN LIMITATION — long-chat truncation:
    // We send messageLimit=100 with cursor=null (no pagination). For chats
    // with more than 100 messages, only the most recent 100 are exported and
    // older messages are silently dropped. Real Gemini frontend uses cursor
    // pagination to scroll back further, but the cursor format isn't covered
    // by any HAR we have. Expect a user report at some point: "my longest
    // chat is missing the early messages." When that happens, implement
    // cursor-based loop here using the second element of the response as the
    // continuation token (verify exact field against a fresh HAR of an
    // active scroll-up). Track as a follow-up before then.
    // ============================================
    /**
     * Fetch full message detail for a conversation by UUID via the hNvQHb batchexecute RPC.
     * @param {string} uuid - The Gemini conversation UUID (with or without 'c_' prefix)
     * @returns {Promise<object>} Structured conversation data with entries array
     * @throws {Error} If the conversation cannot be fetched or has no content
     */
    getThreadDetail: async function (uuid) {
        console.log(`[Gemini] Fetching thread detail for: ${uuid}`);

        const chatId = uuid.startsWith('c_') ? uuid : `c_${uuid}`;
        const payload = [chatId, 100, null, 1, [1], [4], null, 1];

        try {
            console.log(`[Gemini] Fetching messages with hNvQHb for ${chatId}`);
            const data = await GeminiAdapter._batchExecute('hNvQHb', payload);

            if (!data) {
                throw new Error('Empty response from hNvQHb');
            }

            const entries = [];
            let title = '';
            let model = '';

            // data[0] is the array of conversation turns
            // Each turn: [[chatId, responseId], null, userMsg, modelResponse]
            const turns = data[0];
            if (!Array.isArray(turns)) {
                console.warn('[Gemini] Unexpected response structure — data[0] is not an array');
                throw new Error('Unexpected hNvQHb response structure');
            }

            for (const turn of turns) {
                if (!Array.isArray(turn)) continue;

                try {
                    // Extract user query
                    // turn[2] = [["query text"], 1, null, 1, "turnId", 0]
                    // turn[2][0][0] = the query string
                    // turn[2][5] = 0 means user role
                    let query = '';
                    if (Array.isArray(turn[2]) && Array.isArray(turn[2][0])) {
                        query = turn[2][0][0] || '';
                    }

                    // Extract model answer
                    // turn[3] = [[[responseCandidate]]]
                    // turn[3][0][0] = [candidateId, [answerText], ...metadata...]
                    // turn[3][0][0][1][0] = full markdown answer
                    let answer = '';
                    let citations = [];
                    if (Array.isArray(turn[3]) && Array.isArray(turn[3][0]) && Array.isArray(turn[3][0][0])) {
                        const candidate = turn[3][0][0];

                        // Primary: [1][0] contains the full markdown text
                        if (Array.isArray(candidate[1]) && typeof candidate[1][0] === 'string') {
                            answer = candidate[1][0];
                        }
                        // Fallback: [1] is a string directly
                        else if (typeof candidate[1] === 'string') {
                            answer = candidate[1];
                        }

                        // Extract model name (deep in the structure, near the end)
                        // In HAR: appears as "2.5 Flash" at a deep nested position
                        if (!model) {
                            try {
                                // Walk through candidate to find model string
                                const candidateStr = JSON.stringify(candidate);
                                const modelMatch = candidateStr.match(/"((?:2\.5|2\.0|1\.5|1\.0)\s+(?:Flash|Pro|Ultra|Nano)[^"]*?)"/);
                                if (modelMatch) model = modelMatch[1];
                            } catch (e) { /* ignore */ }
                        }

                        // Extract citation sources from candidate metadata
                        // Citations appear as arrays of [title, url, snippet] in deep positions
                        try {
                            const candidateStr = JSON.stringify(candidate);
                            // Look for URL patterns in the response metadata
                            const urlMatches = candidateStr.match(/\["([^"]+)","(https?:\/\/[^"]+)","([^"]*)"\]/g);
                            if (urlMatches) {
                                for (const m of urlMatches) {
                                    try {
                                        const parsed = JSON.parse(m);
                                        if (parsed[1] && parsed[1].startsWith('http')) {
                                            citations.push({
                                                name: parsed[0] || parsed[1],
                                                url: parsed[1]
                                            });
                                        }
                                    } catch (e) { /* skip */ }
                                }
                            }
                        } catch (e) { /* ignore citation extraction errors */ }
                    }

                    if (query && answer) {
                        const entryObj = {
                            query: query.trim(),
                            answer: answer.trim()
                        };
                        // Attach citations if found
                        if (citations.length > 0) {
                            entryObj.citations = citations;
                            // Append sources to the answer for export
                            const sourceText = citations.map(c =>
                                `> 🔗 [${c.name}](${c.url})`
                            ).join('\n');
                            entryObj.answer += '\n\n**Sources:**\n' + sourceText;
                        }
                        entries.push(entryObj);
                    }
                } catch (e) {
                    console.warn('[Gemini] Failed to parse turn:', e.message);
                }
            }

            // Extract timestamp from the last element: [unixSeconds, nanos]
            let datetime = new Date().toISOString();
            const lastItem = data[data.length - 1];
            if (Array.isArray(lastItem) && typeof lastItem[0] === 'number' && lastItem[0] > 1700000000) {
                try {
                    datetime = new Date(lastItem[0] * 1000).toISOString();
                } catch (e) { /* use default */ }
            }

            if (entries.length > 0) {
                // Use first query as title fallback
                title = document.title?.replace(' - Gemini', '').replace(' - Google Gemini', '').trim()
                    || entries[0]?.query?.substring(0, 100)
                    || 'Gemini Conversation';

                console.log(`[Gemini] ✓ Successfully parsed ${entries.length} message pairs` +
                    (model ? ` (model: ${model})` : ''));

                return {
                    uuid,
                    title,
                    platform: 'Gemini',
                    model: model || 'Gemini',
                    datetime,
                    entries
                };
            }

            console.warn('[Gemini] hNvQHb returned data but no message pairs could be extracted');
            throw new Error('Could not parse message pairs from hNvQHb response');

        } catch (error) {
            const message = error?.message || 'Unknown error';
            if (typeof Logger !== 'undefined') {
                Logger.error('Gemini', 'getThreadDetail failed', { error: message, uuid });
            } else {
                console.error(`[Gemini] hNvQHb failed for ${chatId}:`, message);
            }

            // Fallback: try with WqGlee and Mklfhc as alternate RPC IDs
            const fallbackRpcs = ['WqGlee', 'Mklfhc'];
            for (const rpcId of fallbackRpcs) {
                try {
                    console.log(`[Gemini] Trying fallback RPC: ${rpcId}`);
                    const data = await GeminiAdapter._batchExecute(rpcId, [chatId, 10]);
                    if (data && Array.isArray(data[0])) {
                        // Attempt same parsing as hNvQHb
                        const entries = [];
                        for (const turn of data[0]) {
                            if (!Array.isArray(turn)) continue;
                            const query = turn[2]?.[0]?.[0] || '';
                            const answer = turn[3]?.[0]?.[0]?.[1]?.[0] || '';
                            if (query && answer) entries.push({ query: query.trim(), answer: answer.trim() });
                        }
                        if (entries.length > 0) {
                            return {
                                uuid,
                                title: entries[0].query.substring(0, 100),
                                platform: 'Gemini',
                                entries
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`[Gemini] Fallback ${rpcId} also failed:`, e.message);
                }
            }

            throw new Error(`Gemini message fetch failed for ${chatId}: ${message}`);
        }
    },

    // ============================================
    // DOM Fallback (multiple strategies)
    // FIXED: Updated selectors for latest Gemini UI
    // ============================================


    getSpaces: async function () { return []; }
};

window.GeminiAdapter = GeminiAdapter;
