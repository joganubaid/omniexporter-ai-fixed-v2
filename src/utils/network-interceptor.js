// OmniExporter AI - Network Interceptor
// Auto-discovers API endpoints for chat lists
// SAFE VERSION: All modifications are wrapped in try-catch to prevent page crashes
"use strict";

// Secure namespace — non-configurable to resist tampering
if (!window.__omniExporterInternal) {
    Object.defineProperty(window, '__omniExporterInternal', {
        value: {
            chatList: [],
            fetchIntercepted: false,
            xhrIntercepted: false,
            // Simple integrity token — not cryptographic, just deters casual tampering
            _token: Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
        },
        writable: false,
        configurable: false
    });
}

var NetworkInterceptor = window.NetworkInterceptor = window.NetworkInterceptor || {
    capturedEndpoints: {},
    chatListData: null,
    isInitialized: false,

    init() {
        // Prevent multiple initializations
        if (this.isInitialized) return;
        this.isInitialized = true;

        // SAFETY: Wrap all interceptors in try-catch
        try {
            this.interceptXHR();
        } catch (e) {
            console.warn('[NetworkInterceptor] XHR intercept failed (safe to ignore):', e.message);
        }

        try {
            this.interceptFetch();
        } catch (e) {
            console.warn('[NetworkInterceptor] Fetch intercept failed (safe to ignore):', e.message);
        }

        console.log('[NetworkInterceptor] Initialized safely');
    },

    // Intercept XMLHttpRequest - SAFE version
    interceptXHR() {
        // Store original functions
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const self = this;

        // Use a WeakSet instead of writing to XHR.prototype to avoid
        // prototype pollution that affects all iframes and workers on the page.
        if (!this._xhrInterceptedInstances) this._xhrInterceptedInstances = new WeakSet();
        if (this._xhrPatched) return;
        this._xhrPatched = true;

        const interceptedInstances = this._xhrInterceptedInstances;

        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                this._interceptedUrl = url;
                this._interceptedMethod = method;
            } catch (e) {
                // Property assignment can fail on locked-down XHR proxies
                // (some Chrome enterprise policies do this). Non-fatal —
                // we just lose this XHR for interception purposes.
                console.debug('[NetworkInterceptor] XHR.open property assign failed:', e.message);
            }
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            try {
                // Ensure we only attach a single 'load' listener per XHR instance
                if (!interceptedInstances.has(this)) {
                    interceptedInstances.add(this);
                    this.addEventListener('load', function () {
                        try {
                            self.processResponse(this._interceptedUrl, this.responseText, this._interceptedMethod);
                        } catch (e) {
                            console.debug('[NetworkInterceptor] processResponse threw:', e.message);
                        }
                    });
                }
            } catch (e) {
                console.debug('[NetworkInterceptor] XHR.send setup failed:', e.message);
            }
            return originalSend.apply(this, arguments);
        };
    },

    // Intercept Fetch API - SAFE version
    interceptFetch() {
        // Only intercept if not already intercepted
        if (window.__omniExporterInternal.fetchIntercepted) return;
        window.__omniExporterInternal.fetchIntercepted = true;

        const originalFetch = window.fetch;
        const self = this;

        window.fetch = new Proxy(originalFetch, {
            apply(target, thisArg, args) {
                const [url, options = {}] = args;
                let response;
                const result = Reflect.apply(target, thisArg, args);

                result.then(resp => {
                    // Clone response to read it WITHOUT blocking the original
                    try {
                        const clone = resp.clone();
                        // Read in background, don't await
                        clone.text().then(text => {
                            try {
                                self.processResponse(url.toString(), text, (options && options.method) || 'GET');
                            } catch (e) {
                                console.debug('[NetworkInterceptor] fetch processResponse threw:', e.message);
                            }
                        }).catch(e => console.debug('[NetworkInterceptor] fetch clone.text() rejected:', e?.message));
                    } catch (e) {
                        console.debug('[NetworkInterceptor] fetch resp.clone() failed:', e.message);
                    }
                }).catch(() => {
                    // Original fetch rejected — caller's own .catch() will see it.
                    // We intentionally don't log here because the caller is the
                    // right place to react.
                });

                return result;
            }
        });
    },

    // Process and identify chat list responses
    processResponse(url, responseText, method) {
        // only process traffic from known AI platform API endpoints
        // This prevents intercepting unrelated requests (banking, social, etc.)
        const AI_URL_PATTERNS = [
            /perplexity\.ai\/rest\/|perplexity\.ai\/p\//,
            /chatgpt\.com\/backend-api\/|chat\.openai\.com\/backend-api\//,
            /claude\.ai\/api\//,
            /gemini\.google\.com\/_\/BardChatUi\//,
            /grok\.com\/rest\/|x\.com\/i\/grok/,
            /chat\.deepseek\.com\/api\//,
        ];
        const urlStr = url ? url.toString() : '';
        if (!AI_URL_PATTERNS.some(pattern => pattern.test(urlStr))) return;

        // SAFETY: Silent fail on any error
        try {
            if (!responseText || responseText.length < 10) return;

            const data = JSON.parse(responseText);

            // Pattern detection for chat lists
            if (this.isChatListResponse(data, url)) {
                const platform = this.detectPlatform(url);
                this.capturedEndpoints[platform] = {
                    url: url,
                    method: method,
                    timestamp: Date.now()
                };
                this.chatListData = this.extractChatList(data);

                // Store for popup access
                window.__omniExporterInternal.chatList = this.chatListData;
                window.__omniEndpoints = this.capturedEndpoints;

                console.log('[NetworkInterceptor] Captured chat list for', platform, ':', this.chatListData.length, 'items');
            }
        } catch (e) {
            // Most likely a non-JSON response that snuck past our pattern
            // matcher (HTML error pages, redirects, etc.) — not a bug, but
            // worth tracing in debug.
            console.debug('[NetworkInterceptor] processResponse parse failed:', e.message);
        }
    },

    // Detect if response contains chat list
    isChatListResponse(data, url) {
        try {
            if (!url) return false;
            // Check URL patterns
            const listPatterns = [
                /chat.*list/i, /conversations/i, /threads/i,
                /history/i, /sessions/i, /chats/i
            ];
            const urlMatches = listPatterns.some(p => p.test(url));

            // Check data structure (array of objects with uuid/id and title)
            const isArray = Array.isArray(data);
            const hasData = data?.data && Array.isArray(data.data);
            const hasList = data?.list && Array.isArray(data.list);

            const items = isArray ? data : (data?.data || data?.list || data?.conversations || data?.threads || []);

            if (items.length > 0) {
                const hasIds = items.some(i => i.uuid || i.id || i.session_id || i.chat_session_id);
                const hasTitles = items.some(i => i.title || i.name);
                return hasIds && (urlMatches || hasTitles);
            }

            return false;
        } catch (e) {
            console.debug('[NetworkInterceptor] isChatListResponse threw:', e.message);
            return false;
        }
    },

    detectPlatform(url) {
        if (url.includes('deepseek')) return 'DeepSeek';
        if (url.includes('grok') || url.includes('x.com')) return 'Grok';
        if (url.includes('gemini')) return 'Gemini';
        if (url.includes('perplexity')) return 'Perplexity';
        if (url.includes('chatgpt') || url.includes('openai')) return 'ChatGPT';
        if (url.includes('claude')) return 'Claude';
        return 'Unknown';
    },

    extractChatList(data) {
        try {
            let items = Array.isArray(data) ? data :
                (data?.data || data?.list || data?.conversations || data?.threads || data?.chats || []);
            // Guard: if the resolved value is not an array (e.g. a plain object when data.data
            // is an empty object or non-list structure), .map() would throw a TypeError.
            // Normalize such cases to an empty array so map/filter operate safely and yield no items.
            if (!Array.isArray(items)) items = [];

            return items.map(item => ({
                uuid: item.uuid || item.id || item.session_id || item.chat_session_id || item.conversationId,
                title: item.title || item.name || 'Untitled',
                last_query_datetime: item.last_query_datetime || item.updated_at || item.updatedAt ||
                    item.create_time || item.createdAt || new Date().toISOString()
            })).filter(i => i.uuid);
        } catch (e) {
            console.debug('[NetworkInterceptor] extractChatList threw:', e.message);
            return [];
        }
    },

    // Get captured chat list
    getChatList() {
        return window.__omniExporterInternal.chatList || [];
    }
};

// Initialize interceptor - SAFE with delay to not block page load
setTimeout(() => {
    try {
        NetworkInterceptor.init();
    } catch (e) {
        console.warn('[NetworkInterceptor] Init failed (page will still work)');
    }
}, 100);

// Expose for adapter use
window.NetworkInterceptor = NetworkInterceptor;
