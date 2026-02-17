// OmniExporter AI - Gemini Page Context Interceptor
// This script MUST run in the PAGE context (not content script)
// It intercepts XHR requests to increase message fetch limit from 20 to 100

(function () {
    'use strict';

    // Prevent multiple injections
    if (window.__omniexporter_gemini_interceptor__) {
        console.log('[OmniExporter] Gemini interceptor already active');
        return;
    }
    window.__omniexporter_gemini_interceptor__ = true;

    const CONFIG = {
        targetUrl: '/_/BardChatUi/data/batchexecute',
        targetAction: 'hNvQHb',
        newLimit: 100,
        debug: true
    };

    function log(...args) {
        if (CONFIG.debug) {
            console.log('[OmniExporter-Interceptor]', ...args);
        }
    }

    // =============================================
    // XHR INTERCEPTOR
    // =============================================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    function isTargetRequest(url) {
        return url && url.includes(CONFIG.targetUrl);
    }

    function hasTargetRpcids(url, targetRpcid) {
        try {
            const urlObj = new URL(url, window.location.origin);
            return urlObj.searchParams.get('rpcids') === targetRpcid;
        } catch {
            return false;
        }
    }

    // Traverse nested arrays/objects and modify message limit
    function traverseAndModify(obj, callback) {
        if (Array.isArray(obj)) {
            return obj.map(item => {
                const modified = callback(item);
                return traverseAndModify(modified, callback);
            });
        } else if (typeof obj === 'object' && obj !== null) {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = traverseAndModify(value, callback);
            }
            return result;
        }
        return obj;
    }

    // Modify the f.req field to change message limit
    function modifyFreqField(freqStr) {
        try {
            const parsed = JSON.parse(freqStr);
            let modified = false;

            const result = traverseAndModify(parsed, (item) => {
                // Look for hNvQHb action with message limit
                if (Array.isArray(item) && item.length >= 2 &&
                    item[0] === CONFIG.targetAction && typeof item[1] === 'string') {
                    try {
                        const innerPayload = JSON.parse(item[1]);
                        // innerPayload[1] is the message limit (usually 10 or 20)
                        if (Array.isArray(innerPayload) && innerPayload.length > 1 &&
                            typeof innerPayload[1] === 'number' && innerPayload[1] <= 20) {
                            log(`Changing message limit from ${innerPayload[1]} to ${CONFIG.newLimit}`);
                            innerPayload[1] = CONFIG.newLimit;
                            item[1] = JSON.stringify(innerPayload);
                            modified = true;
                        }
                    } catch { }
                }
                return item;
            });

            return modified ? JSON.stringify(result) : freqStr;
        } catch {
            return freqStr;
        }
    }

    // Modify request body
    function modifyRequestBody(body) {
        if (!body || typeof body !== 'string' || !body.includes('f.req=')) {
            return body;
        }

        try {
            const params = new URLSearchParams(body);
            const freqValue = params.get('f.req');
            if (freqValue) {
                const modified = modifyFreqField(freqValue);
                if (modified !== freqValue) {
                    params.set('f.req', modified);
                    return params.toString();
                }
            }
        } catch (e) {
            log('Error modifying request:', e);
        }
        return body;
    }

    // Hook XMLHttpRequest.open
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        this._omni_url = url;
        this._omni_method = method;
        return originalXHROpen.call(this, method, url, async !== false, user || null, password || null);
    };

    // Hook XMLHttpRequest.send
    XMLHttpRequest.prototype.send = function (body) {
        const url = this._omni_url;

        // Only intercept Gemini batchexecute requests for hNvQHb (message fetch)
        if (url && isTargetRequest(url) && hasTargetRpcids(url, CONFIG.targetAction)) {
            const modifiedBody = modifyRequestBody(body);
            if (modifiedBody !== body) {
                log('✅ Modified request - message limit increased to', CONFIG.newLimit);
                return originalXHRSend.call(this, modifiedBody);
            }
        }

        return originalXHRSend.call(this, body);
    };

    // =============================================
    // NOTIFY CONTENT SCRIPT
    // =============================================
    window.postMessage({
        type: 'OMNIEXPORTER_GEMINI',
        direction: 'to-content',
        action: 'INTERCEPTOR_READY',
        success: true,
        data: { limit: CONFIG.newLimit }
    }, '*');

    log('✅ Gemini XHR interceptor active - message limit increased to', CONFIG.newLimit);
})();
