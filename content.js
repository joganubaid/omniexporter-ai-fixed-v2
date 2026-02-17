// OmniExporter AI - Enterprise Edition
// content.js - Unified Platform Adapter

// ── RE-INJECTION GUARD ────────────────────────────────────────────────────────
// Chrome reloads content scripts on extension update without reloading the tab.
// `const` at top level throws "already declared" on second injection.
// Guard with a window flag so the body only runs once per page lifetime.
if (window.__omniExporterLoaded) {
    // Already loaded — just re-register the message listener so the
    // updated background script can still reach us.
    (function reRegister() {
        try {
            if (window.__omniExporterManager) {
                window.__omniExporterManager.initialize();
                console.log('[OmniExporter] Re-registered message listener after reload');
            }
        } catch (e) { /* ignore */ }
    })();
} else {
window.__omniExporterLoaded = true;

// Initialize Logger for content script
if (typeof Logger !== 'undefined') {
    Logger.init().then(() => {
        Logger.info('Content', 'Content script active', { url: window.location.hostname });
    }).catch(() => { });
}

console.log("OmniExporter AI Content Script Active");

// ============================================
// SECURITY UTILITIES (Audit Fix)
// ============================================
const SecurityUtils = {
    // Validate UUID format to prevent injection
    isValidUuid: (uuid) => {
        if (!uuid || typeof uuid !== 'string') return false;
        // Allow alphanumeric, underscore, hyphen, 8-128 chars
        return /^[a-zA-Z0-9_-]{8,128}$/.test(uuid);
    },

    // Sanitize HTML to prevent XSS
    sanitizeHtml: (str) => {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, (m) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[m]);
    },

    // Fetch with timeout to prevent hanging
    fetchWithTimeout: async (url, options = {}, timeoutMs = 30000) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            return response;
        } finally {
            clearTimeout(timeout);
        }
    },

    // Validate API response structure
    isValidApiResponse: (data) => {
        return data && typeof data === 'object';
    }
};

class ContentScriptManager {
    constructor() {
        this.messageHandler = null;
        this.cleanupFunctions = [];
    }

    initialize() {
        // Remove existing listener if any (safety against multiple injections)
        this.cleanup();

        this.messageHandler = (request, sender, sendResponse) => {
            this.handleMessage(request, sendResponse);
            return true; // Keep message channel open for async response
        };

        chrome.runtime.onMessage.addListener(this.messageHandler);

        // Cleanup on visibility change (optional optimization)
        const visibilityHandler = () => {
            if (document.hidden) {
                // We could pause things here if needed
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        this.cleanupFunctions.push(() => {
            document.removeEventListener('visibilitychange', visibilityHandler);
        });

        // Fix 16: SPA Navigation Handling
        const navigationHandler = () => {
            const adapter = getPlatformAdapter();
            if (adapter) {
                const newUuid = adapter.extractUuid(window.location.href);
                console.log('[OmniExporter] SPA navigation detected, new conversation:', newUuid);
            }
        };

        // Handle browser back/forward
        window.addEventListener('popstate', navigationHandler);
        this.cleanupFunctions.push(() => {
            window.removeEventListener('popstate', navigationHandler);
        });

        // Intercept pushState/replaceState for SPA routing
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            navigationHandler();
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            navigationHandler();
        };

        this.cleanupFunctions.push(() => {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        });

        console.log("OmniExporter AI Content Script Initialized");
    }

    cleanup() {
        if (this.messageHandler) {
            chrome.runtime.onMessage.removeListener(this.messageHandler);
            this.messageHandler = null;
        }
        this.cleanupFunctions.forEach(fn => fn());
        this.cleanupFunctions = [];
        console.log("OmniExporter AI Content Script Cleaned Up");
    }

    async handleMessage(request, sendResponse) {
        // Phase 4: Health check handler
        if (request.type === 'HEALTH_CHECK') {
            sendResponse({ healthy: true, timestamp: Date.now() });
            return;
        }

        const adapter = getPlatformAdapter();
        if (!adapter) {
            sendResponse({ success: false, error: "Unsupported platform." });
            return;
        }

        try {
            if (request.type === "EXTRACT_CONTENT") {
                await handleExtraction(adapter, sendResponse);
            } else if (request.type === "EXTRACT_CONTENT_BY_UUID") {
                await handleExtractionByUuid(adapter, request.payload.uuid, sendResponse);
            } else if (request.type === "GET_THREAD_LIST") {
                await handleGetThreadList(adapter, request.payload, sendResponse);
            } else if (request.type === "GET_THREAD_LIST_OFFSET") {
                await handleGetThreadListOffset(adapter, request.payload, sendResponse);
            } else if (request.type === "GET_SPACES") {
                await handleGetSpaces(adapter, sendResponse);
            } else if (request.type === "GET_PLATFORM_INFO") {
                sendResponse({ success: true, platform: adapter.name });
            }
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }
}

const manager = new ContentScriptManager();
manager.initialize();

// Ensure cleanup on page unload
window.addEventListener('beforeunload', () => manager.cleanup());


/**
 * Normalize entries from any adapter format to expected blocks format
 * This ensures all platforms return data in the format popup.js expects
 * 
 * Adapters return various formats:
 * - ChatGPT: { entries: [{query_str, blocks}], title }
 * - Perplexity: Similar blocks format
 * - Gemini/Grok/DeepSeek: { detail: { entries: [{query, answer}] } }
 * - Or sometimes: { entries: [{query, answer}] }
 */
function normalizeEntries(detail, platform) {
    // Handle various possible data structures
    let entries = [];

    // Priority 1: Check if detail has entries directly (ChatGPT, Perplexity return this)
    if (detail?.entries && Array.isArray(detail.entries)) {
        entries = detail.entries;
    }
    // Priority 2: Check nested detail.detail.entries (Gemini/Grok/DeepSeek)
    else if (detail?.detail?.entries && Array.isArray(detail.detail.entries)) {
        entries = detail.detail.entries;
    }
    // Priority 3: If detail itself is an array
    else if (Array.isArray(detail)) {
        entries = detail;
    }
    // Priority 4: For adapters returning messages directly
    else if (detail?.messages && Array.isArray(detail.messages)) {
        entries = detail.messages;
    }

    // If no entries found, return empty
    if (!entries || entries.length === 0) {
        return [];
    }

    return entries.map((entry, index) => {
        // If already in expected format with valid blocks, return as-is
        if (entry.blocks && Array.isArray(entry.blocks) && entry.blocks.length > 0) {
            // Verify the blocks have content
            const hasContent = entry.blocks.some(b =>
                b?.markdown_block?.answer || b?.markdown_block?.chunks
            );
            if (hasContent) {
                return entry;
            }
        }

        // Extract query - try multiple possible keys
        const query = entry.query_str || entry.query || entry.question || entry.prompt || '';

        // Extract answer - try multiple possible keys
        let answer = '';

        // Check blocks first (might have empty blocks)
        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block?.markdown_block?.answer) {
                    answer += block.markdown_block.answer + '\n\n';
                } else if (block?.markdown_block?.chunks) {
                    answer += block.markdown_block.chunks.join('\n') + '\n\n';
                }
            });
        }

        // Fallback to flat answer fields
        if (!answer.trim()) {
            answer = entry.answer || entry.response || entry.text || entry.content || '';
        }


        // Convert to expected format
        return {
            query_str: query,
            query: query, // Keep for backward compatibility
            blocks: [{
                intended_usage: 'ask_text',
                markdown_block: {
                    answer: answer.trim()
                }
            }],
            // Preserve original fields
            created_datetime: entry.created_datetime || entry.create_time || new Date().toISOString(),
            updated_datetime: entry.updated_datetime || entry.update_time
        };
    });
}

/**
 * Handle Single Extraction (Current Chat)
 */
async function handleExtraction(adapter, sendResponse) {
    try {
        const uuid = adapter.extractUuid(window.location.href);
        if (!uuid) throw new Error(`Open a ${adapter.name} chat first.`);

        const detail = await adapter.getThreadDetail(uuid);

        // Normalize entries to expected format
        const normalizedEntries = normalizeEntries(detail, adapter.name);

        // Get title from various sources
        const title = detail?.title || document.title?.replace(` - ${adapter.name}`, '').trim() || 'Untitled';

        sendResponse({
            success: true,
            data: {
                title: title,
                uuid: uuid,
                detail: { entries: normalizedEntries },
                platform: adapter.name,
                debug: detail.debug
            }
        });
    } catch (error) {
        if (typeof Logger !== 'undefined') Logger.error('Content', 'Extraction error', { error: error.message });
        console.error(`[OmniExporter] Extraction error:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Specific Thread Extraction
 */
async function handleExtractionByUuid(adapter, uuid, sendResponse) {
    try {
        const detail = await adapter.getThreadDetail(uuid);

        // Normalize entries to expected format
        const normalizedEntries = normalizeEntries(detail, adapter.name);
        const title = detail?.title || `Thread_${uuid}`;

        sendResponse({
            success: true,
            data: {
                title: title,
                uuid: uuid,
                detail: { entries: normalizedEntries },
                platform: adapter.name,
                debug: detail.debug
            }
        });
    } catch (error) {
        if (typeof Logger !== 'undefined') Logger.error('Content', 'ExtractionByUuid error', { error: error.message, uuid });
        console.error(`[OmniExporter] ExtractionByUuid error:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Thread List Fetching
 */
async function handleGetThreadList(adapter, payload, sendResponse) {
    try {
        const response = await adapter.getThreads(payload.page || 1, payload.limit || 20, payload.spaceId);
        sendResponse({ success: true, data: response });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Thread List Fetching with Direct Offset (for Load All feature)
 * ENTERPRISE: Supports all 6 platforms with anti-bot measures
 */
async function handleGetThreadListOffset(adapter, payload, sendResponse) {
    try {
        const offset = payload.offset || 0;
        const limit = payload.limit || 50;

        // ANTI-BOT: Add random delay between requests (200-800ms)
        if (offset > 0) {
            const delay = 200 + Math.random() * 600;
            await new Promise(r => setTimeout(r, delay));
        }

        // Common headers to appear more like a real browser
        const browserHeaders = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };

        // Use Perplexity API directly with offset
        if (adapter.name === 'Perplexity') {
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'listThreads');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const url = `${baseUrl}${endpoint}`;
            // HAR-verified body: includes search_term
            const body = { limit, offset, ascending: false, search_term: "" };

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    ...browserHeaders,
                    "content-type": "application/json",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": "2.18"
                },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            const items = Array.isArray(data) ? data : [];
            // HAR-verified: use total_threads from response for accurate pagination
            const totalThreads = items.length > 0 ? (items[0].total_threads || 0) : 0;

            const threads = items.map(t => ({
                // HAR-verified: use slug for detail API (it expects slug, not UUID)
                uuid: t.slug || t.uuid,
                title: t.title || "Untitled",
                last_query_datetime: t.last_query_datetime
            }));

            const hasMore = totalThreads > 0
                ? (offset + threads.length < totalThreads)
                : threads.length === limit;

            sendResponse({ success: true, data: { threads, offset, hasMore, total: totalThreads } });
        }
        // ENTERPRISE: DeepSeek with cursor-based offset simulation
        else if (adapter.name === 'DeepSeek' && adapter.getThreadsWithOffset) {
            const result = await adapter.getThreadsWithOffset(offset, limit);
            sendResponse({
                success: true,
                data: {
                    threads: result.threads,
                    offset: result.offset,
                    hasMore: result.hasMore,
                    total: result.total
                }
            });
        }
        // ENTERPRISE: ChatGPT with native offset support + anti-bot headers
        else if (adapter.name === 'ChatGPT') {
            try {
                const baseUrl = platformConfig.getBaseUrl('ChatGPT');
                const endpoint = platformConfig.buildEndpoint('ChatGPT', 'conversations');
                // HAR parameters: offset=0&limit=28&order=updated&is_archived=false&is_starred=false
                // Server seems to strict-check limit=28 or similar, 50 causes 500 error
                const safeLimit = 28;
                const url = `${baseUrl}${endpoint}?offset=${offset}&limit=${safeLimit}&order=updated&is_archived=false&is_starred=false`;

                // Use the full HAR-verified headers including Bearer token
                const chatgptHeaders = await ChatGPTAdapter._getHeaders();
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: {
                        ...browserHeaders,
                        ...chatgptHeaders
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const threads = (data.items || []).map(t => ({
                        uuid: t.id,
                        title: t.title || 'ChatGPT Chat',
                        last_query_datetime: t.update_time
                    }));
                    const total = data.total || 0;
                    const hasMore = total > 0
                        ? (offset + threads.length < total)
                        : (threads.length === safeLimit);
                    sendResponse({
                        success: true,
                        data: { threads, offset, hasMore, total }
                    });
                } else if (response.status === 403 || response.status === 429) {
                    // Bot detection likely - use DOM fallback
                    console.warn('[ChatGPT] API blocked (403/429), using DOM fallback');
                    const result = await adapter.getThreads(1, limit);
                    sendResponse({ success: true, data: { threads: result.threads || result, offset: 0, hasMore: false } });
                } else {
                    // Other error - try page-based fallback
                    const page = Math.floor(offset / limit) + 1;
                    const result = await adapter.getThreads(page, limit);
                    sendResponse({ success: true, data: result });
                }
            } catch (e) {
                console.error('[ChatGPT] Error:', e.message);
                sendResponse({ success: false, error: e.message });
            }
        }
        // ENTERPRISE: Gemini with API support
        else if (adapter.name === 'Gemini') {
            try {
                const page = Math.floor(offset / limit) + 1;
                const result = await adapter.getThreads(page, limit);
                const threads = result.threads || result || [];
                sendResponse({
                    success: true,
                    data: {
                        threads: Array.isArray(threads) ? threads : [],
                        offset,
                        hasMore: result.hasMore || false
                    }
                });
            } catch (e) {
                console.warn('[Gemini] API failed, trying DOM fallback:', e.message);
                // DOM fallback - parse sidebar
                const threads = [];
                document.querySelectorAll('[class*="conversation-title"], [class*="chat-item"], a[href*="/app/"]').forEach((item, i) => {
                    if (i >= limit) return;
                    const href = item.closest('a')?.getAttribute('href') || '';
                    const uuid = href.match(/\/app\/([a-zA-Z0-9_-]+)/)?.[1];
                    if (uuid) {
                        threads.push({
                            uuid,
                            title: item.textContent?.trim() || 'Gemini Chat',
                            platform: 'Gemini'
                        });
                    }
                });
                sendResponse({ success: true, data: { threads, offset: 0, hasMore: false } });
            }
        }
        // ENTERPRISE: Grok support (HAR-verified endpoints)
        else if (adapter.name === 'Grok') {
            try {
                // HAR-verified: ?pageSize=60 required, fields are conversationId/modifyTime
                const response = await fetch('https://grok.com/rest/app-chat/conversations?pageSize=60', {
                    credentials: 'include',
                    headers: {
                        ...browserHeaders,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    // HAR-verified: response is { conversations: [{conversationId, title, modifyTime, createTime}] }
                    const chats = data.conversations || data.data || data.items || [];
                    const threads = chats.slice(offset, offset + limit).map(t => ({
                        // HAR-verified: field is 'conversationId' not 'id'
                        uuid: t.conversationId || t.id || t.uuid,
                        title: t.title || t.name || 'Grok Chat',
                        // HAR-verified: fields are 'modifyTime' and 'createTime'
                        last_query_datetime: t.modifyTime || t.createTime || t.updatedAt
                    }));
                    sendResponse({
                        success: true,
                        data: { threads, offset, hasMore: offset + limit < chats.length, total: chats.length }
                    });
                } else {
                    // DOM fallback
                    const result = await adapter.getThreads(1, limit);
                    sendResponse({ success: true, data: { threads: result.threads || result, offset: 0, hasMore: false } });
                }
            } catch (e) {
                console.warn('[Grok] API failed:', e.message);
                const result = await adapter.getThreads(1, limit);
                sendResponse({ success: true, data: { threads: result.threads || result, offset: 0, hasMore: false } });
            }
        }
        // ENTERPRISE: Use getAllThreads if adapter supports it (for complete Load All)
        else if (payload.loadAll && adapter.getAllThreads) {
            const threads = await adapter.getAllThreads();
            sendResponse({
                success: true,
                data: {
                    threads,
                    offset: 0,
                    hasMore: false,
                    total: threads.length
                }
            });
        }
        else {
            // Fallback to page-based for other platforms
            const page = Math.floor(offset / limit) + 1;
            const response = await adapter.getThreads(page, limit);
            sendResponse({ success: true, data: response });
        }
    } catch (error) {
        console.error('[handleGetThreadListOffset] Error:', error);
        sendResponse({ success: false, error: error.message });
    }
}



async function handleGetSpaces(adapter, sendResponse) {
    try {
        if (!adapter.getSpaces) return sendResponse({ success: true, data: [] });
        const spaces = await adapter.getSpaces();
        sendResponse({ success: true, data: spaces });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// --- Platform Detection & Adapters (Fix #5: Capability Validation) ---

/**
 * Validate adapter has required methods
 */
function validateAdapter(adapter) {
    const required = ['name', 'extractUuid', 'getThreads', 'getThreadDetail'];
    for (const method of required) {
        if (!adapter[method]) {
            console.error(`[OmniExporter] Adapter missing required method: ${method}`);
            return false;
        }
    }
    return true;
}

function getPlatformAdapter() {
    const host = window.location.hostname;
    let adapter = null;

    // Original platforms (with platform-config.js)
    if (host.includes("perplexity.ai")) {
        adapter = PerplexityAdapter;
    }
    else if (host.includes("chatgpt.com") || host.includes("openai.com")) {
        adapter = ChatGPTAdapter;
    }
    else if (host.includes("claude.ai")) {
        adapter = ClaudeAdapter;
    }
    // New platforms (with standalone adapters)
    else if (host.includes("gemini.google.com")) {
        adapter = window.GeminiAdapter || null;
    }
    else if (host.includes("grok.com") || host.includes("x.com")) {
        adapter = window.GrokAdapter || null;
    }
    else if (host.includes("chat.deepseek.com") || host.includes("deepseek.com")) {
        adapter = window.DeepSeekAdapter || null;
    }

    // Validate adapter has required capabilities
    if (adapter && !validateAdapter(adapter)) {
        return null;
    }

    return adapter;
}

// --- Perplexity Implementation (Uses Platform Config) ---
const PerplexityAdapter = {
    name: "Perplexity",

    extractUuid: (url) => {
        // Use config layer with multiple pattern fallbacks
        return platformConfig.extractUuid('Perplexity', url);
    },

    /**
     * Parse entries from partial JSON response
     */
    _parseEntries: (json) => {
        // Handle various Perplexity API response formats
        if (Array.isArray(json)) return json;
        if (json.entries) return json.entries;
        if (json.results) return json.results;
        if (json.data) return json.data;
        return [];
    },

    getThreads: async (page, limit, spaceId = null) => {
        try {
            // Build endpoint using config
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'listThreads');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const url = `${baseUrl}${endpoint}`;

            // HAR-verified body: includes search_term
            const body = { limit, offset: (page - 1) * limit, ascending: false, search_term: "" };
            if (spaceId) body.collection_uuid = spaceId;

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "accept": "*/*",
                    "content-type": "application/json",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": "2.18"
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'listThreads');
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const items = Array.isArray(data) ? data : [];
            // HAR-verified: use total_threads from response for accurate pagination
            const totalThreads = items.length > 0 ? (items[0].total_threads || 0) : 0;

            return {
                threads: items.map(t => ({
                    // HAR-verified: use slug for detail API (it expects slug, not UUID)
                    uuid: t.slug || t.uuid,
                    title: DataExtractor.extractTitle(t, 'Perplexity'),
                    last_query_datetime: t.last_query_datetime
                })),
                hasMore: totalThreads > 0
                    ? ((page - 1) * limit + items.length < totalThreads)
                    : items.length === limit,
                page
            };
        } catch (error) {
            console.error('[Perplexity] getThreads error:', error);
            throw error;
        }
    },

    getSpaces: async () => {
        try {
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'spaces');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const response = await fetch(`${baseUrl}${endpoint}`, {
                credentials: "include",
                headers: {
                    "accept": "*/*",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": "2.18"
                }
            });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'spaces');
                return [];
            }

            const data = await response.json();
            return (data || []).map(s => ({ uuid: s.uuid, name: s.title }));
        } catch (error) {
            console.error('[Perplexity] getSpaces error:', error);
            return [];
        }
    },

    getThreadDetail: async (uuid) => {
        return await fetchPerplexityDetailResilient(uuid);
    }
};

// --- ChatGPT Implementation (Enterprise Edition - Matches Perplexity Quality) ---
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

            const data = await response.json();
            if (data.accessToken) {
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

// --- Claude Implementation (Enterprise Edition - Matches Perplexity Quality) ---
const ClaudeAdapter = {
    name: "Claude",
    _cachedOrgId: null,

    // Cache for pagination
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    extractUuid: (url) => {
        return platformConfig.extractUuid('Claude', url);
    },

    // ============================================
    // ENTERPRISE: Anti-bot headers
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
        const headers = { ...ClaudeAdapter._getHeaders(), ...options.headers };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });

                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to Claude');
                }

                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 2) * 1000;
                    console.warn(`[Claude] Rate limited, waiting ${waitTime}ms`);
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

    async getOrgId() {
        if (this._cachedOrgId) return this._cachedOrgId;

        try {
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'organizations');
            const response = await ClaudeAdapter._fetchWithRetry(`${baseUrl}${endpoint}`);

            const orgs = await response.json();
            if (!orgs || orgs.length === 0) {
                throw new Error('No Claude organizations found. Please check your login.');
            }

            this._cachedOrgId = orgs[0].uuid;
            console.log(`[Claude] Org found: ${orgs[0].name || this._cachedOrgId}`);
            return this._cachedOrgId;
        } catch (error) {
            console.error('[Claude] org fetch failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Get ALL threads (Load All feature)
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });
            const response = await ClaudeAdapter._fetchWithRetry(`${baseUrl}${endpoint}`);

            const data = await response.json();
            const threads = (Array.isArray(data) ? data : []).map(t => ({
                uuid: t.uuid,
                title: DataExtractor.extractTitle(t, 'Claude'),
                last_query_datetime: t.updated_at,
                platform: 'Claude'
            }));

            // Update cache
            ClaudeAdapter._allThreadsCache = threads;
            ClaudeAdapter._cacheTimestamp = Date.now();

            if (progressCallback) {
                progressCallback(threads.length, false);
            }

            return threads;
        } catch (error) {
            console.error('[Claude] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        // Check cache validity
        const cacheValid = ClaudeAdapter._cacheTimestamp > Date.now() - ClaudeAdapter._cacheTTL;

        if (!cacheValid || ClaudeAdapter._allThreadsCache.length === 0) {
            await ClaudeAdapter.getAllThreads();
        }

        const threads = ClaudeAdapter._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < ClaudeAdapter._allThreadsCache.length,
            total: ClaudeAdapter._allThreadsCache.length
        };
    },

    // Standard page-based (backwards compatible)
    getThreads: async function (page, limit) {
        try {
            const result = await this.getThreadsWithOffset((page - 1) * limit, limit);

            return {
                threads: result.threads,
                hasMore: result.hasMore,
                page
            };
        } catch (error) {
            console.error('[Claude] getThreads error:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Resilient thread detail fetching
    // ============================================
    getThreadDetail: async function (uuid) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversationDetail', { org: orgId, uuid });
            const url = `${baseUrl}${endpoint}`;

            const response = await ClaudeAdapter._fetchWithRetry(url);
            const data = await response.json();

            console.log(`[Claude] API success for ${uuid}`);
            return {
                uuid,
                entries: transformClaudeData(data),
                title: data.name,
                platform: 'Claude'
            };
        } catch (error) {
            console.error('[Claude] getThreadDetail error:', error);
            return {
                uuid,
                entries: [],
                title: 'Error fetching details',
                platform: 'Claude',
                error: error.message
            };
        }
    },



    getSpaces: async () => []
};

// --- Helper Functions ---

/**
 * Resilient Perplexity detail fetcher using platform config
 */
// HAR-verified: supported_block_use_cases required for full response
const PERPLEXITY_BLOCK_USE_CASES = [
    'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
    'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
    'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
    'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
    'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
    'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
    'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
    'pending_followups', 'inline_claims'
];

async function fetchPerplexityDetailResilient(uuid) {
    console.log('[Perplexity] Fetching thread detail for:', uuid);

    let entries = [];
    let cursor = null;
    let isInitial = true;
    let title = 'Untitled Thread';

    // Get version from config or detector
    const version = platformConfig.activeVersions.get('Perplexity') ||
        PLATFORM_CONFIGS.Perplexity.versions.current;

    try {
        while (true) {
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const params = new URLSearchParams({
                with_parent_info: "true",
                with_schematized_response: "true",
                version: version,
                source: "default",
                limit: isInitial ? "10" : "100"
            });

            // HAR-verified: initial request uses offset=0 and from_first=true
            if (isInitial) {
                params.set("offset", "0");
                params.set("from_first", "true");
            }

            if (cursor) params.append("cursor", cursor);

            // HAR-verified: supported_block_use_cases required for full response
            PERPLEXITY_BLOCK_USE_CASES.forEach(uc => params.append("supported_block_use_cases", uc));

            const url = `${baseUrl}/rest/thread/${uuid}?${params.toString()}`;
            console.log('[OmniExporter] Fetching:', url);

            const response = await fetch(url, {
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": "2.18"
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const json = await response.json();

            // Extract entries - robust check
            const rawEntries = PerplexityAdapter._parseEntries ? PerplexityAdapter._parseEntries(json) : (json.entries || []);

            if (rawEntries && Array.isArray(rawEntries)) {
                rawEntries.forEach(entry => {
                    if (!entries.find(e => e.uuid === entry.uuid)) {
                        entries.push(entry);
                    }
                });
            }

            // HAR-verified: title is in thread_title field of entries
            if (title === 'Untitled Thread' && entries.length > 0) {
                const firstEntry = entries[0];
                title = firstEntry.thread_title || firstEntry.query_str?.slice(0, 100) || title;
            }

            // Check for pagination
            if (!json.next_cursor || json.next_cursor === cursor) {
                console.log('[OmniExporter] No more pages, total entries:', entries.length);
                break;
            }

            cursor = json.next_cursor;
            isInitial = false;
        }

        console.log('[OmniExporter] Final result - Title:', title, 'Entries:', entries.length);

        return {
            entries: entries,
            title: title,
            uuid: uuid
        };
    } catch (error) {
        console.error('[OmniExporter] Error fetching thread detail:', error);
        throw error;
    }
}


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

function transformClaudeData(data) {
    // Claude returns chat_messages array
    const entries = [];
    const messages = data.chat_messages || [];

    try {
        let currentEntry = null;
        messages.forEach(msg => {
            // Claude API: msg.text is always "" — actual text is in msg.content[0].text
            const msgText = (msg.content && msg.content[0]?.text) || msg.text || '';
            if (msg.sender === 'human') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: msgText,
                    blocks: []
                };
            } else if (msg.sender === 'assistant' && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: msgText }
                });
            }
        });
        if (currentEntry && currentEntry.blocks.length > 0) {
            entries.push(currentEntry);
        }
    } catch (e) {
        console.error('[OmniExporter] Claude transform error:', e);
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

// ============================================
// RESILIENT EXTRACTION HELPERS
// ============================================

/**
 * Extract answer using DataExtractor with fallbacks
 */
function extractAnswerResilient(entry, platform) {
    // Try DataExtractor first (uses config-based paths)
    const extracted = DataExtractor.extractAnswer(entry, platform);
    if (extracted) return extracted;

    // Fallback: Try Perplexity block extraction
    if (platform === 'Perplexity' && entry.blocks) {
        const { answer } = DataExtractor.extractFromPerplexityBlocks(entry);
        if (answer) return answer;
    }

    // Final fallback: direct properties
    return entry.answer || entry.text || entry.content || '';
}



// ============================================
// AUTO-VERSION DETECTION ON LOAD
// ============================================
async function initializePlatformAdapters() {
    try {
        const adapter = getPlatformAdapter();
        if (adapter && typeof versionDetector !== 'undefined') {
            const detectedVersion = await versionDetector.detect(adapter.name);
            if (typeof platformConfig !== 'undefined') {
                platformConfig.setActiveVersion(adapter.name, detectedVersion);
            }
            console.log(`[OmniExporter] Detected ${adapter.name} version: ${detectedVersion}`);
        }
    } catch (e) {
        console.warn('[OmniExporter] Version detection failed:', e);
    }
}

// Initialize version detection after DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlatformAdapters);
} else {
    initializePlatformAdapters();
}

// ============================================
// (duplicate ContentScriptManager instantiation removed — manager already initialized above)

// Expose manager reference for re-injection guard
window.__omniExporterManager = manager;

} // end if (!window.__omniExporterLoaded)

