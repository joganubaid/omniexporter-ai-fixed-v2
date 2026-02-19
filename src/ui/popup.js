// OmniExporter AI - Popup JavaScript
// Phase 9: Multi-Platform Export v5.0

// ============================================
// LOGGER HELPER (popup context)
// ============================================
const logPopup = (level, message, data = null) => {
    if (typeof Logger !== 'undefined') {
        Logger[level]('UI', message, data);
    }
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[Popup] ${message}`, data || '');
};

// Initialize Logger
if (typeof Logger !== 'undefined') {
    Logger.init().catch(() => { });
}

// ============================================
// GLOBAL ERROR HANDLER (Audit Fix)
// ============================================
window.addEventListener('error', (event) => {
    logPopup('error', 'Uncaught error', { error: event.error?.message });
    if (typeof OmniToast !== 'undefined') {
        OmniToast.show('An error occurred. Check console for details.', 'error');
    }
});

window.addEventListener('unhandledrejection', (event) => {
    logPopup('error', 'Unhandled promise rejection', { reason: event.reason?.message || String(event.reason) });
    if (typeof OmniToast !== 'undefined') {
        OmniToast.show('Operation failed. Please try again.', 'error');
    }
});

let currentPlatform = "Unknown";
let selectedExportFormat = "markdown";

// ============================================
// FIX 11: RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================
async function withRetry(fn, maxRetries = 3, baseDelayMs = 2000) {
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
                logPopup('warn', `Retry ${attempt + 1}/${maxRetries} after ${delay}ms`, { error: error.message });
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// ============================================
// FIX 12: NOTION ERROR MAPPER
// ============================================
const NotionErrorMapper = {
    map(error) {
        const code = error?.code || '';
        const msg = error?.message || '';
        const errorMap = {
            'object_not_found': 'Database not found. Please verify your Database ID.',
            'unauthorized': 'Invalid API key. Please check your Notion integration.',
            'restricted_resource': 'This database is not shared with your integration.',
            'rate_limited': 'Too many requests. Please wait a moment and try again.'
        };
        if (errorMap[code]) return errorMap[code];
        if (msg.includes('Could not find database')) return errorMap['object_not_found'];
        if (msg.includes('API token')) return errorMap['unauthorized'];
        return msg || 'Unknown Notion error';
    }
};

// ============================================
// FIX 15: ENHANCED RATE LIMITER
// ============================================
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

            if (now - addedAt > 5 * 60 * 1000) {
                const stale = this.queue.shift();
                stale.reject(new Error('Request timeout: took too long in queue'));
                continue;
            }

            this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);

            if (this.requestTimestamps.length >= this.requestsPerMinute) {
                const oldestRequest = Math.min(...this.requestTimestamps);
                const waitTime = 60000 - (now - oldestRequest) + 100;
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

            const delay = this.queue.length > 50 ? 200 : 500;
            await new Promise(r => setTimeout(r, delay));
        }

        this.processing = false;
    }
}

const notionRateLimiter = new RateLimiter(30);

// Notion Schema Cache
let notionSchemaCache = null;
let schemaCacheTime = 0;
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================
// PERFORMANCE & SECURITY UTILITIES (Phase 2)
// ============================================

class LoadingManager {
    static show(elementId, text = '⏳') {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.dataset.originalText = el.textContent;
        el.textContent = text;
        el.disabled = true;
    }

    static hide(elementId) {
        const el = document.getElementById(elementId);
        if (!el || !el.dataset.originalText) return;
        el.textContent = el.dataset.originalText;
        el.disabled = false;
        delete el.dataset.originalText;
    }
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
}

// ============================================
// CONNECTION STATUS MANAGER (Phase 13)
// ============================================
class ConnectionStatusManager {
    static setStatus(status) {
        const el = document.getElementById('connection-status');
        if (!el) return;

        // Remove all status classes
        el.classList.remove('connected', 'disconnected', 'checking');

        // Add new status class
        if (status) {
            el.classList.add(status);
        }

        // Update title for accessibility
        const titles = {
            connected: 'Connected to platform',
            disconnected: 'Disconnected',
            checking: 'Checking connection...'
        };
        el.title = titles[status] || '';
    }

    static connected() { this.setStatus('connected'); }
    static disconnected() { this.setStatus('disconnected'); }
    static checking() { this.setStatus('checking'); }
}

// ============================================
// LOADING OVERLAY (Phase 13)
// ============================================
class LoadingOverlay {
    static overlay = null;

    static show(message = 'Loading...') {
        this.hide(); // Remove any existing overlay

        this.overlay = document.createElement('div');
        this.overlay.className = 'loading-overlay';
        this.overlay.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">${message}</div>
        `;
        document.body.appendChild(this.overlay);

        // Trigger animation
        requestAnimationFrame(() => {
            this.overlay.classList.add('visible');
        });
    }

    static hide() {
        if (this.overlay) {
            this.overlay.classList.remove('visible');
            setTimeout(() => {
                this.overlay?.remove();
                this.overlay = null;
            }, 200);
        }
    }

    static update(message) {
        const textEl = this.overlay?.querySelector('.loading-text');
        if (textEl) {
            textEl.textContent = message;
        }
    }
}

class RequestDeduplicator {
    constructor() {
        this.activeRequests = new Set();
    }
    async run(key, fn) {
        if (this.activeRequests.has(key)) return null;
        this.activeRequests.add(key);
        try {
            return await fn();
        } finally {
            this.activeRequests.delete(key);
        }
    }
}

const reqDeduplication = new RequestDeduplicator();

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initConnectionDots(); // Initialize connection dots first
    detectPlatform();
    loadSyncStatus();
    initExportDropdown();
    initNavigationBar();

    // Event Listeners
    document.getElementById('saveToNotionBtn').addEventListener('click', saveToNotion);
    document.getElementById('openDashboard').addEventListener('click', openDashboard);
    document.getElementById('toggleSync').addEventListener('click', toggleAutoSync);

    // Phase 2: Offline Detection
    window.addEventListener('online', () => {
        setStatus('🌐 Back online', 'success');
        if (typeof Toast !== 'undefined') Toast.success('Back online');
    });
    window.addEventListener('offline', () => {
        setStatus('🔌 Offline', 'error');
        if (typeof Toast !== 'undefined') Toast.warning('You are offline');
    });
    if (!navigator.onLine) setStatus('🔌 Offline', 'error');
});

// ============================================
// CONNECTION DOTS INITIALIZATION
// ============================================
function initConnectionDots() {
    const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];
    platforms.forEach(platform => {
        const dot = document.getElementById(`dot-${platform}`);
        if (dot) {
            dot.classList.add('checking'); // Show checking animation initially
        }
    });
}

// ============================================
// EXPORT DROPDOWN
// ============================================
function initExportDropdown() {
    const dropdown = document.querySelector('.export-dropdown');
    const exportBtn = document.getElementById('exportBtn');
    const dropdownMenu = document.getElementById('exportMenu');

    if (!dropdown || !exportBtn) return;

    // Toggle dropdown on button click
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    // Handle format selection
    if (dropdownMenu) {
        dropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', async () => {
                const format = item.getAttribute('data-format');
                selectedExportFormat = format;
                dropdown.classList.remove('open');
                await exportCurrentChat(format);
            });
        });
    }
}

// ============================================
// NAVIGATION BAR
// ============================================
function initNavigationBar() {
    const navBtns = document.querySelectorAll('.nav-btn');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const platform = btn.getAttribute('data-platform');
            navigateToPlatform(platform);
        });
    });
}

function navigateToPlatform(platform) {
    const platformUrls = {
        'perplexity': 'https://www.perplexity.ai/',
        'chatgpt': 'https://chatgpt.com/',
        'claude': 'https://claude.ai/',
        'gemini': 'https://gemini.google.com/',
        'grok': 'https://grok.com/',
        'deepseek': 'https://chat.deepseek.com/'
    };

    const url = platformUrls[platform];
    if (url) {
        chrome.tabs.create({ url });
        if (typeof Toast !== 'undefined') Toast.info(`Opening ${platform}...`);
    }
}

function updateNavBarActive(platform) {
    const platformMap = {
        'Perplexity': 'perplexity',
        'ChatGPT': 'chatgpt',
        'Claude': 'claude',
        'Gemini': 'gemini',
        'Grok': 'grok',
        'DeepSeek': 'deepseek'
    };

    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-platform') === platformMap[platform]) {
            btn.classList.add('active');
        }
    });

    // Update connection dots
    updatePlatformConnectionDots(platformMap[platform]);
}

// ============================================
// PLATFORM CONNECTION DOTS (from reference files)
// ============================================
function updatePlatformConnectionDots(activePlatform) {
    const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

    platforms.forEach(platform => {
        const dot = document.getElementById(`dot-${platform}`);
        if (dot) {
            dot.classList.remove('connected', 'checking');
            if (platform === activePlatform) {
                dot.classList.add('connected');
            }
        }
    });
}

// ============================================
// PLATFORM DETECTION (Fix #3: Content Script Injection)
// ============================================

/**
 * Inject content script if not already present
 */
async function ensureContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['platform-config.js', 'content.js']
        });
        logPopup('debug', 'Content script injected');
        return true;
    } catch (e) {
        logPopup('warn', 'Content script injection failed', { error: e.message });
        return false;
    }
}

async function detectPlatform() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            document.getElementById('platform-status').textContent = "No Tab";
            return;
        }

        const supportedUrls = ['perplexity.ai', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'chat.deepseek.com'];
        const isSupported = supportedUrls.some(domain => tab.url.includes(domain));

        if (!isSupported) {
            document.getElementById('platform-status').textContent = "Unsupported";
            return;
        }

        // Try to communicate with content script
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, async (response) => {
            if (chrome.runtime.lastError) {
                logPopup('debug', 'Content script not ready, injecting...');

                // Fix #3: Inject content script and retry
                const injected = await ensureContentScript(tab.id);
                if (injected) {
                    // Wait for script to initialize
                    await new Promise(r => setTimeout(r, 500));

                    // Retry communication
                    chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, (retryResponse) => {
                        if (retryResponse && retryResponse.success) {
                            currentPlatform = retryResponse.platform;
                            document.getElementById('platform-status').textContent = currentPlatform;
                        } else {
                            document.getElementById('platform-status').textContent = "Refresh Page";
                        }
                    });
                } else {
                    document.getElementById('platform-status').textContent = "Refresh Page";
                }
                return;
            }

            if (response && response.success) {
                currentPlatform = response.platform;
                logPopup('info', 'Platform detected', { platform: currentPlatform });
                document.getElementById('platform-status').textContent = currentPlatform;
                updateNavBarActive(currentPlatform);
            }
        });
    } catch (e) {
        logPopup('error', 'Platform detection error', { error: e.message });
    }
}

// ============================================
// EXPORT CURRENT CHAT (Multi-Format)
// ============================================
async function exportCurrentChat(format = 'markdown') {
    try {
        await reqDeduplication.run('export', async () => {
            LoadingManager.show('exportBtn', '⏳');
            logPopup('info', 'Starting export', { format });

            // Show loading toast if available
            let loadingToastId;
            if (typeof Toast !== 'undefined') {
                loadingToastId = Toast.loading('Extracting conversation...');
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                setStatus('No active tab', 'error');
                LoadingManager.hide('exportBtn');
                if (loadingToastId && typeof Toast !== 'undefined') Toast.dismiss(loadingToastId);
                return;
            }

            chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, async (response) => {
                try {
                    if (chrome.runtime.lastError) {
                        setStatus('Refresh page first', 'error');
                        if (loadingToastId && typeof Toast !== 'undefined') {
                            Toast.dismiss(loadingToastId);
                            Toast.error('Page not ready. Refresh and try again.');
                        }
                        return;
                    }

                    if (!response || !response.success) {
                        setStatus('Export failed', 'error');
                        if (loadingToastId && typeof Toast !== 'undefined') {
                            Toast.dismiss(loadingToastId);
                            Toast.error('Failed to extract conversation');
                        }
                        return;
                    }

                    // Use ExportManager if available, fallback to old method
                    if (typeof ExportManager !== 'undefined') {
                        try {
                            const result = ExportManager.export(response.data, format, currentPlatform);
                            setStatus(`Exported as ${result.format}!`, 'success');
                            if (loadingToastId && typeof Toast !== 'undefined') {
                                Toast.dismiss(loadingToastId);
                                Toast.success(`Exported as ${result.format}`);
                            }
                        } catch (exportErr) {
                            setStatus(`Export error: ${exportErr.message}`, 'error');
                            if (loadingToastId && typeof Toast !== 'undefined') {
                                Toast.dismiss(loadingToastId);
                                Toast.error(exportErr.message);
                            }
                        }
                    } else {
                        // Fallback to old markdown export
                        const markdown = formatToMarkdown(response.data);
                        downloadFile(markdown, response.data.title || 'Chat');
                        setStatus('Exported!', 'success');
                        if (loadingToastId && typeof Toast !== 'undefined') {
                            Toast.dismiss(loadingToastId);
                            Toast.success('Exported as Markdown');
                        }
                    }
                } finally {
                    LoadingManager.hide('exportBtn');
                }
            });
        });
    } catch (err) {
        logPopup('error', 'Export failed', { error: err.message });
        setStatus('Failed', 'error');
        LoadingManager.hide('exportBtn');
        if (typeof Toast !== 'undefined') Toast.error('Export failed');
    }
}

// ============================================
// SAVE TO NOTION
// ============================================
async function saveToNotion() {
    try {
        await reqDeduplication.run('saveNotion', async () => {
            LoadingManager.show('saveToNotionBtn', '⏳');
            logPopup('info', 'Starting Notion sync');

            const storage = await chrome.storage.local.get(['notionDbId']);
            if (!storage.notionDbId) {
                setStatus('Configure Notion in Settings', 'error');
                LoadingManager.hide('saveToNotionBtn');
                return;
            }

            if (typeof NotionOAuth === 'undefined') {
                setStatus('OAuth module not loaded', 'error');
                LoadingManager.hide('saveToNotionBtn');
                return;
            }

            let token;
            try {
                token = await NotionOAuth.getActiveToken();
            } catch (error) {
                setStatus(error.message || 'Notion auth missing', 'error');
                LoadingManager.hide('saveToNotionBtn');
                return;
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                setStatus('No active tab', 'error');
                LoadingManager.hide('saveToNotionBtn');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, async (response) => {
                try {
                    if (chrome.runtime.lastError) {
                        setStatus('Refresh page first', 'error');
                        return;
                    }

                    if (!response || !response.success) {
                        setStatus('Extract failed', 'error');
                        return;
                    }

                    try {
                        await syncToNotionAPI(response.data, token, storage.notionDbId);
                        setStatus('✅ Saved to Notion!', 'success');
                    } catch (notionErr) {
                        setStatus(`Error: ${notionErr.message}`, 'error');
                    }
                } finally {
                    LoadingManager.hide('saveToNotionBtn');
                }
            });
        });
    } catch (err) {
        logPopup('error', 'Notion sync failed', { error: err.message });
        setStatus('Failed', 'error');
        LoadingManager.hide('saveToNotionBtn');
    }
}

/**
 * Build Notion page properties based on database schema
 * Supports common property types: Title, URL, Date, Select, Multi-Select
 */
async function buildNotionProperties(data, dbId, apiKey, entries) {
    // Build title - always required
    const title = data.title || data.query_str || 'Untitled Chat';

    // Build URL based on platform
    const platformUrls = {
        'Perplexity': `https://www.perplexity.ai/search/${data.uuid}`,
        'ChatGPT': `https://chatgpt.com/c/${data.uuid}`,
        'Claude': `https://claude.ai/chat/${data.uuid}`,
        'Gemini': `https://gemini.google.com/app/${data.uuid}`,
        'Grok': `https://grok.com/chat/${data.uuid}`,
        'DeepSeek': `https://chat.deepseek.com/a/chat/s/${data.uuid}`
    };
    const chatUrl = platformUrls[currentPlatform] || platformUrls['Perplexity'];

    // Build date - use last_query_datetime or current date
    const chatDate = data.last_query_datetime || data.updated_at || new Date().toISOString();

    // Build properties object - Notion property names are case-sensitive
    // We include common property names that databases might have
    const properties = {
        // Title is always required (case-insensitive match)
        'Title': {
            title: [{ type: 'text', text: { content: title.slice(0, 2000) } }]
        }
    };

    // Add URL property (common names: URL, Link, Source)
    properties['URL'] = { url: chatUrl };

    // Add Tags/Platform property (common names: Tags, Platform, Source)
    properties['Tags'] = {
        multi_select: [{ name: currentPlatform || 'AI' }]
    };

    // Add Chat Time/Date property (common names: Chat Time, Date, Created)
    properties['Chat Time'] = {
        date: { start: chatDate.split('T')[0] } // Format: YYYY-MM-DD
    };

    // Add Space Name if available
    if (data.space_name) {
        properties['Space Name'] = {
            rich_text: [{ type: 'text', text: { content: data.space_name } }]
        };
    }

    return properties;
}

// Sync to Notion API
async function syncToNotionAPI(data, apiKey, dbId) {
    const entries = data.detail?.entries || [];
    const children = [];

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
        const query = entry.query || entry.query_str || '';
        if (query) {
            children.push({
                type: "heading_2",
                heading_2: {
                    rich_text: [{ type: "text", text: { content: `🙋 ${query}`.slice(0, 2000) } }]
                }
            });
        }

        // Extract answer
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

        // Add answer (chunked)
        if (answer.trim()) {
            const chunks = splitTextForNotion(answer.trim(), 1900);
            chunks.forEach(chunk => {
                children.push({
                    type: "paragraph",
                    paragraph: { rich_text: [{ type: "text", text: { content: chunk } }] }
                });
            });
        }

        if (index < entries.length - 1) {
            children.push({ type: "divider", divider: {} });
        }
    });

    // Create Notion page with dynamic properties and throttling
    const properties = await buildNotionProperties(data, dbId, apiKey, entries);

    const response = await withRetry(async () => {
        return await notionRateLimiter.throttle(async () => {
            return await fetch('https://api.notion.com/v1/pages', {
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
        throw new Error(NotionErrorMapper.map(error));
    }

    return await response.json();
}

// Split text for Notion's 2000 char limit
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


// OPEN DASHBOARD
// ============================================
function openDashboard() {
    const optionsUrl = chrome.runtime.getURL('options.html');
    chrome.tabs.create({ url: optionsUrl });
}

// ============================================
// AUTO-SYNC TOGGLE
// ============================================
async function loadSyncStatus() {
    const { autoSyncEnabled } = await chrome.storage.local.get('autoSyncEnabled');
    updateSyncUI(autoSyncEnabled);
}

async function toggleAutoSync() {
    const { autoSyncEnabled } = await chrome.storage.local.get('autoSyncEnabled');
    const newState = !autoSyncEnabled;

    if (newState) {
        const { syncInterval = 60 } = await chrome.storage.local.get('syncInterval');
        chrome.alarms.create('autoSyncAlarm', { periodInMinutes: syncInterval });
    } else {
        chrome.alarms.clear('autoSyncAlarm');
    }

    chrome.storage.local.set({ autoSyncEnabled: newState });
    updateSyncUI(newState);
}

function updateSyncUI(isEnabled) {
    const statusEl = document.getElementById('syncStatus');
    if (!statusEl) return;
    if (isEnabled) {
        statusEl.textContent = 'ON';
        statusEl.className = 'status on';
    } else {
        statusEl.textContent = 'OFF';
        statusEl.className = 'status off';
    }
}

// ============================================
// UTILITIES
// ============================================
function formatToMarkdown(data) {
    const entries = data.detail?.entries || [];
    const firstEntry = entries[0] || {};
    const title = data.title || 'Untitled Chat';
    const date = firstEntry.updated_datetime
        ? new Date(firstEntry.updated_datetime).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
    const url = `https://www.perplexity.ai/search/${data.uuid || ''}`;

    let md = '---\n';
    md += `title: ${title}\n`;
    md += `date: ${date}\n`;
    md += `url: ${url}\n`;
    md += `source: ${currentPlatform}\n`;
    md += '---\n\n';

    entries.forEach(entry => {
        const query = entry.query || entry.query_str || '';
        if (query) md += `## 🙋 ${query}\n\n`;

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
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

function setStatus(message, type) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-message ${type}`;

    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            el.className = 'status-message';
        }, 3000);
    }
}

async function getNotionDatabaseSchema(dbId, apiKey) {
    if (notionSchemaCache && (Date.now() - schemaCacheTime < SCHEMA_CACHE_TTL)) {
        return notionSchemaCache;
    }
    try {
        const response = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Notion-Version': '2022-06-28'
            }
        });
        if (!response.ok) throw new Error('Schema fetch failed');
        const schema = await response.json();
        notionSchemaCache = schema;
        schemaCacheTime = Date.now();
        return schema;
    } catch (e) {
        console.warn('[OmniExporter] Schema fetch failed:', e.message);
        return null;
    }
}

async function buildNotionProperties(data, dbId, apiKey, entries = []) {
    const properties = {
        title: { title: [{ type: "text", text: { content: (data.title || 'Chat').slice(0, 2000) } }] }
    };
    try {
        const schema = await getNotionDatabaseSchema(dbId, apiKey);
        if (!schema || !schema.properties) return properties;
        const availableProps = schema.properties;
        if (availableProps['URL'] && data.uuid) {
            properties.URL = { url: `https://www.perplexity.ai/search/${data.uuid}` };
        }
        const threadTime = (entries && entries[0]) ? (entries[0].updated_datetime || entries[0].created_datetime) : null;
        if (availableProps['Chat Time'] && threadTime) {
            try {
                properties['Chat Time'] = { date: { start: new Date(threadTime).toISOString() } };
            } catch (e) { }
        }
        if (availableProps['Space Name'] && data.spaceName) {
            properties['Space Name'] = { rich_text: [{ type: "text", text: { content: data.spaceName } }] };
        }
        if (availableProps['Platform']) {
            properties.Platform = { select: { name: currentPlatform || 'Unknown' } };
        }
    } catch (error) {
        console.warn('[OmniExporter] Property build failed:', error.message);
    }
    return properties;
}
