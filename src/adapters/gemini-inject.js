// OmniExporter AI - Gemini Page Context Injection
// This script runs in the page context to access window.WIZ_global_data
"use strict";

(function () {
    'use strict';

    const BRIDGE_ID = 'omniexporter-gemini-bridge';
    const MESSAGE_TYPE = 'OMNIEXPORTER_GEMINI';

    // ============================================
    // WEB BRIDGE - Communication with Content Script
    // ============================================
    class WebBridge {
        constructor() {
            this.isReady = false;
            this.pendingRequests = new Map();
            this.setupListener();
        }

        setupListener() {
            window.addEventListener('message', (event) => {
                if (event.source !== window) return;
                // Security: Only accept messages from Gemini origin
                if (event.origin !== 'https://gemini.google.com') return;
                if (!event.data || event.data.type !== MESSAGE_TYPE) return;
                if (event.data.direction !== 'to-page') return;

                this.handleRequest(event.data);
            });

            // Signal that inject script is ready
            this.sendToContentScript({
                action: 'INJECT_READY',
                success: true
            });

            this.isReady = true;
            console.log('[OmniExporter] Gemini inject script ready');
        }

        handleRequest(message) {
            const { requestId, action, data } = message;

            try {
                let result;
                switch (action) {
                    case 'GET_GLOBAL_DATA':
                        result = this.getGlobalData();
                        break;
                    case 'GET_CONVERSATIONS':
                        result = this.getConversations();
                        break;
                    case 'GET_CONVERSATION_DETAIL':
                        result = this.getConversationDetail(data?.conversationId);
                        break;
                    case 'GET_AUTH_TOKEN':
                        result = this.getAuthToken();
                        break;
                    case 'GET_SESSION_PARAMS':
                        result = this.getSessionParams();
                        break;
                    default:
                        throw new Error(`Unknown action: ${action}`);
                }

                this.sendResponse(requestId, true, result);
            } catch (error) {
                this.sendResponse(requestId, false, null, error.message);
            }
        }

        sendResponse(requestId, success, data, error = null) {
            this.sendToContentScript({
                action: 'RESPONSE',
                requestId,
                success,
                data,
                error
            });
        }

        sendToContentScript(payload) {
            window.postMessage({
                type: MESSAGE_TYPE,
                direction: 'to-content',
                ...payload
            }, window.location.origin);
        }

        // ============================================
        // GEMINI DATA EXTRACTION
        // ============================================

        getGlobalData() {
            // WIZ_global_data contains Gemini's configuration and auth
            if (typeof window.WIZ_global_data !== 'undefined') {
                return {
                    exists: true,
                    keys: Object.keys(window.WIZ_global_data),
                    // Extract useful data
                    SNlM0e: window.WIZ_global_data.SNlM0e, // XSRF token ("at" param)
                    cfb2h: window.WIZ_global_data.cfb2h,   // Build ID ("bl" param)
                    FdrFJe: window.WIZ_global_data.FdrFJe, // Session ID ("f.sid" param)
                };
            }
            return { exists: false };
        }

        getAuthToken() {
            // Primary: WIZ_global_data.SNlM0e (this is the "at" XSRF token)
            if (window.WIZ_global_data?.SNlM0e) {
                return { token: window.WIZ_global_data.SNlM0e };
            }

            // Fallback: Search in page scripts
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const match = script.textContent?.match(/"SNlM0e":"([^"]+)"/);
                if (match) return { token: match[1] };
            }

            return null;
        }

        // Extract all session parameters needed for batchexecute API calls
        // HAR analysis: bl=boq_assistant-bard-web-server_YYYYMMDD.NN_p0
        //               f.sid=<numeric>, at=<XSRF token>
        getSessionParams() {
            const params = { at: null, bl: null, fsid: null };

            // From WIZ_global_data (primary source)
            if (typeof window.WIZ_global_data !== 'undefined') {
                params.at = window.WIZ_global_data.SNlM0e || null;   // XSRF token → "at" POST param
                params.bl = window.WIZ_global_data.cfb2h || null;    // Build version → "bl" query param
                params.fsid = window.WIZ_global_data.FdrFJe || null; // Session ID → "f.sid" query param
            }

            // Fallback: parse from page HTML if WIZ_global_data missing
            if (!params.at || !params.bl) {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    if (!params.at) {
                        const atMatch = text.match(/"SNlM0e":"([^"]+)"/);
                        if (atMatch) params.at = atMatch[1];
                    }
                    if (!params.bl) {
                        const blMatch = text.match(/"cfb2h":"([^"]+)"/);
                        if (blMatch) params.bl = blMatch[1];
                    }
                    if (!params.fsid) {
                        const sidMatch = text.match(/"FdrFJe":"([^"]+)"/);
                        if (sidMatch) params.fsid = sidMatch[1];
                    }
                }
            }

            console.log('[OmniExporter] Session params:', {
                at: params.at ? '✓ found' : '✗ missing',
                bl: params.bl ? '✓ ' + params.bl : '✗ missing',
                fsid: params.fsid ? '✓ found' : '✗ missing'
            });

            return params;
        }

        getConversations() {
            const conversations = [];

            // Strategy 1: Parse from window.__INITIAL_DATA__
            if (window.__INITIAL_DATA__) {
                try {
                    const data = this.traverseForConversations(window.__INITIAL_DATA__);
                    if (data.length > 0) return data;
                } catch (e) {
                    console.warn('[OmniExporter] Failed to parse __INITIAL_DATA__:', e);
                }
            }


            // Strategy 2: DOM Parsing REMOVED (Strict API Only)
            return conversations;
        }

        extractIdFromHref(href) {
            if (!href) return null;
            const match = href.match(/\/(?:app|gem)\/([a-zA-Z0-9_-]+)/);
            return match ? match[1] : null;
        }

        getConversationDetail(conversationId) {
            const messages = [];

            // Strategy 1: Parse from page data structures
            if (window.__INITIAL_DATA__) {
                try {
                    const data = this.traverseForMessages(window.__INITIAL_DATA__, conversationId);
                    if (data.length > 0) return { id: conversationId, messages: data };
                } catch (e) {
                    console.warn('[OmniExporter] Failed to parse messages:', e);
                }
            }


            // Strategy 2: DOM Extraction REMOVED (Strict API Only)

            // Get title (Allowed as browser metadata, not content scraping)
            const title = document.title?.replace(' - Gemini', '').replace('Gemini', '').trim() ||
                'Gemini Conversation';

            return {
                id: conversationId,
                title,
                messages,
                platform: 'Gemini'
            };
        }

        traverseForConversations(obj, results = []) {
            if (!obj || typeof obj !== 'object') return results;

            // Look for conversation-like structures
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    this.traverseForConversations(item, results);
                }
            } else {
                // Check if this looks like a conversation
                if (obj.conversationId || obj.id || obj.uuid) {
                    results.push({
                        uuid: obj.conversationId || obj.id || obj.uuid,
                        title: obj.title || obj.name || 'Untitled',
                        platform: 'Gemini'
                    });
                }

                for (const key of Object.keys(obj)) {
                    this.traverseForConversations(obj[key], results);
                }
            }

            return results;
        }

        traverseForMessages(obj, targetId, results = []) {
            if (!obj || typeof obj !== 'object') return results;

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    this.traverseForMessages(item, targetId, results);
                }
            } else {
                // Check if this is a message
                if (obj.content || obj.text || obj.message) {
                    results.push({
                        query: obj.query || obj.prompt || '',
                        answer: obj.content || obj.text || obj.message || '',
                    });
                }

                for (const key of Object.keys(obj)) {
                    this.traverseForMessages(obj[key], targetId, results);
                }
            }

            return results;
        }
    }

    // ============================================
    // XHR INTERCEPTOR (Optional - for API capture)
    // ============================================
    class XHRInterceptor {
        constructor() {
            this.originalOpen = null;
            this.originalSend = null;
            this.capturedData = [];
        }

        start() {
            if (this.originalOpen) return;

            this.originalOpen = XMLHttpRequest.prototype.open;
            this.originalSend = XMLHttpRequest.prototype.send;

            const self = this;

            XMLHttpRequest.prototype.open = function (method, url, ...args) {
                this._omni_url = url;
                this._omni_method = method;
                return self.originalOpen.apply(this, [method, url, ...args]);
            };

            XMLHttpRequest.prototype.send = function (body) {
                const xhr = this;
                const url = this._omni_url;

                // Capture Gemini API responses
                if (url && url.includes('/_/BardChatUi/data/')) {
                    xhr.addEventListener('load', function () {
                        try {
                            self.capturedData.push({
                                url,
                                method: xhr._omni_method,
                                response: xhr.responseText?.substring(0, 10000) // Limit size
                            });
                        } catch (e) {
                            // Ignore capture errors
                        }
                    });
                }

                return self.originalSend.apply(this, [body]);
            };

            console.log('[OmniExporter] XHR interceptor started');
        }

        stop() {
            if (this.originalOpen) {
                XMLHttpRequest.prototype.open = this.originalOpen;
                XMLHttpRequest.prototype.send = this.originalSend;
                this.originalOpen = null;
                this.originalSend = null;
            }
        }

        getCapturedData() {
            return this.capturedData;
        }
    }

    // ============================================
    // INITIALIZATION
    // ============================================
    const bridge = new WebBridge();
    const interceptor = new XHRInterceptor();

    // Start interceptor for Gemini pages
    if (window.location.hostname.includes('gemini.google.com')) {
        interceptor.start();

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            interceptor.stop();
        });
    }

    // Expose for debugging (remove in production)
    window.__omniexporter_gemini = {
        bridge,
        interceptor,
        getGlobalData: () => bridge.getGlobalData(),
        getConversations: () => bridge.getConversations()
    };
})();
