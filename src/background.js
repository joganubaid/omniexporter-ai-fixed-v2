// OmniExporter AI - Enterprise Edition v5.2.0
// background.js - Enterprise Background Service Worker (Phase 10-12)
"use strict";

try {
    // background.js lives in src/ — paths are relative to src/
    importScripts('utils/logger.js');
} catch (e) {
    console.error("[OmniExporter] Failed to load logger.js:", e);
}

// Logger fallback stub — if logger.js failed to load, define a no-op Logger
// so the rest of the service worker doesn't crash with "Logger is not defined"
if (typeof Logger === 'undefined') {
    console.warn("[OmniExporter] Logger not available, using fallback stub");
    var Logger = {
        _stub: true,
        config: { enabled: false },
        init() { return Promise.resolve(); },
        info() {},
        warn() {},
        error(mod, msg, data) { console.error(`[${mod}]`, msg, data || ''); },
        debug() {},
        receiveLog() {},
        time() { return { end() { return 0; } }; }
    };
}

// config.js is gitignored — may not exist on fresh clone
// Extension uses defaults from auth/notion-oauth.js if config.js is missing
try {
    importScripts('config.js');
} catch (e) {
    console.warn("[OmniExporter] config.js not found — using default configuration. Copy config.example.js to config.js to customize.");
}

try {
    // auth/ is at root level — one level up from src/
    importScripts('../auth/notion-oauth.js');
} catch (e) {
    console.error("[OmniExporter] Failed to load auth/notion-oauth.js:", e);
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

// REAL-10 FIX: Guard keepAlive alarm so it's never created twice.
function createKeepAliveAlarm() {
    chrome.alarms.get(KEEP_ALIVE_ALARM, (existing) => {
        if (!existing) chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.4 });
    });
}

chrome.runtime.onInstalled.addListener(() => {
    console.log("OmniExporter AI Service Worker Installed");

    createKeepAliveAlarm();

    // Initialize default settings
    chrome.storage.local.get(['autoSyncEnabled', 'syncInterval'], (res) => {
        if (res.autoSyncEnabled) {
            const interval = res.syncInterval || 60;
            chrome.alarms.create('autoSyncAlarm', { periodInMinutes: interval });
            console.log(`Auto-sync alarm set for every ${interval} minutes`);
        }
    });

    // Create context menus
    setupContextMenus();
});

// Also create keep-alive and context menus on startup (service worker restarts)
// BUG-12 FIX: onInstalled is NOT called on SW restart — must re-register here.
chrome.runtime.onStartup.addListener(() => {
    createKeepAliveAlarm();
    setupContextMenus();
    Logger.info('System', 'Service worker started up');
});

/**
 * BUG-12 FIX: Create context menus safely, removing any existing ones first.
 * Called from both onInstalled and onStartup.
 */
function setupContextMenus() {
    const docPatterns = [
        'https://www.perplexity.ai/*',
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
        'https://grok.com/*',
        'https://x.com/i/grok/*',
        'https://chat.deepseek.com/*'
    ];
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'exportThread',
            title: 'Export this thread with OmniExporter',
            contexts: ['page'],
            documentUrlPatterns: docPatterns
        });
    });
}

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
    // MIN-2 FIX: Return null for unknown platform instead of silently returning Perplexity URL.
    return urls[platform] || null;
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

// BUG-4 FIX: Guard alarm creation — SW restarts often and duplicate alarms cause errors.
chrome.alarms.get('storageCleanup', (existing) => {
    if (!existing) chrome.alarms.create('storageCleanup', { periodInMinutes: 5 });
});

// ============================================
// AUTO-SYNC IMPLEMENTATION (Incremental with Checkpoints)
// ============================================

// Note: auth/notion-oauth.js is already loaded via importScripts at the top of this file.


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
    // Totals across all platforms (for summary logging / recordSyncJob)
    let totalThreads = 0;
    let totalNewThreads = 0;
    let totalSuccessCount = 0;
    let totalFailedCount = 0;
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

            // BUG-7 FIX: Iterate all open AI tabs instead of only the first.
            // Build a map of platform -> tab so each platform is processed once per run.
            const platformTabMap = new Map();
            for (const t of tabs) {
                const p = t.url.includes('perplexity') ? 'Perplexity'
                    : t.url.includes('chatgpt') || t.url.includes('openai') ? 'ChatGPT'
                    : t.url.includes('claude') ? 'Claude'
                    : t.url.includes('gemini') ? 'Gemini'
                    : t.url.includes('grok') || t.url.includes('x.com') ? 'Grok'
                    : t.url.includes('deepseek') ? 'DeepSeek'
                    : null;
                if (p && !platformTabMap.has(p)) platformTabMap.set(p, t);
            }

            // REAL-2 FIX: Single shared Set lives outside the platform loop.
            // Threads exported in the ChatGPT iteration are visible to the Claude iteration.
            const sharedExportedUuids = new Set(settings.exportedUuids || []);

            // Process each unique platform tab
            for (const [platform, tab] of platformTabMap) {

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
                await recordSyncJob(threads?.length || 0, 0, 1, 0);
                continue;
            }

            // REAL-2 FIX: Use sharedExportedUuids (defined once before loop) so each platform
            // sees UUIDs synced by previous platforms in this same run.
            const newThreads = threads.filter(t => !sharedExportedUuids.has(t.uuid));

            Logger.info('AutoSync', `Found ${newThreads.length} new threads since checkpoint`,
                { total: threads.length, newCount: newThreads.length, platform });

            // REAL-1 + REAL-4 FIX: Retry logic now uses syncFailures object.
            // trackFailure() writes to this key — reads now match what's written.
            // retryThreads pulls from syncFailures storage, NOT from current API response.
            // This catches threads that failed in PREVIOUS runs (may not appear in current API results).
            const platformThreadUuids = new Set(threads.map(t => t.uuid));
            const { syncFailures = {} } = await chrome.storage.local.get('syncFailures');
            // Derive platform-scoped failures:
            // - If syncFailures[platform] is an object of { uuid -> count }, use that.
            // - Else, if syncFailures is a flat { uuid -> count }, restrict to UUIDs
            //   that belong to this platform's threads to avoid cross-platform retries.
            let platformFailures = {};
            const maybePlatformFailures = syncFailures && typeof syncFailures[platform] === 'object'
                ? syncFailures[platform]
                : null;
            if (maybePlatformFailures && Object.values(maybePlatformFailures).every(v => typeof v === 'number')) {
                platformFailures = maybePlatformFailures;
            } else if (syncFailures && Object.values(syncFailures).every(v => typeof v === 'number')) {
                platformFailures = Object.fromEntries(
                    Object.entries(syncFailures).filter(([uuid]) => platformThreadUuids.has(uuid))
                );
            }
            // Build retry list: UUIDs for this platform that are NOT yet exported, attempt count < 3
            const retryUuids = Object.entries(platformFailures)
                .filter(([uuid, count]) => !sharedExportedUuids.has(uuid) && count < 3)
                .map(([uuid]) => uuid);

            // Merge: newThreads + any retry UUID not already in newThreads
            const newUuidSet = new Set(newThreads.map(t => t.uuid));
            for (const uuid of retryUuids) {
                if (!newUuidSet.has(uuid)) {
                    // We don't have full thread metadata from storage — use minimal stub
                    // so EXTRACT_CONTENT_BY_UUID can fetch full detail
                    newThreads.push({ uuid, title: `(retry) ${uuid}`, platform });
                    newUuidSet.add(uuid);
                }
            }

            if (newThreads.length === 0) {
                await updateSyncCheckpoint(platform, Date.now(), null);
                await recordSyncJob(threads.length, 0, 0, 0);
                continue;
            }

            let successCount = 0, failedCount = 0;
            // REAL-3 FIX: Removed Math.min(..., 10) cap — MAX_THREADS_PER_RUN controls the limit.
            const BATCH_SIZE = 5;
            const MAX_THREADS_PER_RUN = 50;

            // Process in batches — REAL-3 FIX: no artificial 10-thread cap
            for (let i = 0; i < Math.min(newThreads.length, MAX_THREADS_PER_RUN); i += BATCH_SIZE) {
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
                            totalSuccessCount++;
                            sharedExportedUuids.add(thread.uuid); // REAL-2: update shared Set
                        } else {
                            failedCount++;
                            totalFailedCount++;
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
                        totalFailedCount++;
                        console.error(`[AutoSync] Error syncing ${thread.uuid}:`, e);
                    }
                }

                // Brief pause between batches
                await new Promise(r => setTimeout(r, 2000));
            }

            // Update checkpoint
            await updateSyncCheckpoint(platform, Date.now(), newThreads[0]?.uuid);

            // Aggregate per-platform counts into global totals
            if (Array.isArray(newThreads)) {
                totalNewThreads += newThreads.length;
            }
            if (typeof threads !== 'undefined' && Array.isArray(threads)) {
                totalThreads += threads.length;
            } else if (Array.isArray(newThreads)) {
                // Fallback if threads is not available; approximate with newThreads
                totalThreads += newThreads.length;
            }

            } // end for (const [platform, tab] of platformTabMap)

            // REAL-2 FIX: Save shared exportedUuids once after all platforms processed
            await chrome.storage.local.set({
                lastSyncDate: new Date().toISOString(),
                exportedUuids: Array.from(sharedExportedUuids)
            });

            // REAL-11 FIX: Pass total threads (including already-exported) so skipped is correct
            // recordSyncJob will compute skipped = total - attempted
            await recordSyncJob(
                totalThreads || totalNewThreads,
                totalSuccessCount,
                totalFailedCount,
                totalNewThreads
            );
            console.log(`[AutoSync] All platforms complete: ${totalSuccessCount} synced, ${totalFailedCount} failed`);



        } catch (e) {
            console.error("[AutoSync] Error:", e);
        }
    } finally {
        // Always release the lock (BUG-1 FIX: runs even on early errors)
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
                // BUG-8 FIX: Use the conversation's actual date instead of today.
                const rawDate = data.detail?.last_query_datetime
                    || data.detail?.entries?.[0]?.created_datetime
                    || data.detail?.entries?.[0]?.last_query_datetime;
                const chatDate = rawDate
                    ? new Date(rawDate).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0];
                properties['Chat Time'] = { date: { start: chatDate } };
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
            // REAL-5 FIX: Accept any block with a markdown_block — don't require intended_usage.
            // Gemini/Grok/DeepSeek entries go through normalizeEntries() which wraps answers in
            // blocks[0].markdown_block.answer WITHOUT an intended_usage field.
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

// REAL-11 FIX: 4th param `attempted` = threads actually processed (new + retry).
// `total` should be the full threads.length including already-exported ones.
// skipped = total - attempted (shows how many were already exported).
async function recordSyncJob(total, success, failed, attempted = total) {
    const { exportHistory = [] } = await chrome.storage.local.get('exportHistory');

    exportHistory.unshift({
        timestamp: new Date().toISOString(),
        total,
        attempted,
        success,
        failed,
        skipped: total - attempted,
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

// REAL-4 FIX: trackFailure now writes to BOTH:
//   'failures' (array, for Activity Log display)
//   'syncFailures' (object uuid→count, for retry logic reads)
async function trackFailure(failure) {
    const [{ failures = [] }, { syncFailures = {} }] = await Promise.all([
        chrome.storage.local.get('failures'),
        chrome.storage.local.get('syncFailures')
    ]);

    failures.push({ ...failure, timestamp: new Date().toISOString() });
    if (failures.length > 100) failures.shift();

    // Increment retry counter for this UUID
    syncFailures[failure.uuid] = (syncFailures[failure.uuid] || 0) + 1;

    await chrome.storage.local.set({ failures, syncFailures });
}

// ============================================
// CONTEXT MENU CLICK HANDLER
// ============================================

// REAL-6 FIX: Context menu now actually triggers a download.
// After extracting, send EXPORT_THREAD back to the content script which calls ExportManager.export().
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'exportThread') {
        chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTENT' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[ContextMenu] Extract failed:', chrome.runtime.lastError.message);
                return;
            }
            if (response && response.success) {
                console.log('[ContextMenu] Extracted:', response.data.title, '— triggering download');
                // Send the extracted data back to content script for download via ExportManager
                chrome.tabs.sendMessage(tab.id, {
                    type: 'EXPORT_THREAD',
                    payload: { data: response.data, format: 'markdown' }
                });
            } else {
                console.warn('[ContextMenu] Extract unsuccessful:', response?.error);
            }
        });
    }
});

// ============================================
// KEYBOARD SHORTCUTS (Commands)
// ============================================
chrome.commands.onCommand.addListener((command) => {
    if (command === 'open_dashboard') {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/options.html') });
        Logger.info('System', 'Dashboard opened via keyboard shortcut');
    }
});
