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

// FIX #1: Changed from 0.4 to 1 minute — Chrome enforces a 1-minute minimum for production
// (non-developer-mode) extensions. 0.4 minutes only works when loaded unpacked.
// Guard with chrome.alarms.get to prevent duplicates (FIX #10).
function createKeepAliveAlarm() {
    chrome.alarms.get(KEEP_ALIVE_ALARM, (existing) => {
        if (!existing) chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
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

// FIX #3: Sync lock is now validated against chrome.storage on every acquire.
// Without this, if the SW terminates mid-sync and restarts, globalSyncInProgress resets to
// false — allowing a new sync to start while the previous run’s Notion requests are still in-flight.
let globalSyncInProgress = false;

async function acquireSyncLock() {
    // Check in-memory first (fastest path — same SW instance)
    if (globalSyncInProgress) {
        console.log('[Sync] Another sync is in progress (in-memory), skipping');
        return false;
    }
    // Cross-restart check: verify storage state wasn’t left dirty by a crashed SW
    const { syncInProgress, syncStartTime } = await chrome.storage.local.get(['syncInProgress', 'syncStartTime']);
    if (syncInProgress) {
        const age = Date.now() - (syncStartTime || 0);
        // If lock is older than 10 minutes, treat as stale and override
        if (age < 10 * 60 * 1000) {
            console.log('[Sync] Sync in progress per storage (age: ' + Math.round(age/1000) + 's), skipping');
            return false;
        }
        console.warn('[Sync] Stale lock detected (' + Math.round(age/60000) + 'min), overriding');
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
                await recordSyncJob(0, 0, 1); // Log failure
                continue; // BUG-1 FIX: Do not return — continue to next platform tab
            }
            const exportedUuids = new Set(settings.exportedUuids || []);

            // Filter out already exported
            const newThreads = threads.filter(t => !exportedUuids.has(t.uuid));

            Logger.info('AutoSync', `Found ${newThreads.length} new threads since checkpoint`, { total: threads.length, newCount: newThreads.length });

            // MISSING-4 FIX: Also include previously-failed threads (up to 3 retries).
            const { syncFailures = {} } = await chrome.storage.local.get('syncFailures');
            const retryThreads = threads.filter(t =>
                !exportedUuids.has(t.uuid) &&
                syncFailures[t.uuid] && syncFailures[t.uuid] < 3
            );

            if (newThreads.length === 0 && retryThreads.length === 0) {
                // Update checkpoint even if no new threads
                await updateSyncCheckpoint(platform, Date.now(), null);

                // Log empty run so user sees it in Activity Log
                await recordSyncJob(0, 0, 0);
                continue; // BUG-7 FIX: Move to next platform instead of returning
            }

            // Merge new + retry candidates (deduped)
            const seenUuids = new Set(newThreads.map(t => t.uuid));
            for (const t of retryThreads) {
                if (!seenUuids.has(t.uuid)) { seenUuids.add(t.uuid); newThreads.push(t); }
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
            console.log(`[AutoSync] ${platform} complete: ${successCount} synced, ${failedCount} failed`);

            } // end for (const [platform, tab] of platformTabMap)

        } catch (e) {
            console.error("[AutoSync] Error:", e);
        }
    } finally {
        // Always release the lock (BUG-1 FIX: runs even on early errors)
        await releaseSyncLock();
    }
}

/**
 * FIX #5: Notion-specific fetch with exponential backoff on 429.
 * Notion rate-limits at ~3 requests/second. A flat 1s delay is not retry logic.
 */
async function notionFetchWithBackoff(url, options, maxRetries = 4) {
    let delay = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(url, options);
        if (response.status !== 429 && response.status !== 503) return response;
        const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : delay;
        console.warn(`[Notion] Rate limited (${response.status}), waiting ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
        delay = Math.min(delay * 2, 30000); // cap at 30s
    }
    // Final attempt after max retries
    return fetch(url, options);
}

async function syncToNotion(data, settings) {
    try {
        const entries = data.detail?.entries || [];
        const children = [];
        const token = await NotionOAuth.getActiveToken();
        const notionHeaders = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        };

        // Fetch database schema to know which properties exist
        let dbSchema = null;
        try {
            const schemaResponse = await notionFetchWithBackoff(
                `https://api.notion.com/v1/databases/${settings.notionDbId}`,
                { headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' } }
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
                if (prop.type === 'title') { titlePropertyName = name; break; }
            }
        }

        const properties = {};
        properties[titlePropertyName] = {
            title: [{ type: "text", text: { content: (data.title || "Untitled").slice(0, 2000) } }]
        };

        if (dbSchema?.properties) {
            if (dbSchema.properties['URL']?.type === 'url')
                properties['URL'] = { url: getPlatformUrl(data.platform, data.uuid) };
            if (dbSchema.properties['Tags']?.type === 'multi_select')
                properties['Tags'] = { multi_select: [{ name: data.platform || 'AI' }] };
            if (dbSchema.properties['Platform']?.type === 'select')
                properties['Platform'] = { select: { name: data.platform || 'AI' } };
            if (dbSchema.properties['Chat Time']?.type === 'date') {
                const rawDate = data.detail?.last_query_datetime
                    || data.detail?.entries?.[0]?.created_datetime
                    || data.detail?.entries?.[0]?.last_query_datetime;
                const chatDate = rawDate
                    ? new Date(rawDate).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0];
                properties['Chat Time'] = { date: { start: chatDate } };
            }
            if (dbSchema.properties['Exported']?.type === 'date')
                properties['Exported'] = { date: { start: new Date().toISOString().split('T')[0] } };
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
                    heading_2: { rich_text: [{ type: "text", text: { content: query.slice(0, 2000) } }] }
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
                children.push({
                    type: "paragraph",
                    paragraph: { rich_text: [{ type: "text", text: { content: answer.slice(0, 1900) } }] }
                });
            }
        });

        console.log('[AutoSync] Creating page with', children.length, 'blocks');

        // FIX #2: POST the first 100 blocks only (Notion per-request limit).
        // Then PATCH /v1/blocks/{page_id}/children for any remaining blocks in batches of 100.
        const firstBatch = children.slice(0, 100);
        const response = await notionFetchWithBackoff('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: notionHeaders,
            body: JSON.stringify({
                parent: { database_id: settings.notionDbId },
                properties,
                children: firstBatch
            })
        });

        // FIX #6: Check content-type before calling .json() — Cloudflare Turnstile
        // challenges return text/html on captcha-blocked endpoints, which throws on .json().
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok) {
            let errMsg = `HTTP ${response.status}`;
            if (contentType.includes('application/json')) {
                const err = await response.json();
                errMsg = err.message || err.code || errMsg;
                console.error('[AutoSync] Notion API Error:', err);
            } else {
                const text = await response.text();
                // HTML response = likely Cloudflare challenge / bot detection
                if (text.includes('<html')) {
                    errMsg = 'Cloudflare challenge detected — please open the Notion tab and refresh';
                    console.warn('[AutoSync] Notion returned HTML (likely Cloudflare block)');
                } else {
                    errMsg = text.slice(0, 200);
                }
            }
            return { success: false, error: errMsg };
        }

        const pageData = contentType.includes('application/json') ? await response.json() : null;
        const pageId = pageData?.id;

        // Append remaining blocks in batches of 100 if page was created successfully
        if (pageId && children.length > 100) {
            for (let i = 100; i < children.length; i += 100) {
                const batch = children.slice(i, i + 100);
                await new Promise(r => setTimeout(r, 350)); // Notion rate limit
                const patchResp = await notionFetchWithBackoff(
                    `https://api.notion.com/v1/blocks/${pageId}/children`,
                    {
                        method: 'PATCH',
                        headers: notionHeaders,
                        body: JSON.stringify({ children: batch })
                    }
                );
                if (!patchResp.ok) {
                    console.warn(`[AutoSync] Failed to append block batch ${i}-${i+100}`);
                    break; // partial append — don't fail the whole sync
                }
            }
        }

        console.log('[AutoSync] ✓ Page created successfully', pageId ? `(id: ${pageId})` : '');
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
// CONTEXT MENU CLICK HANDLER
// ============================================

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
        chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/options.html') });
        Logger.info('System', 'Dashboard opened via keyboard shortcut');
    }
});
