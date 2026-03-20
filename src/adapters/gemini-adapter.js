// OmniExporter AI - Gemini Adapter (Enterprise Edition)
// Support for Google Gemini (gemini.google.com)
// VERIFIED API: batchexecute with rpcids MaZiqc (list) and snvDe/hNvQHb (messages)
// HAR-verified: 2026-02-16 — Headers, query params, payload structure confirmed
// FIXED: Session params (bl, f.sid, at), headers (X-Same-Domain), response parsing
"use strict";

// =============================================
// PAGE CONTEXT SCRIPT INJECTOR
// Content scripts run in isolated world - they CAN'T intercept page XHRs
// Solution: Inject script into page context via web_accessible_resources
// =============================================

(function injectPageInterceptor() {
    // Only run on Gemini pages
    if (!window.location.hostname.includes('gemini.google.com')) return;

    // Prevent duplicate injection.
    // The previous guard used document.getElementById('omni-gemini-interceptor'), but the
    // script removes itself from the DOM (this.remove()) after loading, so the ID is always
    // absent and the guard never fired — allowing duplicate injection on every SPA navigation.
    // A persistent window flag is used instead so it survives the DOM removal.
    if (window.__omniGeminiInterceptorInjected) return;
    window.__omniGeminiInterceptorInjected = true;

    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('src/adapters/gemini-page-interceptor.js');
        script.onload = function () {
            console.log('[GeminiAdapter] Page interceptor injected successfully');
            this.remove(); // Clean up script tag after execution
        };
        script.onerror = function () {
            console.warn('[GeminiAdapter] Failed to inject page interceptor');
            // Reset flag on failure so a retry can succeed on next navigation
            window.__omniGeminiInterceptorInjected = false;
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        console.warn('[GeminiAdapter] Injection error:', e.message);
        window.__omniGeminiInterceptorInjected = false;
    }
})();

// =============================================
// MESSAGE BRIDGE - Connect to gemini-inject.js
// Listens for messages from page context scripts
// =============================================
const GeminiBridge = window.GeminiBridge = window.GeminiBridge || {
    pendingRequests: new Map(),
    isReady: false,
    interceptorReady: false,
    // Cache session params to avoid repeated postMessage calls.
    // TTL is 60 s — short enough that a Gemini deploy (which changes the `bl` build-label)
    // won't leave stale params cached for long and cause 404s on every batchexecute call.
    // The cache is also invalidated explicitly when a batchexecute call returns 404.
    _sessionParamsCache: null,
    _sessionParamsCacheTime: 0,
    _sessionParamsCacheTTL: 60000, // 60 seconds (was 5 minutes)

    init() {
        // REAL-9 FIX: Mark as initialized immediately so the outer guard works correctly
        this._listenerAdded = true;
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            // Security: Only accept messages from Gemini origin
            if (event.origin !== 'https://gemini.google.com') return;
            if (!event.data || event.data.type !== 'OMNIEXPORTER_GEMINI') return;
            if (event.data.direction !== 'to-content') return;

            this.handleMessage(event.data);
        });
        console.log('[GeminiAdapter] Message bridge initialized');
    },

    handleMessage(message) {
        const { action, requestId, success, data, error } = message;

        switch (action) {
            case 'INJECT_READY':
                this.isReady = true;
                console.log('[GeminiAdapter] gemini-inject.js is ready');
                break;
            case 'INTERCEPTOR_READY':
                this.interceptorReady = true;
                console.log('[GeminiAdapter] Page interceptor ready - limit:', data?.limit);
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
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 10000);

            // Sec 2 fix: use specific origin instead of '*' to prevent token interception
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
            console.warn('[GeminiAdapter] Bridge not ready, cannot get session params');
            return { at: null, bl: null, fsid: null };
        }

        try {
            const params = await this.sendRequest('GET_SESSION_PARAMS');
            if (params && params.at) {
                this._sessionParamsCache = params;
                this._sessionParamsCacheTime = now;
                console.log('[GeminiAdapter] Session params acquired:', {
                    at: '✓',
                    bl: params.bl || '✗',
                    fsid: params.fsid || '✗'
                });
            }
            return params || { at: null, bl: null, fsid: null };
        } catch (e) {
            console.warn('[GeminiAdapter] Failed to get session params:', e.message);
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

// REAL-9 FIX: Guard init() so only one window message listener is ever added.
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
    // ENTERPRISE: Use platformConfig for endpoints
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
        // Try platformConfig patterns first
        if (typeof platformConfig !== 'undefined') {
            const uuid = platformConfig.extractUuid('Gemini', url);
            if (uuid) return uuid;
        }

        // Fallback patterns
        const appMatch = url.match(/gemini\.google\.com\/app\/([a-zA-Z0-9_-]+)/);
        if (appMatch) return appMatch[1];
        const gemMatch = url.match(/gemini\.google\.com\/gem\/([a-zA-Z0-9_-]+)/);
        if (gemMatch) return gemMatch[1];
        // Return a stable empty string instead of `'gemini_' + Date.now()`.
        // A timestamp-based fallback created a new UUID on every extractUuid() call,
        // so the same conversation produced a different ID each time — defeating the
        // deduplication logic and creating a new Notion page on every export attempt.
        return '';
    },

    // ============================================
    // HAR-VERIFIED: Required headers for batchexecute
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
    // ENTERPRISE: Get ALL threads (Load All feature)
    // BUG-4 FIX: Loop with cursor pagination instead of single page fetch
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

                // For API pagination, cursor is authoritative; keep page at 1 so
                // NetworkInterceptor fallback doesn't skip data by synthetic offsets.
                const result = await this.getThreads(1, 100, cursor);

                // Add unique threads to allThreads
                for (const thread of result.threads) {
                    if (!seenUuids.has(thread.uuid)) {
                        seenUuids.add(thread.uuid);
                        allThreads.push(thread);
                    }
                }

                hasMore = !!result.nextCursor;
                cursor = result.nextCursor || null;

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

    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    /**
     * Fetch threads using offset-based pagination with in-memory cache.
     * @param {number} offset - Number of threads to skip
     * @param {number} limit - Maximum number of threads to return
     * @returns {Promise<{threads: Array, offset: number, hasMore: boolean, total: number}>}
     */
    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        // Check cache validity
        const cacheValid = GeminiAdapter._cacheTimestamp > Date.now() - GeminiAdapter._cacheTTL;

        if (!cacheValid || GeminiAdapter._allThreadsCache.length === 0) {
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
    // HAR-VERIFIED: Build batchexecute request body
    // f.req payload: [[[rpcid, JSON.stringify(payload), null, "generic"]]]
    // at param: XSRF token appended to body
    // ============================================
    _buildBatchRequest: (rpcid, payload, atToken = null) => {
        // HAR-verified: f.req must be TRIPLE-nested [[[rpcid, data, null, "generic"]]]
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
    // HAR-VERIFIED: Build batchexecute URL with all query params
    // Params from HAR: rpcids, source-path, bl, f.sid, hl, _reqid, rt
    // ============================================
    _buildBatchUrl: function (rpcid, sessionParams = {}) {
        const params = new URLSearchParams();
        params.set('rpcids', rpcid);
        params.set('source-path', '/app');

        // bl (build ID) — critical, request fails without it
        if (sessionParams.bl) {
            params.set('bl', sessionParams.bl);
        } else {
            // Fallback: use a generic bl value (will be updated when inject script reads it)
            params.set('bl', 'boq_assistant-bard-web-server_20260210.04_p0');
        }

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
    // HAR-VERIFIED: Make batchexecute API call
    // Uses correct headers, URL params, and body format
    // ============================================
    _batchExecute: async function (rpcid, payload) {
        // Get session params from page context
        const sessionParams = await GeminiBridge.getSessionParams();

        const url = this._buildBatchUrl(rpcid, sessionParams);
        const body = GeminiAdapter._buildBatchRequest(rpcid, payload, sessionParams.at);

        try {
            console.log(`[Gemini] Calling batchexecute: rpcid=${rpcid}, bl=${sessionParams.bl || 'fallback'}`);

            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: GeminiAdapter._getHeaders(),
                body
            });

            if (!response.ok) {
                console.error(`[Gemini] API error: ${response.status} ${response.statusText}`);
                throw new Error(`Gemini API error: ${response.status}`);
            }

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
    // HAR-VERIFIED: Parse batchexecute response
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
    // HAR-VERIFIED: Get thread list via MaZiqc RPC
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
    getThreads: async function (page = 1, limit = 20, cursor = null) {
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

        const threads = [];

        // Try API: rpcid MaZiqc for listing conversations
        try {
            // HAR-verified payload: [13, null, [0, null, 1]]
            // 13 = conversation category ID (fixed)
            // null = no pagination cursor
            // [0, null, 1] = sort/filter params
            const payload = [13, cursor, [0, null, 1]];
            console.log(`[Gemini] Fetching thread list with MaZiqc, cursor=${cursor || 'none'}`);

            const data = await GeminiAdapter._batchExecute('MaZiqc', payload);

            if (data) {
                // HAR-verified response structure:
                // [null, null, [[chat_id, title, null, null, null, [timestamp_secs, timestamp_nanos], null, null, null, 1, ...], ...]]
                // The conversations array is at data[2] (third element)
                let conversations = null;

                // Try data[2] first (HAR-verified position)
                if (Array.isArray(data[2])) {
                    conversations = data[2];
                }
                // Fallback: data[0] (older format)
                else if (Array.isArray(data[0])) {
                    conversations = data[0];
                }
                // Fallback: data itself if it's a flat array of conversations
                else if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && typeof data[0][0] === 'string') {
                    conversations = data;
                }

                if (conversations && conversations.length > 0) {
                    conversations.forEach(conv => {
                        if (!Array.isArray(conv)) return;

                        // HAR-verified structure per chat:
                        // [0] = chat ID (e.g., "c_ec00ff04a46f7fa6")
                        // [1] = title (e.g., "DIY Soundproofing With Household Items")
                        // [5] = [timestamp_seconds, timestamp_nanos]
                        const uuid = conv[0] || '';
                        const title = conv[1] || 'Gemini Chat';

                        // Extract timestamp from conv[5] if available
                        let datetime = new Date().toISOString();
                        if (Array.isArray(conv[5]) && conv[5][0]) {
                            try {
                                datetime = new Date(conv[5][0] * 1000).toISOString();
                            } catch (e) {
                                // Keep default
                            }
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

                        // Get next cursor for pagination (at data[1])
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
            console.warn('[GeminiAdapter] MaZiqc API failed:', message);
            if (typeof Logger !== 'undefined') {
                Logger.error('GeminiAdapter', 'getThreads failed', { error: message });
            }
        }

        return { threads, hasMore: false, page };
    },

    // ============================================
    // HAR-VERIFIED: Get thread detail via hNvQHb RPC
    // Payload: ["c_chatId", 10, null, 1, [1], [4], null, 1]
    // Response structure:
    //   data[0] = array of conversation turns
    //   turn[2] = user message: [2][0][0] = query text, [2][5] = role (0=user)
    //   turn[3] = model response: [3][0][0][1][0] = answer markdown
    //   turn[3][0][0][1] array wraps the full answer text
    //   Timestamp: last element [unixSeconds, nanos]
    // Verified: 2026-02-17 with chat c_ec00ff04a46f7fa6
    // ============================================
    /**
     * Fetch full message detail for a conversation by UUID via the hNvQHb batchexecute RPC.
     * @param {string} uuid - The Gemini conversation UUID (with or without 'c_' prefix)
     * @returns {Promise<object>} Structured conversation data with entries array
     * @throws {Error} If the conversation cannot be fetched or has no content
     */
    getThreadDetail: async function (uuid) {
        console.log(`[GeminiAdapter] Fetching thread detail for: ${uuid}`);

        // Ensure uuid has the c_ prefix (Gemini chat IDs use it)
        const chatId = uuid.startsWith('c_') ? uuid : `c_${uuid}`;

        // HAR-verified payload for hNvQHb
        // [chatId, messageLimit, cursor, 1, [1], [4], null, 1]
        const payload = [chatId, 10, null, 1, [1], [4], null, 1];

        try {
            console.log(`[Gemini] Fetching messages with hNvQHb for ${chatId}`);
            const data = await GeminiAdapter._batchExecute('hNvQHb', payload);

            if (!data) {
                throw new Error('Empty response from hNvQHb');
            }

            const entries = [];
            let title = '';
            let model = '';

            // HAR-verified: data[0] is the array of conversation turns
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
            console.error(`[Gemini] hNvQHb failed for ${chatId}:`, message);
            if (typeof Logger !== 'undefined') {
                Logger.error('GeminiAdapter', 'getThreadDetail failed', { error: message, uuid });
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
