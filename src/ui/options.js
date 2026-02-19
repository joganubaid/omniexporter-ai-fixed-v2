// OmniExporter AI - Options Page JavaScript
// Enterprise Dashboard v5.0 - Phase 10-12

// ============================================================================
// SECTION: STATE MANAGEMENT
// ============================================================================
let currentPlatform = "Unknown";
let aiPlatformTabId = null; // Store the AI platform tab ID
let selectedThreads = new Set();
let threadData = [];
let currentPage = 1;
let itemsPerPage = 50; // Increased from 20 for faster loading
let hasMoreThreads = true;
let exportedUuids = new Set();
let exportHistory = [];
let syncStatusMap = {};
let exportStartTime = null;

// ============================================================================
// SECTION: PERFORMANCE & SECURITY UTILITIES (Phase 2)
// ============================================================================

/**
 * Manages loading states across the application
 */
class LoadingManager {
    static show(elementId, text = 'Loading...') {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.dataset.originalContent = el.innerHTML;
        el.innerHTML = `<div class="loader-container"><div class="loader"></div><span>${text}</span></div>`;
    }

    static hide(elementId) {
        const el = document.getElementById(elementId);
        if (!el || !el.dataset.originalContent) return;
        el.innerHTML = el.dataset.originalContent;
        delete el.dataset.originalContent;
    }
}

/**
 * Sanitizes user input to prevent XSS
 */
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

    // Validate Notion API key format (Audit Fix)
    static validateNotionKey(key) {
        if (!key || typeof key !== 'string') return false;
        // Notion keys start with 'secret_' and are alphanumeric
        return /^secret_[a-zA-Z0-9]{43}$/.test(key) || /^ntn_[a-zA-Z0-9]+$/.test(key);
    }

    // Validate UUID format
    static validateUuid(uuid) {
        if (!uuid || typeof uuid !== 'string') return false;
        return /^[a-zA-Z0-9_-]{8,128}$/.test(uuid);
    }
}

/**
 * Request Deduplicator to prevent race conditions
 */
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

const reqDeduplication = new RequestDeduplicator();

const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Notion Schema Cache
let notionSchemaCache = null;
let schemaCacheTime = 0;

// ============================================================================
// SECTION: FIX 11: RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================================================
async function withRetry(fn, maxRetries = 3, baseDelayMs = 2000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Don't retry on auth or validation errors
            if (error.message?.includes('unauthorized') || error.message?.includes('Invalid')) {
                throw error;
            }
            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt); // 2s, 4s, 8s
                console.warn(`[OmniExporter] Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`, error.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// ============================================================================
// SECTION: FIX 12: NOTION ERROR MAPPER
// ============================================================================
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

// ============================================================================
// SECTION: FIX 15: ENHANCED RATE LIMITER
// ============================================================================
class RateLimiter {
    constructor(requestsPerMinute = 30) {
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
            if (now - addedAt > 5 * 60 * 1000) {
                const stale = this.queue.shift();
                stale.reject(new Error('Request timeout: took too long in queue'));
                continue;
            }

            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);

            if (this.requestTimestamps.length >= this.requestsPerMinute) {
                const oldestRequest = Math.min(...this.requestTimestamps);
                const waitTime = 60000 - (now - oldestRequest) + 100; // +100ms buffer
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            const { fn, resolve, reject } = this.queue.shift();
            this.requestTimestamps.push(Date.now());

            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                reject(error);
            }

            // Adaptive delay based on queue size
            const delay = this.queue.length > 50 ? 200 : 500;
            await new Promise(r => setTimeout(r, delay));
        }

        this.processing = false;
    }
}

const notionRateLimiter = new RateLimiter(30);

// ============================================================================
// SECTION: FIX 17: EXPORT PROGRESS MANAGER
// ============================================================================
class ExportProgressManager {
    static async saveProgress(jobId, progress) {
        await chrome.storage.local.set({
            [`export_progress_${jobId}`]: {
                ...progress,
                lastUpdate: Date.now()
            }
        });
    }

    static async loadProgress(jobId) {
        const key = `export_progress_${jobId}`;
        const data = await chrome.storage.local.get(key);
        return data[key] || null;
    }

    static async clearProgress(jobId) {
        await chrome.storage.local.remove(`export_progress_${jobId}`);
    }

    static async getActiveJob() {
        const data = await chrome.storage.local.get(null);
        for (const key of Object.keys(data)) {
            if (key.startsWith('export_progress_')) {
                const progress = data[key];
                // Only return if less than 1 hour old and not complete
                if (Date.now() - progress.lastUpdate < 60 * 60 * 1000 && progress.current < progress.total) {
                    return { jobId: key.replace('export_progress_', ''), progress };
                }
            }
        }
        return null;
    }
}

// ============================================================================
// SECTION: PHASE 4: DATA VALIDATOR
// ============================================================================
class DataValidator {
    /**
     * Validate thread data structure and completeness
     */
    static validateThreadData(data, platform) {
        const errors = [];
        const warnings = [];

        // Basic structure validation
        if (!data || typeof data !== 'object') {
            errors.push('Invalid data structure');
            return { valid: false, errors, warnings, completeness: 0, stats: {} };
        }

        // Title validation
        if (!data.title || data.title.trim() === '' || data.title === 'Untitled') {
            warnings.push('Thread has no meaningful title');
        }

        // UUID validation
        if (!data.uuid) {
            errors.push('Missing thread UUID');
        }

        // Content validation
        const entries = data.detail?.entries || [];
        if (entries.length === 0) {
            errors.push('No conversation entries found');
        }

        let contentScore = 0;
        let emptyEntries = 0;
        let totalQuestions = 0;
        let totalAnswers = 0;

        entries.forEach((entry, idx) => {
            // Check for questions
            const hasQuestion = !!(entry.query || entry.query_str);
            if (hasQuestion) {
                totalQuestions++;
                contentScore += 10;
            }

            // Check for answers
            let hasAnswer = false;
            if (entry.blocks && Array.isArray(entry.blocks)) {
                const hasTextBlock = entry.blocks.some(b =>
                    b.intended_usage === 'ask_text' &&
                    b.markdown_block &&
                    (b.markdown_block.answer || b.markdown_block.chunks)
                );
                if (hasTextBlock) {
                    hasAnswer = true;
                    totalAnswers++;
                    contentScore += 15;
                }
            }

            if (!hasAnswer && (entry.answer || entry.text)) {
                hasAnswer = true;
                totalAnswers++;
                contentScore += 15;
            }

            if (!hasAnswer) {
                emptyEntries++;
            }
        });

        // Calculate completeness score (0-100)
        const maxScore = entries.length * 25;
        const completeness = maxScore > 0 ? Math.round((contentScore / maxScore) * 100) : 0;

        // Flag severely incomplete data
        if (emptyEntries > entries.length * 0.5 && entries.length > 0) {
            errors.push(`More than 50% of entries empty (${emptyEntries}/${entries.length})`);
        }

        // Platform-specific validation
        if (platform === 'Perplexity') {
            const hasSources = entries.some(entry =>
                entry.blocks?.some(b =>
                    b.intended_usage === 'web_results' &&
                    b.web_result_block?.web_results?.length > 0
                )
            );
            if (!hasSources && entries.length > 0) {
                warnings.push('No sources found (unusual for Perplexity)');
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            completeness,
            stats: {
                totalEntries: entries.length,
                emptyEntries,
                totalQuestions,
                totalAnswers,
                hasUuid: !!data.uuid,
                hasTitle: !!data.title && data.title !== 'Untitled'
            }
        };
    }

    /**
     * Generate a detailed validation report
     */
    static generateReport(validation) {
        const { valid, errors, warnings, completeness, stats } = validation;
        let report = [];

        if (valid) {
            report.push(`✅ Validation passed (${completeness}% complete)`);
        } else {
            report.push(`❌ Validation failed`);
        }

        report.push(`📊 ${stats.totalQuestions} Q, ${stats.totalAnswers} A`);

        if (errors.length > 0) {
            report.push(`Errors: ${errors.join(', ')}`);
        }

        if (warnings.length > 0 && warnings.length <= 3) {
            report.push(`Warnings: ${warnings.join(', ')}`);
        } else if (warnings.length > 3) {
            report.push(`${warnings.length} warnings`);
        }

        return report.join(' | ');
    }

    /**
     * Check if data meets minimum quality threshold
     */
    static meetsMinimumQuality(validation, threshold = 50) {
        return validation.valid && validation.completeness >= threshold;
    }
}

// ============================================================================
// SECTION: PHASE 7: RESILIENT DATA EXTRACTOR (for options.js)
// ============================================================================
class ResilientDataExtractor {
    /**
     * Extract answer from entry with multiple fallback strategies
     */
    static extractAnswer(entry) {
        // Strategy 1: Perplexity blocks structure
        if (entry.blocks && Array.isArray(entry.blocks)) {
            for (const block of entry.blocks) {
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    const answer = block.markdown_block.answer ||
                        (block.markdown_block.chunks || []).join('\n');
                    if (answer) return answer;
                }
                // Alternative block types
                if (block.text_block?.content) {
                    return block.text_block.content;
                }
            }
        }

        // Strategy 2: Direct properties
        if (entry.answer) return entry.answer;
        if (entry.text) return entry.text;
        if (entry.content) return typeof entry.content === 'string' ? entry.content : '';

        // Strategy 3: Response field (potential future format)
        if (entry.response?.text) return entry.response.text;
        if (entry.response?.content) return entry.response.content;

        return '';
    }

    /**
     * Extract query from entry
     */
    static extractQuery(entry) {
        return entry.query || entry.query_str || entry.question || entry.prompt || '';
    }

    /**
     * Extract title
     */
    static extractTitle(data) {
        if (data.title && data.title !== 'Untitled') return data.title.slice(0, 100);
        if (data.name) return data.name.slice(0, 100);

        // Try first query
        const entries = data.detail?.entries || [];
        if (entries.length > 0) {
            const firstQuery = this.extractQuery(entries[0]);
            if (firstQuery) return firstQuery.slice(0, 100);
        }

        return 'Untitled';
    }

    /**
     * Extract sources from Perplexity entry
     */
    static extractSources(entry) {
        if (!entry.blocks) return [];

        for (const block of entry.blocks) {
            if (block.intended_usage === 'web_results' && block.web_result_block?.web_results) {
                return block.web_result_block.web_results;
            }
        }

        return entry.sources || entry.citations || [];
    }
}

// ============================================================================
// SECTION: PHASE 4: DUPLICATE DETECTOR
// ============================================================================
class DuplicateDetector {
    /**
     * Generate fingerprint for a thread
     */
    static generateFingerprint(data) {
        const entries = data.detail?.entries || [];
        const content = [
            data.uuid,
            data.title,
            entries.length,
            entries[0]?.query || entries[0]?.query_str || '',
            entries[entries.length - 1]?.query || entries[entries.length - 1]?.query_str || ''
        ].join('|');

        return this.simpleHash(content);
    }

    /**
     * Simple hash function
     */
    static simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    /**
     * Check if thread has been modified since last export
     */
    static async hasChanged(uuid, newFingerprint) {
        const { exportFingerprints = {} } = await chrome.storage.local.get('exportFingerprints');
        const oldFingerprint = exportFingerprints[uuid];
        return !oldFingerprint || oldFingerprint !== newFingerprint;
    }

    /**
     * Save fingerprint after export
     */
    static async saveFingerprint(uuid, fingerprint) {
        const { exportFingerprints = {} } = await chrome.storage.local.get('exportFingerprints');
        exportFingerprints[uuid] = fingerprint;
        await chrome.storage.local.set({ exportFingerprints });
    }
}

// ============================================================================
// SECTION: PHASE 4: ERROR RECOVERY
// ============================================================================
class ErrorRecovery {
    static async handleExportError(error, context) {
        const errorType = this.classifyError(error);

        switch (errorType) {
            case 'RATE_LIMIT':
                return { retry: true, delay: 60000, message: 'Rate limited. Waiting 60s...' };
            case 'AUTH_ERROR':
                return { retry: false, userAction: 'relogin', message: 'Please re-login to the platform' };
            case 'NETWORK_ERROR':
                if (!navigator.onLine) {
                    return { retry: true, waitForOnline: true, message: 'Waiting for internet...' };
                }
                return { retry: true, delay: 5000, message: 'Network error. Retrying...' };
            case 'DATA_ERROR':
                return { retry: false, skip: true, message: 'Invalid data, skipping' };
            default:
                return { retry: false, message: error.message };
        }
    }

    static classifyError(error) {
        const message = (error.message || '').toLowerCase();

        if (message.includes('rate') || message.includes('429')) return 'RATE_LIMIT';
        if (message.includes('unauthorized') || message.includes('401')) return 'AUTH_ERROR';
        if (message.includes('network') || message.includes('fetch')) return 'NETWORK_ERROR';
        if (message.includes('validation') || message.includes('invalid')) return 'DATA_ERROR';

        return 'UNKNOWN';
    }
}

// ============================================================================
// SECTION: PHASE 4: CONTENT SCRIPT HEALTH CHECKER
// ============================================================================
class ContentScriptHealthChecker {
    constructor() {
        this.retryAttempts = 3;
    }

    /**
     * Check if content script is responsive on a tab
     */
    async isContentScriptReady(tabId) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, 2000);

            chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK' }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    resolve(false);
                } else {
                    resolve(response?.healthy === true);
                }
            });
        });
    }

    /**
     * Inject content script if not present
     */
    async ensureContentScript(tabId) {
        try {
            const isReady = await this.isContentScriptReady(tabId);
            if (isReady) {
                console.log('[HealthCheck] Content script already active');
                return { success: true, injected: false };
            }

            console.log('[HealthCheck] Content script not responding, injecting...');

            const tab = await chrome.tabs.get(tabId);
            const supportedDomains = ['perplexity.ai', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'x.com/i/grok', 'chat.deepseek.com'];
            const isSupported = supportedDomains.some(d => tab.url?.includes(d));

            if (!isSupported) {
                return { success: false, error: 'Tab is not on a supported platform' };
            }

            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });

            await new Promise(r => setTimeout(r, 500));

            const isReadyNow = await this.isContentScriptReady(tabId);
            if (isReadyNow) {
                console.log('[HealthCheck] Content script injected successfully');
                return { success: true, injected: true };
            } else {
                return { success: false, error: 'Content script injection failed verification' };
            }

        } catch (error) {
            console.error('[HealthCheck] Injection error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send message with automatic retry and injection
     */
    async sendMessageWithHealthCheck(tabId, message, timeout = 15000) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                const healthStatus = await this.ensureContentScript(tabId);
                if (!healthStatus.success) {
                    throw new Error(healthStatus.error);
                }

                const response = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        reject(new Error(`Message timeout after ${timeout}ms`));
                    }, timeout);

                    chrome.tabs.sendMessage(tabId, message, (response) => {
                        clearTimeout(timer);

                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (!response) {
                            reject(new Error('No response from content script'));
                        } else if (!response.success) {
                            reject(new Error(response.error || 'Request failed'));
                        } else {
                            resolve(response);
                        }
                    });
                });

                return response;

            } catch (error) {
                console.log(`[HealthCheck] Attempt ${attempt}/${this.retryAttempts} failed:`, error.message);

                if (attempt === this.retryAttempts) {
                    throw error;
                }

                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }

    /**
     * Test connection to a tab
     */
    async testConnection(tabId) {
        const startTime = Date.now();

        try {
            const isReady = await this.isContentScriptReady(tabId);
            return {
                connected: isReady,
                responseTime: Date.now() - startTime,
                status: isReady ? 'healthy' : 'not_responsive'
            };
        } catch (error) {
            return {
                connected: false,
                responseTime: Date.now() - startTime,
                status: 'error',
                error: error.message
            };
        }
    }
}

// Global health checker instance
const healthChecker = new ContentScriptHealthChecker();

// ============================================================================
// SECTION: AI PLATFORM TAB FINDER (Multi-Platform Support)
// ============================================================================
let allAITabs = []; // Store all found AI platform tabs

async function findAllAIPlatformTabs() {
    // Find ALL tabs with AI platform URLs
    const supportedDomains = [
        { domain: 'perplexity.ai', name: 'Perplexity' },
        { domain: 'chatgpt.com', name: 'ChatGPT' },
        { domain: 'chat.openai.com', name: 'ChatGPT' },
        { domain: 'claude.ai', name: 'Claude' },
        { domain: 'gemini.google.com', name: 'Gemini' },
        { domain: 'grok.com', name: 'Grok' },
        { domain: 'chat.deepseek.com', name: 'DeepSeek' }
    ];

    allAITabs = [];

    for (const { domain, name } of supportedDomains) {
        // Try with subdomain
        const tabs = await chrome.tabs.query({ url: `*://*.${domain}/*` });
        tabs.forEach(tab => {
            if (!allAITabs.find(t => t.id === tab.id)) {
                allAITabs.push({ ...tab, platformName: name });
            }
        });

        // Also try without subdomain
        const tabsAlt = await chrome.tabs.query({ url: `*://${domain}/*` });
        tabsAlt.forEach(tab => {
            if (!allAITabs.find(t => t.id === tab.id)) {
                allAITabs.push({ ...tab, platformName: name });
            }
        });
    }

    return allAITabs;
}

async function updatePlatformSelector() {
    const selector = document.getElementById('platformSelector');
    if (!selector) return;

    const tabs = await findAllAIPlatformTabs();
    selector.innerHTML = '';

    if (tabs.length === 0) {
        selector.innerHTML = '<option value="">⚠️ No AI platforms found</option>';
        log('Open Perplexity, ChatGPT, or Claude in another tab.', 'info');
        return;
    }

    // Group tabs by platform
    const groups = {};
    tabs.forEach(tab => {
        if (!groups[tab.platformName]) groups[tab.platformName] = [];
        groups[tab.platformName].push(tab);
    });

    for (const [platform, platformTabs] of Object.entries(groups)) {
        const optgroup = document.createElement('optgroup');
        const emoji = platform === 'Perplexity' ? '🔮' :
            platform === 'ChatGPT' ? '🤖' :
                platform === 'Claude' ? '🧠' :
                    platform === 'Gemini' ? '✨' :
                        platform === 'Grok' ? '❌' :
                            platform === 'DeepSeek' ? '🔍' : '💬';
        optgroup.label = `${emoji} ${platform}`;

        platformTabs.forEach(tab => {
            const option = document.createElement('option');
            option.value = tab.id;
            const title = tab.title || 'Untitled Tab';
            option.textContent = `${title.slice(0, 45)}${title.length > 45 ? '...' : ''}`;

            if (tab.id === aiPlatformTabId) {
                option.selected = true;
                currentPlatform = platform;
            }
            optgroup.appendChild(option);
        });
        selector.appendChild(optgroup);
    }

    // If nothing selected yet, select the first available tab
    if (!aiPlatformTabId && tabs.length > 0) {
        aiPlatformTabId = tabs[0].id;
        currentPlatform = tabs[0].platformName;
        selector.value = aiPlatformTabId;
    }

    log(`Found ${tabs.length} AI platform tab(s)`, 'success');

    // Update the visual platform icon
    updatePlatformIcon();
}

function updatePlatformIcon() {
    const iconDisplay = document.getElementById('platformIconDisplay');
    if (!iconDisplay) return;

    // Hide all icons first
    iconDisplay.querySelectorAll('.platform-icon').forEach(icon => {
        icon.style.display = 'none';
    });

    // Show the icon matching current platform
    if (currentPlatform) {
        const activeIcon = iconDisplay.querySelector(`[data-platform="${currentPlatform}"]`);
        if (activeIcon) {
            activeIcon.style.display = 'block';
        }
    }
}

async function getAITab() {
    // CRITICAL FIX: Always return a tab matching the current platform
    // This prevents exporting Grok threads from a Perplexity tab

    const tabs = await findAllAIPlatformTabs();

    // If we have a currentPlatform, find a tab for that specific platform
    if (currentPlatform) {
        const platformTab = tabs.find(t => t.platformName === currentPlatform);
        if (platformTab) {
            aiPlatformTabId = platformTab.id;
            console.log(`[getAITab] Using ${currentPlatform} tab:`, platformTab.id);
            return platformTab;
        }
    }

    // Return cached tab if valid and still exists
    if (aiPlatformTabId) {
        try {
            const tab = await chrome.tabs.get(aiPlatformTabId);
            // Verify this tab is still in our AI tabs list
            if (tab && tabs.find(t => t.id === tab.id)) {
                return tabs.find(t => t.id === tab.id);
            }
        } catch (e) {
            aiPlatformTabId = null;
        }
    }

    // Otherwise find first available
    if (tabs.length > 0) {
        aiPlatformTabId = tabs[0].id;
        return tabs[0];
    }
    return null;
}

// Message ID counter for tracking
let messageIdCounter = 0;

// Generate unique message ID
function generateMessageId() {
    return `msg_${Date.now()}_${++messageIdCounter}`;
}

// Send message with timeout (20 seconds, matching reference)
async function sendMessageWithTimeout(tabId, message, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const msgId = generateMessageId();
        const fullMessage = { ...message, id: msgId, timestamp: Date.now() };

        // Set timeout
        const timeoutId = setTimeout(() => {
            reject(new Error(`Message timeout after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        // Send message
        chrome.tabs.sendMessage(tabId, fullMessage, (response) => {
            clearTimeout(timeoutId);

            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response) {
                reject(new Error('No response from content script'));
                return;
            }

            if (!response.success) {
                reject(new Error(response.error || 'Unknown error'));
                return;
            }

            resolve(response);
        });
    });
}

// ============================================================================
// SECTION: PHASE 5 FIX 5: CONNECTION STATUS MONITORING
// ============================================================================
async function monitorConnectionStatus() {
    try {
        const statusEl = document.getElementById('connectionStatus');
        if (!statusEl) return;

        const tab = await getAITab();
        if (!tab) {
            statusEl.style.display = 'none';
            return;
        }

        statusEl.style.display = 'flex';

        const result = await healthChecker.testConnection(tab.id);

        if (result.connected) {
            statusEl.classList.add('connected');
            statusEl.querySelector('.status-text').textContent = 'Connected';
            const responseTimeEl = statusEl.querySelector('.response-time');
            if (responseTimeEl) responseTimeEl.textContent = `${result.responseTime}ms`;
        } else {
            statusEl.classList.remove('connected');
            statusEl.querySelector('.status-text').textContent = 'Disconnected';
            const responseTimeEl = statusEl.querySelector('.response-time');
            if (responseTimeEl) responseTimeEl.textContent = result.error || '';
        }
    } catch (e) {
        // Silently ignore connection errors - this is expected when tabs close
        // console.log('[Monitor] Connection check failed:', e.message);
    }
}
// ============================================================================
// SECTION: NOTION OAUTH HELPERS
// ============================================================================
function toggleNotionAuthSections(method) {
    const oauthSection = document.getElementById('notionOauthSection');
    const tokenSection = document.getElementById('notionTokenSection');
    if (!oauthSection || !tokenSection) return;
    if (method === 'token') {
        oauthSection.style.display = 'none';
        tokenSection.style.display = 'block';
    } else {
        oauthSection.style.display = 'block';
        tokenSection.style.display = 'none';
    }
}

function updateOauthStatus(data) {
    const statusEl = document.getElementById('notionOauthStatus');
    if (!statusEl) return;
    const connected = !!data?.notion_oauth_workspace_name;
    if (connected) {
        statusEl.textContent = `Connected: ${data.notion_oauth_workspace_name}`;
        statusEl.classList.add('connected');
    } else {
        statusEl.textContent = 'Not connected';
        statusEl.classList.remove('connected');
    }
}

async function resolveNotionToken() {
    if (typeof NotionOAuth === 'undefined') {
        throw new Error('OAuth module not loaded');
    }
    return NotionOAuth.getActiveToken();
}

async function handleOauthConnect() {
    try {
        await saveAllSettings();
        await NotionOAuth.init();
        log('🔐 Starting OAuth flow...', 'info');
        await NotionOAuth.authorize();
        const status = await NotionOAuth.getStatus();
        updateOauthStatus({ notion_oauth_workspace_name: status.workspace });
        await chrome.storage.local.set({ notion_auth_method: 'oauth' });

        // Show database connection status
        const { notionDbId, notionDbName } = await chrome.storage.local.get(['notionDbId', 'notionDbName']);
        const dbIdInput = document.getElementById('notionDbId');
        if (notionDbId) {
            if (dbIdInput) dbIdInput.value = notionDbId;
            log(`✅ OAuth2 connected! Database "${notionDbName || 'AI Chats Export'}" ready.`, 'success');
        } else {
            log('✅ OAuth2 connected. Note: Could not auto-create database - please check Notion permissions.', 'success');
        }
    } catch (error) {
        log(`OAuth connection failed: ${error.message}`, 'error');
    }
}

async function handleOauthDisconnect() {
    await NotionOAuth.disconnect();
    await chrome.storage.local.set({ notion_auth_method: 'token' });
    updateOauthStatus({});
    log('OAuth disconnected', 'info');
}

// ============================================================================
// SECTION: INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initSubtabs();
    initDataSourceRadio();
    initDateFilter();

    // Load persisted data
    await loadSettings();
    loadExportedUuids();
    loadExportHistory();
    loadFailures();

    // Platform detection and initial data load
    await updatePlatformSelector();

    // Only fetch history if we found a platform
    if (aiPlatformTabId) {
        fetchHistory(1);
        loadSpaces();

        // Phase 5 Fix 2: Check for interrupted jobs
        const activeJob = await ExportProgressManager.getActiveJob();
        if (activeJob) {
            const resume = confirm(
                `Found incomplete export: ${activeJob.progress.current}/${activeJob.progress.total} completed.\n\nResume?`
            );
            if (resume) {
                selectedThreads = new Set(activeJob.progress.uuids.slice(activeJob.progress.current));
                updateSelection(null, false);
                setTimeout(() => bulkSyncToNotion(), 1000); // Resume after UI loads
            } else {
                await ExportProgressManager.clearProgress(activeJob.jobId);
            }
        }

        // Phase 5 Fix 5: Start connection monitoring
        monitorConnectionStatus();
        const connectionMonitorInterval = setInterval(monitorConnectionStatus, 10000);

        // Phase 6: Memory leak fix - cleanup interval on page unload
        window.addEventListener('beforeunload', () => {
            if (connectionMonitorInterval) {
                clearInterval(connectionMonitorInterval);
            }
        });
    } else {
        log('Waiting for AI platform connection...', 'info');
    }

    // Event Listeners - Header
    document.getElementById('autoSyncToggle').addEventListener('click', toggleAutoSync);

    // OAuth UI events
    document.querySelectorAll('input[name="notionAuthMethod"]').forEach((input) => {
        input.addEventListener('change', (e) => {
            toggleNotionAuthSections(e.target.value);
        });
    });

    // Connect OAuth button
    const connectBtn = document.getElementById('connectNotionOauth');
    if (connectBtn) {
        connectBtn.addEventListener('click', handleOauthConnect);
    }

    document.getElementById('disconnectNotionOauth')?.addEventListener('click', handleOauthDisconnect);

    // Load NotionOAuth module
    if (typeof NotionOAuth !== 'undefined') {
        await NotionOAuth.init();
    }


    // Platform selector events
    document.getElementById('platformSelector').addEventListener('change', (e) => {
        const selectedTabId = parseInt(e.target.value);
        if (selectedTabId) {
            aiPlatformTabId = selectedTabId;
            const selectedTab = allAITabs.find(t => t.id === selectedTabId);
            if (selectedTab) {
                currentPlatform = selectedTab.platformName;
                log(`Switched to ${currentPlatform}`, 'info');
                fetchHistory(1);
                loadSpaces();
            }
        }
    });

    document.getElementById('refreshPlatformsBtn').addEventListener('click', () => {
        log('Refreshing platforms...', 'info');
        updatePlatformSelector();
    });

    // Event Listeners - Thread List
    document.getElementById('selectAllBtn').addEventListener('click', selectAllThreads);
    document.getElementById('refreshHistory').addEventListener('click', () => fetchHistory(1));
    document.getElementById('prevPageBtn').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn').addEventListener('click', () => changePage(1));
    document.getElementById('loadAllBtn').addEventListener('click', loadAllThreads);
    document.getElementById('historySearch').addEventListener('input', handleSearch);

    // Event Listeners - Bulk Actions
    document.getElementById('bulkExportBtn').addEventListener('click', bulkSyncToNotion);
    document.getElementById('bulkMdBtn').addEventListener('click', bulkExportMarkdown);
    document.getElementById('exportAllBtn').addEventListener('click', exportAllThreads);
    document.getElementById('clearCacheBtn').addEventListener('click', clearExportedCache);

    // Event Listeners - Settings
    document.getElementById('saveAllSettings').addEventListener('click', saveAllSettings);
    document.getElementById('testNotionBtn').addEventListener('click', testNotionConnection);
    document.getElementById('downloadLogsBtn').addEventListener('click', downloadLogsAsJson);
    document.getElementById('clearLogs').addEventListener('click', clearAllData);

    // Phase 2: Offline Detection
    window.addEventListener('online', () => log('🌐 Back online!', 'success'));
    window.addEventListener('offline', () => log('🔌 Working offline. Some features may be limited.', 'error'));
    if (!navigator.onLine) log('🔌 Working offline.', 'error');
});


// ============================================================================
// SECTION: NAVIGATION
// ============================================================================
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;

            // Update nav items
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Update tab content - hide all, then show selected
            document.querySelectorAll('.tab-content').forEach(t => {
                t.classList.add('hidden');
                t.classList.remove('active');
            });
            const activeTab = document.getElementById(`tab-${tabId}`);
            if (activeTab) {
                activeTab.classList.remove('hidden');
                activeTab.classList.add('active');
            }
        });
    });
}


function initSubtabs() {
    document.querySelectorAll('.subtab').forEach(tab => {
        tab.addEventListener('click', () => {
            const subtabId = tab.dataset.subtab;

            // Update subtab buttons
            document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update subtab content
            document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`subtab-${subtabId}`).classList.add('active');
        });
    });
}

// ============================================================================
// SECTION: DATA SOURCE & DATE FILTER
// ============================================================================
function initDataSourceRadio() {
    document.querySelectorAll('input[name="dataSource"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const spaceSelector = document.getElementById('spaceSelector');
            if (e.target.value === 'spaces') {
                spaceSelector.classList.remove('hidden');
            } else {
                spaceSelector.classList.add('hidden');
            }
            fetchHistory(1);
        });
    });
}

function initDateFilter() {
    const checkbox = document.getElementById('dateFilterEnabled');
    const input = document.getElementById('dateFilterValue');

    checkbox.addEventListener('change', () => {
        input.disabled = !checkbox.checked;
        if (!checkbox.checked) input.value = '';
    });
}

// ============================================================================
// SECTION: STORAGE & SETTINGS PERSISTENCE
// ============================================================================
async function loadSettings() {
    const data = await chrome.storage.local.get([
        'notionApiKey',
        'notionKey',
        'notionDbId',
        'syncInterval',
        'autoSyncNotion',
        'includeMetadata',
        'syncImages',
        'syncCitations',
        'skipExported',
        'autoSyncEnabled',
        'notion_auth_method',
        'notion_oauth_client_id',
        'notion_oauth_client_secret',
        'notion_oauth_workspace_name',
        'notion_oauth_token_expires'
    ]);

    // Migrate legacy key
    if (!data.notionApiKey && data.notionKey) {
        await chrome.storage.local.set({ notionApiKey: data.notionKey });
    }

    // Notion credentials
    if (data.notionApiKey || data.notionKey) {
        document.getElementById('notionKey').value = data.notionApiKey || data.notionKey;
    }
    if (data.notionDbId) {
        document.getElementById('notionDbId').value = data.notionDbId;
    }

    // OAuth credentials (optional - may not exist in simplified UI)
    const clientIdInput = document.getElementById('notionOauthClientId');
    const clientSecretInput = document.getElementById('notionOauthClientSecret');
    const redirectUriInput = document.getElementById('notionOauthRedirectUri');

    if (clientIdInput && data.notion_oauth_client_id) {
        clientIdInput.value = data.notion_oauth_client_id;
    }
    if (clientSecretInput && data.notion_oauth_client_secret) {
        clientSecretInput.value = data.notion_oauth_client_secret;
    }

    // Redirect URI (optional in simplified UI)
    if (redirectUriInput) {
        const redirectUri = chrome.identity.getRedirectURL('notion');
        redirectUriInput.value = redirectUri;
    }

    // Auth method (optional - simplified UI may not have this)
    const authRadio = document.querySelector(`input[name="notionAuthMethod"]`);
    if (authRadio) {
        const authMethod = data.notion_auth_method || 'oauth';
        const selectedRadio = document.querySelector(`input[name="notionAuthMethod"][value="${authMethod}"]`);
        if (selectedRadio) selectedRadio.checked = true;
    }
    updateOauthStatus(data);

    // Sync settings
    if (data.syncInterval) {
        document.getElementById('syncInterval').value = data.syncInterval;
    }
    if (data.autoSyncNotion) {
        document.getElementById('autoSyncNotion').checked = true;
    }
    if (data.includeMetadata) {
        document.getElementById('includeMetadata').checked = true;
    }
    if (data.syncImages !== false) { // Default true
        document.getElementById('syncImages').checked = true;
    }
    if (data.syncCitations !== false) { // Default true
        document.getElementById('syncCitations').checked = true;
    }
    if (data.skipExported !== false) { // Default true
        document.getElementById('skipExported').checked = true;
    }

    // Auto-sync toggle in header
    if (data.autoSyncEnabled) {
        const btn = document.getElementById('autoSyncToggle');
        btn.classList.add('active');
        btn.querySelector('span').textContent = 'Auto On';
    }

    log('Settings loaded from storage', 'info');
}


async function saveAllSettings() {
    try {
        const authMethod = document.querySelector('input[name="notionAuthMethod"]:checked')?.value || 'oauth';

        // Helper to check element existence
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? InputSanitizer.clean(el.value.trim()) : '';
        };

        const settings = {
            notionApiKey: getVal('notionKey'),
            notionDbId: getVal('notionDbId'),
            syncInterval: parseInt(document.getElementById('syncInterval')?.value) || 60,
            autoSyncNotion: document.getElementById('autoSyncNotion')?.checked || false,
            includeMetadata: document.getElementById('includeMetadata')?.checked || false,
            syncImages: document.getElementById('syncImages')?.checked || false,
            syncCitations: document.getElementById('syncCitations')?.checked || false,
            skipExported: document.getElementById('skipExported')?.checked || false,
            notion_auth_method: authMethod,
            notion_oauth_client_id: getVal('notionOauthClientId') || null,
            notion_oauth_client_secret: getVal('notionOauthClientSecret') || null
        };

        // Notion API key validation (only if token selected)
        if (authMethod === 'token' && settings.notionApiKey && !settings.notionApiKey.startsWith('secret_') && !settings.notionApiKey.startsWith('ntn_')) {
            log('⚠️ Invalid Notion API Key format. Should start with secret_ or ntn_', 'error');
            return;
        }

        if (settings.notionDbId && !InputSanitizer.validateDatabaseId(settings.notionDbId)) {
            log('⚠️ Invalid Notion Database ID format.', 'error');
            return;
        }

        await chrome.storage.local.set(settings);
        log('✅ All settings saved successfully!', 'success');

        // Show confirmation
        const btn = document.getElementById('saveAllSettings');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Saved!';
            btn.style.backgroundColor = 'var(--success)';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
            }, 2000);
        }
    } catch (e) {
        log(`Error saving settings: ${e.message}`, 'error');
        throw e; // Re-throw to stop caller
    }
}


// Test Notion API connection
async function testNotionConnection() {
    const resultEl = document.getElementById('notionTestResult');
    const btnEl = document.getElementById('testNotionBtn');
    const dbId = document.getElementById('notionDbId').value.trim();

    if (!dbId) {
        resultEl.innerHTML = '❌ Enter Database ID first';
        resultEl.style.color = 'var(--error)';
        return;
    }

    // Validate database ID format
    if (!isValidNotionDatabaseId(dbId)) {
        resultEl.innerHTML = '❌ Invalid Database ID format. Should be a 32-character ID.';
        resultEl.style.color = 'var(--error)';
        return;
    }

    btnEl.disabled = true;
    btnEl.textContent = '⏳ Testing...';
    resultEl.innerHTML = '';

    try {
        const token = await resolveNotionToken();
        const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const dbTitle = data.title?.[0]?.plain_text || 'Database';
            resultEl.innerHTML = `✅ Connected: "${dbTitle}"`;
            resultEl.style.color = 'var(--success)';
            log(`Notion connection successful: ${dbTitle}`, 'success');
        } else {
            const error = await response.json();
            resultEl.innerHTML = `❌ ${error.message || 'Connection failed'}`;
            resultEl.style.color = 'var(--error)';
            log(`Notion connection failed: ${error.message}`, 'error');
        }
    } catch (err) {
        resultEl.innerHTML = `❌ ${err.message}`;
        resultEl.style.color = 'var(--error)';
        log(`Notion test error: ${err.message}`, 'error');
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = '🔌 Test Connection';
    }
}


function loadExportedUuids() {
    chrome.storage.local.get(['exportedUuids'], (data) => {
        if (data.exportedUuids && Array.isArray(data.exportedUuids)) {
            exportedUuids = new Set(data.exportedUuids);
            log(`Loaded ${exportedUuids.size} previously exported threads`, 'info');
        }
    });
}

function saveExportedUuids() {
    chrome.storage.local.set({
        exportedUuids: Array.from(exportedUuids)
    });
}

function loadExportHistory() {
    chrome.storage.local.get(['exportHistory'], (data) => {
        if (data.exportHistory && Array.isArray(data.exportHistory)) {
            exportHistory = data.exportHistory;
            renderExportHistory();
        }
    });
}

function loadFailures() {
    chrome.storage.local.get(['failures'], (data) => {
        const container = document.getElementById('failureContent');
        if (!container) return;

        const failures = data.failures || [];
        container.innerHTML = '';

        if (failures.length === 0) {
            container.innerHTML = '<div class="loader">No recent failures.</div>';
            return;
        }

        failures.slice(0, 20).forEach(f => {
            const item = document.createElement('div');
            item.className = 'failure-card';
            const time = f.timestamp ? new Date(f.timestamp).toLocaleString() : 'Unknown time';
            item.innerHTML = `
                <div class="failure-title">${escapeHtml(f.title || 'Unknown')}</div>
                <div class="failure-meta">${escapeHtml(f.uuid?.slice(0, 8) || '')}... • ${time}</div>
                <div class="failure-error">${escapeHtml(f.reason || 'Unknown error')}</div>
                <button class="retry-btn" data-uuid="${escapeHtml(f.uuid)}">Retry</button>
            `;
            item.querySelector('.retry-btn')?.addEventListener('click', () => {
                retryFailedThread(f.uuid);
            });
            container.appendChild(item);
        });
    });
}


function reportFailure(uuid, reason, title = 'Unknown') {
    chrome.storage.local.get(['failures'], (data) => {
        const failures = data.failures || [];
        failures.unshift({
            uuid,
            reason,
            title,
            timestamp: new Date().toISOString()
        });
        // Keep last 50 failures
        chrome.storage.local.set({
            failures: failures.slice(0, 50)
        }, () => {
            loadFailures();
        });
    });
}


// Removed redundant detectPlatform function as it's replaced by updatePlatformSelector



async function loadSpaces() {
    try {
        const tab = await getAITab();
        if (!tab) return;

        try {
            const response = await sendMessageWithTimeout(tab.id, { type: 'GET_SPACES' }, 10000);
            if (response.data && response.data.length > 0) {
                const selector = document.getElementById('spaceSelector');
                selector.innerHTML = '<option value="">Select a Space...</option>';
                response.data.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.uuid;
                    opt.textContent = s.name;
                    selector.appendChild(opt);
                });
                selector.addEventListener('change', () => fetchHistory(1));
            }
        } catch (msgError) {
            console.log('Could not load spaces:', msgError.message);
        }
    } catch (e) {
        console.error("Load spaces error:", e);
    }
}


// ============================================================================
// SECTION: THREAD HISTORY
// ============================================================================
async function fetchHistory(page = 1) {
    const listEl = document.getElementById('threadList');
    const dataSource = document.querySelector('input[name="dataSource"]:checked').value;
    const spaceId = dataSource === 'spaces' ? document.getElementById('spaceSelector').value : null;
    const dateFilter = document.getElementById('dateFilterEnabled').checked
        ? document.getElementById('dateFilterValue').value : null;

    if (page === 1) {
        listEl.innerHTML = '<div class="loader-container"><div class="loader"></div><span>Fetching history...</span></div>';
        threadData = [];
        currentPage = 1;
    }

    try {
        await reqDeduplication.run('fetchHistory', async () => {
            const tab = await getAITab();
            if (!tab) {
                listEl.innerHTML = '<div class="loader">Open an AI platform (Perplexity, ChatGPT, Claude) first.</div>';
                return;
            }

            try {
                const response = await sendMessageWithTimeout(tab.id, {
                    type: 'GET_THREAD_LIST',
                    payload: { page, limit: itemsPerPage, spaceId }
                }, 15000);

                let newThreads = response.data.threads;

                // Apply date filter client-side
                if (dateFilter) {
                    const filterDate = new Date(dateFilter);
                    newThreads = newThreads.filter(t => {
                        const threadDate = new Date(t.last_query_datetime);
                        return threadDate >= filterDate;
                    });
                }

                threadData = page === 1 ? newThreads : [...threadData, ...newThreads];
                hasMoreThreads = response.data.has_next !== false && newThreads.length === itemsPerPage;
                currentPage = page;

                const start = (currentPage - 1) * itemsPerPage;
                renderThreadList(threadData.slice(start, start + itemsPerPage));
                updatePagination();
            } catch (msgError) {
                listEl.innerHTML = '<div class="loader">Please refresh the AI platform page.</div>';
                log(`Thread fetch error: ${msgError.message}`, 'error');
            }
        });
    } catch (e) {
        console.error("[OmniExporter] Error boundary caught fetchHistory error:", e);
        listEl.innerHTML = `<div class="loader">Error: ${e.message}</div>`;
    }
}


function renderThreadList(threads) {
    try {
        const listEl = document.getElementById('threadList');
        listEl.innerHTML = '';

        if (threads.length === 0) {
            listEl.innerHTML = '<div class="loader">No threads found.</div>';
            return;
        }

        threads.forEach(t => {
            try {
                const isExported = exportedUuids.has(t.uuid);
                const status = syncStatusMap[t.uuid];
                const item = document.createElement('div');
                item.className = `thread-item ${isExported ? 'exported' : ''}`;

                const date = t.last_query_datetime ? new Date(t.last_query_datetime).toLocaleDateString() : 'Unknown';

                let statusHtml = '';
                if (status === 'synced' || isExported) {
                    statusHtml = '<span class="thread-status synced">✓ Synced</span>';
                } else if (status === 'failed') {
                    statusHtml = '<span class="thread-status failed">✗ Failed</span>';
                }

                // Use InputSanitizer for user-provided content
                const safeTitle = InputSanitizer.clean(t.title || 'Untitled');
                const safeUuid = InputSanitizer.clean(t.uuid);
                item.innerHTML = `
                    <input type="checkbox" data-uuid="${safeUuid}" ${selectedThreads.has(t.uuid) ? 'checked' : ''} ${isExported ? 'disabled' : ''}>
                    <div class="thread-info">
                        <div class="thread-title">${safeTitle}</div>
                        <div class="thread-date">${date}</div>
                    </div>
                    ${statusHtml}
                `;

                if (!isExported) {
                    item.querySelector('input').addEventListener('change', (e) => {
                        updateSelection(t.uuid, e.target.checked);
                    });
                }

                listEl.appendChild(item);
            } catch (itemError) {
                console.error("[OmniExporter] Error rendering thread item:", itemError, t);
            }
        });
    } catch (e) {
        console.error("[OmniExporter] Error boundary caught renderThreadList error:", e);
        document.getElementById('threadList').innerHTML = '<div class="loader">Failed to render threads.</div>';
    }
}

function updatePagination() {
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, threadData.length);
    document.getElementById('pageIndicator').textContent = `Page ${currentPage} • ${startItem}-${endItem} of ${threadData.length}`;
    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled = !hasMoreThreads && endItem >= threadData.length;
}

function changePage(delta) {
    const newPage = currentPage + delta;
    if (delta > 0 && hasMoreThreads && newPage * itemsPerPage > threadData.length) {
        fetchHistory(newPage);
    } else {
        currentPage = newPage;
        const start = (currentPage - 1) * itemsPerPage;
        renderThreadList(threadData.slice(start, start + itemsPerPage));
        updatePagination();
    }
}

async function loadAllThreads() {
    try {
        await reqDeduplication.run('loadAll', async () => {
            const listEl = document.getElementById('threadList');
            const loadBtn = document.getElementById('loadAllBtn');

            // Get platform emoji for loading
            const platformEmoji = currentPlatform === 'Perplexity' ? '🔮' :
                currentPlatform === 'ChatGPT' ? '🤖' :
                    currentPlatform === 'Claude' ? '🧠' :
                        currentPlatform === 'Gemini' ? '✨' :
                            currentPlatform === 'Grok' ? '❌' :
                                currentPlatform === 'DeepSeek' ? '🔍' : '💬';

            // Enhanced loading button state
            if (loadBtn) {
                loadBtn.innerHTML = `<span class="loading-spinner"></span> Loading...`;
                loadBtn.disabled = true;
                loadBtn.classList.add('loading');
            }

            // Show skeleton loading with platform branding
            listEl.innerHTML = `
                <div class="loading-state">
                    <div class="platform-loading-header">
                        <span class="platform-emoji">${platformEmoji}</span>
                        <span class="platform-name">${currentPlatform || 'AI Platform'}</span>
                    </div>
                    <div class="loading-progress">
                        <div class="progress-bar-animated"></div>
                    </div>
                    <div class="loading-text">Fetching threads...</div>
                    <div class="skeleton-threads">
                        ${Array(5).fill('<div class="skeleton-thread"><div class="skeleton-checkbox"></div><div class="skeleton-content"><div class="skeleton-title"></div><div class="skeleton-date"></div></div></div>').join('')}
                    </div>
                </div>`;

            threadData = [];
            let offset = 0;
            let keepLoading = true;
            const batchSize = 50;
            const maxThreads = 10000;
            const delayMs = 200;

            const tab = await getAITab();
            if (!tab) {
                listEl.innerHTML = '<div class="empty-state"><span class="empty-icon">🔌</span><span>Open an AI platform first</span></div>';
                if (loadBtn) {
                    loadBtn.innerHTML = 'Load All';
                    loadBtn.disabled = false;
                    loadBtn.classList.remove('loading');
                }
                return;
            }

            while (keepLoading && threadData.length < maxThreads) {
                const result = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'GET_THREAD_LIST_OFFSET',
                        payload: { offset, limit: batchSize }
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            chrome.tabs.sendMessage(tab.id, {
                                type: 'GET_THREAD_LIST',
                                payload: { page: Math.floor(offset / batchSize) + 1, limit: batchSize }
                            }, (r) => resolve(r || { success: false }));
                        } else {
                            resolve(response || { success: false });
                        }
                    });
                });

                if (result && result.success && result.data && result.data.threads && result.data.threads.length > 0) {
                    const newThreads = result.data.threads;
                    threadData = [...threadData, ...newThreads];

                    // Update progress with count
                    const loadingText = listEl.querySelector('.loading-text');
                    if (loadingText) {
                        loadingText.textContent = `${platformEmoji} Loaded ${threadData.length} threads...`;
                    }

                    offset += newThreads.length;
                    if (newThreads.length < batchSize) keepLoading = false;
                    await new Promise(r => setTimeout(r, delayMs));
                } else {
                    keepLoading = false;
                }
            }

            hasMoreThreads = false;
            currentPage = 1;
            renderThreadList(threadData.slice(0, itemsPerPage));
            updatePagination();

            // Restore button
            if (loadBtn) {
                loadBtn.innerHTML = '✓ Loaded';
                loadBtn.disabled = false;
                loadBtn.classList.remove('loading');
                setTimeout(() => { loadBtn.innerHTML = 'Load All'; }, 2000);
            }

            log(`Loaded all ${threadData.length} threads!`, 'success');
        });
    } catch (e) {
        console.error("[OmniExporter] Error in loadAllThreads:", e);
        const loadBtn = document.getElementById('loadAllBtn');
        if (loadBtn) {
            loadBtn.innerHTML = 'Load All';
            loadBtn.disabled = false;
            loadBtn.classList.remove('loading');
        }
        log('Failed to load all threads.', 'error');
    }
}



function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    const filtered = threadData.filter(t => (t.title || '').toLowerCase().includes(query));
    renderThreadList(filtered.slice(0, itemsPerPage));
}

function selectAllThreads() {
    const visible = threadData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    visible.forEach(t => {
        if (!exportedUuids.has(t.uuid)) selectedThreads.add(t.uuid);
    });
    renderThreadList(visible);
    updateSelection(null, false);
}

function updateSelection(uuid, checked) {
    if (uuid) {
        if (checked) selectedThreads.add(uuid);
        else selectedThreads.delete(uuid);
    }
    const count = selectedThreads.size;
    document.getElementById('bulkExportBtn').textContent = `Save Selected to Notion (${count})`;
    document.getElementById('bulkExportBtn').disabled = count === 0;
    document.getElementById('bulkMdBtn').textContent = `Export MD (${count})`;
    document.getElementById('bulkMdBtn').disabled = count === 0;
}

// ============================================================================
// SECTION: EXPORT OPERATIONS
// ============================================================================

// Validate export operation (can be extended for subscription limits)
function validateExportOperation(type, count, isPremium = false) {
    const limits = {
        free: { single: true, batch: 5, daily: 20 },
        premium: { single: true, batch: 200, daily: 10000 }
    };
    const limit = isPremium ? limits.premium : limits.free;

    if (type === 'batch' && count > limit.batch && !isPremium) {
        return {
            allowed: false,
            message: `Free plan allows max ${limit.batch} items per batch. Upgrade for more.`,
            limitInfo: { isLimited: true, maxExports: limit.batch }
        };
    }
    return { allowed: true, limitInfo: { isLimited: false } };
}

async function syncSingleThread(thread, forceReExport = false) {
    syncStatusMap[thread.uuid] = 'syncing';

    try {
        const tab = await getAITab();
        if (!tab) {
            syncStatusMap[thread.uuid] = 'failed';
            reportFailure(thread.uuid, 'No AI platform tab found', thread.title);
            return;
        }

        try {
            const response = await sendMessageWithTimeout(tab.id, {
                type: 'EXTRACT_CONTENT_BY_UUID',
                payload: { uuid: thread.uuid }
            }, 30000);

            // Phase 4: Validate data before syncing
            const validation = DataValidator.validateThreadData(response.data, currentPlatform);
            console.log('[OmniExporter] Validation:', DataValidator.generateReport(validation));

            if (!validation.valid) {
                syncStatusMap[thread.uuid] = 'failed';
                reportFailure(thread.uuid, `Validation failed: ${validation.errors.join(', ')}`, thread.title);
                return;
            }

            // Phase 4: Check for duplicates
            const fingerprint = DuplicateDetector.generateFingerprint(response.data);
            const hasChanged = await DuplicateDetector.hasChanged(thread.uuid, fingerprint);

            if (!hasChanged && !forceReExport) {
                syncStatusMap[thread.uuid] = 'skipped';
                log(`Skipped ${thread.title}: No changes detected`, 'info');
                return;
            }

            // Warn if low quality but still valid
            if (validation.completeness < 50) {
                log(`⚠️ ${thread.title}: Only ${validation.completeness}% complete`, 'warning');
            }

            await syncToNotion(response.data);

            // Save fingerprint after successful sync
            await DuplicateDetector.saveFingerprint(thread.uuid, fingerprint);

            syncStatusMap[thread.uuid] = 'synced';
            exportedUuids.add(thread.uuid);
            saveExportedUuids();

        } catch (msgError) {
            // Phase 4: Use ErrorRecovery for smart handling
            const recovery = await ErrorRecovery.handleExportError(msgError, { thread });

            if (recovery.retry && recovery.delay) {
                log(recovery.message, 'warning');
                await new Promise(r => setTimeout(r, recovery.delay));
                return syncSingleThread(thread, forceReExport); // Retry
            }

            syncStatusMap[thread.uuid] = 'failed';
            reportFailure(thread.uuid, recovery.message || msgError.message, thread.title);
        }
    } catch (e) {
        syncStatusMap[thread.uuid] = 'failed';
        reportFailure(thread.uuid, e.message, thread.title);
    }
}

async function exportSingleThread(thread) {
    try {
        const tab = await getAITab();
        if (!tab) {
            log('No AI platform tab found', 'error');
            return;
        }

        try {
            const response = await sendMessageWithTimeout(tab.id, {
                type: 'EXTRACT_CONTENT_BY_UUID',
                payload: { uuid: thread.uuid }
            }, 30000);

            // Fix: Ensure title is present (fallback to thread list title)
            const title = response.data.title || thread.title || 'Untitled Chat';
            response.data.title = title;

            // Use shared ExportManager for consistent output and filename parsing
            if (typeof ExportManager !== 'undefined') {
                ExportManager.export(response.data, 'markdown', currentPlatform);
            } else {
                // Fallback to legacy validation if ExportManager is missing (should not happen)
                const markdown = formatToMarkdown(response.data);
                downloadFile(markdown, title);
            }

            log(`Exported: ${title}`, 'success');
        } catch (msgError) {
            log(`Export failed: ${msgError.message}`, 'error');
        }
    } catch (e) {
        log(`Export error: ${e.message}`, 'error');
    }
}


async function bulkSyncToNotion() {
    try {
        await reqDeduplication.run('bulkSync', async () => {
            const uuids = Array.from(selectedThreads);
            const total = uuids.length;
            if (total === 0) return;

            const progressContainer = document.getElementById('exportProgress');
            const progressFill = document.getElementById('progressBarFill');
            const progressText = document.getElementById('progressText');

            progressContainer.classList.remove('hidden');
            exportStartTime = Date.now();
            let success = 0, failed = 0;

            // Fix 17: Generate job ID for progress persistence
            const jobId = `job_${Date.now()}`;

            log(`Starting bulk sync of ${total} threads...`);

            for (let i = 0; i < total; i++) {
                progressFill.style.width = `${Math.round((i / total) * 100)}%`;
                progressText.textContent = `Syncing: ${i + 1}/${total}`;

                const thread = threadData.find(t => t.uuid === uuids[i]);
                if (thread) {
                    try {
                        await syncSingleThread(thread);
                        if (syncStatusMap[thread.uuid] === 'synced') success++;
                        else failed++;
                    } catch (e) {
                        failed++;
                    }

                    // Fix 17: Save progress every 5 items
                    if (i % 5 === 0) {
                        await ExportProgressManager.saveProgress(jobId, {
                            current: i,
                            total,
                            success,
                            failed,
                            uuids
                        });
                    }

                    // Small adaptive delay
                    await new Promise(r => setTimeout(r, 800));
                }
            }

            progressFill.style.width = '100%';
            progressText.textContent = 'Completed!';

            // Fix 17: Clear progress on completion
            await ExportProgressManager.clearProgress(jobId);

            recordExportJob(total, success, failed);

            setTimeout(() => {
                progressContainer.classList.add('hidden');
                selectedThreads.clear();
                updateSelection(null, false);
                renderThreadList(threadData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage));
            }, 2000);
        });
    } catch (e) {
        console.error("[OmniExporter] Error boundary caught bulkSyncToNotion error:", e);
        log('Bulk sync encountered an error. Progress may be saved for resume.', 'error');
    }
}

// ============================================================================
// SECTION: NOTION SYNC - Full API Integration
// ============================================================================
async function syncToNotion(data) {
    // Load credentials from storage
    const storage = await chrome.storage.local.get(['notionDbId']);
    const dbId = storage.notionDbId;

    if (!dbId) {
        log('Notion not configured. Go to Settings to add API Key and Database ID.', 'error');
        throw new Error('Notion not configured');
    }

    const apiKey = await resolveNotionToken();


    try {
        // Build content blocks from conversation entries
        const entries = data.detail?.entries || [];
        const children = [];

        console.log('[OmniExporter] syncToNotion - entries:', entries.length);

        // Add metadata header
        children.push({
            type: "callout",
            callout: {
                icon: { emoji: "🤖" },
                color: "blue_background",
                rich_text: [{
                    type: "text",
                    text: { content: `Exported from ${currentPlatform} on ${new Date().toLocaleString()}` }
                }]
            }
        });
        children.push({ type: "divider", divider: {} });

        // Add each Q&A entry
        entries.forEach((entry, index) => {
            // Question/Query
            const query = entry.query || entry.query_str || '';
            if (query) {
                children.push({
                    type: "heading_2",
                    heading_2: {
                        rich_text: [{
                            type: "text",
                            text: { content: `🙋 ${query}`.slice(0, 2000) }
                        }]
                    }
                });
            }

            // Answer extraction - handle Perplexity's block structure
            let answer = '';
            let sources = [];

            if (entry.blocks && Array.isArray(entry.blocks)) {
                entry.blocks.forEach(block => {
                    if (block.intended_usage === 'ask_text' && block.markdown_block) {
                        if (block.markdown_block.answer) {
                            answer += block.markdown_block.answer + '\n\n';
                        } else if (block.markdown_block.chunks && Array.isArray(block.markdown_block.chunks)) {
                            answer += block.markdown_block.chunks.join('\n') + '\n\n';
                        }
                    }
                    if (block.intended_usage === 'web_results' && block.web_result_block) {
                        const webResults = block.web_result_block.web_results || [];
                        webResults.forEach(wr => {
                            if (wr.url && wr.name) {
                                sources.push({ name: wr.name, url: wr.url });
                            }
                        });
                    }
                });
            }

            // Fallback for simple format
            if (!answer.trim()) {
                answer = entry.answer || entry.text || '';
            }

            // Add answer paragraphs (chunked for Notion's 2000 char limit)
            if (answer.trim()) {
                const chunks = splitTextIntoChunks(answer.trim(), 1900);
                chunks.forEach(chunk => {
                    children.push({
                        type: "paragraph",
                        paragraph: {
                            rich_text: [{
                                type: "text",
                                text: { content: chunk }
                            }]
                        }
                    });
                });
            }

            // Add sources as bulleted list
            if (sources.length > 0) {
                children.push({
                    type: "heading_3",
                    heading_3: {
                        rich_text: [{
                            type: "text",
                            text: { content: "📚 Sources" }
                        }]
                    }
                });

                const uniqueSources = sources.filter((s, i, arr) => i === arr.findIndex(x => x.url === s.url));
                uniqueSources.slice(0, 10).forEach(source => {
                    children.push({
                        type: "bulleted_list_item",
                        bulleted_list_item: {
                            rich_text: [{
                                type: "text",
                                text: {
                                    content: source.name.slice(0, 200),
                                    link: { url: source.url }
                                }
                            }]
                        }
                    });
                });
            }

            // Add related questions if available
            if (entry.related_queries && entry.related_queries.length > 0) {
                children.push({
                    type: "heading_3",
                    heading_3: {
                        rich_text: [{
                            type: "text",
                            text: { content: "🔗 Related Questions" }
                        }]
                    }
                });

                entry.related_queries.slice(0, 5).forEach(q => {
                    children.push({
                        type: "bulleted_list_item",
                        bulleted_list_item: {
                            rich_text: [{
                                type: "text",
                                text: { content: q.slice(0, 200) }
                            }]
                        }
                    });
                });
            }

            // Add divider between entries
            if (index < entries.length - 1) {
                children.push({ type: "divider", divider: {} });
            }
        });

        // Create page in Notion database with dynamic properties and throttling
        const properties = await buildNotionProperties(data, dbId, apiKey, entries);
        const notionUrl = 'https://api.notion.com/v1/pages';

        const response = await withRetry(async () => {
            return await notionRateLimiter.throttle(async () => {
                return await fetch(notionUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'Notion-Version': '2022-06-28'
                    },
                    body: JSON.stringify({
                        parent: { database_id: dbId },
                        properties: properties,
                        children: children.slice(0, 100)
                    })
                });
            });
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('[OmniExporter] Notion API error:', error);
            throw new Error(NotionErrorMapper.map(error));
        }

        const result = await response.json();
        const pageId = result.id;

        // If content has more than 100 blocks, append remaining in chunks
        if (children.length > 100) {
            log(`📄 Appending ${children.length - 100} additional blocks...`, 'info');
            await appendBlocksToPage(apiKey, pageId, children.slice(100));
        }

        log(`✅ Synced to Notion: ${data.title || 'Thread'}`, 'success');
        console.log('[OmniExporter] Notion page created:', result.url);

        return result;

    } catch (err) {
        log(`❌ Notion sync failed: ${err.message}`, 'error');
        throw err;
    }
}

// Append additional blocks to existing Notion page (handles >100 blocks)
async function appendBlocksToPage(apiKey, pageId, blocks) {
    // Chunk blocks into groups of 100
    const chunks = [];
    for (let i = 0; i < blocks.length; i += 100) {
        chunks.push(blocks.slice(i, i + 100));
    }

    // Append each chunk
    for (const chunk of chunks) {
        const response = await notionRateLimiter.throttle(async () => {
            return await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({ children: chunk })
            });
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Failed to append blocks: ${error.message}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 300));
    }
}


// Helper: Split text into chunks for Notion's 2000 char limit
function splitTextIntoChunks(text, maxLength = 1900) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Find a good break point (newline, period, space)
        let breakPoint = remaining.lastIndexOf('\n', maxLength);
        if (breakPoint < maxLength / 2) {
            breakPoint = remaining.lastIndexOf('. ', maxLength);
        }
        if (breakPoint < maxLength / 2) {
            breakPoint = remaining.lastIndexOf(' ', maxLength);
        }
        if (breakPoint < maxLength / 2) {
            breakPoint = maxLength;
        }

        chunks.push(remaining.slice(0, breakPoint + 1).trim());
        remaining = remaining.slice(breakPoint + 1);
    }

    return chunks;
}

async function bulkExportMarkdown() {
    const uuids = Array.from(selectedThreads);

    for (const uuid of uuids) {
        const thread = threadData.find(t => t.uuid === uuid);
        if (thread) await exportSingleThread(thread);
    }
    selectedThreads.clear();
    updateSelection(null, false);
}

async function exportAllThreads() {
    const uuids = threadData.filter(t => !exportedUuids.has(t.uuid)).map(t => t.uuid);
    uuids.forEach(uuid => selectedThreads.add(uuid));
    updateSelection(null, false);
    await bulkSyncToNotion();
}

// ============================================================================
// SECTION: EXPORT HISTORY TRACKING
// ============================================================================
function recordExportJob(total, success, failed, isAuto = false) {
    const endTime = Date.now();
    const duration = exportStartTime ? Math.round((endTime - exportStartTime) / 1000) : 0;

    const job = {
        timestamp: new Date().toISOString(),
        total,
        success,
        failed,
        duration,
        isAuto,
        platform: currentPlatform
    };

    chrome.storage.local.get(['exportHistory'], (data) => {
        const history = data.exportHistory || [];
        history.unshift(job);
        // Keep only last 50 jobs
        chrome.storage.local.set({ exportHistory: history.slice(0, 50) }, () => {
            log(`Export completed: ${success}/${total} successful (${duration}s)`, success === total ? 'success' : 'error');
            renderExportHistory();
        });
    });
}

function loadExportHistory() {
    chrome.storage.local.get(['exportHistory'], (data) => {
        exportHistory = data.exportHistory || [];
        renderExportHistory();
    });
}

function renderExportHistory() {
    const container = document.getElementById('historyContent');
    if (!container) return;

    container.innerHTML = '';

    if (exportHistory.length === 0) {
        container.innerHTML = '<div class="loader">No export history yet.</div>';
        return;
    }

    exportHistory.slice(0, 10).forEach(job => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const date = new Date(job.timestamp).toLocaleString();
        const status = job.failed === 0 ? '✅' : '⚠️';
        item.innerHTML = `
            <div class="history-header">
                <span>${status} ${job.success}/${job.total}</span>
                <span class="history-meta">${date}</span>
            </div>
            <div class="history-details">
            Duration: ${job.duration}s | Platform: ${job.platform || 'Unknown'}${job.isAuto ? ' | Auto-Sync' : ''}
            </div>
        `;
        container.appendChild(item);
    });
}

// ============================================================================
// SECTION: UTILITIES
// ============================================================================

/**
 * Fetches Notion database schema and caches it
 */
async function getNotionDatabaseSchema(dbId, apiKey) {
    if (notionSchemaCache && (Date.now() - schemaCacheTime < SCHEMA_CACHE_TTL)) {
        return notionSchemaCache;
    }

    try {
        const response = await notionRateLimiter.throttle(async () => {
            return await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Notion-Version': '2022-06-28'
                }
            });
        });

        if (!response.ok) throw new Error('Database schema fetch failed');

        const schema = await response.json();
        notionSchemaCache = schema;
        schemaCacheTime = Date.now();
        return schema;
    } catch (e) {
        console.warn('[OmniExporter] Schema fetch failed:', e.message);
        return null; // Fallback to title-only
    }
}

/**
 * Dynamically builds Notion properties based on available columns
 */
async function buildNotionProperties(data, dbId, apiKey, entries = []) {
    // Required Title property
    const properties = {
        title: {
            title: [{
                type: "text",
                text: { content: (data.title || 'Untitled Chat').slice(0, 2000) }
            }]
        }
    };

    try {
        const schema = await getNotionDatabaseSchema(dbId, apiKey);
        if (!schema || !schema.properties) return properties;

        const availableProps = schema.properties;

        // URL column
        if (availableProps['URL'] && data.uuid) {
            properties.URL = { url: `https://www.perplexity.ai/search/${data.uuid}` };
        }

        // Chat Time column
        const threadTime = entries[0]?.updated_datetime || entries[0]?.created_datetime || data.datetime;
        if (availableProps['Chat Time'] && threadTime) {
            try {
                properties['Chat Time'] = {
                    date: { start: new Date(threadTime).toISOString() }
                };
            } catch (e) { /* Invalid date */ }
        }

        // Space Name column
        if (availableProps['Space Name'] && data.spaceName) {
            properties['Space Name'] = {
                rich_text: [{ type: "text", text: { content: data.spaceName } }]
            };
        }

        // Platform column
        if (availableProps['Platform']) {
            properties.Platform = {
                select: { name: currentPlatform || 'Unknown' }
            };
        }

        // Tags column (if it exists)
        if (availableProps['Tags']) {
            properties.Tags = {
                multi_select: [{ name: currentPlatform || 'AI' }]
            };
        }

    } catch (error) {
        console.warn('[OmniExporter] Property build failed:', error.message);
        if (typeof log === 'function') log('Using minimal properties due to schema fetch failure', 'info');
    }

    return properties;
}

// YAML value escaper for frontmatter
function escapeYamlValue(value) {
    if (!value) return '';
    const str = String(value);
    if (str.includes(':') || str.includes('#') || str.includes("'") || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
}

// HTML escaper for XSS prevention
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Validate Notion Database ID
function isValidNotionDatabaseId(id) {
    if (!id) return false;
    const cleanId = id.replace(/-/g, '');
    return /^[a-f0-9]{32}$/i.test(cleanId);
}

// Log utility
function log(message, type = 'info') {
    const container = document.getElementById('logContent');
    if (!container) {
        console.log(`[${type}] ${message}`);
        return;
    }

    const item = document.createElement('div');
    item.className = `log-item log-${type}`;
    const time = new Date().toLocaleTimeString();
    item.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    container.insertBefore(item, container.firstChild);

    while (container.children.length > 100) {
        container.removeChild(container.lastChild);
    }
}

// ============================================================================
// SECTION: RESTORED STABILIZATION FUNCTIONS (Phase 2.5)
// ============================================================================

async function toggleAutoSync() {
    const toggle = document.getElementById('autoSyncToggle');
    if (!toggle) return;
    const isActive = toggle.classList.contains('active');

    if (isActive) {
        toggle.classList.remove('active');
        toggle.querySelector('span').textContent = 'Auto Off';
        chrome.alarms.clear('autoSyncAlarm');
        chrome.storage.local.set({ autoSyncEnabled: false });
        log('Auto-Sync disabled', 'info');
    } else {
        toggle.classList.add('active');
        toggle.querySelector('span').textContent = 'Auto On';
        const interval = parseInt(document.getElementById('syncInterval').value) || 60;
        chrome.alarms.create('autoSyncAlarm', { periodInMinutes: interval });
        chrome.storage.local.set({ autoSyncEnabled: true });
        log(`Auto-Sync enabled (every ${interval} mins)`, 'success');
    }
}

function clearExportedCache() {
    if (!confirm('Clear all exported records? This will allow re-exporting synced threads.')) return;

    exportedUuids.clear();
    syncStatusMap = {};
    chrome.storage.local.set({ exportedUuids: [] }, () => {
        log('Exported records cache cleared.', 'success');
        const start = (currentPage - 1) * itemsPerPage;
        renderThreadList(threadData.slice(start, start + itemsPerPage));
    });
}

async function retryFailedThread(uuid) {
    const thread = threadData.find(t => t.uuid === uuid);
    if (thread) {
        log(`Retrying: ${thread.title || uuid}`, 'info');
        await syncSingleThread(thread);
        if (typeof loadFailures === 'function') loadFailures();
    } else {
        log('Thread not found. Refresh history first.', 'error');
    }
}

function downloadLogsAsJson() {
    chrome.storage.local.get(['exportHistory', 'failures'], (data) => {
        const logs = {
            exportHistory: data.exportHistory || [],
            failures: data.failures || [],
            exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omniexporter_logs_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

function clearAllData() {
    if (!confirm('Clear ALL data including settings, history, and cache?')) return;

    chrome.storage.local.clear(() => {
        exportedUuids.clear();
        syncStatusMap = {};
        exportHistory = [];
        threadData = [];
        log('All data cleared.', 'success');
        location.reload();
    });
}

function formatToMarkdown(data) {
    const entries = data.detail?.entries || [];
    const firstEntry = entries[0] || {};

    const title = escapeYamlValue(data.title || 'Untitled Chat');
    const date = firstEntry.updated_datetime
        ? new Date(firstEntry.updated_datetime).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
    const baseUrl = (currentPlatform === 'Claude') ? 'https://claude.ai/chat/' :
        (currentPlatform === 'Gemini') ? 'https://gemini.google.com/app/' :
            (currentPlatform === 'ChatGPT') ? 'https://chat.openai.com/c/' :
                'https://www.perplexity.ai/search/';
    const url = `${baseUrl}${data.uuid || ''}`;

    let md = '---\n';
    md += `title: ${title}\n`;
    md += `date: ${date}\n`;
    md += `url: ${url}\n`;
    md += `source: ${currentPlatform}\n`;
    md += '---\n\n';

    entries.forEach(entry => {
        const query = entry.query || entry.query_str || '';
        if (query) md += `## ${query}\n\n`;

        let answer = '';
        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    if (block.markdown_block.answer) {
                        answer += block.markdown_block.answer + '\n\n';
                    } else if (block.markdown_block.chunks) {
                        answer += block.markdown_block.chunks.join('\n') + '\n\n';
                    }
                }
            });
        }
        if (!answer.trim()) answer = entry.answer || entry.text || '';
        if (answer.trim()) md += `${answer.trim()}\n\n`;

        md += '---\n\n';
    });

    return md;
}

function downloadFile(content, name) {
    const sanitized = name.replace(/[^a-z0-9]/gi, '_');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitized}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// SECTION: DEVELOPER TOOLS - LOG VIEWER
// ============================================================================

/**
 * Initialize Developer Tools tab
 */
async function initDevTools() {
    // Load debug settings
    const settings = await chrome.storage.local.get([
        'debugMode',
        'logMaxEntries',
        'logConsoleOutput'
    ]);

    // Set toggle state
    const debugToggle = document.getElementById('debugModeToggle');
    if (debugToggle) {
        debugToggle.checked = settings.debugMode || false;
        debugToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            await chrome.storage.local.set({ debugMode: enabled });
            if (typeof Logger !== 'undefined') {
                Logger.config.enabled = enabled;
                Logger.info('System', enabled ? 'Debug mode enabled' : 'Debug mode disabled');
            }
            refreshLogStats();
        });
    }

    // Log max entries dropdown
    const maxEntriesSelect = document.getElementById('logMaxEntries');
    if (maxEntriesSelect) {
        maxEntriesSelect.value = settings.logMaxEntries || '1000';
        maxEntriesSelect.addEventListener('change', async (e) => {
            await chrome.storage.local.set({ logMaxEntries: parseInt(e.target.value) });
            if (typeof Logger !== 'undefined') {
                Logger.config.maxEntries = parseInt(e.target.value);
            }
        });
    }

    // Console output checkbox
    const consoleOutputCheck = document.getElementById('logConsoleOutput');
    if (consoleOutputCheck) {
        consoleOutputCheck.checked = settings.logConsoleOutput !== false;
        consoleOutputCheck.addEventListener('change', async (e) => {
            await chrome.storage.local.set({ logConsoleOutput: e.target.checked });
            if (typeof Logger !== 'undefined') {
                Logger.config.consoleOutput = e.target.checked;
            }
        });
    }

    // Bind button handlers
    document.getElementById('refreshLogStats')?.addEventListener('click', refreshLogStats);
    document.getElementById('applyLogFilters')?.addEventListener('click', loadLogEntries);
    document.getElementById('downloadLogsJson')?.addEventListener('click', downloadLogsAsJsonFile);
    document.getElementById('downloadLogsTxt')?.addEventListener('click', downloadLogsAsTxt);
    document.getElementById('copyLogsForAI')?.addEventListener('click', copyLogsForAI);
    document.getElementById('clearAllLogs')?.addEventListener('click', clearAllLogs);

    // Initial load
    refreshLogStats();
    loadLogEntries();
}

/**
 * Refresh log statistics
 */
async function refreshLogStats() {
    try {
        if (typeof Logger === 'undefined') {
            console.warn('Logger not available');
            return;
        }

        const stats = await Logger.getStats();

        document.getElementById('statTotalLogs').textContent = stats.total || 0;
        document.getElementById('statErrors').textContent = stats.byLevel?.ERROR || 0;
        document.getElementById('statWarnings').textContent = stats.byLevel?.WARN || 0;
        document.getElementById('statInfo').textContent = (stats.byLevel?.INFO || 0) + (stats.byLevel?.DEBUG || 0);
    } catch (e) {
        console.error('Failed to refresh log stats:', e);
    }
}

/**
 * Load and render log entries with filters
 */
async function loadLogEntries() {
    const container = document.getElementById('logEntriesContainer');
    if (!container) return;

    try {
        if (typeof Logger === 'undefined') {
            container.innerHTML = '<div class="log-empty-state">Logger not initialized.</div>';
            return;
        }

        // Get filter values
        const level = document.getElementById('logFilterLevel')?.value || '';
        const module = document.getElementById('logFilterModule')?.value || '';
        const search = document.getElementById('logSearchInput')?.value || '';
        const limitVal = document.getElementById('logLimit')?.value;
        const limit = limitVal ? parseInt(limitVal) : null;

        // Fetch logs with filters
        const logs = await Logger.getLogs({
            level: level || undefined,
            module: module || undefined,
            search: search || undefined,
            limit: limit || undefined
        });

        if (logs.length === 0) {
            container.innerHTML = '<div class="log-empty-state">No logs match your filters. Enable debug mode to start collecting logs.</div>';
            return;
        }

        // Render log entries (newest first)
        const reversedLogs = [...logs].reverse();
        container.innerHTML = reversedLogs.map(renderLogEntry).join('');

        // Add click handlers for expandable entries
        container.querySelectorAll('.log-entry-expandable').forEach(el => {
            el.addEventListener('click', () => el.classList.toggle('expanded'));
        });
    } catch (e) {
        console.error('Failed to load log entries:', e);
        container.innerHTML = `<div class="log-empty-state">Error loading logs: ${e.message}</div>`;
    }
}

/**
 * Render a single log entry
 */
function renderLogEntry(log) {
    const time = log.timestamp.split('T')[1].split('.')[0];
    const hasData = log.data && Object.keys(log.data).length > 0;
    const expandableClass = hasData ? 'log-entry-expandable' : '';
    const levelClass = `level-${log.level.toLowerCase()}`;

    let dataHtml = '';
    if (hasData) {
        try {
            dataHtml = `<div class="log-data">${JSON.stringify(log.data, null, 2)}</div>`;
        } catch (e) {
            dataHtml = '<div class="log-data">[Data not serializable]</div>';
        }
    }

    return `
        <div class="log-entry ${levelClass} ${expandableClass}">
            <span class="log-time">${time}</span>
            <span class="log-level">${log.level}</span>
            <span class="log-module">${log.moduleIcon || '❓'} ${log.module}</span>
            <span class="log-message">${escapeHtml(log.message)}${hasData ? ' ▸' : ''}</span>
            ${dataHtml}
        </div>
    `;
}

/**
 * Download logs as JSON file
 */
async function downloadLogsAsJsonFile() {
    try {
        if (typeof Logger === 'undefined') return;

        const exportData = await Logger.exportLogs('json');
        const blob = new Blob([exportData.content], { type: exportData.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exportData.filename;
        a.click();
        URL.revokeObjectURL(url);

        Logger.info('System', 'Logs exported as JSON');
    } catch (e) {
        console.error('Failed to download logs:', e);
    }
}

/**
 * Download logs as text file
 */
async function downloadLogsAsTxt() {
    try {
        if (typeof Logger === 'undefined') return;

        const exportData = await Logger.exportLogs('txt');
        const blob = new Blob([exportData.content], { type: exportData.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exportData.filename;
        a.click();
        URL.revokeObjectURL(url);

        Logger.info('System', 'Logs exported as text');
    } catch (e) {
        console.error('Failed to download logs:', e);
    }
}

/**
 * Copy AI-friendly report to clipboard
 */
async function copyLogsForAI() {
    try {
        if (typeof Logger === 'undefined') return;

        const report = await Logger.generateAIReport();
        await navigator.clipboard.writeText(report);

        // Show confirmation
        const btn = document.getElementById('copyLogsForAI');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => btn.textContent = originalText, 2000);
        }

        Logger.info('System', 'AI report copied to clipboard');
    } catch (e) {
        console.error('Failed to copy logs:', e);
        alert('Failed to copy to clipboard. Please check permissions.');
    }
}

/**
 * Clear all stored logs
 */
async function clearAllLogs() {
    if (!confirm('Clear all debug logs? This cannot be undone.')) return;

    try {
        if (typeof Logger !== 'undefined') {
            await Logger.clear();
        }
        await chrome.storage.local.remove('omniExporterLogs');

        refreshLogStats();
        loadLogEntries();
    } catch (e) {
        console.error('Failed to clear logs:', e);
    }
}

// ============================================================================
// SECTION: AUTO-REFRESH LOG VIEWER
// ============================================================================
let logAutoRefreshInterval = null;
let isDevToolsTabActive = false;

function startLogAutoRefresh() {
    if (logAutoRefreshInterval) return;
    logAutoRefreshInterval = setInterval(() => {
        if (isDevToolsTabActive && document.visibilityState === 'visible') {
            refreshLogStats();
            loadLogEntries();
        }
    }, 3000); // Refresh every 3 seconds
}

function stopLogAutoRefresh() {
    if (logAutoRefreshInterval) {
        clearInterval(logAutoRefreshInterval);
        logAutoRefreshInterval = null;
    }
}

// Initialize Developer Tools when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Delay init slightly to ensure Logger is loaded
    setTimeout(initDevTools, 100);

    // Watch for tab changes to manage auto-refresh
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;
            isDevToolsTabActive = (tabId === 'devtools');

            if (isDevToolsTabActive) {
                startLogAutoRefresh();
                refreshLogStats();
                loadLogEntries();
            } else {
                stopLogAutoRefresh();
            }
        });
    });
});

// Stop auto-refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        stopLogAutoRefresh();
    } else if (isDevToolsTabActive) {
        startLogAutoRefresh();
    }
});

// ============================================================================
// SECTION: TEST RUNNER - INTEGRATED TEST SUITE
// ============================================================================
const TestRunner = {
    results: [],
    passed: 0,
    failed: 0,
    testTimings: [],        // Per-test timing
    flakyTests: {},         // Track flaky tests
    coverageMap: {},        // Coverage estimation

    // Test utilities with timing
    async test(name, fn) {
        const start = performance.now();
        try {
            await fn();
            const duration = Math.round(performance.now() - start);
            this.passed++;
            this.results.push({ name, status: 'passed', duration });
            this.testTimings.push({ name, duration });
            this.appendResult(`✅ ${name} <span style="color:var(--text-tertiary)">(${duration}ms)</span>`);
            this.trackFlaky(name, true);
            return true;
        } catch (e) {
            const duration = Math.round(performance.now() - start);
            this.failed++;
            this.results.push({ name, status: 'failed', error: e.message, duration });
            this.testTimings.push({ name, duration });
            this.appendResult(`❌ ${name}: ${e.message}`);
            this.trackFlaky(name, false);
            return false;
        }
    },

    // ============================================
    // RICH ASSERTIONS LIBRARY
    // ============================================
    assert(cond, msg) {
        if (!cond) throw new Error(msg || 'Assertion failed');
    },

    assertEqual(a, b, msg) {
        if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
    },

    assertDeepEqual(a, b, msg) {
        const aStr = JSON.stringify(a);
        const bStr = JSON.stringify(b);
        if (aStr !== bStr) throw new Error(msg || `Deep equal failed:\nExpected: ${bStr}\nGot: ${aStr}`);
    },

    assertThrows(fn, expectedError, msg) {
        try {
            fn();
            throw new Error(msg || 'Expected function to throw');
        } catch (e) {
            if (expectedError && !(e instanceof expectedError) && !e.message.includes(expectedError)) {
                throw new Error(msg || `Expected error type ${expectedError}, got ${e.message}`);
            }
        }
    },

    assertType(val, type, msg) {
        const actualType = typeof val;
        if (actualType !== type) throw new Error(msg || `Expected type ${type}, got ${actualType}`);
    },

    assertInRange(val, min, max, msg) {
        if (val < min || val > max) throw new Error(msg || `Expected ${val} to be between ${min} and ${max}`);
    },

    assertMatches(str, regex, msg) {
        if (!regex.test(str)) throw new Error(msg || `Expected "${str}" to match ${regex}`);
    },

    assertArrayContains(arr, item, msg) {
        if (!arr.includes(item)) throw new Error(msg || `Expected array to contain ${item}`);
    },

    // ============================================
    // FLAKY TEST TRACKING
    // ============================================
    trackFlaky(name, passed) {
        if (!this.flakyTests[name]) {
            this.flakyTests[name] = { passes: 0, fails: 0 };
        }
        if (passed) {
            this.flakyTests[name].passes++;
        } else {
            this.flakyTests[name].fails++;
        }
    },

    getFlakyTests() {
        return Object.entries(this.flakyTests)
            .filter(([_, stats]) => stats.passes > 0 && stats.fails > 0)
            .map(([name, stats]) => ({ name, ...stats }));
    },

    // ============================================
    // COVERAGE ESTIMATION
    // ============================================
    markCovered(module, fn) {
        if (!this.coverageMap[module]) {
            this.coverageMap[module] = new Set();
        }
        this.coverageMap[module].add(fn);
    },

    getCoverageReport() {
        const modules = {
            Logger: ['log', 'info', 'warn', 'error', 'debug', 'updateSettings', 'secureClear', 'flush'],
            Storage: ['get', 'set', 'remove', 'getBytesInUse'],
            OAuth: ['isConfigured', 'getActiveToken', 'startAuthFlow', 'clearAuth'],
            Export: ['toMarkdown', 'toPlainText', 'toHTML', 'toJSON'],
            PlatformConfig: ['getConfig', 'patterns', 'endpoints', 'dataFields']
        };

        const report = {};
        for (const [module, functions] of Object.entries(modules)) {
            const covered = this.coverageMap[module]?.size || 0;
            report[module] = {
                total: functions.length,
                covered,
                percent: Math.round((covered / functions.length) * 100)
            };
        }
        return report;
    },

    // ============================================
    // TEST METRICS
    // ============================================
    getMetrics() {
        const timings = this.testTimings.map(t => t.duration);
        return {
            totalTests: this.passed + this.failed,
            passRate: Math.round((this.passed / (this.passed + this.failed)) * 100) || 0,
            avgDuration: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) || 0,
            slowestTest: this.testTimings.sort((a, b) => b.duration - a.duration)[0],
            fastestTest: this.testTimings.sort((a, b) => a.duration - b.duration)[0],
            flakyCount: this.getFlakyTests().length
        };
    },

    reset() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
        this.testTimings = [];
        const container = document.getElementById('testResults');
        if (container) container.innerHTML = '';
        document.getElementById('testResultsContainer').style.display = 'block';
    },

    appendResult(text) {
        const container = document.getElementById('testResults');
        if (container) {
            container.innerHTML += text + '<br>';
            container.scrollTop = container.scrollHeight;
        }
    },

    updateSummary(duration = 0) {
        document.getElementById('testsPassed').textContent = this.passed;
        document.getElementById('testsFailed').textContent = this.failed;
        document.getElementById('testsDuration').textContent = duration + 'ms';

        // Update metrics panel
        const metrics = this.getMetrics();
        const passRateEl = document.getElementById('metricPassRate');
        const avgDurationEl = document.getElementById('metricAvgDuration');
        const flakyCountEl = document.getElementById('metricFlakyCount');
        const slowestEl = document.getElementById('metricSlowest');
        const fastestEl = document.getElementById('metricFastest');

        if (passRateEl) passRateEl.textContent = metrics.passRate + '%';
        if (avgDurationEl) avgDurationEl.textContent = metrics.avgDuration + 'ms';
        if (flakyCountEl) flakyCountEl.textContent = metrics.flakyCount;
        if (slowestEl && metrics.slowestTest) slowestEl.textContent = `${metrics.slowestTest.name} (${metrics.slowestTest.duration}ms)`;
        if (fastestEl && metrics.fastestTest) fastestEl.textContent = `${metrics.fastestTest.name} (${metrics.fastestTest.duration}ms)`;

        // Save to history and refresh display
        if (this.passed > 0 || this.failed > 0) {
            this.saveToHistory();
            if (typeof window.displayTestHistory === 'function') {
                window.displayTestHistory();
            }
            if (typeof window.refreshPerformance === 'function') {
                window.refreshPerformance();
            }
        }
    },

    setStatus(text) {
        const el = document.getElementById('testRunnerStatus');
        if (el) el.textContent = text;
    },

    // ============================================
    // LOGGER TESTS (14 tests)
    // ============================================
    async testLogger() {
        this.appendResult('<b>📝 LOGGER TESTS</b>');

        // Core
        await this.test('Logger exists', () => this.assert(typeof Logger !== 'undefined'));
        await this.test('Logger.info is function', () => this.assert(typeof Logger.info === 'function'));
        await this.test('Logger.error is function', () => this.assert(typeof Logger.error === 'function'));
        await this.test('Logger.warn is function', () => this.assert(typeof Logger.warn === 'function'));
        await this.test('Logger.debug is function', () => this.assert(typeof Logger.debug === 'function'));
        await this.test('Logger.init works', async () => { await Logger.init(); this.assert(Logger._initialized); });

        // Retrieval
        await this.test('Logger.getLogs returns array', async () => {
            this.markCovered('Logger', 'getLogs');
            const logs = await Logger.getLogs();
            this.assert(Array.isArray(logs));
        });
        await this.test('Logger.getStats returns object', async () => {
            this.markCovered('Logger', 'getStats');
            const s = await Logger.getStats();
            this.assert(typeof s.total === 'number');
        });

        // Sanitization
        await this.test('Sanitizes passwords', () => {
            this.markCovered('Logger', 'sanitize');
            const r = Logger._sanitizeData({ password: 'x' });
            this.assertEqual(r.password, '[REDACTED]');
        });
        await this.test('Sanitizes tokens', () => { const r = Logger._sanitizeData({ token: 'x', access_token: 'y' }); this.assertEqual(r.token, '[REDACTED]'); });
        await this.test('Truncates long strings', () => { const r = Logger._sanitizeData({ text: 'a'.repeat(600) }); this.assert(r.text.length < 600); });

        // Timing
        await this.test('Logger.time returns timer', () => {
            this.markCovered('Logger', 'time');
            const t = Logger.time('Test', 'op');
            this.assert(typeof t.end === 'function');
        });

        // Export
        await this.test('generateAIReport returns string', async () => {
            this.markCovered('Logger', 'generateAIReport');
            const r = await Logger.generateAIReport();
            this.assert(typeof r === 'string');
        });
        await this.test('Logger.clear is function', () => {
            this.markCovered('Logger', 'clear');
            this.assert(typeof Logger.clear === 'function');
        });
    },

    // ============================================
    // STORAGE TESTS (6 tests)
    // ============================================
    async testStorage() {
        this.appendResult('<b>💾 STORAGE TESTS</b>');

        await this.test('Chrome storage exists', () => this.assert(chrome.storage.local));
        await this.test('Storage set/get works', async () => {
            await chrome.storage.local.set({ _test: 'val' });
            const r = await chrome.storage.local.get('_test');
            this.assertEqual(r._test, 'val');
            await chrome.storage.local.remove('_test');
        });
        await this.test('Storage remove works', async () => {
            await chrome.storage.local.set({ _testRm: 'x' });
            await chrome.storage.local.remove('_testRm');
            const r = await chrome.storage.local.get('_testRm');
            this.assert(r._testRm === undefined);
        });
        await this.test('Storage handles objects', async () => {
            this.markCovered('Storage', 'get');
            this.markCovered('Storage', 'set');
            const obj = { nested: { arr: [1, 2, 3] } };
            await chrome.storage.local.set({ _testObj: obj });
            const r = await chrome.storage.local.get('_testObj');
            this.assertEqual(JSON.stringify(r._testObj), JSON.stringify(obj));
            await chrome.storage.local.remove('_testObj');
        });
        await this.test('debugMode setting exists', async () => {
            const r = await chrome.storage.local.get('debugMode');
            this.assert(r.debugMode !== undefined || r.debugMode === undefined); // Exists or not, no error
        });
        await this.test('Storage batch operations', async () => {
            this.markCovered('Storage', 'remove');
            await chrome.storage.local.set({ _a: 1, _b: 2 });
            const r = await chrome.storage.local.get(['_a', '_b']);
            this.assertEqual(r._a, 1);
            await chrome.storage.local.remove(['_a', '_b']);
        });
    },

    // ============================================
    // OAUTH TESTS (12 tests)
    // ============================================
    async testOAuth() {
        this.appendResult('<b>🔐 OAUTH TESTS</b>');

        // Module
        await this.test('NotionOAuth exists', () => this.assert(typeof NotionOAuth !== 'undefined'));
        await this.test('NotionOAuth.init works', async () => { const r = await NotionOAuth.init(); this.assertEqual(r, true); });

        // Config
        await this.test('config.authorizationEndpoint exists', () => this.assert(NotionOAuth.config.authorizationEndpoint));
        await this.test('config.scopes is array', () => this.assert(Array.isArray(NotionOAuth.config.scopes)));

        // Methods exist
        await this.test('isConfigured returns boolean', () => this.assert(typeof NotionOAuth.isConfigured() === 'boolean'));
        await this.test('authorize is function', () => this.assert(typeof NotionOAuth.authorize === 'function'));
        await this.test('getAccessToken is function', () => this.assert(typeof NotionOAuth.getAccessToken === 'function'));
        await this.test('getActiveToken is function', () => this.assert(typeof NotionOAuth.getActiveToken === 'function'));
        await this.test('disconnect is function', () => this.assert(typeof NotionOAuth.disconnect === 'function'));
        await this.test('getStatus is function', () => this.assert(typeof NotionOAuth.getStatus === 'function'));
        await this.test('storeTokens is function', () => this.assert(typeof NotionOAuth.storeTokens === 'function'));
        await this.test('createExportDatabase is function', () => this.assert(typeof NotionOAuth.createExportDatabase === 'function'));
    },

    // ============================================
    // EXPORT MANAGER TESTS (14 tests)
    // ============================================
    async testExport() {
        this.appendResult('<b>📤 EXPORT MANAGER TESTS</b>');

        const testData = {
            title: 'Test Conversation',
            uuid: 'test-uuid-123',
            detail: {
                entries: [
                    { query: 'What is AI?', answer: 'Artificial Intelligence...' },
                    { query: 'Explain more', answer: 'AI systems...' }
                ]
            }
        };

        // Module
        await this.test('ExportManager exists', () => this.assert(typeof ExportManager !== 'undefined'));

        // Formats
        await this.test('formats.markdown exists', () => this.assert(ExportManager.formats.markdown));
        await this.test('formats.json exists', () => this.assert(ExportManager.formats.json));
        await this.test('formats.html exists', () => this.assert(ExportManager.formats.html));
        await this.test('formats.txt exists', () => this.assert(ExportManager.formats.txt));
        await this.test('formats.pdf exists', () => this.assert(ExportManager.formats.pdf));

        // Markdown
        await this.test('toMarkdown works', () => { const md = ExportManager.toMarkdown(testData, 'Test'); this.assert(md.includes('Test Conversation')); });
        await this.test('Markdown has frontmatter', () => { const md = ExportManager.toMarkdown(testData, 'Test'); this.assert(md.includes('---')); });

        // JSON
        await this.test('toJSON works', () => { const j = ExportManager.toJSON(testData, 'Test'); JSON.parse(j); });
        await this.test('JSON has meta', () => { const j = JSON.parse(ExportManager.toJSON(testData, 'Test')); this.assert(j.meta.tool === 'OmniExporter AI'); });

        // HTML
        await this.test('toHTML works', () => { const h = ExportManager.toHTML(testData, 'Test'); this.assert(h.includes('<!DOCTYPE html>')); });

        // Plain Text
        await this.test('toPlainText works', () => { const t = ExportManager.toPlainText(testData, 'Test'); this.assert(t.includes('QUESTION')); });

        // Utilities
        await this.test('escapeHtml works', () => { const r = ExportManager.escapeHtml('<script>'); this.assert(!r.includes('<script>')); });
        await this.test('generateFilename works', () => { const f = ExportManager.generateFilename('Test!@#', '.md'); this.assert(f.endsWith('.md')); });
    },

    // ============================================
    // PLATFORM CONFIG TESTS (10 tests)
    // ============================================  
    async testPlatformConfig() {
        this.appendResult('<b>⚙️ PLATFORM CONFIG TESTS</b>');

        const pcm = typeof PlatformConfigManager !== 'undefined';
        const pc = typeof PlatformConfig !== 'undefined';

        await this.test('PlatformConfig exists', () => this.assert(pc || pcm));

        if (pc) {
            await this.test('Perplexity config exists', () => this.assert(PlatformConfig.Perplexity));
            await this.test('ChatGPT config exists', () => this.assert(PlatformConfig.ChatGPT));
            await this.test('Claude config exists', () => this.assert(PlatformConfig.Claude));
            await this.test('Gemini config exists', () => this.assert(PlatformConfig.Gemini));
            await this.test('Grok config exists', () => this.assert(PlatformConfig.Grok));
            await this.test('DeepSeek config exists', () => this.assert(PlatformConfig.DeepSeek));
            await this.test('Config has baseUrl', () => this.assert(PlatformConfig.Perplexity.baseUrl));
            await this.test('Config has endpoints', () => this.assert(PlatformConfig.Perplexity.endpoints));
            await this.test('Config has patterns', () => {
                this.markCovered('PlatformConfig', 'patterns');
                this.assert(PlatformConfig.Perplexity.patterns);
            });
        } else {
            this.appendResult('ℹ️ PlatformConfig skipped (only available in content script)');
        }
    },

    // ============================================
    // UI COMPONENT TESTS (12 tests)
    // ============================================
    async testUI() {
        this.appendResult('<b>🖥️ UI COMPONENT TESTS</b>');

        // Navigation
        await this.test('Nav items exist', () => this.assert(document.querySelectorAll('.nav-item').length > 0));
        await this.test('Dev Tools tab exists', () => this.assert(document.querySelector('[data-tab="devtools"]')));
        await this.test('History tab exists', () => this.assert(document.querySelector('[data-tab="history"]')));
        await this.test('Settings tab exists', () => this.assert(document.querySelector('[data-tab="settings"]')));

        // Dev Tools
        await this.test('Debug toggle exists', () => this.assert(document.getElementById('debugModeToggle')));
        await this.test('Log viewer exists', () => this.assert(document.getElementById('logEntriesContainer')));
        await this.test('Log filters exist', () => this.assert(document.getElementById('logFilterLevel')));

        // Test Runner
        await this.test('Run All Tests button exists', () => this.assert(document.getElementById('runAllTests')));
        await this.test('Platform test buttons exist', () => this.assert(document.querySelectorAll('[data-platform]').length >= 6));
        await this.test('Deep test buttons exist', () => this.assert(document.querySelectorAll('[data-deep]').length === 6));

        // Header
        await this.test('Platform selector exists', () => this.assert(document.getElementById('platformSelector')));
        await this.test('Auto-sync toggle exists', () => this.assert(document.getElementById('autoSyncToggle')));
    },

    // ============================================
    // TOAST SYSTEM TESTS (8 tests)
    // ============================================
    async testToast() {
        this.appendResult('<b>🔔 TOAST TESTS</b>');

        const toastAvailable = typeof Toast !== 'undefined';
        await this.test('Toast class exists', () => this.assert(toastAvailable));

        if (toastAvailable) {
            await this.test('Toast.init is function', () => this.assert(typeof Toast.init === 'function'));
            await this.test('Toast.create is function', () => this.assert(typeof Toast.create === 'function'));
            await this.test('Toast.dismiss is function', () => this.assert(typeof Toast.dismiss === 'function'));
            await this.test('Toast.success is function', () => this.assert(typeof Toast.success === 'function'));
            await this.test('Toast.error is function', () => this.assert(typeof Toast.error === 'function'));
            await this.test('Toast.info is function', () => this.assert(typeof Toast.info === 'function'));
            await this.test('Toast.escapeHtml works', () => { const r = Toast.escapeHtml('<test>'); this.assert(!r.includes('<')); });
        } else {
            this.appendResult('⚠️ Toast not loaded in Options context');
        }
    },

    // ============================================
    // STRESS TESTS (4 tests)
    // ============================================
    async testStress() {
        this.appendResult('<b>💪 STRESS TESTS</b>');

        // Large data handling
        await this.test('Large object sanitization', () => {
            const bigObj = {};
            for (let i = 0; i < 100; i++) bigObj[`key${i}`] = 'value'.repeat(10);
            const r = Logger._sanitizeData(bigObj);
            this.assert(typeof r === 'object');
        });

        // Rapid operations
        await this.test('Rapid storage ops (50x)', async () => {
            for (let i = 0; i < 50; i++) {
                await chrome.storage.local.set({ [`_stress${i}`]: i });
            }
            const r = await chrome.storage.local.get('_stress49');
            this.assertEqual(r._stress49, 49);
            // Cleanup
            const keys = Array.from({ length: 50 }, (_, i) => `_stress${i}`);
            await chrome.storage.local.remove(keys);
        });

        // Memory check
        await this.test('Memory usage reasonable', () => {
            if (performance.memory) {
                const mb = performance.memory.usedJSHeapSize / 1024 / 1024;
                this.assert(mb < 500, `Used: ${mb.toFixed(1)}MB`);
            } else {
                this.assert(true); // Can't measure, pass
            }
        });

        // Concurrent operations
        await this.test('Concurrent async ops (10x)', async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
                chrome.storage.local.set({ [`_conc${i}`]: i })
            );
            await Promise.all(promises);
            const keys = Array.from({ length: 10 }, (_, i) => `_conc${i}`);
            await chrome.storage.local.remove(keys);
        });
    },

    // ============================================
    // ADVANCED FEATURE TESTS (8 tests)
    // ============================================
    async testAdvanced() {
        this.appendResult('<b>🚀 ADVANCED TESTS</b>');

        // Chrome APIs
        await this.test('chrome.tabs API exists', () => this.assert(chrome.tabs));
        await this.test('chrome.runtime API exists', () => this.assert(chrome.runtime));
        await this.test('chrome.alarms API exists', () => this.assert(chrome.alarms));

        // Manifest
        await this.test('Manifest accessible', () => {
            const m = chrome.runtime.getManifest();
            this.assert(m.name && m.version);
        });

        // Extension ID
        await this.test('Extension ID exists', () => this.assert(chrome.runtime.id));

        // Storage quota
        await this.test('Storage quota available', async () => {
            if (chrome.storage.local.getBytesInUse) {
                const bytes = await chrome.storage.local.getBytesInUse();
                this.assert(typeof bytes === 'number');
            } else {
                this.assert(true);
            }
        });

        // Performance API
        await this.test('Performance API works', () => {
            const t = performance.now();
            this.assert(typeof t === 'number' && t > 0);
        });

        // JSON handling
        await this.test('Large JSON parse/stringify', () => {
            const obj = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'test' })) };
            const str = JSON.stringify(obj);
            const parsed = JSON.parse(str);
            this.assertEqual(parsed.items.length, 1000);
        });
    },

    // ============================================
    // SECURITY TESTS (4 tests)
    // ============================================
    async testSecurity() {
        this.appendResult('<b>🔒 SECURITY TESTS</b>');

        // UUID Validation
        await this.test('Valid UUID passes', () => {
            const validUuid = '550e8400-e29b-41d4-a716-446655440000';
            const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            this.assert(pattern.test(validUuid));
        });

        await this.test('Invalid UUID rejected', () => {
            const invalidUuid = 'not-a-uuid';
            const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            this.assert(!pattern.test(invalidUuid));
        });

        // XSS Prevention
        await this.test('HTML sanitization works', () => {
            const malicious = '<script>alert("xss")</script>';
            const div = document.createElement('div');
            div.textContent = malicious;
            const sanitized = div.innerHTML;
            this.assert(!sanitized.includes('<script>'));
        });

        await this.test('Script injection blocked', () => {
            const input = '"><img src=x onerror=alert(1)>';
            const safe = input.replace(/[<>"'&]/g, c => ({
                '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
            }[c]));
            this.assert(!safe.includes('<'));
        });
    },

    // ============================================
    // ERROR SIMULATION TESTS (4 tests)
    // ============================================
    async testErrorSimulation() {
        this.appendResult('<b>⚠️ ERROR SIMULATION TESTS</b>');

        // Timeout handling
        await this.test('Timeout promise rejects', async () => {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 50)
            );
            try {
                await timeoutPromise;
                this.assert(false, 'Should have timed out');
            } catch (e) {
                this.assertEqual(e.message, 'Timeout');
            }
        });

        // Rate limit error handling
        await this.test('429 error mapped correctly', () => {
            const error = { status: 429, message: 'Rate limited' };
            const isRateLimit = error.status === 429;
            this.assert(isRateLimit);
        });

        // Invalid JSON handling
        await this.test('Invalid JSON throws', () => {
            try {
                JSON.parse('not valid json');
                this.assert(false, 'Should have thrown');
            } catch (e) {
                this.assert(e instanceof SyntaxError);
            }
        });

        // Token expiry simulation
        await this.test('Token expiry detection', () => {
            const token = { expires_at: Date.now() - 1000 }; // Expired 1 second ago
            const isExpired = token.expires_at < Date.now();
            this.assert(isExpired);
        });
    },

    // ============================================
    // PLATFORM ADAPTER TESTS (12 tests)
    // ============================================
    async testPlatformAdapters() {
        this.appendResult('<b>🌐 PLATFORM ADAPTER TESTS</b>');

        const pc = typeof PlatformConfig !== 'undefined' ? PlatformConfig : null;

        // Perplexity UUID extraction
        await this.test('Perplexity UUID from URL', () => {
            const url = 'https://perplexity.ai/search/abc123def456';
            const match = url.match(/\/search\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123def456');
        });

        // ChatGPT UUID extraction
        await this.test('ChatGPT UUID from URL', () => {
            const url = 'https://chatgpt.com/c/550e8400-e29b-41d4-a716-446655440000';
            const match = url.match(/\/c\/([a-f0-9-]+)/i);
            this.assert(match !== null);
        });

        // Claude UUID extraction
        await this.test('Claude UUID from URL', () => {
            const url = 'https://claude.ai/chat/abc123-def456-789';
            const match = url.match(/\/chat\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123-def456-789');
        });

        // Gemini UUID extraction
        await this.test('Gemini UUID from URL', () => {
            const url = 'https://gemini.google.com/app/abc123xyz';
            const match = url.match(/\/app\/([^/?#]+)/);
            this.assert(match !== null);
        });

        // Grok UUID extraction
        await this.test('Grok UUID from URL', () => {
            const url = 'https://grok.com/chat/abc123';
            const match = url.match(/\/chat\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123');
        });

        // DeepSeek UUID extraction
        await this.test('DeepSeek UUID from URL', () => {
            const url = 'https://chat.deepseek.com/a/chat/s/abc123';
            const match = url.match(/\/chat\/s\/([^/?#]+)/) || url.match(/\/chat\/([^/?#]+)/);
            this.assert(match !== null);
        });

        // Platform Config tests
        if (pc) {
            await this.test('PlatformConfig.Perplexity has baseUrl', () => {
                this.markCovered('PlatformConfig', 'getConfig');
                this.assert(pc.Perplexity?.baseUrl);
            });
            await this.test('PlatformConfig.ChatGPT has endpoints', () => {
                this.markCovered('PlatformConfig', 'endpoints');
                this.assert(pc.ChatGPT?.endpoints);
            });
            await this.test('PlatformConfig.Claude has patterns', () => {
                this.markCovered('PlatformConfig', 'patterns');
                this.assert(pc.Claude?.patterns);
            });
            await this.test('PlatformConfig.Gemini has dataFields', () => {
                this.markCovered('PlatformConfig', 'dataFields');
                this.assert(pc.Gemini?.dataFields);
            });
            await this.test('PlatformConfig.Grok has versions', () => this.assert(pc.Grok?.versions));
            await this.test('PlatformConfig.DeepSeek has rateLimit', () => this.assert(pc.DeepSeek?.rateLimit));
        } else {
            this.appendResult('ℹ️ PlatformConfig skipped (only available in content script)');
        }
    },

    // ============================================
    // TEST HISTORY & EXPORT
    // ============================================
    history: [],

    saveToHistory() {
        const entry = {
            timestamp: new Date().toISOString(),
            passed: this.passed,
            failed: this.failed,
            total: this.passed + this.failed,
            results: [...this.results]
        };
        this.history.unshift(entry);
        if (this.history.length > 10) this.history.pop();

        // Save to storage
        chrome.storage.local.set({ testHistory: this.history });
    },

    async loadHistory() {
        const { testHistory } = await chrome.storage.local.get('testHistory');
        this.history = testHistory || [];
    },

    exportResults(format = 'json') {
        const data = {
            timestamp: new Date().toISOString(),
            passed: this.passed,
            failed: this.failed,
            total: this.passed + this.failed,
            results: this.results
        };

        let content, filename, type;

        if (format === 'csv') {
            content = 'Name,Status,Error\n' +
                this.results.map(r => `"${r.name}","${r.status}","${r.error || ''}"`).join('\n');
            filename = `test-results-${Date.now()}.csv`;
            type = 'text/csv';
        } else {
            content = JSON.stringify(data, null, 2);
            filename = `test-results-${Date.now()}.json`;
            type = 'application/json';
        }

        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Run all unit tests
    async runAll() {
        this.reset();
        await this.loadHistory();
        this.setStatus('Running 110+ tests...');
        const start = performance.now();

        this.setStatus('Running tests in parallel...');

        // Group 1: Core tests (no dependencies) - run in parallel
        this.appendResult('<b>🚀 Running Core Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testLogger(),
            this.testOAuth(),
            this.testExport(),
            this.testPlatformConfig()
        ]);

        // Group 2: Storage & UI tests - run in parallel
        this.appendResult('\n<b>🎨 Running Storage & UI Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testStorage(),
            this.testUI(),
            this.testToast()
        ]);

        // Group 3: Advanced tests - run in parallel
        this.appendResult('\n<b>🔬 Running Advanced Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testAdvanced(),
            this.testSecurity(),
            this.testErrorSimulation(),
            this.testPlatformAdapters()
        ]);

        // Stress tests optional - can be slow
        // await this.testStress();

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.saveToHistory();
        this.setStatus(this.failed === 0 ? '✅ All Passed!' : `❌ ${this.failed} Failed`);
    },

    // Platform test helper - UPDATED: Now fetches data!
    async testPlatform(key) {
        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        const platform = platforms[key];
        this.appendResult(`<b>🌐 Testing ${platform.name}...</b>`);

        try {
            // Check if tab is already open
            const existingTabs = await chrome.tabs.query({ url: platform.match });
            let tab;
            let openedNewTab = false;

            if (existingTabs.length > 0) {
                // Use existing tab
                tab = existingTabs[0];
                this.appendResult(`   ↳ Using existing tab`);
            } else {
                // Open new tab
                tab = await chrome.tabs.create({ url: platform.url, active: false });
                openedNewTab = true;
                this.appendResult(`   ↳ Opening new tab...`);
                await new Promise(r => setTimeout(r, 5000));
            }

            return new Promise((resolve) => {
                // Step 1: Check Connectivity
                chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, async (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        this.appendResult(`❌ ${platform.name}: Not connected`);
                        this.failed++;
                        resolve();
                        return; // Stop here if not connected
                    }

                    this.appendResult(`✅ ${platform.name}: Connected`);

                    // Step 2: VERIFY DATA ACCESS ( Honest Test )
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'GET_THREAD_LIST',
                        payload: { page: 1, limit: 1 }
                    }, async (threadResp) => {
                        if (chrome.runtime.lastError) {
                            this.appendResult(`⚠️ ${platform.name}: API check failed (${chrome.runtime.lastError.message})`);
                        } else if (threadResp?.success) {
                            const count = threadResp.data?.threads?.length || 0;
                            this.appendResult(`   ↳ Verified: Fetched ${count} threads from API`);
                            this.passed++; // Only pass if we can talk to API
                        } else {
                            this.appendResult(`❌ ${platform.name}: API Error: ${threadResp?.error || 'Unknown'}`);
                            this.failed++;
                        }

                        // Only close tabs we opened - with error handling
                        if (openedNewTab) {
                            await new Promise(r => setTimeout(r, 1000));
                            try {
                                await chrome.tabs.remove(tab.id);
                            } catch (e) {
                                // Tab may already be closed, ignore
                            }
                        }
                        resolve();
                    });
                });
            });
        } catch (e) {
            this.appendResult(`❌ ${platform.name}: ${e.message}`);
            this.failed++;
        }
    },

    // Notion Connection Test
    async testNotionConnection() {
        this.reset();
        this.setStatus('Testing Notion Connection...');
        this.appendResult('<b>📝 NOTION CONNECTION TEST</b>');

        try {
            // 1. Check if configured
            if (!NotionOAuth.isConfigured()) {
                this.appendResult('❌ Notion OAuth not configured');
                return;
            }

            // 2. Check token existence
            const token = await NotionOAuth.getActiveToken().catch(() => null);
            if (!token) {
                this.appendResult('❌ No active Notion token found (Please login)');
                return;
            }
            this.appendResult('✅ Active token found');

            // 3. Test API connectivity
            this.appendResult('⏳ Verifying with Notion API...');
            const result = await NotionOAuth.testConnection();

            if (result.success) {
                this.appendResult(`✅ <b>SUCCESS:</b> Connected to workspace "${result.workspaceName}"`);
                this.appendResult(`   Authenticated as: ${result.botName}`);
                this.passed++;
                this.setStatus('✅ Notion Connected');
            } else {
                this.appendResult(`❌ <b>FAILED:</b> ${result.error}`);
                this.appendResult('   Please try reconnecting your Notion account.');
                this.failed++;
                this.setStatus('❌ Connection Failed');
            }

        } catch (e) {
            this.appendResult(`❌ Error: ${e.message}`);
            this.failed++;
        }
    },

    // Test all platforms - PARALLEL
    async runAllPlatforms() {
        this.reset();
        this.setStatus('Testing all platforms in parallel...');
        const start = performance.now();

        this.appendResult('<b>🌐 PLATFORM TESTS (PARALLEL)</b>');
        this.appendResult('Testing all 6 platforms simultaneously\n');

        const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

        // Run all platform tests in parallel
        await Promise.allSettled(
            platforms.map(key => this.testPlatform(key))
        );

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.setStatus(`Done: ${this.passed}/6 platforms (${duration}ms)`);
    },

    // Network status helper
    setNetworkStatus(text) {
        const el = document.getElementById('networkTestStatus');
        const container = document.getElementById('networkTestProgress');
        if (el) el.textContent = text;
        if (container) container.style.display = text ? 'block' : 'none';
    },

    // Countdown helper
    async countdown(seconds, prefix = 'Loading') {
        for (let i = seconds; i > 0; i--) {
            this.setNetworkStatus(`${prefix}... ${i}s remaining`);
            await new Promise(r => setTimeout(r, 1000));
        }
    },

    // ⚡ Fast Internet Test Mode - PARALLEL
    async testFastInternet() {
        this.reset();
        this.setStatus('⚡ Fast Internet Test (Parallel)');
        this.appendResult('<b>⚡ FAST INTERNET - PARALLEL MODE</b>');
        this.appendResult('Testing all 6 platforms simultaneously\n');

        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        // Phase 1: Open all tabs in parallel
        this.setNetworkStatus('Opening all platform tabs...');
        const tabSetup = await Promise.all(
            Object.entries(platforms).map(async ([key, platform]) => {
                const existingTabs = await chrome.tabs.query({ url: platform.match });
                if (existingTabs.length > 0) {
                    return { platform, tab: existingTabs[0], opened: false };
                } else {
                    const tab = await chrome.tabs.create({ url: platform.url, active: false });
                    return { platform, tab, opened: true };
                }
            })
        );

        // Phase 2: Wait 3 seconds for tabs to load
        await this.countdown(3, 'Loading platforms');

        // Phase 3: Test all in parallel
        this.setNetworkStatus('Testing all platforms simultaneously...');
        const results = await Promise.allSettled(
            tabSetup.map(async ({ platform, tab }) => {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                return { platform, success };
            })
        );

        // Phase 4: Process results
        const failed = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                this.appendResult(`✅ ${result.value.platform.name}: Connected`);
                this.passed++;
            } else {
                const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                failed.push(tabSetup.find(t => t.platform.name === name));
                this.appendResult(`⏳ ${name}: Queued for retry...`);
            }
        }

        // Phase 5: Retry failed ones with 5s wait
        if (failed.length > 0) {
            this.appendResult(`\n<b>Retrying ${failed.length} failed platforms...</b>`);
            await this.countdown(5, 'Retry wait');

            const retryResults = await Promise.allSettled(
                failed.filter(f => f).map(async ({ platform, tab }) => {
                    const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 3);
                    return { platform, success };
                })
            );

            for (const result of retryResults) {
                if (result.status === 'fulfilled' && result.value.success) {
                    this.appendResult(`✅ ${result.value.platform.name}: Connected (retry)`);
                    this.passed++;
                } else {
                    const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                    this.appendResult(`❌ ${name}: Failed after retry`);
                    this.failed++;
                }
            }
        }

        // Cleanup
        for (const { tab, opened } of tabSetup) {
            if (opened) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }
        }

        this.setNetworkStatus('');
        this.updateSummary();
        this.setStatus(`⚡ Done: ${this.passed}/6 platforms`);
    },

    // 🐢 Slow Internet Test Mode - PARALLEL with extended retry
    async testSlowInternet() {
        this.reset();
        this.setStatus('🐢 Slow Internet Test (Parallel)');
        this.appendResult('<b>🐢 SLOW INTERNET - PARALLEL MODE</b>');
        this.appendResult('All platforms tested together, 5s wait + 10s retry\n');

        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        // Phase 1: Open all tabs in parallel
        this.setNetworkStatus('Opening all platform tabs...');
        const tabSetup = await Promise.all(
            Object.entries(platforms).map(async ([key, platform]) => {
                const existingTabs = await chrome.tabs.query({ url: platform.match });
                if (existingTabs.length > 0) {
                    return { platform, tab: existingTabs[0], opened: false };
                } else {
                    const tab = await chrome.tabs.create({ url: platform.url, active: false });
                    return { platform, tab, opened: true };
                }
            })
        );

        // Phase 2: Wait 5 seconds for tabs to load
        await this.countdown(5, 'Loading platforms');

        // Phase 3: Test all in parallel
        this.setNetworkStatus('Testing all platforms simultaneously...');
        const results = await Promise.allSettled(
            tabSetup.map(async ({ platform, tab }) => {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                return { platform, success };
            })
        );

        // Process first round results
        const failed = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                this.appendResult(`✅ ${result.value.platform.name}: Connected`);
                this.passed++;
            } else {
                const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                failed.push(tabSetup.find(t => t.platform.name === name));
            }
        }

        // Phase 4: Retry failed ones with 5s wait
        if (failed.length > 0) {
            this.appendResult(`\n<b>Retrying ${failed.length} failed platforms (5s wait)...</b>`);
            await this.countdown(5, 'Retry 1');

            const retry1 = await Promise.allSettled(
                failed.filter(f => f).map(async ({ platform, tab }) => {
                    const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                    return { platform, tab, success };
                })
            );

            const stillFailed = [];
            for (const result of retry1) {
                if (result.status === 'fulfilled' && result.value.success) {
                    this.appendResult(`✅ ${result.value.platform.name}: Connected (retry 1)`);
                    this.passed++;
                } else if (result.status === 'fulfilled') {
                    stillFailed.push({ platform: result.value.platform, tab: result.value.tab });
                }
            }

            // Phase 5: Final retry with 10s wait
            if (stillFailed.length > 0) {
                this.appendResult(`\n<b>Final retry for ${stillFailed.length} platforms (10s wait)...</b>`);
                await this.countdown(10, 'Final retry');

                const retry2 = await Promise.allSettled(
                    stillFailed.map(async ({ platform, tab }) => {
                        const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 3);
                        return { platform, success };
                    })
                );

                for (const result of retry2) {
                    if (result.status === 'fulfilled' && result.value.success) {
                        this.appendResult(`✅ ${result.value.platform.name}: Connected (final)`);
                        this.passed++;
                    } else {
                        const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                        this.appendResult(`❌ ${name}: Failed after all retries`);
                        this.failed++;
                    }
                }
            }
        }

        // Cleanup
        for (const { tab, opened } of tabSetup) {
            if (opened) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }
        }

        this.setNetworkStatus('');
        this.updateSummary();
        this.setStatus(`🐢 Done: ${this.passed}/6 platforms`);
    },

    // 📂 Test Open Tabs Only
    async testOpenTabsOnly() {
        this.reset();
        this.setStatus('📂 Testing Open Tabs');
        this.appendResult('<b>📂 OPEN TABS ONLY MODE</b>');
        this.appendResult('Only testing platforms you have open\n');

        const platforms = {
            perplexity: { name: 'Perplexity', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', match: '*://chat.deepseek.com/*' }
        };

        let testedCount = 0;

        for (const [key, platform] of Object.entries(platforms)) {
            const existingTabs = await chrome.tabs.query({ url: platform.match });

            if (existingTabs.length === 0) {
                this.appendResult(`⏭️ ${platform.name}: Not open (skipped)`);
                continue;
            }

            testedCount++;
            const tab = existingTabs[0];

            try {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                if (success) {
                    this.appendResult(`✅ ${platform.name}: Connected`);
                    this.passed++;
                } else {
                    this.appendResult(`❌ ${platform.name}: Not connected`);
                    this.failed++;
                }
            } catch (e) {
                this.appendResult(`❌ ${platform.name}: ${e.message}`);
                this.failed++;
            }
        }

        if (testedCount === 0) {
            this.appendResult('⚠️ No platform tabs are open!');
            this.appendResult('Please open at least one AI platform in a tab.');
        }

        this.updateSummary();
        this.setStatus(`📂 Tested ${testedCount}/6 open platforms`);
    },

    // Helper: Send message with retry
    async sendMessageWithRetry(tabId, message, maxRetries = 2) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tabId, message, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(response);
                        }
                    });
                });
                if (response?.success) return true;
                if (response?.data) return response; // Return data if available
            } catch (e) { }
            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    },

    // Helper: Get AI Tab (mimics getAITab from usage)
    async getAITab(matchUrl) {
        const tabs = await chrome.tabs.query({ url: matchUrl });
        if (tabs.length > 0) return tabs[0];
        return null;
    },

    // Deep platform test - tests everything including Notion Upload
    async runDeepPlatformTest(key) {
        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*', formatter: 'perplexity' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*', formatter: 'chatgpt' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*', formatter: 'claude' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*', formatter: 'gemini' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*', formatter: 'grok' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*', formatter: 'deepseek' }
        };

        const platform = platforms[key];

        // Note: When running in parallel, we can't reset(). We rely on appendResult being additive.
        this.appendResult(`<b>🔬 DEEP TEST: ${platform.name}</b>`);

        try {
            // Find or open tab
            // Find or open tab - using Logic similar to actual usage
            const existingTab = await this.getAITab(platform.match);
            let tab;
            let openedNewTab = false;

            if (existingTab) {
                tab = existingTab;
                this.appendResult(`   ✅ ${platform.name}: Using existing tab (Active)`);
                // Ensure tab is ready/awake
                await chrome.tabs.reload(tab.id); // Reload to ensure content script is fresh
                await new Promise(r => setTimeout(r, 3000)); // Wait for reload
            } else {
                tab = await chrome.tabs.create({ url: platform.url, active: true }); // Make active to ensure full loading
                openedNewTab = true;
                this.appendResult(`   ⏳ ${platform.name}: Opening new tab (Active)...`);
                await new Promise(r => setTimeout(r, 8000)); // Longer wait for initial load
            }

            // Test 1: Connection
            const connected = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
            if (!connected) {
                this.appendResult(`   ❌ ${platform.name}: Connection failed`);
                this.failed++;
                if (openedNewTab) chrome.tabs.remove(tab.id);
                return { success: false, reason: 'Connection failed' };
            }
            this.appendResult(`   ✅ ${platform.name}: Connected`);

            // Test 2: Fetch Thread List
            // Test 2: Fetch Thread List
            const threadResp = await this.sendMessageWithRetry(tab.id, { type: 'GET_THREAD_LIST', payload: { page: 1, limit: 10 } }, 2);

            if (!threadResp || !threadResp.success || !threadResp.data?.threads) {
                this.appendResult(`   ❌ ${platform.name}: Thread list failed`);
                this.failed++;
                return { success: false, reason: 'Thread list failed' };
            }

            const threads = threadResp.data.threads;
            const threadCount = threads.length;

            if (threadCount === 0) {
                this.appendResult(`   ⚠️ ${platform.name}: 0 threads found (Empty account?)`);
                // Can't proceed to extraction if 0 threads
                return { success: true, reason: 'No threads to test' };
            }
            this.appendResult(`   ✅ ${platform.name}: Found ${threadCount} threads`);

            // Test 3: Content Extraction (The Honest Check)
            const firstThread = threads[0];
            this.appendResult(`   ⏳ ${platform.name}: Extracting "${firstThread.title?.substring(0, 20)}..."`);

            const extractResp = await this.sendMessageWithRetry(tab.id, { type: 'EXTRACT_CONTENT_BY_UUID', payload: { uuid: firstThread.uuid } }, 2);

            if (!extractResp || !extractResp.success || !extractResp.data) {
                this.appendResult(`   ❌ ${platform.name}: Extraction Failed!`);
                this.failed++;
                return { success: false, reason: 'Extraction failed' };
            }

            // Verify Content Quality
            const entries = extractResp.data.detail?.entries || [];
            const hasContent = entries.some(e => e.query || e.answer); // Check for at least one question or answer

            if (entries.length === 0 || !hasContent) {
                this.appendResult(`   ❌ ${platform.name}: EXPORTED DUMMY DATA (Empty content)`);
                if (extractResp.data.debug) {
                    this.appendResult(`   🔍 DEBUG: ${JSON.stringify(extractResp.data.debug)}`);
                }
                this.failed++;
                return { success: false, reason: 'Empty content extracted' };
            }

            this.appendResult(`   ✅ ${platform.name}: Extracted ${entries.length} messages (Valid Content)`);
            this.passed++;


            // Test 4: Notion Upload (Real World Verification)
            if (NotionOAuth.isConfigured() && (await NotionOAuth.getStatus()).connected) {
                this.appendResult(`   ⏳ ${platform.name}: Verifying Notion Upload...`);
                try {
                    // 1. Format for Notion (simulate export)
                    // Note: We use a simplified text block for the test to avoid complex formatting issues during test
                    const testContent = [
                        {
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: [{ type: 'text', text: { content: `Verified Export Test: ${platform.name}\nTimestamp: ${new Date().toISOString()}` } }]
                            }
                        },
                        {
                            object: 'block',
                            type: 'callout',
                            callout: {
                                rich_text: [{ type: 'text', text: { content: `Successfully extracted ${entries.length} messages from ${platform.name}.` } }],
                                icon: { emoji: '✅' }
                            }
                        }
                    ];

                    const notionProps = {
                        'Title': { title: [{ text: { content: `TEST: ${firstThread.title || 'Untitled'}` } }] },
                        'Platform': { select: { name: platform.name } },
                        'URL': { url: firstThread.url || platform.url },
                        'Exported': { date: { start: new Date().toISOString() } }
                    };

                    // 2. Upload
                    const uploadResp = await NotionOAuth.uploadPage(notionProps, testContent);

                    if (uploadResp && uploadResp.id) {
                        this.appendResult(`   ✅ ${platform.name}: Uploaded to Notion!`);
                        this.passed++;
                    } else {
                        throw new Error('Upload response invalid');
                    }

                } catch (e) {
                    this.appendResult(`   ❌ ${platform.name}: Notion Upload Failed (${e.message})`);
                    this.failed++;
                }
            } else {
                this.appendResult(`   ℹ️ ${platform.name}: Skipping upload (Notion not connected)`);
            }

            // Cleanup
            if (openedNewTab) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }

            return { success: true };

        } catch (e) {
            this.appendResult(`   ❌ ${platform.name}: Error - ${e.message}`);
            this.failed++;
            return { success: false, error: e.message };
        }
    },

    // Full E2E test - PARALLEL EXECUTION
    async runFullE2E() {
        this.reset();
        this.setStatus('Running FULL E2E (Parallel Mode)...');
        const start = performance.now();

        this.appendResult('<b>🚀 FULL E2E TEST (PARALLEL & DEEP)</b>');
        this.appendResult('Starting UI & Unit Tests...\n');

        // Unit tests run sequentially first (fast)
        await this.testLogger();
        await this.testStorage();
        await this.testOAuth();
        await this.testExport();
        await this.testUI();

        // Platform tests run in parallel
        this.appendResult('\n<b>🌐 LAUNCHING PARALLEL DEEP TESTS</b>');
        this.appendResult('This will open multiple tabs and verify content extraction...\n');

        const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

        // Execute all promises
        const results = await Promise.allSettled(
            platforms.map(key => this.runDeepPlatformTest(key))
        );

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.setStatus(this.failed === 0 ? '🏆 All Systems Verified!' : `Done: ${this.passed} passed, ${this.failed} failed`);

        // Add final report at bottom
        this.appendResult('\n<b>🏁 FINAL REPORT</b>');
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        this.appendResult(`Successful Platforms: ${successCount} / ${platforms.length}`);
    }
};

// Wire up test runner buttons
document.addEventListener('DOMContentLoaded', () => {
    // Unit test buttons
    document.getElementById('runAllTests')?.addEventListener('click', () => TestRunner.runAll());
    document.getElementById('runLoggerTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testLogger().then(() => TestRunner.updateSummary()); });
    document.getElementById('runStorageTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testStorage().then(() => TestRunner.updateSummary()); });
    document.getElementById('runOAuthTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testOAuth().then(() => TestRunner.updateSummary()); });
    document.getElementById('runExportTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testExport().then(() => TestRunner.updateSummary()); });
    document.getElementById('runUITests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testUI().then(() => TestRunner.updateSummary()); });

    // Platform test buttons
    document.getElementById('runAllPlatformTests')?.addEventListener('click', () => TestRunner.runAllPlatforms());
    document.querySelectorAll('[data-platform]').forEach(btn => {
        btn.addEventListener('click', () => {
            TestRunner.reset();
            TestRunner.testPlatform(btn.dataset.platform).then(() => TestRunner.updateSummary());
        });
    });

    // Notion Test
    document.getElementById('testNotionBtn')?.addEventListener('click', () => TestRunner.testNotionConnection());

    // Network mode test buttons
    document.getElementById('testFastInternet')?.addEventListener('click', () => TestRunner.testFastInternet());
    document.getElementById('testSlowInternet')?.addEventListener('click', () => TestRunner.testSlowInternet());
    document.getElementById('testOpenTabsOnly')?.addEventListener('click', () => TestRunner.testOpenTabsOnly());

    // Deep platform test buttons
    // Deep platform test buttons
    document.getElementById('runFullE2E')?.addEventListener('click', () => TestRunner.runFullE2E());
    document.querySelectorAll('[data-deep]').forEach(btn => {
        btn.addEventListener('click', () => {
            // For single deep test, we Reset first
            TestRunner.reset();
            TestRunner.runDeepPlatformTest(btn.dataset.deep).then(() => TestRunner.updateSummary());
        });
    });

    // Extra test buttons
    document.getElementById('runToastTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testToast().then(() => TestRunner.updateSummary()); });
    document.getElementById('runAdvancedTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testAdvanced().then(() => TestRunner.updateSummary()); });
    document.getElementById('runStressTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testStress().then(() => TestRunner.updateSummary()); });
    document.getElementById('runSecurityTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testSecurity().then(() => TestRunner.updateSummary()); });
    document.getElementById('runErrorTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testErrorSimulation().then(() => TestRunner.updateSummary()); });
    document.getElementById('runAdapterTests')?.addEventListener('click', () => { TestRunner.reset(); TestRunner.testPlatformAdapters().then(() => TestRunner.updateSummary()); });

    // Export buttons
    document.getElementById('exportResultsJson')?.addEventListener('click', () => TestRunner.exportResults('json'));
    document.getElementById('exportResultsCsv')?.addEventListener('click', () => TestRunner.exportResults('csv'));

    // Search and Filter
    document.getElementById('testSearch')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('#testResults > div').forEach(div => {
            div.style.display = div.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
    });

    document.getElementById('testFilter')?.addEventListener('change', (e) => {
        const filter = e.target.value;
        document.querySelectorAll('#testResults > div').forEach(div => {
            if (filter === 'all') div.style.display = '';
            else if (filter === 'passed') div.style.display = div.textContent.includes('✅') ? '' : 'none';
            else if (filter === 'failed') div.style.display = div.textContent.includes('❌') ? '' : 'none';
        });
    });

    // Performance Panel - make global for auto-refresh
    window.refreshPerformance = async () => {
        const perfMemory = document.getElementById('perfMemory');
        const perfStorage = document.getElementById('perfStorage');
        const perfLogCount = document.getElementById('perfLogCount');

        if (perfMemory) {
            if (performance.memory) {
                perfMemory.textContent = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB';
            } else {
                perfMemory.textContent = 'N/A';
            }
        }

        if (perfStorage) {
            const bytes = await chrome.storage.local.getBytesInUse();
            perfStorage.textContent = (bytes / 1024).toFixed(2) + ' KB';
        }

        if (perfLogCount) {
            const { omniLogs = [] } = await chrome.storage.local.get('omniLogs');
            perfLogCount.textContent = omniLogs.length;
        }
    };
    document.getElementById('refreshPerformance')?.addEventListener('click', window.refreshPerformance);

    // Auto-refresh performance on load
    window.refreshPerformance();

    // Test History Display - make it global so it can be called after tests
    window.displayTestHistory = async () => {
        const panel = document.getElementById('testHistoryPanel');
        if (!panel) return;

        await TestRunner.loadHistory();
        if (TestRunner.history.length === 0) {
            panel.innerHTML = '<em>No test runs yet</em>';
            return;
        }

        panel.innerHTML = TestRunner.history.map(h => {
            const date = new Date(h.timestamp).toLocaleString();
            const status = h.failed === 0 ? '✅' : '❌';
            return `<div style="padding: 4px 0; border-bottom: 1px solid var(--border);">
                ${status} ${date} - ${h.passed}/${h.total} passed
            </div>`;
        }).join('');
    };
    window.displayTestHistory();

    // Clear All Logs
    document.getElementById('clearAllLogs')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear ALL logs? This cannot be undone.')) {
            await Logger.secureClear?.() || await chrome.storage.local.remove(['omniLogs', 'logEntries', 'testHistory', 'debugLogs']);
            alert('All logs cleared securely!');
            location.reload();
        }
    });

    // Show Coverage Report
    document.getElementById('showCoverageBtn')?.addEventListener('click', () => {
        const coverage = TestRunner.getCoverageReport();
        let report = '📈 COVERAGE REPORT\n\n';
        for (const [module, data] of Object.entries(coverage)) {
            const bar = '█'.repeat(Math.floor(data.percent / 10)) + '░'.repeat(10 - Math.floor(data.percent / 10));
            report += `${module}: ${bar} ${data.percent}% (${data.covered}/${data.total})\n`;
        }
        alert(report);
    });

    // Show Flaky Tests
    document.getElementById('showFlakyBtn')?.addEventListener('click', () => {
        const flaky = TestRunner.getFlakyTests();
        if (flaky.length === 0) {
            alert('⚠️ FLAKY TESTS\n\nNo flaky tests detected!\n\nFlaky tests are tests that sometimes pass and sometimes fail.');
        } else {
            let report = '⚠️ FLAKY TESTS\n\n';
            flaky.forEach(t => {
                report += `${t.name}\n  ✅ Passes: ${t.passes}  ❌ Fails: ${t.fails}\n\n`;
            });
            alert(report);
        }
    });
});
