/**
 * OmniExporter AI - Enterprise Logger
 * Comprehensive logging system with storage, filtering, and export
 * 
 * Usage:
 *   Logger.info('ModuleName', 'Message', { optional: 'data' });
 *   Logger.error('ModuleName', 'Error occurred', { error: e.message });
 */

const Logger = {
    // Configuration
    config: {
        enabled: false,           // Debug mode toggle
        maxEntries: 1000,         // Max stored log entries
        consoleOutput: true,      // Also output to console
        storageKey: 'omniExporterLogs'
    },

    // Context detection - are we in a content script?
    _isContentScript: (typeof window !== 'undefined' &&
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        !chrome.runtime.getBackgroundPage),
    _isBackground: (typeof importScripts === 'function'),

    // Log levels
    LEVELS: {
        ERROR: { value: 0, label: 'ERROR', color: '#ff4444' },
        WARN: { value: 1, label: 'WARN', color: '#ffaa00' },
        INFO: { value: 2, label: 'INFO', color: '#4488ff' },
        DEBUG: { value: 3, label: 'DEBUG', color: '#888888' }
    },

    // Module definitions for filtering
    MODULES: {
        AutoSync: { icon: '🔄', description: 'Auto-sync operations' },
        OAuth: { icon: '🔐', description: 'Notion authentication' },
        Content: { icon: '📄', description: 'Content script' },
        Perplexity: { icon: '🟦', description: 'Perplexity adapter' },
        ChatGPT: { icon: '🟢', description: 'ChatGPT adapter' },
        Claude: { icon: '🟠', description: 'Claude adapter' },
        Gemini: { icon: '🟣', description: 'Gemini adapter' },
        Grok: { icon: '🔴', description: 'Grok adapter' },
        DeepSeek: { icon: '🟤', description: 'DeepSeek adapter' },
        Export: { icon: '📤', description: 'Export operations' },
        Notion: { icon: '📝', description: 'Notion API' },
        Storage: { icon: '💾', description: 'Chrome storage' },
        UI: { icon: '🖥️', description: 'UI events' },
        Network: { icon: '🌐', description: 'Network requests' },
        Platform: { icon: '⚙️', description: 'Platform config' },
        System: { icon: '🔧', description: 'System events' }
    },

    // In-memory log buffer (for when storage is slow)
    _buffer: [],
    _flushTimeout: null,
    _initialized: false,

    /**
     * Initialize logger - load settings from storage
     */
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

            // Log initialization
            if (this.config.enabled) {
                this._log('INFO', 'System', 'Logger initialized', {
                    enabled: this.config.enabled,
                    maxEntries: this.config.maxEntries
                });
            }
        } catch (e) {
            console.error('[Logger] Init failed:', e);
        }
    },

    /**
     * Update logger settings
     * SECURITY: Auto-clears logs when debug mode is disabled
     */
    async updateSettings(settings) {
        const wasEnabled = this.config.enabled;

        if (settings.debugMode !== undefined) {
            this.config.enabled = settings.debugMode;
        }
        if (settings.logMaxEntries !== undefined) {
            this.config.maxEntries = settings.logMaxEntries;
        }
        if (settings.logConsoleOutput !== undefined) {
            this.config.consoleOutput = settings.logConsoleOutput;
        }

        await chrome.storage.local.set({
            debugMode: this.config.enabled,
            logMaxEntries: this.config.maxEntries,
            logConsoleOutput: this.config.consoleOutput
        });

        // SECURITY: Auto-clear logs when debug mode is disabled
        if (wasEnabled && !this.config.enabled) {
            console.log('[Logger] Debug mode disabled - clearing all logs for security');
            await this.secureClear();
        }
    },

    /**
     * Secure clear - removes ALL log-related data
     * Called when: debug mode is disabled, on session end, manual clear
     */
    async secureClear() {
        // Clear in-memory buffer
        this._buffer = [];

        // Clear all log-related storage
        await chrome.storage.local.remove([
            'omniLogs',
            'logEntries',
            'testHistory',
            'debugLogs'
        ]);

        // Force garbage collection hint
        if (typeof globalThis.gc === 'function') {
            globalThis.gc();
        }

        console.log('[Logger] All logs securely cleared');
        return true;
    },

    /**
     * Generate unique ID for log entry
     */
    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Core logging function
     */
    _log(level, module, message, data = null, error = null) {
        const levelConfig = this.LEVELS[level];
        const moduleConfig = this.MODULES[module] || { icon: '❓', description: module };

        // Create log entry
        const entry = {
            id: this._generateId(),
            timestamp: new Date().toISOString(),
            level: level,
            module: module,
            moduleIcon: moduleConfig.icon,
            message: message,
            data: data ? this._sanitizeData(data) : null,
            stack: error?.stack || null
        };

        // Always output to console for ERROR and WARN
        if (this.config.consoleOutput || levelConfig.value <= 1) {
            this._consoleOutput(entry, levelConfig);
        }

        // Store log if debug mode is enabled
        if (this.config.enabled || levelConfig.value <= 1) {
            // Content scripts send logs to background
            if (this._isContentScript) {
                this._sendToBackground(entry);
            } else {
                this._buffer.push(entry);
                this._scheduleFlush();
            }
        }

        return entry;
    },

    /**
     * Send log entry to background script for storage (content scripts only)
     */
    _sendToBackground(entry) {
        try {
            chrome.runtime.sendMessage({
                type: 'LOGGER_STORE_LOG',
                payload: entry
            }).catch(() => {
                // Ignore errors - background might not be ready
            });
        } catch (e) {
            // Extension context invalidated, ignore
        }
    },

    /**
     * Receive log entry from content script (background only)
     * Call this from background.js message listener
     */
    receiveLog(entry) {
        if (!entry || !entry.id) return;
        this._buffer.push(entry);
        this._scheduleFlush();
    },

    /**
     * Sanitize data to prevent circular references and sensitive data
     */
    _sanitizeData(data) {
        try {
            // Handle simple types
            if (data === null || data === undefined) return null;
            if (typeof data !== 'object') return data;

            // Limit object depth and size
            const sanitized = JSON.parse(JSON.stringify(data, (key, value) => {
                // Remove sensitive keys
                if (['password', 'token', 'secret', 'apiKey', 'access_token'].includes(key.toLowerCase())) {
                    return '[REDACTED]';
                }
                // Truncate long strings
                if (typeof value === 'string' && value.length > 500) {
                    return value.substring(0, 500) + '...[truncated]';
                }
                return value;
            }));

            return sanitized;
        } catch (e) {
            return { _error: 'Could not serialize data', _type: typeof data };
        }
    },

    /**
     * Output to browser console
     */
    _consoleOutput(entry, levelConfig) {
        const prefix = `[${entry.moduleIcon} ${entry.module}]`;
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

    /**
     * Schedule buffer flush to storage
     */
    _scheduleFlush() {
        if (this._flushTimeout) return;

        this._flushTimeout = setTimeout(() => {
            this._flushToStorage();
            this._flushTimeout = null;
        }, 1000); // Flush every 1 second max
    },

    /**
     * Flush buffer to storage
     */
    async _flushToStorage() {
        if (this._buffer.length === 0) return;

        try {
            const { [this.config.storageKey]: existingLogs = [] } =
                await chrome.storage.local.get(this.config.storageKey);

            // Combine and limit
            const allLogs = [...existingLogs, ...this._buffer];
            const trimmedLogs = allLogs.slice(-this.config.maxEntries);

            await chrome.storage.local.set({
                [this.config.storageKey]: trimmedLogs
            });

            this._buffer = [];
        } catch (e) {
            console.error('[Logger] Storage flush failed:', e);
        }
    },

    // ============================================
    // PUBLIC LOGGING METHODS
    // ============================================

    /**
     * Log error - always logged and stored
     */
    error(module, message, data = null) {
        const error = data instanceof Error ? data : null;
        const dataObj = error ? { message: error.message, name: error.name } : data;
        return this._log('ERROR', module, message, dataObj, error);
    },

    /**
     * Log warning - always logged and stored
     */
    warn(module, message, data = null) {
        return this._log('WARN', module, message, data);
    },

    /**
     * Log info - only when debug mode enabled
     */
    info(module, message, data = null) {
        if (!this.config.enabled) return null;
        return this._log('INFO', module, message, data);
    },

    /**
     * Log debug - only when debug mode enabled
     */
    debug(module, message, data = null) {
        if (!this.config.enabled) return null;
        return this._log('DEBUG', module, message, data);
    },

    /**
     * Log with timing (for performance tracking)
     */
    time(module, label) {
        const startTime = performance.now();
        return {
            end: (data = null) => {
                const duration = Math.round(performance.now() - startTime);
                this.debug(module, `${label} completed in ${duration}ms`, { duration, ...data });
                return duration;
            }
        };
    },

    // ============================================
    // LOG RETRIEVAL AND EXPORT
    // ============================================

    /**
     * Get logs with optional filtering
     */
    async getLogs(options = {}) {
        await this._flushToStorage(); // Ensure buffer is flushed

        const { [this.config.storageKey]: logs = [] } =
            await chrome.storage.local.get(this.config.storageKey);

        let filtered = [...logs];

        // Filter by level
        if (options.level) {
            const minLevel = this.LEVELS[options.level]?.value ?? 0;
            filtered = filtered.filter(log =>
                this.LEVELS[log.level]?.value <= minLevel
            );
        }

        // Filter by module
        if (options.module) {
            filtered = filtered.filter(log => log.module === options.module);
        }

        // Filter by search term
        if (options.search) {
            const term = options.search.toLowerCase();
            filtered = filtered.filter(log =>
                log.message.toLowerCase().includes(term) ||
                JSON.stringify(log.data || {}).toLowerCase().includes(term)
            );
        }

        // Filter by time range
        if (options.since) {
            const sinceTime = new Date(options.since).getTime();
            filtered = filtered.filter(log =>
                new Date(log.timestamp).getTime() >= sinceTime
            );
        }

        // Limit results
        if (options.limit) {
            filtered = filtered.slice(-options.limit);
        }

        return filtered;
    },

    /**
     * Get log statistics
     */
    async getStats() {
        const logs = await this.getLogs();

        const stats = {
            total: logs.length,
            byLevel: { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 },
            byModule: {},
            oldest: logs[0]?.timestamp || null,
            newest: logs[logs.length - 1]?.timestamp || null
        };

        logs.forEach(log => {
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
            stats.byModule[log.module] = (stats.byModule[log.module] || 0) + 1;
        });

        return stats;
    },

    /**
     * Export logs as downloadable file
     */
    async exportLogs(format = 'json') {
        const logs = await this.getLogs();
        const stats = await this.getStats();

        const exportData = {
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            debugMode: this.config.enabled,
            stats: stats,
            logs: logs
        };

        let content, filename, mimeType;

        if (format === 'json') {
            content = JSON.stringify(exportData, null, 2);
            filename = `omniexporter-logs-${Date.now()}.json`;
            mimeType = 'application/json';
        } else {
            // Text format for easy reading
            const lines = [
                '='.repeat(60),
                'OmniExporter AI - Debug Logs',
                '='.repeat(60),
                `Exported: ${exportData.exportedAt}`,
                `Version: ${exportData.extensionVersion}`,
                `Total Logs: ${stats.total}`,
                `Errors: ${stats.byLevel.ERROR} | Warnings: ${stats.byLevel.WARN}`,
                '='.repeat(60),
                '',
                ...logs.map(log => {
                    const time = log.timestamp.split('T')[1].split('.')[0];
                    const data = log.data ? ` | ${JSON.stringify(log.data)}` : '';
                    return `[${time}] [${log.level}] ${log.moduleIcon} ${log.module}: ${log.message}${data}`;
                })
            ];
            content = lines.join('\n');
            filename = `omniexporter-logs-${Date.now()}.txt`;
            mimeType = 'text/plain';
        }

        return { content, filename, mimeType };
    },

    /**
     * Generate AI-friendly debug report
     */
    async generateAIReport() {
        const logs = await this.getLogs({ limit: 200 }); // Last 200 logs
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
                const time = log.timestamp.split('T')[1].split('.')[0];
                return `${time} [${log.level}] ${log.module}: ${log.message}`;
            })
        ];

        return report.join('\n');
    },

    /**
     * Clear all stored logs
     */
    async clear() {
        this._buffer = [];
        await chrome.storage.local.remove(this.config.storageKey);
        this.info('System', 'Logs cleared');
    }
};

// Auto-initialize when loaded
Logger.init();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}

// Make available globally
if (typeof globalThis !== 'undefined') {
    globalThis.Logger = Logger;
}
if (typeof window !== 'undefined') {
    window.Logger = Logger;
}
