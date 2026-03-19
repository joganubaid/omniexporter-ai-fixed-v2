// OmniExporter AI - Popup JavaScript
// Phase 9: Multi-Platform Export v5.2.0
"use strict";

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
// PLATFORM URL BUILDER (from shared-utils.js)
// BUG-2 FIX: Use shared getPlatformUrl function
// Fallback if shared-utils.js is not loaded
// ============================================
if (typeof getPlatformUrl === 'undefined') {
    console.warn('[Popup] getPlatformUrl not loaded from shared-utils.js, using fallback');
    function getPlatformUrl(platform, uuid) {
        const urls = {
            'Perplexity': (uuid) => `https://www.perplexity.ai/search/${uuid}`,
            'ChatGPT': (uuid) => `https://chatgpt.com/c/${uuid}`,
            'Claude': (uuid) => `https://claude.ai/chat/${uuid}`,
            'Gemini': (uuid) => `https://gemini.google.com/app/${uuid}`,
            'Grok': (uuid) => `https://grok.com/chat/${uuid}`,
            'DeepSeek': (uuid) => `https://chat.deepseek.com/c/${uuid}`
        };
        const builder = urls[platform];
        if (!builder) {
            console.warn(`[Popup] Unknown platform: ${platform}`);
            return null;
        }
        return builder(uuid || '');
    }
}

// ============================================
// FIX 11: RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================
// (withRetry, NotionErrorMapper, RateLimiter, LoadingManager, InputSanitizer
//  are provided by shared-utils.js)

const notionRateLimiter = new RateLimiter(30);

// Notion Schema Cache
let notionSchemaCache = null;
let schemaCacheTime = 0;
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================
// PERFORMANCE & SECURITY UTILITIES (Phase 2)
// ============================================

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

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        const textEl = document.createElement('div');
        textEl.className = 'loading-text';
        textEl.textContent = message;
        this.overlay.appendChild(spinner);
        this.overlay.appendChild(textEl);
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

// (RequestDeduplicator is provided by shared-utils.js)
const reqDeduplication = new RequestDeduplicator();

// ============================================
// INITIALIZATION
// ============================================
// Module-level DOM cache — populated in DOMContentLoaded
const DOM = {};

document.addEventListener('DOMContentLoaded', () => {
    // Cache frequently used DOM elements at initialization
    DOM.saveToNotionBtn = document.getElementById('saveToNotionBtn');
    DOM.openDashboard = document.getElementById('openDashboard');
    DOM.toggleSync = document.getElementById('toggleSync');
    DOM.platformStatus = document.getElementById('platform-status');
    DOM.syncStatus = document.getElementById('syncStatus');
    DOM.status = document.getElementById('status');

    initConnectionDots(); // Initialize connection dots first
    detectPlatform();
    loadSyncStatus();
    initExportDropdown();
    initNavigationBar();

    // Event Listeners
    DOM.saveToNotionBtn.addEventListener('click', saveToNotion);
    DOM.openDashboard.addEventListener('click', openDashboard);
    DOM.toggleSync.addEventListener('click', toggleAutoSync);

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
// PLATFORM_CONTENT_SCRIPT_FILES and getContentScriptFiles() are defined in
// src/utils/shared-utils.js (loaded before this script) to avoid duplication.

/**
 * Inject content script if not already present.
 * @param {number} tabId
 * @param {string} [tabUrl] - URL of the tab (used to pick platform-specific files)
 */
async function ensureContentScript(tabId, tabUrl) {
    try {
        // Skip reinjection if content script is already alive to avoid redeclaration errors.
        // HEALTH_CHECK is handled in content.js and returns: { healthy: true, timestamp }.
        const health = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                } else {
                    resolve(response?.healthy === true);
                }
            });
        });
        if (health) return true;

        const files = getContentScriptFiles(tabUrl || '');
        await chrome.scripting.executeScript({
            target: { tabId },
            files
        });
        logPopup('debug', 'Content script injected', { fileCount: files.length });
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
            if (DOM.platformStatus) DOM.platformStatus.textContent = "No Tab";
            return;
        }

        const supportedUrls = ['perplexity.ai', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'chat.deepseek.com'];
        const isSupported = supportedUrls.some(domain => tab.url.includes(domain));

        if (!isSupported) {
            if (DOM.platformStatus) DOM.platformStatus.textContent = "Unsupported";
            return;
        }

        // Try to communicate with content script
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, async (response) => {
            if (chrome.runtime.lastError) {
                logPopup('debug', 'Content script not ready, injecting...');

                // Fix #3: Inject content script and retry
                const injected = await ensureContentScript(tab.id, tab.url);
                if (injected) {
                    // Wait for script to initialize
                    await new Promise(r => setTimeout(r, 500));

                    // Retry communication
                    chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, (retryResponse) => {
                        if (retryResponse && retryResponse.success) {
                            currentPlatform = retryResponse.platform;
                            if (DOM.platformStatus) DOM.platformStatus.textContent = currentPlatform;
                        } else {
                            if (DOM.platformStatus) DOM.platformStatus.textContent = "Refresh Page";
                        }
                    });
                } else {
                    if (DOM.platformStatus) DOM.platformStatus.textContent = "Refresh Page";
                }
                return;
            }

            if (response && response.success) {
                currentPlatform = response.platform;
                logPopup('info', 'Platform detected', { platform: currentPlatform });
                if (DOM.platformStatus) DOM.platformStatus.textContent = currentPlatform;
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

// NOTE: buildNotionProperties is defined once below (near getNotionDatabaseSchema)
// The previous duplicate definition was removed — Bug 2 fix.

// Sync to Notion API
async function syncToNotionAPI(data, apiKey, dbId) {
    const entries = data.detail?.entries || [];
    let children = [];

    // Use rich block builder if available, otherwise fall back to basic blocks
    if (typeof NotionBlockBuilder !== 'undefined') {
        children = NotionBlockBuilder.buildNotionBlocks(entries, currentPlatform || 'AI', {
            title: data.title,
            url: data.url || '',
            model: data.detail?.model || '',
            exportDate: new Date().toISOString().split('T')[0]
        });
    } else {
        // Fallback: basic block generation
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

            let answer = '';
            if (entry.blocks && Array.isArray(entry.blocks)) {
                entry.blocks.forEach(block => {
                    if (block.markdown_block) {
                        answer += (block.markdown_block.answer || block.markdown_block.chunks?.join('\n') || '') + '\n\n';
                    }
                });
            }
            if (!answer.trim()) answer = entry.answer || entry.text || '';

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
    }

    // Create Notion page with dynamic properties and throttling
    const properties = await buildNotionProperties(data, dbId, apiKey, entries);

    const response = await withRetry(async () => {
        const res = await notionRateLimiter.throttle(async () => {
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
                    children: children.slice(0, 100) // Notion max per request
                })
            });
        });
        // Throw on rate-limit / service-unavailable so withRetry will back off and retry
        if (res.status === 429 || res.status === 503) {
            throw new Error(`Rate limited (${res.status})`);
        }
        return res;
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(NotionErrorMapper.map(error));
    }

    const pageData = await response.json();
    const pageId = pageData?.id;

    // Err 1 fix: append remaining blocks beyond the first 100 (Notion limit per POST)
    if (pageId && children.length > 100) {
        const notionHeaders = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        };
        for (let i = 100; i < children.length; i += 100) {
            const batch = children.slice(i, i + 100);
            try {
                // Use withRetry + rateLimiter (same as the initial POST) so 429s are handled
                // instead of silently dropping blocks.
                await withRetry(async () => {
                    const patchResp = await notionRateLimiter.throttle(async () => {
                        return await fetch(
                            `https://api.notion.com/v1/blocks/${pageId}/children`,
                            { method: 'PATCH', headers: notionHeaders, body: JSON.stringify({ children: batch }) }
                        );
                    });
                    if (patchResp.status === 429 || patchResp.status >= 500) {
                        const retryAfterHeader = patchResp.headers.get('Retry-After');
                        let delayMs = 2000; // default fallback delay in ms
                        if (retryAfterHeader != null) {
                            const retryAfterSeconds = Number.parseFloat(retryAfterHeader);
                            if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
                                // Convert to ms and ensure we don't go below our default fallback
                                delayMs = Math.max(retryAfterSeconds * 1000, 2000);
                            }
                        }
                        await new Promise(r => setTimeout(r, delayMs));
                        throw new Error(`Notion rate limit (${patchResp.status}) on PATCH batch ${i}`);
                    }
                    if (!patchResp.ok) {
                        throw new Error(`Failed to append block batch ${i}–${i + batch.length}: ${patchResp.status}`);
                    }
                });
            } catch (patchErr) {
                console.warn(`[Popup] PATCH batch ${i} failed after retries:`, patchErr.message);
                break; // partial append — don't fail the whole export
            }
        }
    }

    return pageData;
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
    chrome.runtime.openOptionsPage();
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
    const statusEl = DOM.syncStatus || document.getElementById('syncStatus');
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
    const url = getPlatformUrl(currentPlatform, data.uuid); // Bug 7 fix: platform-aware URL

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
                if (block.markdown_block) {
                    answer += (block.markdown_block.answer || block.markdown_block.chunks?.join('\n') || '') + '\n\n';
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setStatus(message, type) {
    const el = DOM.status || document.getElementById('status');
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
    // Bug 3 fix: key must be 'Title' (capital T) to match auto-created DB schema
    const properties = {
        'Title': { title: [{ type: "text", text: { content: (data.title || 'Chat').slice(0, 2000) } }] }
    };
    try {
        const schema = await getNotionDatabaseSchema(dbId, apiKey);
        if (!schema || !schema.properties) return properties;
        const availableProps = schema.properties;
        if (availableProps['URL'] && data.uuid) {
            // Bug 2/7 fix: use platform-aware URL via shared helper
            properties.URL = { url: getPlatformUrl(currentPlatform, data.uuid) };
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
