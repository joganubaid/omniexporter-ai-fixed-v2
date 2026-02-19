// OmniExporter AI - Network Interceptor
// Auto-discovers API endpoints for chat lists
// SAFE VERSION: All modifications are wrapped in try-catch to prevent page crashes

const NetworkInterceptor = {
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

        // Only intercept if not already intercepted
        if (XMLHttpRequest.prototype._omniIntercepted) return;
        XMLHttpRequest.prototype._omniIntercepted = true;

        XMLHttpRequest.prototype.open = function (method, url) {
            try {
                this._interceptedUrl = url;
                this._interceptedMethod = method;
            } catch (e) { }
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            try {
                this.addEventListener('load', function () {
                    try {
                        self.processResponse(this._interceptedUrl, this.responseText, this._interceptedMethod);
                    } catch (e) { }
                });
            } catch (e) { }
            return originalSend.apply(this, arguments);
        };
    },

    // Intercept Fetch API - SAFE version
    interceptFetch() {
        // Only intercept if not already intercepted
        if (window._omniFetchIntercepted) return;
        window._omniFetchIntercepted = true;

        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (url, options = {}) {
            let response;
            try {
                response = await originalFetch.apply(this, arguments);
            } catch (e) {
                // Let errors pass through naturally
                throw e;
            }

            // Clone response to read it WITHOUT blocking the original
            try {
                const clone = response.clone();
                // Read in background, don't await
                clone.text().then(text => {
                    try {
                        self.processResponse(url.toString(), text, options.method || 'GET');
                    } catch (e) { }
                }).catch(() => { });
            } catch (e) { }

            return response;
        };
    },

    // Process and identify chat list responses
    processResponse(url, responseText, method) {
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
                window.__omniChatList = this.chatListData;
                window.__omniEndpoints = this.capturedEndpoints;

                console.log('[NetworkInterceptor] Captured chat list for', platform, ':', this.chatListData.length, 'items');
            }
        } catch (e) {
            // Silently ignore parse errors
        }
    },

    // Detect if response contains chat list
    isChatListResponse(data, url) {
        try {
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
            const items = Array.isArray(data) ? data :
                (data?.data || data?.list || data?.conversations || data?.threads || data?.chats || []);

            return items.map(item => ({
                uuid: item.uuid || item.id || item.session_id || item.chat_session_id || item.conversationId,
                title: item.title || item.name || 'Untitled',
                last_query_datetime: item.last_query_datetime || item.updated_at || item.updatedAt ||
                    item.create_time || item.createdAt || new Date().toISOString()
            })).filter(i => i.uuid);
        } catch (e) {
            return [];
        }
    },

    // Get captured chat list
    getChatList() {
        return window.__omniChatList || [];
    },

    // Get discovered endpoints
    getEndpoints() {
        return window.__omniEndpoints || {};
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
