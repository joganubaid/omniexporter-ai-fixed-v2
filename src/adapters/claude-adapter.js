// OmniExporter AI - Claude Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

const ClaudeAdapter = window.ClaudeAdapter = window.ClaudeAdapter || {
    name: "Claude",
    _cachedOrgId: null,

    // Cache for pagination
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    extractUuid: (url) => {
        return platformConfig.extractUuid('Claude', url);
    },

    // ============================================
    // ENTERPRISE: Anti-bot headers
    // ============================================
    _getHeaders: () => {
        return {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;
        const headers = { ...ClaudeAdapter._getHeaders(), ...options.headers };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });

                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to Claude');
                }

                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 2) * 1000;
                    console.warn(`[Claude] Rate limited, waiting ${waitTime}ms`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }

                lastError = new Error(`HTTP ${response.status}`);
            } catch (e) {
                lastError = e;
            }

            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
        throw lastError;
    },

    async getOrgId() {
        if (this._cachedOrgId) return this._cachedOrgId;

        try {
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'organizations');
            const response = await ClaudeAdapter._fetchWithRetry(`${baseUrl}${endpoint}`);

            const orgs = await response.json().catch((e) => { console.warn('[Claude] Failed to parse org response:', e.message); return null; });
            if (!orgs || orgs.length === 0) {
                throw new Error('No Claude organizations found. Please check your login.');
            }

            this._cachedOrgId = orgs[0].uuid;
            console.log(`[Claude] Org found: ${orgs[0].name || this._cachedOrgId}`);
            return this._cachedOrgId;
        } catch (error) {
            console.error('[Claude] org fetch failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Get ALL threads (Load All feature)
    // BUG-6/PERF-1 FIX: Fetch in pages instead of one massive request.
    // Users with 500+ conversations caused timeouts with the previous single-call approach.
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });

            const allThreads = [];
            const seenUuids = new Set();
            let offset = 0;
            const PAGE_SIZE = 50;
            let hasMore = true;
            let pageNum = 0;

            while (hasMore) {
                pageNum++;
                // Safety limit: max 200 pages to prevent runaway loops
                if (pageNum > 200) {
                    console.warn('[Claude] Reached max page limit, stopping pagination');
                    break;
                }
                const pageUrl = `${baseUrl}${endpoint}?limit=${PAGE_SIZE}&offset=${offset}&sort=updated_at&order=desc`;
                const response = await ClaudeAdapter._fetchWithRetry(pageUrl);
                const data = await response.json().catch(() => null);

                const page = Array.isArray(data) ? data : [];
                for (const t of page) {
                    if (!seenUuids.has(t.uuid)) {
                        seenUuids.add(t.uuid);
                        allThreads.push({
                            uuid: t.uuid,
                            title: DataExtractor.extractTitle(t, 'Claude'),
                            last_query_datetime: t.updated_at,
                            platform: 'Claude'
                        });
                    }
                }

                if (progressCallback) progressCallback(allThreads.length, page.length === PAGE_SIZE);

                // Claude returns fewer than PAGE_SIZE items when done
                hasMore = page.length === PAGE_SIZE;
                offset += page.length;

                // Safety cap: 10000 conversations max
                if (allThreads.length >= 10000) break;

                // Brief pause between pages to avoid rate limiting
                if (hasMore) await new Promise(r => setTimeout(r, 300));
            }

            // Update cache
            ClaudeAdapter._allThreadsCache = allThreads;
            ClaudeAdapter._cacheTimestamp = Date.now();

            console.log(`[Claude] getAllThreads complete: ${allThreads.length} conversations`);
            return allThreads;
        } catch (error) {
            console.error('[Claude] getAllThreads failed:', error);
            throw error;
        }
    },


    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        // Check cache validity
        const cacheValid = ClaudeAdapter._cacheTimestamp > Date.now() - ClaudeAdapter._cacheTTL;

        if (!cacheValid || ClaudeAdapter._allThreadsCache.length === 0) {
            await ClaudeAdapter.getAllThreads();
        }

        const threads = ClaudeAdapter._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < ClaudeAdapter._allThreadsCache.length,
            total: ClaudeAdapter._allThreadsCache.length
        };
    },

    // Standard page-based (backwards compatible)
    getThreads: async function (page, limit) {
        try {
            const result = await this.getThreadsWithOffset((page - 1) * limit, limit);

            return {
                threads: result.threads,
                hasMore: result.hasMore,
                page
            };
        } catch (error) {
            console.error('[Claude] getThreads error:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Resilient thread detail fetching
    // ============================================
    getThreadDetail: async function (uuid) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversationDetail', { org: orgId, uuid });
            const url = `${baseUrl}${endpoint}`;

            const response = await ClaudeAdapter._fetchWithRetry(url);
            const data = await response.json().catch((e) => { console.warn('[Claude] Failed to parse conversation response:', e.message); return null; });
            if (!data) throw new Error('Failed to parse conversation response');

            console.log(`[Claude] API success for ${uuid}`);
            return {
                uuid,
                entries: transformClaudeData(data),
                title: data.name,
                platform: 'Claude'
            };
        } catch (error) {
            console.error('[Claude] getThreadDetail error:', error);
            return {
                uuid,
                entries: [],
                title: 'Error fetching details',
                platform: 'Claude',
                error: error.message
            };
        }
    },

    getSpaces: async () => [],

    // ============================================
    // HAR-VERIFIED 2026-03-16: Fetch project details
    // GET /api/organizations/{org}/projects/{projectUuid}
    // Response: { uuid, name, description, ... }
    // ============================================
    getProjects: async function () {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            // List conversations and extract unique project references
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });
            const url = `${baseUrl}${endpoint}?limit=100&offset=0&sort=updated_at&order=desc`;

            const response = await ClaudeAdapter._fetchWithRetry(url);
            const data = await response.json().catch(() => null);

            if (!data || !Array.isArray(data)) return [];

            // Extract unique project UUIDs from conversations
            const projectUuids = new Set();
            data.forEach(conv => {
                if (conv.project_uuid) projectUuids.add(conv.project_uuid);
            });

            if (projectUuids.size === 0) return [];

            // Fetch each project's details
            const projects = [];
            for (const projectUuid of projectUuids) {
                try {
                    const projectEndpoint = platformConfig.buildEndpoint('Claude', 'projects', { org: orgId, uuid: projectUuid });
                    const projectUrl = `${baseUrl}${projectEndpoint}`;
                    const projectResp = await ClaudeAdapter._fetchWithRetry(projectUrl, {}, 2);
                    const projectData = await projectResp.json().catch(() => null);
                    if (projectData) {
                        projects.push({
                            uuid: projectData.uuid || projectUuid,
                            name: projectData.name || projectData.title || 'Untitled Project',
                            description: projectData.description || ''
                        });
                    }
                } catch (e) {
                    console.warn(`[Claude] Could not fetch project ${projectUuid}:`, e.message);
                }
            }

            console.log(`[Claude] ✓ Found ${projects.length} projects`);
            return projects;
        } catch (error) {
            console.warn('[Claude] getProjects failed:', error.message);
            return [];
        }
    }
};

function transformClaudeData(data) {
    // Claude returns chat_messages array
    const entries = [];
    const messages = data.chat_messages || [];

    try {
        let currentEntry = null;
        messages.forEach(msg => {
            // Claude API: msg.text is always "" — actual text is in msg.content[0].text
            const msgText = (msg.content && msg.content[0]?.text) || msg.text || '';
            if (msg.sender === 'human') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: msgText,
                    blocks: []
                };
            } else if (msg.sender === 'assistant' && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: msgText }
                });
            }
        });
        if (currentEntry && currentEntry.blocks.length > 0) {
            entries.push(currentEntry);
        }
    } catch (e) {
        console.error('[OmniExporter] Claude transform error:', e);
    }

    return entries;
}

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
window.ClaudeAdapter = ClaudeAdapter;
