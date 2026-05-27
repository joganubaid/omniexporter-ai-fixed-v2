// OmniExporter AI - Gemini Page Context Injection
// This script runs in the page context to access window.WIZ_global_data
"use strict";

(function () {
    'use strict';

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
        //
        // ⚠ NOTE ON ISOLATED-WORLD: This script is loaded as a regular content
        // script (manifest.json content_scripts), which means it runs in
        // Chrome's ISOLATED world. From there, `window.WIZ_global_data` is
        // Gemini's page-context global and is NOT directly accessible — the
        // isolated `window` is a sandboxed copy. The `if (typeof
        // window.WIZ_global_data !== 'undefined')` checks below therefore
        // almost always evaluate false in production; the inline-script-text
        // scan fallback at the bottom of each method is what actually
        // extracts the values.
        //
        // The direct reads are kept for two reasons: (1) cheap fast-path if
        // some Chrome version ever surfaces the global in isolated world, and
        // (2) ergonomic readability — the field names make the intent clear.
        // If you want the primary path to actually fire, this script needs to
        // be split into its own `content_scripts` entry with `"world":
        // "MAIN"` in manifest.json (Chrome 102+ feature).
        // ============================================

        getGlobalData() {
            if (typeof window.WIZ_global_data !== 'undefined') {
                return {
                    exists: true,
                    keys: Object.keys(window.WIZ_global_data),
                    SNlM0e: window.WIZ_global_data.SNlM0e, // XSRF token ("at" param)
                    cfb2h: window.WIZ_global_data.cfb2h,   // Build ID ("bl" param)
                    FdrFJe: window.WIZ_global_data.FdrFJe, // Session ID ("f.sid" param)
                };
            }
            return { exists: false };
        }

        getAuthToken() {
            // Primary (rarely fires from isolated world — see note above)
            if (window.WIZ_global_data?.SNlM0e) {
                return { token: window.WIZ_global_data.SNlM0e };
            }

            // Fallback (always works): scan inline <script> tags for the JSON literal
            // that Gemini's HTML embeds the SNlM0e token in.
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                const content = script.textContent;
                if (!content || !content.includes('SNlM0e')) continue;
                const match = content.match(/"SNlM0e":"([^"]+)"/);
                if (match) return { token: match[1] };
            }

            return null;
        }

        // Extract all session parameters needed for batchexecute API calls.
        // HAR (2026-05): bl=boq_assistant-bard-web-server_YYYYMMDD.NN_p0
        //                f.sid=<numeric>
        //                at=<SNlM0e XSRF token>:<page-load ms timestamp>
        //
        // The :<timestamp> suffix is what Gemini's own frontend sends. The
        // value is reused for the entire session (verified across 40+ calls
        // in one HAR with the same `at` value). We capture it ONCE per
        // session-params read and let it ride.
        getSessionParams() {
            const params = { at: null, bl: null, fsid: null };
            let rawAt = null;

            // From WIZ_global_data (primary source)
            if (typeof window.WIZ_global_data !== 'undefined') {
                rawAt = window.WIZ_global_data.SNlM0e || null;       // XSRF token
                params.bl = window.WIZ_global_data.cfb2h || null;    // Build version → "bl" query param
                params.fsid = window.WIZ_global_data.FdrFJe || null; // Session ID → "f.sid" query param
            }

            // Fallback: parse from page HTML if WIZ_global_data missing
            if (!rawAt || !params.bl) {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    if (!rawAt) {
                        const atMatch = text.match(/"SNlM0e":"([^"]+)"/);
                        if (atMatch) rawAt = atMatch[1];
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

            // Append :<timestamp> exactly as Gemini's frontend does. If the
            // raw token already has a colon (some builds bake it in) leave
            // it alone, otherwise append the current ms timestamp.
            if (rawAt) {
                params.at = rawAt.includes(':') ? rawAt : `${rawAt}:${Date.now()}`;
            }

            console.log('[OmniExporter] Session params:', {
                at: params.at ? '✓ found' : '✗ missing',
                bl: params.bl ? '✓ ' + params.bl : '✗ missing',
                fsid: params.fsid ? '✓ found' : '✗ missing'
            });

            return params;
        }
        // (getConversations / getConversationDetail removed — bridge dispatch
        // table at lines ~47-58 never routes to them, and after DOM scraping
        // was removed they both returned empty placeholders anyway. Chat
        // listing happens via MaZiqc RPC and detail via hNvQHb RPC, both
        // executed from gemini-adapter.js in the content-script context.)
    }

    // (Also removed: unused BRIDGE_ID constant.)

    // ============================================
    // INITIALIZATION
    // ============================================
    const bridge = new WebBridge();
    // Local-only reference — the bridge intentionally has no window-attached
    // handle so page scripts can't reach getGlobalData() (which would expose
    // the XSRF token).
})();
