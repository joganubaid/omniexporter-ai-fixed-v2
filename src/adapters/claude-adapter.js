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
    // HAR-VERIFIED 2026-03-16: Real browser traffic includes anthropic-* headers
    // ============================================
    _getHeaders: () => {
        return {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            // HAR-verified 2026-03-16: anthropic-* headers present on every real browser request
            'anthropic-client-platform': 'web_claude_ai',
            'anthropic-client-version': '1.0.0'
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
    // HAR-VERIFIED 2026-03-16: Uses chat_conversations_v2 for richer metadata
    // BUG-6/PERF-1 FIX: Fetch in pages instead of one massive request.
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');

            const allThreads = [];
            const seenUuids = new Set();
            let hasMore = true;
            let pageNum = 0;

            // Try v2 endpoint first for richer metadata
            let useV2 = true;
            let v2Cursor = null;

            while (hasMore) {
                pageNum++;
                if (pageNum > 200) {
                    console.warn('[Claude] Reached max page limit, stopping pagination');
                    break;
                }

                let pageUrl;
                if (useV2) {
                    // HAR-verified: chat_conversations_v2 returns { data: [...], has_more: bool }
                    const v2Endpoint = platformConfig.buildEndpoint('Claude', 'conversationsV2', { org: orgId });
                    pageUrl = `${baseUrl}${v2Endpoint}`;
                    if (v2Cursor) {
                        pageUrl += `&cursor=${v2Cursor}`;
                    }
                } else {
                    // Fallback to v1 pagination
                    const PAGE_SIZE = 50;
                    const offset = (pageNum - 1) * PAGE_SIZE;
                    const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });
                    pageUrl = `${baseUrl}${endpoint}?limit=${PAGE_SIZE}&offset=${offset}&sort=updated_at&order=desc`;
                }

                try {
                    const response = await ClaudeAdapter._fetchWithRetry(pageUrl);
                    const data = await response.json().catch(() => null);

                    if (useV2 && data && data.data && Array.isArray(data.data)) {
                        // V2 response format: { data: [...], has_more: bool }
                        const page = data.data;
                        for (const t of page) {
                            if (!seenUuids.has(t.uuid)) {
                                seenUuids.add(t.uuid);
                                allThreads.push({
                                    uuid: t.uuid,
                                    title: t.name || DataExtractor.extractTitle(t, 'Claude'),
                                    last_query_datetime: t.updated_at,
                                    platform: 'Claude',
                                    // V2 enriched metadata
                                    model: t.model || null,
                                    project_uuid: t.project_uuid || null,
                                    is_starred: t.is_starred || false,
                                    settings: t.settings || null
                                });
                            }
                        }
                        hasMore = data.has_more === true;
                        // Use last item's cursor for next page
                        if (hasMore && page.length > 0) {
                            v2Cursor = page[page.length - 1].uuid;
                        }
                    } else if (useV2) {
                        // V2 failed, fall back to v1
                        console.warn('[Claude] chat_conversations_v2 response unexpected, falling back to v1');
                        useV2 = false;
                        pageNum = 0; // Reset for v1 pagination
                        continue;
                    } else {
                        // V1 response format: array of conversations
                        const PAGE_SIZE = 50;
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
                        hasMore = page.length === PAGE_SIZE;
                    }
                } catch (e) {
                    if (useV2 && pageNum === 1) {
                        // V2 endpoint not available, fall back to v1
                        console.warn('[Claude] chat_conversations_v2 failed, falling back to v1:', e.message);
                        useV2 = false;
                        pageNum = 0;
                        continue;
                    }
                    throw e;
                }

                if (progressCallback) progressCallback(allThreads.length, hasMore);

                if (allThreads.length >= 10000) break;

                if (hasMore) await new Promise(r => setTimeout(r, 300));
            }

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
    // Full Fidelity mode: handles all content block types + attachments + metadata
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

            // Extract entries with full content block handling
            const entries = transformClaudeData(data);

            // Fetch file previews for local_resource references (non-critical)
            await fetchFilePreviewsForEntries(baseUrl, orgId, uuid, entries);

            console.log(`[Claude] API success for ${uuid}`);
            return {
                uuid,
                entries,
                title: data.name,
                platform: 'Claude',
                // Full Fidelity metadata
                model: data.model || data.settings?.model || null,
                settings: data.settings || null,
                project_uuid: data.project_uuid || null,
                created_at: data.created_at || null,
                updated_at: data.updated_at || null
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
    // HAR-VERIFIED 2026-03-16: Fetch artifact versions for a conversation
    // GET /api/organizations/{org}/artifacts/{convoUuid}/versions?source=w
    // Response: { artifact_versions: [...] }
    // ============================================
    getArtifactVersions: async function (convoUuid) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'artifactVersions', { org: orgId, uuid: convoUuid });
            const url = `${baseUrl}${endpoint}`;
            const response = await ClaudeAdapter._fetchWithRetry(url, {}, 2);
            const data = await response.json().catch(() => null);
            return data?.artifact_versions || [];
        } catch (error) {
            console.warn('[Claude] getArtifactVersions failed:', error.message);
            return [];
        }
    },

    // ============================================
    // HAR-VERIFIED 2026-03-16: Fetch artifact storage info
    // GET /api/organizations/{org}/artifacts/artifact_version/{id}/manage/storage/info?chat_conversation_uuid={uuid}
    // Response: { total_size_bytes: N, ... }
    // ============================================
    getArtifactStorageInfo: async function (artifactId, convoUuid) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'artifactStorageInfo', { org: orgId, artifactId, uuid: convoUuid });
            const url = `${baseUrl}${endpoint}`;
            const response = await ClaudeAdapter._fetchWithRetry(url, {}, 2);
            return await response.json().catch(() => null);
        } catch (error) {
            console.warn('[Claude] getArtifactStorageInfo failed:', error.message);
            return null;
        }
    },

    // ============================================
    // HAR-VERIFIED 2026-03-16: Fetch file preview content
    // GET /api/{org}/files/{fileId}/preview
    // Response: binary content (image/webp, text/html, etc.)
    // ============================================
    getFilePreview: async function (fileId) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'filePreview', { org: orgId, fileId });
            const url = `${baseUrl}${endpoint}`;
            const response = await ClaudeAdapter._fetchWithRetry(url, {}, 2);
            const contentType = response.headers.get('content-type') || '';
            if (contentType.startsWith('text/') || contentType.includes('json')) {
                return { content: await response.text(), contentType };
            }
            // For binary content (images), return metadata only
            return { content: `[Binary file: ${contentType}]`, contentType };
        } catch (error) {
            console.warn('[Claude] getFilePreview failed:', error.message);
            return null;
        }
    },

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

// ============================================
// Full Fidelity content block extractor
// HAR-VERIFIED 2026-03-16: Claude content[] arrays contain 5+ block types:
//   text, tool_use, tool_result, token_budget, local_resource
// Previously only content[0]?.text was read — entire tool/artifact content was dropped.
// ============================================
function extractAllContentBlocks(contentArray) {
    if (!Array.isArray(contentArray)) {
        return typeof contentArray === 'string' ? contentArray : '';
    }
    const parts = [];
    const fileRefs = [];

    for (const block of contentArray) {
        if (!block || !block.type) {
            // Legacy: plain string in content array
            if (typeof block === 'string') {
                parts.push(block);
            }
            continue;
        }

        switch (block.type) {
            case 'text':
                if (block.text) parts.push(block.text);
                break;

            case 'tool_use':
                // Render tool call as a labelled fenced code block
                parts.push(
                    `\n\`\`\`tool_call:${block.name || 'unknown'}\n` +
                    JSON.stringify(block.input || {}, null, 2) +
                    '\n```\n'
                );
                break;

            case 'tool_result': {
                // Tool results may contain nested content arrays or text
                const resultParts = [];
                if (Array.isArray(block.content)) {
                    for (const sub of block.content) {
                        if (!sub) continue;
                        if (sub.type === 'text' && sub.text) {
                            resultParts.push(sub.text);
                        } else if (sub.type === 'local_resource') {
                            // File generated by tool — capture UUID for preview fetching
                            const fileName = sub.name || sub.file_path || 'generated file';
                            resultParts.push(`📄 **[File: ${fileName}]** (${sub.mime_type || 'unknown type'})`);
                            if (sub.uuid) {
                                fileRefs.push({ uuid: sub.uuid, name: fileName, mimeType: sub.mime_type || '' });
                            }
                        } else if (typeof sub === 'string') {
                            resultParts.push(sub);
                        }
                    }
                } else if (typeof block.content === 'string') {
                    resultParts.push(block.content);
                }
                if (resultParts.length > 0) {
                    const prefix = block.is_error ? '❌ **Tool error:**' : '> **Tool result:**';
                    parts.push(`\n${prefix} ${resultParts.join('\n')}\n`);
                }
                break;
            }

            case 'token_budget':
                // Internal Claude throttle marker — skip silently on export
                break;

            case 'local_resource':
                // Standalone file reference
                if (block.uuid) {
                    fileRefs.push({ uuid: block.uuid, name: block.name || '', mimeType: block.mime_type || '' });
                }
                parts.push(`📄 **[File: ${block.name || block.file_path || 'file'}]** (${block.mime_type || 'unknown'})`);
                break;

            default:
                // Future block types (image, thinking, etc.) — include raw text if available
                if (block.text) parts.push(block.text);
                break;
        }
    }

    return { text: parts.join(''), fileRefs };
}

// ============================================
// Full Fidelity data transformer
// Replaces the old transformClaudeData that only read content[0]?.text
// ============================================
function transformClaudeData(data) {
    const entries = [];
    const messages = data.chat_messages || [];

    try {
        let currentEntry = null;
        for (const msg of messages) {
            const extracted = extractAllContentBlocks(msg.content);
            const text = (typeof extracted === 'string' ? extracted : extracted.text) || msg.text || '';
            const fileRefs = (typeof extracted === 'object' && extracted.fileRefs) ? extracted.fileRefs : [];

            if (msg.sender === 'human') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: text,
                    blocks: [],
                    // Include attachment content from human messages
                    attachments: (msg.attachments || []).map(a => ({
                        file_name: a.file_name || a.fileName || '',
                        file_type: a.file_type || a.fileType || '',
                        file_size: a.file_size || a.fileSize || 0,
                        extracted_content: a.extracted_content || ''
                    })).filter(a => a.file_name || a.extracted_content)
                };
                // Prepend attachment context to query if available
                if (currentEntry.attachments.length > 0) {
                    const attachmentSummary = currentEntry.attachments
                        .map(a => `📎 ${a.file_name}${a.extracted_content ? ` (${a.extracted_content.length} chars)` : ''}`)
                        .join('\n');
                    currentEntry.query_str = `${attachmentSummary}\n\n${currentEntry.query_str}`;
                }
            } else if (msg.sender === 'assistant' && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: text }
                });
                // Capture artifact IDs from files_v2 for potential later fetching
                if (msg.files_v2 && Array.isArray(msg.files_v2)) {
                    const artifactFiles = msg.files_v2.filter(f => f.file_kind === 'artifact');
                    if (artifactFiles.length > 0) {
                        if (!currentEntry.artifactIds) currentEntry.artifactIds = [];
                        currentEntry.artifactIds.push(...artifactFiles.map(f => f.file_uuid));
                    }
                }
                // Store file references from content blocks for preview fetching
                if (fileRefs.length > 0) {
                    if (!currentEntry.fileRefs) currentEntry.fileRefs = [];
                    currentEntry.fileRefs.push(...fileRefs);
                }
            }
        }
        if (currentEntry && currentEntry.blocks.length > 0) {
            entries.push(currentEntry);
        }
    } catch (e) {
        console.error('[OmniExporter] Claude transform error:', e);
    }

    return entries;
}

// ============================================
// Fetch file preview content for local_resource references
// Non-critical: failures are logged but don't break export
// ============================================
async function fetchFilePreviewsForEntries(baseUrl, orgId, convoUuid, entries) {
    for (const entry of entries) {
        if (!entry.fileRefs || entry.fileRefs.length === 0) continue;

        for (const ref of entry.fileRefs) {
            try {
                const preview = await ClaudeAdapter.getFilePreview(ref.uuid);
                if (preview && preview.content && preview.contentType) {
                    // Append file content to the answer block
                    const lastBlock = entry.blocks[entry.blocks.length - 1];
                    if (lastBlock && lastBlock.markdown_block) {
                        const header = `\n\n---\n📄 **${ref.name || 'Generated File'}** (${ref.mimeType || preview.contentType}):\n`;
                        if (preview.contentType.startsWith('text/') || preview.contentType.includes('json')) {
                            lastBlock.markdown_block.answer += `${header}\`\`\`\n${preview.content}\n\`\`\`\n`;
                        } else {
                            lastBlock.markdown_block.answer += `${header}${preview.content}\n`;
                        }
                    }
                }
            } catch (e) {
                // Non-critical — skip silently
            }
        }
    }
}

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
window.ClaudeAdapter = ClaudeAdapter;
