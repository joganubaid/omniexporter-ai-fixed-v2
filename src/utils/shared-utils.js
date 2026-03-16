// OmniExporter AI - Shared UI Utilities v5.2.0
// Shared between popup.js and options.js
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

    static validateUuid(uuid) {
        if (!uuid || typeof uuid !== 'string') return false;
        return /^[a-zA-Z0-9_-]{8,128}$/.test(uuid);
    }
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

            try {
                // Wrap execution with a timeout to prevent queue deadlock
                const result = await Promise.race([
                    fn(),
                    new Promise((_, timeoutReject) =>
                        setTimeout(() => timeoutReject(new Error('Rate limiter: request execution exceeded 60s timeout')), RATE_LIMIT_EXECUTION_TIMEOUT_MS)
                    )
                ]);
                resolve(result);
            } catch (error) {
                reject(error);
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
            if (error.message?.includes('unauthorized') || error.message?.includes('Invalid')) {
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
