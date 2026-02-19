// OmniExporter AI - Enterprise Edition
// content.js - Unified Platform Adapter
"use strict";

// ── RE-INJECTION GUARD ────────────────────────────────────────────────────────
// On extension reload, Chrome re-injects scripts into active tabs.
// We need to re-register listeners but avoid "const already declared" errors.

// If already loaded, just re-register the message listener
if (window.__omniExporterLoaded && window.__omniExporterManager) {
    window.__omniExporterManager.initialize();
    console.log('[OmniExporter] Re-registered message listener after reload');
    // Don't execute the rest of the file
} else {
    // Mark as loaded
    window.__omniExporterLoaded = true;

    // Initialize Logger for content script
    if (typeof Logger !== 'undefined') {
        Logger.init().then(() => {
            Logger.info('Content', 'Content script active', { url: window.location.hostname });
        }).catch(() => { });
    }

    console.log("OmniExporter AI Content Script Active");

    // ============================================
    // SECURITY UTILITIES (window property to prevent re-declaration)
    // ============================================
    if (!window.SecurityUtils) {
        window.SecurityUtils = {
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
    }

    // Reference SecurityUtils
    const SecurityUtils = window.SecurityUtils;

    // ============================================
    // CONTENT SCRIPT MANAGER
    // ============================================
    if (!window.ContentScriptManager) {
        window.ContentScriptManager = class ContentScriptManager {
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
        };
    }

    // Create manager instance
    const manager = new window.ContentScriptManager();
    manager.initialize();
    window.__omniExporterManager = manager;

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
        // Security: Validate UUID format before using in API calls
        if (!SecurityUtils.isValidUuid(uuid)) {
            throw new Error(`Invalid conversation ID format.`);
        }

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
        // Security: Validate UUID format before using in API calls
        if (!uuid || !SecurityUtils.isValidUuid(uuid)) {
            sendResponse({ success: false, error: 'Invalid conversation ID format.' });
            return;
        }
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

    if (host.includes("perplexity.ai")) {
        adapter = typeof PerplexityAdapter !== 'undefined' ? PerplexityAdapter : null;
    }
    else if (host.includes("chatgpt.com") || host.includes("openai.com")) {
        adapter = typeof ChatGPTAdapter !== 'undefined' ? ChatGPTAdapter : null;
    }
    else if (host.includes("claude.ai")) {
        adapter = typeof ClaudeAdapter !== 'undefined' ? ClaudeAdapter : null;
    }
    else if (host.includes("gemini.google.com")) {
        adapter = window.GeminiAdapter || null;
    }
    else if (host.includes("grok.com") || host.includes("x.com")) {
        adapter = window.GrokAdapter || null;
    }
    else if (host.includes("chat.deepseek.com") || host.includes("deepseek.com")) {
        adapter = window.DeepSeekAdapter || null;
    }

    if (adapter && !validateAdapter(adapter)) {
        return null;
    }

    return adapter;
}

// --- Helper Functions ---

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

