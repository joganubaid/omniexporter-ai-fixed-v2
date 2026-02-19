// OmniExporter AI - Enterprise Edition v5.0
// background.js - Enterprise Background Service Worker (Phase 10-12)

try {
    importScripts('logger.js', 'config.js', 'auth/notion-oauth.js');
} catch (e) {
    console.error("Failed to load dependencies:", e);
}

// Initialize logger for background script
Logger.init().then(() => {
    Logger.info('System', 'OmniExporter AI Service Worker Active');
}).catch(e => console.error('Logger init failed:', e));

console.log("OmniExporter AI Service Worker Active");

// ============================================
// SERVICE WORKER KEEP-ALIVE (MV3 Fix)
// MV3 service workers terminate after ~30s of inactivity
// We use a periodic alarm to keep it responsive
// ============================================
const KEEP_ALIVE_ALARM = 'keepAlive';

chrome.runtime.onInstalled.addListener(() => {
    console.log("OmniExporter AI Service Worker Installed");

    // Create keep-alive alarm (every 25 seconds)
    chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });

    // Initialize default settings
    chrome.storage.local.get(['autoSyncEnabled', 'syncInterval'], (res) => {
        if (res.autoSyncEnabled) {
            const interval = res.syncInterval || 60;
            chrome.alarms.create('autoSyncAlarm', { periodInMinutes: interval });
            console.log(`Auto-sync alarm set for every ${interval} minutes`);
        }
    });
});

// Also create keep-alive on startup (service worker restarts)
chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });
    Logger.info('System', 'Service worker started up');
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
        // Keep-alive ping - just log occasionally
        // This prevents the service worker from going inactive
        return;
    }

    if (alarm.name === 'autoSyncAlarm') {
        console.log("Auto-sync alarm triggered");
        performAutoSync();
    }

    if (alarm.name === 'storageCleanup') {
        enforceStorageLimit();
    }
});

// ============================================
// PHASE 7: RESILIENT DATA EXTRACTOR (for background.js)
// ============================================
class ResilientDataExtractor {
    static extractAnswer(entry) {
        // Strategy 1: Perplexity blocks structure
        if (entry.blocks && Array.isArray(entry.blocks)) {
            for (const block of entry.blocks) {
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    const answer = block.markdown_block.answer ||
                        (block.markdown_block.chunks || []).join('\n');
                    if (answer) return answer;
                }
                if (block.text_block?.content) return block.text_block.content;
            }
        }
        // Strategy 2: Direct properties
        if (entry.answer) return entry.answer;
        if (entry.text) return entry.text;
        if (entry.content) return typeof entry.content === 'string' ? entry.content : '';
        if (entry.response?.text) return entry.response.text;
        return '';
    }

    static extractQuery(entry) {
        return entry.query || entry.query_str || entry.question || entry.prompt || '';
    }
}

// ============================================
// PLATFORM URL GENERATOR
// ============================================
function getPlatformUrl(platform, uuid) {
    const urls = {
        'Perplexity': `https://www.perplexity.ai/search/${uuid}`,
        'ChatGPT': `https://chatgpt.com/c/${uuid}`,
        'Claude': `https://claude.ai/chat/${uuid}`,
        'Gemini': `https://gemini.google.com/app/${uuid}`,
        'Grok': `https://grok.com/conversation/${uuid}`,
        'DeepSeek': `https://chat.deepseek.com/c/${uuid}`
    };
    return urls[platform] || urls['Perplexity'];
}

// ============================================
// GLOBAL SYNC LOCK (Fix #1)
// ============================================
let globalSyncInProgress = false;

async function acquireSyncLock() {
    if (globalSyncInProgress) {
        console.log('[Sync] Another sync is in progress, skipping');
        return false;
    }
    globalSyncInProgress = true;
    await chrome.storage.local.set({ syncInProgress: true, syncStartTime: Date.now() });
    return true;
}

async function releaseSyncLock() {
    globalSyncInProgress = false;
    await chrome.storage.local.set({ syncInProgress: false, syncStartTime: null });
}

// ============================================
// ALARM CLEANUP (Fix #2)
// ============================================
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        // SECURITY: Clear logs when debug mode is disabled
        if (changes.debugMode && changes.debugMode.newValue === false) {
            console.log('[Security] Debug mode disabled - clearing all logs');
            chrome.storage.local.remove([
                'omniLogs',
                'logEntries',
                'testHistory',
                'debugLogs'
            ]);
        }

        // Handle Auto-Sync Toggle
        if (changes.autoSyncEnabled) {
            if (changes.autoSyncEnabled.newValue === true) {
                // Enable: Create alarm
                chrome.storage.local.get('syncInterval', (res) => {
                    const interval = res.syncInterval || 60;
                    chrome.alarms.create('autoSyncAlarm', { periodInMinutes: interval });
                    console.log(`[Alarm] Auto-sync enabled. Alarm set for every ${interval} minutes`);
                    performAutoSync(); // Trigger immediate sync
                });
            } else {
                // Disable: Clear alarm
                chrome.alarms.clear('autoSyncAlarm');
                console.log('[Alarm] Auto-sync alarm cleared');
            }
        }

        // Update alarm interval if changed
        if (changes.syncInterval && changes.syncInterval.newValue) {
            chrome.storage.local.get('autoSyncEnabled', (res) => {
                if (res.autoSyncEnabled) {
                    const interval = changes.syncInterval.newValue;
                    chrome.alarms.create('autoSyncAlarm', { periodInMinutes: interval });
                    console.log(`[Alarm] Interval updated to ${interval} minutes`);
                }
            });
        }

        // Clear alarm when Notion credentials removed
        if ((changes.notionApiKey && !changes.notionApiKey.newValue) ||
            (changes.notionKey && !changes.notionKey.newValue)) {
            chrome.alarms.clear('autoSyncAlarm');
            console.log('[Alarm] Alarm cleared - Notion key removed');
        }
    }
});

// ============================================
// STORAGE LIMIT ENFORCEMENT (Prevent Memory Overflow)
// ============================================
async function enforceStorageLimit() {
    try {
        const MAX_STORAGE_MB = 5; // 5MB limit for logs
        const bytes = await chrome.storage.local.getBytesInUse(['omniLogs']);
        const mb = bytes / (1024 * 1024);

        if (mb > MAX_STORAGE_MB) {
            console.log(`[Security] Storage limit exceeded (${mb.toFixed(2)}MB > ${MAX_STORAGE_MB}MB) - trimming logs`);
            const { omniLogs = [] } = await chrome.storage.local.get('omniLogs');
            // Keep only last 50% of logs
            const trimmed = omniLogs.slice(Math.floor(omniLogs.length / 2));
            await chrome.storage.local.set({ omniLogs: trimmed });
        }
    } catch (e) {
        console.warn('[Security] Storage limit check failed:', e.message);
    }
}

// Check storage limits periodically (every 5 minutes)
chrome.alarms.create('storageCleanup', { periodInMinutes: 5 });

// ============================================
// AUTO-SYNC IMPLEMENTATION (Incremental with Checkpoints)
// ============================================

// Load OAuth module in service worker context
if (typeof importScripts === 'function') {
    importScripts('auth/notion-oauth.js');
}


/**
 * Get sync checkpoint for a platform
 */
async function getSyncCheckpoint(platform) {
    const { syncCheckpoints = {} } = await chrome.storage.local.get('syncCheckpoints');
    return syncCheckpoints[platform] || { lastSyncTime: 0, lastUuid: null };
}

/**
 * Update sync checkpoint after successful sync
 */
async function updateSyncCheckpoint(platform, lastSyncTime, lastUuid) {
    const { syncCheckpoints = {} } = await chrome.storage.local.get('syncCheckpoints');
    syncCheckpoints[platform] = { lastSyncTime, lastUuid, updatedAt: Date.now() };
    await chrome.storage.local.set({ syncCheckpoints });
}

/**
 * Fetch threads from content script
 * Note: We fetch ALL threads and let exportedUuids handle filtering
 * This ensures threads that were never synced still get picked up
 */
async function fetchThreadsSinceCheckpoint(tabId, platform, checkpoint) {
    return new Promise((resolve) => {
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
            console.warn('[AutoSync] Timeout waiting for content script response');
            resolve({ threads: [], hasMore: false });
        }, 30000);

        chrome.tabs.sendMessage(tabId, {
            type: 'GET_THREAD_LIST',
            payload: { page: 1, limit: 50 }
        }, (response) => {
            clearTimeout(timeout);

            if (chrome.runtime.lastError) {
                console.error('[AutoSync] Message error:', chrome.runtime.lastError.message);
                resolve({ threads: [], hasMore: false });
                return;
            }

            if (!response || !response.success) {
                console.warn('[AutoSync] Content script returned unsuccessful response:', response?.error);
                resolve({ threads: [], hasMore: false });
            } else {
                // Return ALL threads - filtering by exportedUuids happens in performAutoSync
                // This ensures threads that were never synced will be picked up
                const threads = response.data.threads || [];
                console.log(`[AutoSync] Content script returned ${threads.length} threads`);
                resolve({ threads, hasMore: response.data.hasMore });
            }
        });
    });
}

async function performAutoSync() {
    console.log('[AutoSync] performAutoSync initiated');
    // Fix #1: Acquire global lock before sync
    if (!(await acquireSyncLock())) {
        return; // Another sync is in progress
    }

    try {
        const settings = await chrome.storage.local.get([
            'autoSyncEnabled', 'autoSyncNotion', 'notionApiKey', 'notionKey', 'notionDbId', 'exportedUuids', 'notion_auth_method'
        ]);

        Logger.debug('AutoSync', 'Settings loaded', { enabled: settings.autoSyncEnabled, dbId: settings.notionDbId ? 'Present' : 'Missing', notionAuth: settings.notion_auth_method });

        if (!settings.autoSyncEnabled || !settings.notionDbId) {
            Logger.warn('AutoSync', 'Skipped: Not configured or disabled');
            await releaseSyncLock();
            return;
        }

        if (typeof NotionOAuth === 'undefined') {
            console.log("[AutoSync] Skipped: OAuth module not loaded");
            await releaseSyncLock();
            return;
        }

        let authToken;
        try {
            authToken = await NotionOAuth.getActiveToken();
        } catch (error) {
            console.log("[AutoSync] Skipped: Notion auth missing", error.message);
            await releaseSyncLock();
            return;
        }

        Logger.info('AutoSync', 'Starting incremental sync...');

        try {
            // Find AI platform tabs - ALL 6 PLATFORMS
            const tabs = await chrome.tabs.query({
                url: [
                    "https://www.perplexity.ai/*",
                    "https://chatgpt.com/*",
                    "https://chat.openai.com/*",
                    "https://claude.ai/*",
                    "https://gemini.google.com/*",
                    "https://grok.com/*",
                    "https://x.com/i/grok/*",
                    "https://chat.deepseek.com/*"
                ]
            });

            if (tabs.length === 0) {
                console.log("[AutoSync] ❌ No AI platform tabs found - open an AI site first!");
                await recordSyncJob(0, 0, 0); // Log that we checked
                await releaseSyncLock(); // FIX: Release lock before returning
                return;
            }

            Logger.info('AutoSync', `Found ${tabs.length} AI platform tab(s)`, { platforms: tabs.map(t => t.url.split('/')[2]) });

            const tab = tabs[0];
            const platform = tab.url.includes('perplexity') ? 'Perplexity'
                : tab.url.includes('chatgpt') || tab.url.includes('openai') ? 'ChatGPT'
                    : tab.url.includes('claude') ? 'Claude'
                        : tab.url.includes('gemini') ? 'Gemini'
                            : tab.url.includes('grok') || tab.url.includes('x.com') ? 'Grok'
                                : tab.url.includes('deepseek') ? 'DeepSeek'
                                    : 'Unknown';

            // Get checkpoint for this platform
            const checkpoint = await getSyncCheckpoint(platform);
            console.log(`[AutoSync] Checkpoint for ${platform}:`, checkpoint);

            // Fetch only new threads since checkpoint
            console.log(`[AutoSync] Fetching threads from ${platform}...`);
            let threads;
            try {
                const result = await fetchThreadsSinceCheckpoint(tab.id, platform, checkpoint);
                threads = result.threads || [];
                Logger.info('AutoSync', `Fetched ${threads.length} threads from content script`, { platform });
            } catch (fetchError) {
                Logger.error('AutoSync', 'Failed to fetch threads', { error: fetchError.message });
                await recordSyncJob(0, 0, 1); // Log failure
                return;
            }
            const exportedUuids = new Set(settings.exportedUuids || []);

            // Filter out already exported
            const newThreads = threads.filter(t => !exportedUuids.has(t.uuid));

            Logger.info('AutoSync', `Found ${newThreads.length} new threads since checkpoint`, { total: threads.length, newCount: newThreads.length });

            if (newThreads.length === 0) {
                // Update checkpoint even if no new threads
                await updateSyncCheckpoint(platform, Date.now(), null);

                // Log empty run so user sees it in Activity Log
                await recordSyncJob(0, 0, 0);
                return;
            }

            let successCount = 0, failedCount = 0;
            const BATCH_SIZE = 5;

            // Process in batches
            for (let i = 0; i < Math.min(newThreads.length, 10); i += BATCH_SIZE) {
                const batch = newThreads.slice(i, i + BATCH_SIZE);
                console.log(`[AutoSync] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

                for (const thread of batch) {
                    try {
                        const detailResponse = await new Promise((resolve) => {
                            chrome.tabs.sendMessage(tab.id, {
                                type: 'EXTRACT_CONTENT_BY_UUID',
                                payload: { uuid: thread.uuid }
                            }, resolve);
                        });

                        if (!detailResponse || !detailResponse.success) {
                            failedCount++;
                            await trackFailure({
                                uuid: thread.uuid,
                                reason: detailResponse?.error || 'Failed to extract',
                                platform
                            });
                            continue;
                        }

                        console.log(`[AutoSync] Syncing thread "${detailResponse.data?.title || thread.uuid}" to Notion...`);
                        const syncResult = await syncToNotion(detailResponse.data, settings);

                        if (syncResult.success) {
                            successCount++;
                            exportedUuids.add(thread.uuid);
                        } else {
                            failedCount++;
                            await trackFailure({
                                uuid: thread.uuid,
                                reason: syncResult.error || 'Notion sync failed',
                                platform
                            });
                        }

                        // Rate limiting
                        await new Promise(r => setTimeout(r, 1000));

                    } catch (e) {
                        failedCount++;
                        console.error(`[AutoSync] Error syncing ${thread.uuid}:`, e);
                    }
                }

                // Brief pause between batches
                await new Promise(r => setTimeout(r, 2000));
            }

            // Update checkpoint and exported UUIDs
            await updateSyncCheckpoint(platform, Date.now(), newThreads[0]?.uuid);
            await chrome.storage.local.set({
                lastSyncDate: new Date().toISOString(),
                exportedUuids: Array.from(exportedUuids)
            });

            await recordSyncJob(newThreads.length, successCount, failedCount);
            console.log(`[AutoSync] Complete: ${successCount} synced, ${failedCount} failed`);

        } catch (e) {
            console.error("[AutoSync] Error:", e);
        }
    } finally {
        // Always release the lock
        await releaseSyncLock();
    }
}

async function syncToNotion(data, settings) {
    try {
        const entries = data.detail?.entries || [];
        const children = [];
        const token = await NotionOAuth.getActiveToken();

        // First, fetch database schema to know which properties exist
        let dbSchema = null;
        try {
            const schemaResponse = await fetch(
                `https://api.notion.com/v1/databases/${settings.notionDbId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Notion-Version': '2022-06-28'
                    }
                }
            );
            if (schemaResponse.ok) {
                dbSchema = await schemaResponse.json();
                console.log('[AutoSync] Database properties:', Object.keys(dbSchema.properties || {}));
            }
        } catch (schemaErr) {
            console.warn('[AutoSync] Could not fetch schema, using defaults:', schemaErr.message);
        }

        // Find the title property (could be named differently)
        let titlePropertyName = 'Title';
        if (dbSchema?.properties) {
            for (const [name, prop] of Object.entries(dbSchema.properties)) {
                if (prop.type === 'title') {
                    titlePropertyName = name;
                    break;
                }
            }
        }

        // Build properties dynamically based on what exists in the database
        const properties = {};

        // Title is always required
        properties[titlePropertyName] = {
            title: [{ type: "text", text: { content: (data.title || "Untitled").slice(0, 2000) } }]
        };

        // Only add optional properties if they exist in the schema
        if (dbSchema?.properties) {
            if (dbSchema.properties['URL'] && dbSchema.properties['URL'].type === 'url') {
                properties['URL'] = { url: getPlatformUrl(data.platform, data.uuid) };
            }
            if (dbSchema.properties['Tags'] && dbSchema.properties['Tags'].type === 'multi_select') {
                properties['Tags'] = { multi_select: [{ name: data.platform || 'AI' }] };
            }
            if (dbSchema.properties['Platform'] && dbSchema.properties['Platform'].type === 'select') {
                properties['Platform'] = { select: { name: data.platform || 'AI' } };
            }
            if (dbSchema.properties['Chat Time'] && dbSchema.properties['Chat Time'].type === 'date') {
                properties['Chat Time'] = { date: { start: new Date().toISOString().split('T')[0] } };
            }
            if (dbSchema.properties['Exported'] && dbSchema.properties['Exported'].type === 'date') {
                properties['Exported'] = { date: { start: new Date().toISOString().split('T')[0] } };
            }
        }

        children.push({
            type: "callout",
            callout: {
                icon: { emoji: "🤖" },
                color: "blue_background",
                rich_text: [{ type: "text", text: { content: `Auto-synced from ${data.platform || 'AI'} at ${new Date().toLocaleString()}` } }]
            }
        });
        children.push({ type: "divider", divider: {} });

        entries.slice(0, 5).forEach((entry) => {
            const query = entry.query || entry.query_str || '';
            if (query) {
                children.push({
                    type: "heading_2",
                    heading_2: {
                        rich_text: [{ type: "text", text: { content: query.slice(0, 2000) } }]
                    }
                });
            }

            // Extract answer from blocks or direct properties
            let answer = '';
            if (entry.blocks && Array.isArray(entry.blocks)) {
                entry.blocks.forEach(block => {
                    if (block.intended_usage === 'ask_text' && block.markdown_block) {
                        answer += (block.markdown_block.answer || block.markdown_block.chunks?.join('\n') || '') + '\n\n';
                    }
                });
            }
            if (!answer.trim()) answer = entry.answer || entry.text || '';

            if (answer.trim()) {
                children.push({
                    type: "paragraph",
                    paragraph: {
                        rich_text: [{ type: "text", text: { content: answer.slice(0, 1900) } }]
                    }
                });
            }
        });

        console.log('[AutoSync] Creating page with properties:', Object.keys(properties));

        const response = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify({
                parent: { database_id: settings.notionDbId },
                properties,
                children: children.slice(0, 100) // Notion limit
            })
        });

        if (!response.ok) {
            const err = await response.json();
            console.error('[AutoSync] Notion API Error:', err);
            return { success: false, error: err.message || err.code || 'API Error' };
        }

        console.log('[AutoSync] ✓ Page created successfully');
        return { success: true };
    } catch (e) {
        console.error('[AutoSync] syncToNotion exception:', e);
        return { success: false, error: e.message };
    }
}

async function recordSyncJob(total, success, failed) {
    const { exportHistory = [] } = await chrome.storage.local.get('exportHistory');

    exportHistory.unshift({
        timestamp: new Date().toISOString(),
        total,
        success,
        failed,
        skipped: total - success - failed,
        platform: 'AutoSync',
        type: 'auto'
    });

    // Keep last 50 entries
    if (exportHistory.length > 50) exportHistory.length = 50;

    await chrome.storage.local.set({ exportHistory });
}

// ============================================
// MESSAGE HANDLERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle logs from content scripts
    if (request.type === "LOGGER_STORE_LOG") {
        if (typeof Logger !== 'undefined' && Logger.receiveLog) {
            Logger.receiveLog(request.payload);
        }
        return false; // No response needed
    }

    if (request.type === "LOG_FAILURE") {
        trackFailure(request.payload);
    } else if (request.type === "TRIGGER_SYNC") {
        performAutoSync();
        sendResponse({ success: true });
    }
    return true;
});

async function trackFailure(failure) {
    const { failures = [] } = await chrome.storage.local.get('failures');

    failures.push({
        ...failure,
        timestamp: new Date().toISOString()
    });

    // Keep only last 100 failures
    if (failures.length > 100) failures.shift();

    await chrome.storage.local.set({ failures });
}

// ============================================
// CONTEXT MENU (Optional Enhancement)
// ============================================
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'exportThread',
        title: 'Export this thread with OmniExporter',
        contexts: ['page'],
        documentUrlPatterns: [
            'https://www.perplexity.ai/*',
            'https://chatgpt.com/*',
            'https://chat.openai.com/*',
            'https://claude.ai/*',
            'https://gemini.google.com/*',
            'https://grok.com/*',
            'https://x.com/i/grok/*',
            'https://chat.deepseek.com/*'
        ]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'exportThread') {
        chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
            if (response && response.success) {
                console.log("Thread exported via context menu:", response.data.title);
            }
        });
    }
});

// ============================================
// KEYBOARD SHORTCUTS (Commands)
// ============================================
chrome.commands.onCommand.addListener((command) => {
    if (command === 'open_dashboard') {
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
        Logger.info('System', 'Dashboard opened via keyboard shortcut');
    }
});
