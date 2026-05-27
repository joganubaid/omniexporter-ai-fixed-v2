// OmniExporter AI - Claude Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

var ClaudeAdapter = window.ClaudeAdapter = window.ClaudeAdapter || {
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
    // Anti-bot headers — mirror what claude.ai/web sends on real-browser traffic.
    // HAR-verified 2026-05-26 against build SHA below.
    //
    // ⚠ anthropic-client-sha drifts on every Anthropic frontend deploy. If you
    // see Claude API calls start returning 4xx unexpectedly, refresh this value:
    //   1. Open claude.ai in DevTools → Network tab
    //   2. Click any /api/organizations/... request
    //   3. Copy the anthropic-client-sha request header value here
    // ============================================
    _getHeaders: () => {
        const headers = {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'anthropic-client-platform': 'web_claude_ai',
            'anthropic-client-version': '1.0.0',
            'anthropic-client-sha': '9f94910bb319abfbb3f61a3950f57e2804cf87be',
            'anthropic-device-id': '00000000-0000-4000-8000-000000000000',
            'x-activity-session-id': ClaudeAdapter._sessionId || (ClaudeAdapter._sessionId = crypto.randomUUID())
        };
        // Generate anonymous ID on first call and reuse (persistent within session)
        if (!ClaudeAdapter._anonymousId) {
            ClaudeAdapter._anonymousId = 'claudeai.v1.' + (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random()*16|0, v = c=='x'?r:r&0x3|0x8; return v.toString(16); }));
        }
        headers['anthropic-anonymous-id'] = ClaudeAdapter._anonymousId;
        return headers;
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;
        const headers = { ...ClaudeAdapter._getHeaders(), ...options.headers };

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await Logger.tracedFetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                }, { module: 'Claude', label: `attempt ${attempt + 1}/${maxRetries}` });

                if (response.ok) return response;

                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to Claude');
                }

                // Honor Claude's x-should-retry response header. When set to
                // "false", Anthropic is telling us the error is permanent
                // (e.g. 400 invalid request) and retrying will just waste
                // budget. Bail out immediately with the underlying status.
                if (response.headers.get('x-should-retry') === 'false') {
                    throw new Error(`Claude returned HTTP ${response.status} (x-should-retry: false)`);
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
};

// ============================================
// Full Fidelity content block extractor.
// HAR-verified 2026-05-26 — Claude content[] arrays contain these block types:
//   text, thinking, tool_use, tool_result, token_budget, local_resource
// Anything else passes through the `default` arm (we still grab .text if present).
// ============================================
function extractAllContentBlocks(contentArray) {
    if (!Array.isArray(contentArray)) {
        const text = typeof contentArray === 'string' ? contentArray : '';
        return { text, thinking: '', toolCalls: [], toolResults: [] };
    }
    const textParts = [];
    const thinkingParts = [];
    const toolCalls = [];
    const toolResults = [];

    for (const block of contentArray) {
        if (!block || !block.type) {
            if (typeof block === 'string') {
                textParts.push(block);
            }
            continue;
        }

        switch (block.type) {
            case 'text':
                if (block.text) textParts.push(block.text);
                break;

            case 'tool_use':
                toolCalls.push({
                    name: block.name || 'unknown',
                    input: block.input || {}
                });
                break;

            case 'tool_result': {
                const resultTextParts = [];
                if (Array.isArray(block.content)) {
                    for (const sub of block.content) {
                        if (!sub) continue;
                        if (sub.type === 'text' && sub.text) {
                            resultTextParts.push(sub.text);
                        } else if (sub.type === 'local_resource') {
                            const fileName = sub.name || sub.file_path || 'generated file';
                            resultTextParts.push(`[File: ${fileName}] (${sub.mime_type || 'unknown type'})`);
                        } else if (typeof sub === 'string') {
                            resultTextParts.push(sub);
                        }
                    }
                } else if (typeof block.content === 'string') {
                    resultTextParts.push(block.content);
                }
                let resultText = resultTextParts.join('\n');
                // Strip raw HTML <functions> blocks (LLM function definitions, not user-readable)
                resultText = resultText.replace(/<functions>[\s\S]*?<\/functions>/g, '');
                // Strip other raw HTML tags
                resultText = resultText.replace(/<[^>]+>/g, '');
                toolResults.push({
                    isError: !!block.is_error,
                    text: resultText.trim()
                });
                break;
            }

            case 'token_budget':
                break;

            case 'local_resource':
                textParts.push(`[File: ${block.name || block.file_path || 'file'}] (${block.mime_type || 'unknown'})`);
                break;

            case 'thinking':
                if (block.thinking) {
                    thinkingParts.push(block.thinking);
                }
                if (block.summaries && Array.isArray(block.summaries)) {
                    for (const s of block.summaries) {
                        if (s.summary) thinkingParts.push(`Summary: ${s.summary}`);
                    }
                }
                break;

            default:
                if (block.text) textParts.push(block.text);
                break;
        }
    }

    return {
        text: textParts.join('\n\n'),
        thinking: thinkingParts.join('\n\n'),
        toolCalls,
        toolResults
    };
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
            const text = extracted.text || msg.text || '';
            const thinking = extracted.thinking || '';
            const toolCalls = extracted.toolCalls || [];
            const toolResults = extracted.toolResults || [];
            const citations = msg.citations || [];

            if (msg.sender === 'human') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: text,
                    blocks: [],
                    citations: citations.length > 0 ? citations.map(c => ({
                        url: c.url || c.link || '',
                        title: c.title || c.name || ''
                    })) : [],
                    attachments: (msg.attachments || []).map(a => ({
                        file_name: a.file_name || a.fileName || '',
                        file_type: a.file_type || a.fileType || '',
                        file_size: a.file_size || a.fileSize || 0,
                        extracted_content: a.extracted_content || ''
                    })).filter(a => a.file_name || a.extracted_content)
                };
                if (currentEntry.attachments.length > 0) {
                    const attachmentSummary = currentEntry.attachments
                        .map(a => `[Attachment: ${a.file_name}${a.extracted_content ? ` (${a.extracted_content.length} chars)` : ''}]`)
                        .join('\n');
                    currentEntry.query_str = `${attachmentSummary}\n\n${currentEntry.query_str}`;
                }
            } else if (msg.sender === 'assistant' && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: text },
                    thinking: thinking || null,
                    toolCalls: toolCalls.length > 0 ? toolCalls : null,
                    toolResults: toolResults.length > 0 ? toolResults : null
                });
                if (citations.length > 0) {
                    if (!currentEntry.citations) currentEntry.citations = [];
                    currentEntry.citations.push(...citations.map(c => ({
                        url: c.url || c.link || '',
                        title: c.title || c.name || ''
                    })));
                }
                if (msg.files_v2 && Array.isArray(msg.files_v2)) {
                    const artifactFiles = msg.files_v2.filter(f => f.file_kind === 'artifact');
                    if (artifactFiles.length > 0) {
                        if (!currentEntry.artifactIds) currentEntry.artifactIds = [];
                        currentEntry.artifactIds.push(...artifactFiles.map(f => f.file_uuid));
                    }
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

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
window.ClaudeAdapter = ClaudeAdapter;
