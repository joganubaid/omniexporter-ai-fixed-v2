/**
 * OmniExporter AI — Logger
 *
 * Privacy-first design (HARD rule, not a recommendation):
 *
 *   Debug OFF (default — user opens DevTools, sees nothing extraneous):
 *     - ONLY ERROR entries are stored.
 *     - Stored ERROR entries have NO data payload — just timestamp, module,
 *       message, trace ID. Chat content can NEVER leak via the log store
 *       in this mode, even if a caller passes a full conversation object.
 *     - WARN / INFO / DEBUG still print to the browser console for the
 *       developer who has DevTools open right now, but nothing persists.
 *
 *   Debug ON (user explicitly toggled it in Settings):
 *     - Everything is stored: ERROR / WARN / INFO / DEBUG.
 *     - Full data payloads stored, with secret redaction still applied.
 *     - Dashboard shows a red banner reminding the user that logs may
 *       contain chat content and they should clear before sharing.
 *
 * Tracing:
 *
 *   Every export / sync flow gets a unique `traceId`. Pass it through
 *   chained calls so the log viewer can group all related entries.
 *   `Logger.startTrace(name)` returns a short ID; pass it as the 4th
 *   arg's `traceId` to subsequent `Logger.info/debug/warn/error` calls.
 *
 * Performance timing:
 *
 *   `const t = Logger.time(module, label, traceId)`
 *   `const ms = t.end({ extra: 'data' })`
 *   Logs `<label> completed in <ms>ms` at DEBUG level with the duration
 *   field on `data`. Useful for performance summary card in the viewer.
 *
 * Traced fetch:
 *
 *   `await Logger.tracedFetch(url, options, { module, traceId, label })`
 *   Wraps fetch with request/response logging (method, URL with secret
 *   query params scrubbed, status, duration). Drop-in replacement at
 *   adapter API call sites.
 */
"use strict";

// Assign to globalThis so this is safe to re-import in a service worker.
// Using `const Logger` would throw "already declared" when importScripts runs
// the file again after a service worker restart within the same global scope.
globalThis.Logger = globalThis.Logger || ({
    config: {
        enabled: false,             // Debug mode toggle (persisted as `debugMode`)
        maxEntries: 1000,           // Max stored log entries (oldest pruned)
        consoleOutput: true,        // Also output to console
        storageKey: 'omniExporterLogs'
    },

    // Context detection — are we in a content script vs background SW?
    _isContentScript: (typeof window !== 'undefined' &&
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        !chrome.runtime.getBackgroundPage),
    _isBackground: (typeof importScripts === 'function'),

    LEVELS: {
        ERROR: { value: 0, label: 'ERROR', color: '#ff4444' },
        WARN:  { value: 1, label: 'WARN',  color: '#ffaa00' },
        INFO:  { value: 2, label: 'INFO',  color: '#4488ff' },
        DEBUG: { value: 3, label: 'DEBUG', color: '#888888' }
    },

    MODULES: {
        AutoSync:   { icon: '🔄', description: 'Auto-sync operations' },
        OAuth:      { icon: '🔐', description: 'Notion authentication' },
        Content:    { icon: '📄', description: 'Content script' },
        Perplexity: { icon: '🟦', description: 'Perplexity adapter' },
        ChatGPT:    { icon: '🟢', description: 'ChatGPT adapter' },
        Claude:     { icon: '🟠', description: 'Claude adapter' },
        Gemini:     { icon: '🟣', description: 'Gemini adapter' },
        Grok:       { icon: '🔴', description: 'Grok adapter' },
        DeepSeek:   { icon: '🟤', description: 'DeepSeek adapter' },
        Export:     { icon: '📤', description: 'Export operations' },
        Notion:     { icon: '📝', description: 'Notion API' },
        Storage:    { icon: '💾', description: 'Chrome storage' },
        UI:         { icon: '🖥️', description: 'UI events' },
        Network:    { icon: '🌐', description: 'Network requests' },
        Platform:   { icon: '⚙️', description: 'Platform config' },
        System:     { icon: '🔧', description: 'System events' }
    },

    _buffer: [],
    _flushTimeout: null,
    _initialized: false,

    // ============================================
    // INITIALIZATION
    // ============================================

    async init() {
        if (this._initialized) return;

        try {
            const settings = await chrome.storage.local.get([
                'debugMode',
                'logMaxEntries',
                'logConsoleOutput'
            ]);

            this.config.enabled = settings.debugMode || false;
            this.config.maxEntries = settings.logMaxEntries || 1000;
            this.config.consoleOutput = settings.logConsoleOutput !== false;
            this._initialized = true;

            if (this.config.enabled) {
                this._log('INFO', 'System', 'Logger initialized (debug mode ON — full payloads stored)', null);
            }
        } catch (e) {
            console.error('[Logger] Init failed:', e);
        }
    },

    /**
     * Update logger settings. When debug mode flips OFF, every stored log
     * is wiped — privacy contract is "anything in storage was opted in".
     */
    async updateSettings(settings) {
        const wasEnabled = this.config.enabled;

        if (settings.debugMode !== undefined) this.config.enabled = settings.debugMode;
        if (settings.logMaxEntries !== undefined) this.config.maxEntries = settings.logMaxEntries;
        if (settings.logConsoleOutput !== undefined) this.config.consoleOutput = settings.logConsoleOutput;

        await chrome.storage.local.set({
            debugMode: this.config.enabled,
            logMaxEntries: this.config.maxEntries,
            logConsoleOutput: this.config.consoleOutput
        });

        // Privacy contract: turning debug OFF wipes everything that was stored.
        if (wasEnabled && !this.config.enabled) {
            console.log('[Logger] Debug mode disabled — clearing all stored logs');
            await this.secureClear();
        }
    },

    async secureClear() {
        this._buffer = [];
        await chrome.storage.local.remove([
            this.config?.storageKey || 'omniExporterLogs',
            'omniLogs',
            'logEntries',
            'testHistory',
            'debugLogs'
        ]);
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }
        console.log('[Logger] All logs securely cleared');
        return true;
    },

    // ============================================
    // TRACING — group related log entries
    // ============================================

    /**
     * Generate a short, human-typeable trace ID for one export/sync flow.
     * Pass the returned ID to subsequent Logger.* calls via the `traceId`
     * field on the options arg.
     *
     *   const tid = Logger.startTrace('autosync');
     *   Logger.info('AutoSync', 'started', { count: 50 }, { traceId: tid });
     */
    startTrace(name = 'flow') {
        const id = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        if (this.config.enabled) {
            this._log('DEBUG', 'System', `trace started: ${name}`, { traceId: id });
        }
        return id;
    },

    /**
     * Stopwatch. `t.end()` logs `<label> completed in <ms>ms` at DEBUG.
     * Returns the duration as a number.
     */
    time(module, label, traceId = null) {
        const startMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return {
            end: (data = null) => {
                const startedAt = startMs;
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                const durationMs = Math.round(now - startedAt);
                if (this.config.enabled) {
                    this._log('DEBUG', module, `${label} completed in ${durationMs}ms`,
                        Object.assign({ durationMs }, data || {}), null, { traceId });
                }
                return durationMs;
            }
        };
    },

    /**
     * Drop-in `fetch` wrapper that logs request + response + duration.
     *
     *   const res = await Logger.tracedFetch(url, init, {
     *       module: 'Claude',
     *       traceId: tid,
     *       label: 'list conversations'  // optional, defaults to URL path
     *   });
     *
     * Behaviour:
     *   - Debug OFF: only failed (non-2xx) responses log at ERROR with the
     *     scrubbed URL + status. No request bodies, no response bodies.
     *   - Debug ON: every request logs at INFO with URL/status/durationMs.
     *     Failed requests log at ERROR.
     *   - The URL is always scrubbed of secret-shaped query params before
     *     being included in any log entry.
     */
    async tracedFetch(url, init = {}, opts = {}) {
        const module = opts.module || 'Network';
        const traceId = opts.traceId || null;
        const method = (init.method || 'GET').toUpperCase();
        const scrubbed = this._scrubUrl(url);
        const label = opts.label || scrubbed.replace(/^https?:\/\/[^/]+/, '');

        const startMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let response, err;
        try {
            response = await fetch(url, init);
        } catch (e) {
            err = e;
        }
        const durationMs = Math.round(
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startMs);

        if (err) {
            this._log('ERROR', module, `${method} ${label} threw after ${durationMs}ms: ${err.message}`,
                { method, url: scrubbed, durationMs }, err, { traceId });
            throw err;
        }

        const status = response.status;
        const ok = response.ok;
        if (!ok) {
            this._log('ERROR', module, `${method} ${label} → ${status} in ${durationMs}ms`,
                { method, url: scrubbed, status, durationMs }, null, { traceId });
        } else if (this.config.enabled) {
            this._log('INFO', module, `${method} ${label} → ${status} in ${durationMs}ms`,
                { method, url: scrubbed, status, durationMs }, null, { traceId });
        }

        return response;
    },

    // ============================================
    // CORE LOGGING
    // ============================================

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    },

    /**
     * Core log dispatcher. Honours the privacy contract:
     *   Debug OFF → only ERROR is stored, and stored ERROR has no data payload.
     *   Debug ON  → everything is stored with full (redacted) payloads.
     * Console output happens regardless for the developer with DevTools open.
     */
    _log(level, module, message, data = null, error = null, opts = {}) {
        const levelConfig = this.LEVELS[level];
        if (!levelConfig) return null;
        const moduleConfig = this.MODULES[module] || { icon: '❓', description: module };
        const traceId = opts.traceId || null;

        const fullEntry = {
            id: this._generateId(),
            timestamp: new Date().toISOString(),
            level,
            module,
            moduleIcon: moduleConfig.icon,
            message,
            data: data ? this._sanitizeData(data) : null,
            stack: error?.stack || null,
            traceId
        };

        // Always console — the dev has DevTools right now and the privacy
        // contract is about STORAGE, not transient console output.
        if (this.config.consoleOutput || levelConfig.value <= 1) {
            this._consoleOutput(fullEntry, levelConfig);
        }

        // Storage gating — the privacy contract.
        if (this.config.enabled) {
            // Debug ON: store everything with full payloads.
            this._enqueue(fullEntry);
        } else if (level === 'ERROR') {
            // Debug OFF: store ERROR only, and strip the payload + stack
            // so chat content cannot leak. The dev needs to enable debug
            // mode to see why it failed.
            this._enqueue({
                id: fullEntry.id,
                timestamp: fullEntry.timestamp,
                level: 'ERROR',
                module,
                moduleIcon: fullEntry.moduleIcon,
                message,
                data: null,
                stack: null,
                traceId,
                _privacy: 'data-stripped (enable debug mode to see payloads)'
            });
        }

        return fullEntry;
    },

    _enqueue(entry) {
        if (this._isContentScript) {
            this._sendToBackground(entry);
        } else {
            this._buffer.push(entry);
            this._scheduleFlush();
        }
    },

    _sendToBackground(entry) {
        try {
            chrome.runtime.sendMessage({
                type: 'LOGGER_STORE_LOG',
                payload: entry
            }).catch(() => { /* background not ready, drop entry */ });
        } catch (e) {
            // Extension context invalidated — drop.
        }
    },

    /** Background SW receives this from content-script-side _sendToBackground. */
    receiveLog(entry) {
        if (!entry || !entry.id) return;
        this._buffer.push(entry);
        this._scheduleFlush();
    },

    // ============================================
    // REDACTION
    // ============================================

    /**
     * Strip secret-shaped query parameters from a URL so the URL is safe
     * to embed in a log entry. Returns the rebuilt URL.
     */
    _scrubUrl(url) {
        try {
            const u = new URL(url, 'https://placeholder.invalid');
            const SECRET_PARAMS = new Set([
                'token', 'access_token', 'refresh_token', 'auth', 'authorization',
                'sig', 'signature', 'key', 'apikey', 'api_key', 'secret',
                'session', 'sid', 'cookie', 'bearer', 'jwt',
                // Cloudflare R2 / S3 signed URL params
                'X-Amz-Signature', 'X-Amz-Credential',
                // Google batchexecute auth token
                'at',
                // OAuth flow
                'code_verifier', 'code_challenge', 'state'
            ]);
            let changed = false;
            for (const name of [...u.searchParams.keys()]) {
                const lower = name.toLowerCase();
                if (SECRET_PARAMS.has(lower) || SECRET_PARAMS.has(name)) {
                    u.searchParams.set(name, '[REDACTED]');
                    changed = true;
                }
            }
            // If we replaced the placeholder origin, rebuild with the original
            // scheme/host (URL parser is unforgiving about absolute URLs).
            if (u.origin === 'https://placeholder.invalid') {
                const pathStart = url.indexOf(u.pathname);
                if (pathStart < 0) return url;
                const original = url.slice(0, pathStart);
                return original + u.pathname + (changed ? '?' + u.searchParams.toString() : (u.search || ''));
            }
            return u.toString();
        } catch {
            return String(url);
        }
    },

    /**
     * Sanitize data values before storage. Used even in debug mode — the
     * dev sees their own data, not stripped, but tokens are still masked.
     */
    _sanitizeData(data) {
        try {
            if (data === null || data === undefined) return null;
            if (typeof data !== 'object') return data;

            const SENSITIVE_KEYS = [
                'password', 'token', 'access_token', 'refresh_token',
                'secret', 'apikey', 'api_key', 'authorization', 'cookie',
                'session', 'sid', 'credential', 'bearer', 'jwt',
                'notionapikey', 'notionkey', 'notion_oauth_access_token',
                'snlm0e', 'at'
            ];
            // JWT pattern (3 base64url chunks separated by dots, each >= 20 chars).
            const JWT_RE = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

            return JSON.parse(JSON.stringify(data, (key, value) => {
                const lowerKey = String(key).toLowerCase();
                if (SENSITIVE_KEYS.some(sk => lowerKey === sk || lowerKey.endsWith('_' + sk))) {
                    return '[REDACTED]';
                }
                if (typeof value === 'string') {
                    let v = value;
                    // Mask JWTs anywhere in the string.
                    v = v.replace(JWT_RE, '[JWT_REDACTED]');
                    // Long strings → truncate to keep storage bounded.
                    if (v.length > 500) v = v.substring(0, 500) + '...[truncated]';
                    return v;
                }
                // Preserve undefined as null so callers can see which keys were set
                // but undefined (JSON.stringify drops undefined fields entirely).
                if (value === undefined) return null;
                return value;
            }));
        } catch {
            return { _error: 'Could not serialize data', _type: typeof data };
        }
    },

    // ============================================
    // CONSOLE + STORAGE FLUSH
    // ============================================

    _consoleOutput(entry, levelConfig) {
        const trace = entry.traceId ? ` trace=${entry.traceId.split('-').slice(-2).join('-')}` : '';
        const prefix = `[${entry.moduleIcon} ${entry.module}${trace}]`;
        const style = `color: ${levelConfig.color}; font-weight: bold`;

        switch (entry.level) {
            case 'ERROR':
                console.error(`%c${prefix}`, style, entry.message, entry.data || '', entry.stack || '');
                break;
            case 'WARN':
                console.warn(`%c${prefix}`, style, entry.message, entry.data || '');
                break;
            case 'INFO':
                console.log(`%c${prefix}`, style, entry.message, entry.data || '');
                break;
            case 'DEBUG':
                console.debug(`%c${prefix}`, style, entry.message, entry.data || '');
                break;
        }
    },

    _scheduleFlush() {
        if (this._flushTimeout) return;
        this._flushTimeout = setTimeout(() => {
            this._flushToStorage();
            this._flushTimeout = null;
        }, 5000);
    },

    _flushing: false,

    async _flushToStorage() {
        if (this._buffer.length === 0 || this._flushing) return;

        this._flushing = true;
        const toFlush = this._buffer;
        this._buffer = [];

        try {
            const { [this.config.storageKey]: existingLogs = [] } =
                await chrome.storage.local.get(this.config.storageKey);
            const validLogs = Array.isArray(existingLogs) ? existingLogs : [];
            const allLogs = [...validLogs, ...toFlush];
            const trimmedLogs = allLogs.slice(-this.config.maxEntries);
            await chrome.storage.local.set({ [this.config.storageKey]: trimmedLogs });
        } catch (e) {
            // Put entries back so they aren't lost.
            this._buffer = [...toFlush, ...this._buffer];
            console.error('[Logger] Storage flush failed:', e);
        } finally {
            this._flushing = false;
        }
    },

    // ============================================
    // PUBLIC LOGGING METHODS
    //
    // 4th arg is the optional options object: { traceId }
    // Older call sites pass nothing → traceId is just null on the entry.
    // ============================================

    error(module, message, data = null, opts = {}) {
        const error = data instanceof Error ? data : null;
        const dataObj = error ? { message: error.message, name: error.name } : data;
        return this._log('ERROR', module, message, dataObj, error, opts);
    },

    warn(module, message, data = null, opts = {}) {
        // Debug-OFF privacy contract: WARN does not store, but does console.
        return this._log('WARN', module, message, data, null, opts);
    },

    info(module, message, data = null, opts = {}) {
        return this._log('INFO', module, message, data, null, opts);
    },

    debug(module, message, data = null, opts = {}) {
        return this._log('DEBUG', module, message, data, null, opts);
    },

    // ============================================
    // LOG RETRIEVAL AND EXPORT
    // ============================================

    async getLogs(options = {}) {
        await this._flushToStorage();
        const { [this.config.storageKey]: logs = [] } =
            await chrome.storage.local.get(this.config.storageKey);

        let filtered = Array.isArray(logs) ? [...logs] : [];

        if (options.level) {
            const minLevel = this.LEVELS[options.level]?.value ?? 0;
            filtered = filtered.filter(log => this.LEVELS[log.level]?.value <= minLevel);
        }
        if (options.module) {
            filtered = filtered.filter(log => log.module === options.module);
        }
        if (options.traceId) {
            filtered = filtered.filter(log => log.traceId === options.traceId);
        }
        if (options.search) {
            const term = options.search.toLowerCase();
            filtered = filtered.filter(log =>
                (log.message || '').toLowerCase().includes(term) ||
                JSON.stringify(log.data || {}).toLowerCase().includes(term) ||
                (log.traceId || '').toLowerCase().includes(term)
            );
        }
        if (options.since) {
            const sinceTime = new Date(options.since).getTime();
            filtered = filtered.filter(log => new Date(log.timestamp).getTime() >= sinceTime);
        }
        if (options.limit) {
            filtered = filtered.slice(-options.limit);
        }

        return filtered;
    },

    async getStats() {
        const logs = await this.getLogs();
        const stats = {
            total: logs.length,
            byLevel: { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 },
            byModule: {},
            byTrace: {},
            oldest: logs[0]?.timestamp || null,
            newest: logs[logs.length - 1]?.timestamp || null
        };
        for (const log of logs) {
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            stats.byModule[log.module] = (stats.byModule[log.module] || 0) + 1;
            if (log.traceId) stats.byTrace[log.traceId] = (stats.byTrace[log.traceId] || 0) + 1;
        }
        return stats;
    },

    /**
     * Performance summary — last N traced operations with `durationMs`.
     * Used by the dashboard's "Performance" card.
     */
    async getPerformanceSummary(limit = 50) {
        const logs = await this.getLogs();
        const timed = logs
            .filter(l => l.data && typeof l.data.durationMs === 'number')
            .slice(-limit);
        if (timed.length === 0) {
            return { count: 0, avgMs: 0, p95Ms: 0, slowest: null, byModule: {} };
        }
        const durations = timed.map(l => l.data.durationMs).sort((a, b) => a - b);
        const avgMs = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
        const p95Ms = durations[Math.floor(durations.length * 0.95)] || durations[durations.length - 1];
        const slowest = timed.reduce((s, l) => (l.data.durationMs > (s?.data.durationMs || 0) ? l : s), null);

        const byModule = {};
        for (const l of timed) {
            const m = byModule[l.module] = byModule[l.module] || { count: 0, total: 0 };
            m.count++;
            m.total += l.data.durationMs;
        }
        for (const m of Object.values(byModule)) m.avg = Math.round(m.total / m.count);

        return { count: timed.length, avgMs, p95Ms, slowest, byModule };
    },

    /**
     * Export logs as a downloadable blob.
     * Formats: 'json' (single wrapper object), 'ndjson' (one entry per line —
     * greppable, easier for tail/cat/jq), 'txt' (human-readable).
     */
    async exportLogs(format = 'ndjson') {
        const logs = await this.getLogs();
        const stats = await this.getStats();

        if (format === 'ndjson') {
            const content = logs.map(l => JSON.stringify(l)).join('\n');
            return {
                content,
                filename: `omniexporter-logs-${Date.now()}.ndjson`,
                mimeType: 'application/x-ndjson'
            };
        }

        if (format === 'json') {
            const exportData = {
                exportedAt: new Date().toISOString(),
                extensionVersion: chrome.runtime.getManifest().version,
                debugMode: this.config.enabled,
                stats,
                logs
            };
            return {
                content: JSON.stringify(exportData, null, 2),
                filename: `omniexporter-logs-${Date.now()}.json`,
                mimeType: 'application/json'
            };
        }

        // txt — human readable
        const lines = [
            '='.repeat(60),
            'OmniExporter AI - Debug Logs',
            '='.repeat(60),
            `Exported: ${new Date().toISOString()}`,
            `Version: ${chrome.runtime.getManifest().version}`,
            `Total Logs: ${stats.total}`,
            `Errors: ${stats.byLevel.ERROR} | Warnings: ${stats.byLevel.WARN}`,
            '='.repeat(60),
            '',
            ...logs.map(log => {
                const time = (log.timestamp || '').split('T')[1]?.split('.')[0] || '';
                const trace = log.traceId ? ` trace=${log.traceId}` : '';
                const data = log.data ? ` | ${JSON.stringify(log.data)}` : '';
                return `[${time}] [${log.level}] ${log.moduleIcon || ''} ${log.module}${trace}: ${log.message}${data}`;
            })
        ];
        return {
            content: lines.join('\n'),
            filename: `omniexporter-logs-${Date.now()}.txt`,
            mimeType: 'text/plain'
        };
    },

    /** Generate AI-friendly debug report (markdown). Unchanged from prior API. */
    async generateAIReport() {
        const logs = await this.getLogs({ limit: 200 });
        const stats = await this.getStats();
        const errors = logs.filter(l => l.level === 'ERROR');
        const warnings = logs.filter(l => l.level === 'WARN');

        const report = [
            '# OmniExporter Debug Report',
            '',
            '## Summary',
            `- Total logs: ${stats.total}`,
            `- Errors: ${errors.length}`,
            `- Warnings: ${warnings.length}`,
            `- Time range: ${stats.oldest} to ${stats.newest}`,
            '',
            '## Errors',
            errors.length === 0 ? 'No errors recorded.' : '',
            ...errors.map(e => `- [${e.module}] ${e.message}${e.data ? ': ' + JSON.stringify(e.data) : ''}`),
            '',
            '## Warnings',
            warnings.length === 0 ? 'No warnings recorded.' : '',
            ...warnings.map(w => `- [${w.module}] ${w.message}`),
            '',
            '## Recent Activity (Last 50 logs)',
            ...logs.slice(-50).map(log => {
                const time = (log.timestamp || '').split('T')[1]?.split('.')[0] || '';
                return `${time} [${log.level}] ${log.module}: ${log.message}`;
            })
        ];

        return report.join('\n');
    },

    async clear() {
        this._buffer = [];
        await chrome.storage.local.remove(this.config.storageKey);
        this.info('System', 'Logs cleared');
    }
}); // end globalThis.Logger assignment

// Alias for convenience — use var (not const/let) so re-importing is safe.
var Logger = globalThis.Logger;

Logger.init();

// Logger is attached to globalThis at the top of this file (works in both
// service-worker and content-script contexts). Also expose on window so
// dashboard/popup pages can use it without the globalThis dance.
if (typeof window !== 'undefined') {
    window.Logger = globalThis.Logger;
}
