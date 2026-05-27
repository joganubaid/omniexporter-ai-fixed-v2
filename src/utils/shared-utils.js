// OmniExporter AI — Shared utilities loaded into popup, options, and background.
"use strict";

// ============================================
// NAMED CONSTANTS (avoiding magic numbers)
// ============================================
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RATE_LIMIT_REQUESTS_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_STALE_THRESHOLD_MS = 5 * 60 * 1000;
const RATE_LIMIT_BUFFER_MS = 100;
const RATE_LIMIT_ADAPTIVE_QUEUE_THRESHOLD = 50;
const RATE_LIMIT_DELAY_HIGH_MS = 500;
const RATE_LIMIT_DELAY_LOW_MS = 200;
const RATE_LIMIT_EXECUTION_TIMEOUT_MS = 60000; // 60s timeout per individual request

// ============================================
// LOADING MANAGER
// Handles loading states for buttons and containers
// ============================================
class LoadingManager {
    static show(elementId, text = 'Loading...') {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (el.tagName === 'BUTTON') {
            el.dataset.originalText = el.textContent;
            el.textContent = text;
            el.disabled = true;
        } else {
            el.dataset.originalContent = el.innerHTML;
            const container = document.createElement('div');
            container.className = 'loader-container';
            const loader = document.createElement('div');
            loader.className = 'loader';
            const span = document.createElement('span');
            span.textContent = text;
            container.appendChild(loader);
            container.appendChild(span);
            el.innerHTML = '';
            el.appendChild(container);
        }
    }

    static hide(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (el.tagName === 'BUTTON' && el.dataset.originalText !== undefined) {
            el.textContent = el.dataset.originalText;
            el.disabled = false;
            delete el.dataset.originalText;
        } else if (el.dataset.originalContent !== undefined) {
            el.innerHTML = el.dataset.originalContent;
            delete el.dataset.originalContent;
        }
    }
}

// ============================================
// INPUT SANITIZER
// ============================================
/**
 * Split text into chunks for Notion's 2000-char per-block `rich_text` limit.
 * Notion API rejects blocks whose text content exceeds 2000 chars; this
 * helper finds a clean break point (newline → period → space → hard cut)
 * to avoid mid-word splits.
 *
 * Default maxLength is 1900 — slightly under the 2000 cap to leave room for
 * surrounding markup the Notion API may add.
 */
function splitTextForNotion(text, maxLength = 1900) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        let bp = remaining.lastIndexOf('\n', maxLength);
        if (bp < maxLength / 2) bp = remaining.lastIndexOf('. ', maxLength);
        if (bp < maxLength / 2) bp = remaining.lastIndexOf(' ', maxLength);
        if (bp < maxLength / 2) bp = maxLength;
        chunks.push(remaining.slice(0, bp + 1).trim());
        remaining = remaining.slice(bp + 1);
    }
    return chunks;
}

class InputSanitizer {
    static clean(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, (m) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[m]);
    }

    static validateDatabaseId(id) {
        const cleanId = id.replace(/-/g, '');
        return /^[a-f0-9]{32}$/i.test(cleanId);
    }

    static validateNotionKey(key) {
        if (!key || typeof key !== 'string') return false;
        return /^secret_[a-zA-Z0-9]{43}$/.test(key) || /^ntn_[a-zA-Z0-9]{20,}$/.test(key);
    }

    // (validateUuid removed — duplicate of SecurityUtils.isValidUuid in
    // content.js, and had no call sites. Content-script code uses
    // SecurityUtils.isValidUuid; popup/options code doesn't validate UUIDs
    // because the values flow in from URL-extracted adapter responses that
    // already passed the SecurityUtils check upstream.)
}

// ============================================
// REQUEST DEDUPLICATOR
// Prevents duplicate in-flight requests
// ============================================
class RequestDeduplicator {
    constructor() {
        this.activeRequests = new Set();
    }

    async run(key, fn) {
        if (this.activeRequests.has(key)) {
            console.warn(`[OmniExporter] Duplicate request ignored: ${key}`);
            return null;
        }
        this.activeRequests.add(key);
        try {
            return await fn();
        } finally {
            this.activeRequests.delete(key);
        }
    }
}

// ============================================
// RATE LIMITER
// ============================================
class RateLimiter {
    constructor(requestsPerMinute = RATE_LIMIT_REQUESTS_PER_MINUTE) {
        this.requestsPerMinute = requestsPerMinute;
        this.queue = [];
        this.processing = false;
        this.requestTimestamps = [];
    }

    async throttle(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject, addedAt: Date.now() });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            const { addedAt } = this.queue[0];

            // Reject stale requests (>5 min in queue)
            if (now - addedAt > RATE_LIMIT_STALE_THRESHOLD_MS) {
                const stale = this.queue.shift();
                stale.reject(new Error('Request timeout: took too long in queue'));
                continue;
            }

            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

            if (this.requestTimestamps.length >= this.requestsPerMinute) {
                const oldestRequest = Math.min(...this.requestTimestamps);
                const waitTime = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - oldestRequest) + RATE_LIMIT_BUFFER_MS);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            const { fn, resolve, reject } = this.queue.shift();
            this.requestTimestamps.push(Date.now());

            let timeoutId;
            try {
                // Wrap execution with a timeout to prevent queue deadlock
                const result = await Promise.race([
                    fn(),
                    new Promise((_, timeoutReject) => {
                        timeoutId = setTimeout(
                            () => timeoutReject(new Error('Rate limiter: request execution exceeded 60s timeout')),
                            RATE_LIMIT_EXECUTION_TIMEOUT_MS
                        );
                    })
                ]);
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }

            const delay = this.queue.length > RATE_LIMIT_ADAPTIVE_QUEUE_THRESHOLD ? RATE_LIMIT_DELAY_HIGH_MS : RATE_LIMIT_DELAY_LOW_MS;
            await new Promise(r => setTimeout(r, delay));
        }

        this.processing = false;
    }
}

// ============================================
// NOTION ERROR MAPPER
// ============================================
const NotionErrorMapper = {
    map(error) {
        const code = error?.code || '';
        const msg = error?.message || '';

        const errorMap = {
            'object_not_found': 'Database not found. Please verify your Database ID.',
            'unauthorized': 'Invalid API key. Please check your Notion integration.',
            'restricted_resource': 'This database is not shared with your integration.',
            'rate_limited': 'Too many requests. Please wait a moment and try again.',
            'validation_error': 'Invalid data format. Check your content.',
            'conflict_error': 'A conflict occurred. Please try again.',
            'internal_server_error': 'Notion is experiencing issues. Try again later.'
        };

        if (errorMap[code]) return errorMap[code];
        if (msg.includes('Could not find database')) return errorMap['object_not_found'];
        if (msg.includes('API token')) return errorMap['unauthorized'];
        return msg || 'Unknown Notion error';
    }
};

// ============================================
// RETRY WITH EXPONENTIAL BACKOFF
// ============================================
async function withRetry(fn, maxRetries = RETRY_MAX_ATTEMPTS, baseDelayMs = RETRY_BASE_DELAY_MS) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Only skip retry for known non-retriable auth errors.
            // Do NOT use a broad 'Invalid' check — that also matches transient errors
            // like "Invalid JSON", "Invalid date", "Invalid block type" which SHOULD be retried.
            const nonRetriable = ['unauthorized', 'Invalid API key', 'invalid_token', 'revoked_token'];
            if (nonRetriable.some(msg => error.message?.includes(msg))) {
                throw error;
            }
            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                console.warn(`[OmniExporter] Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, error.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// ============================================
// PLATFORM URL GENERATOR (Shared Utility)
// Consolidated from background.js and popup.js
// Returns null for unknown platforms instead of fallback
// ============================================
const PlatformUrlBuilder = {
    // Platform URL templates
    _urls: {
        'Perplexity': (uuid) => `https://www.perplexity.ai/search/${uuid}`,
        'ChatGPT': (uuid) => `https://chatgpt.com/c/${uuid}`,
        'Claude': (uuid) => `https://claude.ai/chat/${uuid}`,
        'Gemini': (uuid) => `https://gemini.google.com/app/${uuid}`,
        'Grok': (uuid) => `https://grok.com/chat/${uuid}`,
        'DeepSeek': (uuid) => `https://chat.deepseek.com/a/chat/s/${uuid}`
    },

    /**
     * Build a platform-specific URL for a conversation UUID.
     *
     * Note on URL encoding: UUIDs are bounded by SecurityUtils.isValidUuid
     * (`^[a-zA-Z0-9_-]{8,128}$`) before reaching here, so they only contain
     * characters that are safe to interpolate raw — encodeURIComponent on the
     * allowed alphabet is a no-op. We intentionally skip the wrapper to keep
     * the URLs identical to what each platform's frontend produces.
     *
     * @param {string} platform - Platform name (Perplexity, ChatGPT, etc.)
     * @param {string} uuid - Conversation UUID
     * @returns {string|null} URL or null if platform is unknown
     */
    buildUrl(platform, uuid) {
        const builder = this._urls[platform];
        if (!builder) {
            console.warn(`[PlatformUrlBuilder] Unknown platform: ${platform}`);
            return null;
        }
        return builder(uuid || '');
    }
};

// Legacy function for backward compatibility
function getPlatformUrl(platform, uuid) {
    return PlatformUrlBuilder.buildUrl(platform, uuid);
}

// ============================================
// EXPORTED UUID STORE — per-platform dedup
// ============================================
//
// Tracks which conversation UUIDs have been synced to Notion, split per
// platform so a ChatGPT-heavy user's history doesn't crowd out Claude/Gemini.
// Each entry stores the timestamp of the last successful sync so we can later
// answer "when was X uploaded?" without an extra round-trip.
//
// Storage shape (chrome.storage.local):
//   exportedUuids_<Platform>  →  { <uuid>: <lastSyncedMs>, ... }
//   exportedUuids__Legacy     →  { <uuid>: <migratedAtMs>, ... }   (read-only)
//   exportedUuids_migrated_v2 →  true                              (one-shot flag)
//
// Design decisions (see roadmap below):
//   - No pruning. Bound is the user's real conversation count, which is finite.
//     A user with 2K convos × 6 platforms ≈ 360KB — comfortably under the 10MB
//     chrome.storage.local cap (now that `unlimitedStorage` is dropped).
//   - LRU eviction was rejected: dropping the oldest UUIDs would cause bulk
//     "Load All" exports to re-upload them as Notion duplicates, and would
//     silently re-upload any old thread the user resurrects with a new message.
//   - Per-platform split (vs. one shared bucket) keeps each write small (only
//     the active platform's cache is serialised per sync) and isolates
//     corruption — a bad write in one platform doesn't poison the others.
//   - Legacy bucket holds pre-v2 UUIDs whose platform was unknown; it's
//     checked alongside the per-platform cache on every dedup, never written
//     to. After a couple of releases the legacy bucket can be deleted.
//
// PHASE 2 ROADMAP — multi-device sync via Notion as source of truth:
//   Add a `Source URL` (or `Source ID`) column to auto-created Notion DBs.
//   On sync: local per-platform cache stays as the fast path. On cache miss,
//   issue a batched `or`-filter query against Notion ("any page where
//   Source URL ∈ {url1, url2, ...}") before uploading. Lets two browsers
//   share dedup via Notion without any extra backend. Also enables a "Rebuild
//   cache from Notion" command that scans the DB and back-fills the local
//   cache after the user manually deletes pages. See README "Architecture
//   Roadmap" once added.
//
const ExportedUuidStore = {
    KEY_PREFIX: 'exportedUuids_',
    LEGACY_BUCKET: 'exportedUuids__Legacy',
    MIGRATION_FLAG: 'exportedUuids_migrated_v2',

    _key(platform) {
        return this.KEY_PREFIX + platform;
    },

    /**
     * Load a platform's cache as Map<uuid, lastSyncedMs>. Mutate in memory
     * and persist with save() — don't call has/add per-uuid against storage.
     */
    async load(platform) {
        const key = this._key(platform);
        const data = await chrome.storage.local.get(key);
        return new Map(Object.entries(data[key] || {}));
    },

    /** Persist a Map<uuid, lastSyncedMs> (or plain object) for a platform. */
    async save(platform, mapOrObj) {
        const obj = mapOrObj instanceof Map ? Object.fromEntries(mapOrObj) : (mapOrObj || {});
        await chrome.storage.local.set({ [this._key(platform)]: obj });
    },

    /**
     * Set of UUIDs from pre-v2 builds whose platform was unknown. Checked as
     * a dedup fallback so existing users don't re-upload everything after the
     * upgrade. Drained over time by forgetLegacy() as the sync loops match
     * against it and promote each UUID to its real per-platform bucket.
     */
    async loadLegacy() {
        const data = await chrome.storage.local.get(this.LEGACY_BUCKET);
        return new Set(Object.keys(data[this.LEGACY_BUCKET] || {}));
    },

    /**
     * Remove UUIDs from the legacy bucket. Called after sync promotes them
     * to their real per-platform cache, so the legacy bucket shrinks toward
     * empty and "Clear cache" eventually reaches every cached entry.
     */
    async forgetLegacy(uuids) {
        if (!uuids || !uuids.length) return 0;
        const data = await chrome.storage.local.get(this.LEGACY_BUCKET);
        const bucket = data[this.LEGACY_BUCKET] || {};
        let removed = 0;
        for (const uuid of uuids) {
            if (uuid in bucket) { delete bucket[uuid]; removed++; }
        }
        if (Object.keys(bucket).length === 0) {
            await chrome.storage.local.remove(this.LEGACY_BUCKET);
        } else if (removed > 0) {
            await chrome.storage.local.set({ [this.LEGACY_BUCKET]: bucket });
        }
        return removed;
    },

    /** Read-only count of legacy bucket entries (for UI / clear dialog). */
    async legacyCount() {
        const data = await chrome.storage.local.get(this.LEGACY_BUCKET);
        return Object.keys(data[this.LEGACY_BUCKET] || {}).length;
    },

    /**
     * Surgical "forget" — removes specific UUIDs from a platform's cache so
     * the next sync re-uploads them. Use when the user has deleted those
     * pages in Notion and wants them back.
     */
    async forget(platform, uuids) {
        if (!uuids || !uuids.length) return 0;
        const cache = await this.load(platform);
        let removed = 0;
        for (const uuid of uuids) {
            if (cache.delete(uuid)) removed++;
        }
        await this.save(platform, cache);
        return removed;
    },

    /**
     * Wipe one platform's cache. Next sync re-uploads everything from that
     * platform. Used when the user has bulk-deleted in Notion or recreated
     * the database.
     */
    async clearPlatform(platform) {
        await chrome.storage.local.remove(this._key(platform));
    },

    /** Wipe every platform's cache and the legacy bucket. Destructive. */
    async clearAll() {
        const platforms = await this.listPlatforms();
        const keys = platforms.map(p => this._key(p)).concat([this.LEGACY_BUCKET, 'exportedUuids']);
        await chrome.storage.local.remove(keys);
    },

    /** List platforms with any cached entries. */
    async listPlatforms() {
        const all = await chrome.storage.local.get(null);
        return Object.keys(all)
            .filter(k => k.startsWith(this.KEY_PREFIX) && k !== this.LEGACY_BUCKET && k !== this.MIGRATION_FLAG)
            .map(k => k.slice(this.KEY_PREFIX.length));
    },

    /** Aggregate counts per-platform + legacy + total. For UI display. */
    async getStats() {
        const all = await chrome.storage.local.get(null);
        const platforms = {};
        let legacy = 0;
        for (const [key, value] of Object.entries(all)) {
            if (key === this.LEGACY_BUCKET) {
                legacy = Object.keys(value || {}).length;
            } else if (key.startsWith(this.KEY_PREFIX) && key !== this.MIGRATION_FLAG) {
                platforms[key.slice(this.KEY_PREFIX.length)] = Object.keys(value || {}).length;
            }
        }
        const total = Object.values(platforms).reduce((a, b) => a + b, 0) + legacy;
        return { platforms, legacy, total };
    },

    /**
     * Idempotent: moves the legacy flat `exportedUuids` array into the legacy
     * bucket so per-platform stores can take over without re-uploading.
     */
    async migrateLegacyIfNeeded() {
        const { [this.MIGRATION_FLAG]: done, exportedUuids } =
            await chrome.storage.local.get([this.MIGRATION_FLAG, 'exportedUuids']);
        if (done) return false;
        if (Array.isArray(exportedUuids) && exportedUuids.length > 0) {
            const now = Date.now();
            const bucket = {};
            for (const uuid of exportedUuids) bucket[uuid] = now;
            await chrome.storage.local.set({ [this.LEGACY_BUCKET]: bucket });
            await chrome.storage.local.remove('exportedUuids');
        }
        await chrome.storage.local.set({ [this.MIGRATION_FLAG]: true });
        return true;
    }
};

// ============================================
// CONTENT SCRIPT FILE MAP (Shared Utility)
// Maps hostname substrings to the full ordered list of content script files.
// Must mirror the ordering in manifest.json content_scripts entries.
// Used by popup.js and options.js ensureContentScript() to inject all required
// files on manual injection (previously only 2 of 7 files were injected, leaving
// Logger, ExportManager and adapter globals undefined — silent failures).
// ============================================
const PLATFORM_CONTENT_SCRIPT_FILES = {
    'perplexity.ai':    ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/perplexity-adapter.js', 'src/content.js'],
    'chatgpt.com':      ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/chatgpt-adapter.js', 'src/content.js'],
    'chat.openai.com':  ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/chatgpt-adapter.js', 'src/content.js'],
    'claude.ai':        ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/claude-adapter.js', 'src/content.js'],
    'gemini.google.com':['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/gemini-inject.js', 'src/adapters/gemini-adapter.js', 'src/content.js'],
    'grok.com':         ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/grok-adapter.js', 'src/content.js'],
    'x.com':            ['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/grok-adapter.js', 'src/content.js'],
    'chat.deepseek.com':['src/utils/logger.js', 'src/utils/network-interceptor.js', 'src/utils/export-manager.js', 'src/platform-config.js', 'src/adapters/deepseek-adapter.js', 'src/content.js'],
};

/**
 * Returns the full list of content script files to inject for a given tab URL.
 * @param {string} url - The tab's URL
 * @returns {string[]} Ordered list of file paths to inject
 */
function getContentScriptFiles(url) {
    for (const [domain, files] of Object.entries(PLATFORM_CONTENT_SCRIPT_FILES)) {
        if (url && url.includes(domain)) return files;
    }
    return ['src/platform-config.js', 'src/content.js'];
}
