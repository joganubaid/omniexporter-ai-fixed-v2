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
    // HAR-VERIFIED 2026-03-20 (from claude.ai.har analysis):
    //   - V2 response shape: { data: [...], has_more: bool }
    //   - NO next_cursor field in the response — cursor/UUID approach is WRONG
    //   - V2 pagination is OFFSET-BASED: ?limit=50&offset=0, &offset=50, &offset=100 ...
    //   - Passing cursor=<uuid> returns the SAME page every time (infinite loop)
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');

            const allThreads = [];
            const seenUuids = new Set();
            let hasMore = true;

            // Unified offset counter — used for both V2 and V1 fallback
            let offset = 0;
            const PAGE_SIZE = 50;
            let useV2 = true;
            let pageNum = 0;

            while (hasMore) {
                pageNum++;
                if (pageNum > 200) {
                    console.warn('[Claude] Reached max page limit (200), stopping pagination');
                    break;
                }

                // Build URL: V2 with offset, or V1 fallback with offset
                let pageUrl;
                if (useV2) {
                    // HAR-verified 2026-03-20: V2 uses &offset=N (NOT cursor=uuid)
                    // Response: { data: [...conversations...], has_more: bool }
                    const v2Endpoint = platformConfig.buildEndpoint('Claude', 'conversationsV2', { org: orgId });
                    pageUrl = `${baseUrl}${v2Endpoint}&offset=${offset}`;
                } else {
                    // V1 fallback — same offset-based approach
                    const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });
                    pageUrl = `${baseUrl}${endpoint}?limit=${PAGE_SIZE}&offset=${offset}&consistency=eventual`;
                }

                try {
                    const response = await ClaudeAdapter._fetchWithRetry(pageUrl);
                    const data = await response.json().catch(() => null);

                    if (useV2 && data && data.data && Array.isArray(data.data)) {
                        // V2 response format: { data: [...], has_more: bool }
                        const page = data.data;
                        let newOnThisPage = 0;
                        for (const t of page) {
                            if (!seenUuids.has(t.uuid)) {
                                seenUuids.add(t.uuid);
                                newOnThisPage++;
                                allThreads.push({
                                    uuid: t.uuid,
                                    title: t.name || DataExtractor.extractTitle(t, 'Claude'),
                                    last_query_datetime: t.updated_at,
                                    platform: 'Claude',
                                    model: t.model || null,
                                    project_uuid: t.project_uuid || null,
                                    is_starred: t.is_starred || false,
                                    settings: t.settings || null
                                });
                            }
                        }
                        // Advance offset by actual page size received
                        offset += page.length;
                        // has_more is the authoritative field (HAR-verified present on every V2 response)
                        hasMore = data.has_more === true;
                        // Safety: stop if we got a full page but no new items (dedup loop)
                        if (page.length > 0 && newOnThisPage === 0) {
                            console.warn('[Claude] Full page returned but all UUIDs already seen — stopping');
                            hasMore = false;
                        }

                    } else if (useV2) {
                        // V2 returned unexpected format — fall back to V1 from scratch
                        console.warn('[Claude] V2 response unexpected, falling back to V1');
                        useV2 = false;
                        offset = 0; // Reset offset for V1
                        continue;

                    } else {
                        // V1 response format: plain array of conversations
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
                        offset += page.length;
                        hasMore = page.length === PAGE_SIZE;
                    }

                } catch (e) {
                    if (useV2 && pageNum === 1) {
                        // V2 unavailable on first attempt — try V1
                        console.warn('[Claude] V2 failed, falling back to V1:', e.message);
                        useV2 = false;
                        offset = 0;
                        pageNum = 0;
                        continue;
                    }
                    // Mid-stream failure: keep partial results rather than losing everything
                    if (allThreads.length > 0) {
                        console.warn(`[Claude] getAllThreads failed on page ${pageNum}, keeping ${allThreads.length} results:`, e.message);
                        break;
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
    
    getFilePreview: async function(fileId) {
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
                    // Append file content to the answer block.
                    // Guard: entry.blocks may be an empty array, making [length-1] return
                    // undefined, which would throw "Cannot read properties of undefined".
                    const lastBlock = entry.blocks && entry.blocks.length > 0
                        ? entry.blocks[entry.blocks.length - 1]
                        : null;
                    if (!lastBlock || !lastBlock.markdown_block) continue;
                    const header = `\n\n---\n📄 **${ref.name || 'Generated File'}** (${ref.mimeType || preview.contentType}):\n`;
                    if (preview.contentType.startsWith('text/') || preview.contentType.includes('json')) {
                        lastBlock.markdown_block.answer += `${header}\`\`\`\n${preview.content}\n\`\`\`\n`;
                    } else {
                        lastBlock.markdown_block.answer += `${header}${preview.content}\n`;
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
