// OmniExporter AI - Perplexity Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

// HAR-verified: supported_block_use_cases required for full response
var PERPLEXITY_BLOCK_USE_CASES = window.PERPLEXITY_BLOCK_USE_CASES = window.PERPLEXITY_BLOCK_USE_CASES || [
    'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
    'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
    'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
    'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
    'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
    'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
    'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
    'pending_followups', 'inline_claims'
];

var PerplexityAdapter = window.PerplexityAdapter = window.PerplexityAdapter || {
    name: "Perplexity",
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute

    extractUuid: (url) => {
        // Use config layer with multiple pattern fallbacks
        return platformConfig.extractUuid('Perplexity', url);
    },

    /**
     * Parse entries from partial JSON response
     */
    _parseEntries: (json) => {
        // Handle various Perplexity API response formats
        if (Array.isArray(json)) return json;
        if (json.entries) return json.entries;
        if (json.results) return json.results;
        if (json.data) return json.data;
        return [];
    },

    getThreads: async (page, limit, spaceId = null) => {
        try {
            // Build endpoint using config
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'listThreads');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const url = `${baseUrl}${endpoint}`;

            // HAR-verified body: includes search_term
            const body = { limit, offset: (page - 1) * limit, ascending: false, search_term: "" };
            if (spaceId) body.collection_uuid = spaceId;

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "accept": "*/*",
                    "content-type": "application/json",
                    // Keep client header consistent with other Perplexity calls.
                    "x-app-apiclient": "default",
                    // BUG-9 FIX: Use dynamic version from platformConfig if available.
                    // Previously hardcoded to "2.18" which bypassed the version detector entirely.
                    "x-app-apiversion": (typeof platformConfig !== 'undefined'
                        ? platformConfig.activeVersions?.get('Perplexity')
                        : null) || "2.18"
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'listThreads');
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const items = Array.isArray(data) ? data : [];
            // HAR-verified: use total_threads from response for accurate pagination
            const totalThreads = items.length > 0 ? (items[0].total_threads || 0) : 0;
            const hasMoreByTotal = totalThreads > 0
                ? ((page - 1) * limit + items.length < totalThreads)
                : false;

            return {
                threads: items.map(t => ({
                    // HAR-verified: use slug for detail API (it expects slug, not UUID)
                    uuid: t.slug || t.uuid,
                    title: DataExtractor.extractTitle(t, 'Perplexity'),
                    last_query_datetime: t.last_query_datetime,
                    // HAR-verified 2026-03-16: additional metadata from list_ask_threads
                    display_model: t.display_model || '',
                    mode: t.mode || '',
                    search_focus: t.search_focus || '',
                    query_count: t.query_count || 0
                })),
                // Keep full-page fallback because total_threads can be stale/partial.
                hasMore: hasMoreByTotal || items.length === limit,
                page
            };
        } catch (error) {
            console.error('[Perplexity] getThreads error:', error);
            throw error;
        }
    },

    getAllThreads: async function (progressCallback = null) {
        const allThreads = [];
        const seenUuids = new Set();
        let page = 1;
        let hasMore = true;
        const limit = 50;
        const maxPages = 200;

        try {
            while (hasMore && page <= maxPages) {
                const result = await this.getThreads(page, limit);
                const pageThreads = result.threads || [];
                let added = 0;

                for (const t of pageThreads) {
                    if (!t?.uuid || seenUuids.has(t.uuid)) continue;
                    seenUuids.add(t.uuid);
                    allThreads.push(t);
                    added++;
                }

                hasMore = result.hasMore === true;
                if (progressCallback) progressCallback(allThreads.length, hasMore);

                // Safety: stop if API keeps returning only already-seen rows.
                if (pageThreads.length > 0 && added === 0) break;

                page++;
                if (hasMore) await new Promise(r => setTimeout(r, 300));
            }

            this._allThreadsCache = allThreads;
            this._cacheTimestamp = Date.now();
            return allThreads;
        } catch (error) {
            console.error('[Perplexity] getAllThreads failed:', error);
            throw error;
        }
    },

    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        const cacheValid = this._cacheTimestamp > Date.now() - this._cacheTTL;
        if (!cacheValid || this._allThreadsCache.length === 0) {
            await this.getAllThreads();
        }

        const threads = this._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < this._allThreadsCache.length,
            total: this._allThreadsCache.length
        };
    },

    // ============================================
    // HAR-VERIFIED 2026-03-16: Fetch user collections (Spaces)
    // GET /rest/collections/list_user_collections?limit=30&offset=0&version=2.18&source=default
    // Response: [{uuid, title, description, thread_count, emoji, ...}]
    // ============================================
    getSpaces: async () => {
        try {
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'spaces');
            const url = baseUrl + endpoint;
            const version = (typeof platformConfig !== 'undefined'
                ? platformConfig.activeVersions?.get('Perplexity')
                : null) || '2.18';

            const response = await fetch(url, {
                credentials: "include",
                headers: {
                    "accept": "*/*",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": version
                }
            });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'spaces');
                return [];
            }

            const data = await response.json();
            // HAR-verified: response is array of collection objects
            const collections = Array.isArray(data) ? data : [];
            return collections.map(s => ({
                uuid: s.uuid,
                name: s.title || 'Untitled Space',
                description: s.description || '',
                threadCount: s.thread_count || 0,
                emoji: s.emoji || ''
            }));
        } catch (error) {
            console.error('[Perplexity] getSpaces error:', error);
            return [];
        }
    },

    getThreadDetail: async (uuid) => {
        return await fetchPerplexityDetailResilient(uuid);
    }
};

// Helper: fetch with exponential-backoff retry (mirrors the pattern in Grok/Claude adapters).
// Used inside fetchPerplexityDetailResilient to handle 429 / transient 5xx without crashing the
// entire paginated detail fetch.
async function _perplexityFetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status >= 500) {
                const retryAfterHeader = response.headers.get('Retry-After');
                let delayMs;
                if (retryAfterHeader != null) {
                    const retryAfterSeconds = parseFloat(retryAfterHeader);
                    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
                        delayMs = retryAfterSeconds * 1000;
                    }
                }
                if (!delayMs || !Number.isFinite(delayMs) || delayMs <= 0) {
                    delayMs = Math.pow(2, attempt) * 1000;
                }
                lastError = new Error(`HTTP ${response.status}`);
                if (attempt < maxRetries - 1) {
                    console.warn(`[Perplexity] HTTP ${response.status} on attempt ${attempt + 1}, retrying in ${delayMs}ms`);
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                } else {
                    break;
                }
            }
            return response;
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            } else {
                break;
            }
        }
    }
    throw lastError;
}

// Helper function for resilient detail fetching
async function fetchPerplexityDetailResilient(uuid) {
    console.log('[Perplexity] Fetching thread detail for:', uuid);

    let entries = [];
    let cursor = null;
    let isInitial = true;
    let title = 'Untitled Thread';

    try {
        // Safety limit to prevent infinite loops if server returns same cursor
        const MAX_PAGES = 200;
        let pageCount = 0;
        while (true) {
            pageCount++;
            if (pageCount > MAX_PAGES) {
                console.warn('[Perplexity] Reached max page limit, stopping pagination');
                break;
            }
            // Re-read version each iteration so config hot-reloads take effect
            const currentVersion = platformConfig.activeVersions.get('Perplexity') ||
                PLATFORM_CONFIGS.Perplexity.versions.current;

            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const params = new URLSearchParams({
                with_parent_info: "true",
                with_schematized_response: "true",
                version: currentVersion,
                source: "default",
                limit: isInitial ? "10" : "100"
            });

            // HAR-verified: initial request uses offset=0 and from_first=true
            if (isInitial) {
                params.set("offset", "0");
                params.set("from_first", "true");
            }

            if (cursor) params.append("cursor", cursor);

            // HAR-verified: supported_block_use_cases required for full response
            PERPLEXITY_BLOCK_USE_CASES.forEach(uc => params.append("supported_block_use_cases", uc));

            const url = `${baseUrl}/rest/thread/${uuid}?${params.toString()}`;
            console.log('[OmniExporter] Fetching:', url);

            // Use _perplexityFetchWithRetry so transient 429/5xx errors are retried rather
            // than immediately crashing the loop and losing all previously-fetched pages.
            const response = await _perplexityFetchWithRetry(url, {
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": (typeof platformConfig !== 'undefined'
                        ? platformConfig.activeVersions?.get('Perplexity')
                        : null) || "2.18"
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const json = await response.json();

            // Extract entries - robust check
            const rawEntries = PerplexityAdapter._parseEntries(json);

            if (rawEntries && Array.isArray(rawEntries)) {
                rawEntries.forEach(entry => {
                    if (!entries.find(e => e.uuid === entry.uuid)) {
                        entries.push(entry);
                    }
                });
            }

            // HAR-verified: title is in thread_title field of entries
            if (title === 'Untitled Thread' && entries.length > 0) {
                const firstEntry = entries[0];
                title = firstEntry.thread_title || firstEntry.query_str?.slice(0, 100) || title;
            }

            // Check for pagination
            if (!json.next_cursor || json.next_cursor === cursor) {
                console.log('[OmniExporter] No more pages, total entries:', entries.length);
                break;
            }

            cursor = json.next_cursor;
            isInitial = false;
        }

        console.log('[OmniExporter] Final result - Title:', title, 'Entries:', entries.length);

        // ── POST-PROCESS: Extract rich content from Perplexity block structures ──
        // HAR-verified: Perplexity entries contain `blocks[]` with diverse intended_usage types.
        // Previously only ask_text and web_results were consumed. Now we extract:
        // media_items, knowledge_cards, inline_images, pending_followups, citations.
        const enrichedEntries = entries.map(entry => {
            if (!entry.blocks || !Array.isArray(entry.blocks)) return entry;

            const enriched = { ...entry };
            const mediaParts = [];
            const followups = [];

            entry.blocks.forEach(block => {
                const usage = block.intended_usage || '';

                // Media items (images, videos returned by search)
                if (usage === 'media_items' && block.media_items_block) {
                    const items = block.media_items_block.items || block.media_items_block.media_items || [];
                    items.forEach(item => {
                        const type = item.type || item.media_type || 'image';
                        const url = item.url || item.thumbnail_url || '';
                        const alt = item.alt || item.title || item.description || '';
                        if (url) {
                            mediaParts.push(type === 'video'
                                ? `🎬 [Video: ${alt || url}](${url})`
                                : `🖼️ [Image: ${alt || url}](${url})`);
                        }
                    });
                }

                // Inline images embedded in response
                if (usage === 'inline_images' && block.inline_images_block) {
                    const images = block.inline_images_block.images || block.inline_images_block.items || [];
                    images.forEach(img => {
                        const url = img.url || img.image_url || '';
                        const alt = img.alt || img.caption || '';
                        if (url) mediaParts.push(`🖼️ [Image: ${alt || 'inline image'}](${url})`);
                    });
                }

                // Knowledge cards (structured entity info)
                if ((usage === 'knowledge_cards' || usage === 'inline_knowledge_cards') && (block.knowledge_card_block || block.inline_knowledge_card_block)) {
                    const card = block.knowledge_card_block || block.inline_knowledge_card_block || {};
                    const cardTitle = card.title || card.name || '';
                    const cardDesc = card.description || card.snippet || '';
                    const cardUrl = card.url || card.source_url || '';
                    if (cardTitle || cardDesc) {
                        mediaParts.push(`📋 **${cardTitle}**${cardDesc ? ': ' + cardDesc : ''}${cardUrl ? ' (' + cardUrl + ')' : ''}`);
                    }
                }

                // Follow-up suggestions
                if (usage === 'pending_followups') {
                    const items = block.pending_followups_block?.followups
                        || block.followups || block.items || [];
                    if (Array.isArray(items)) {
                        items.forEach(f => {
                            const text = typeof f === 'string' ? f : (f.text || f.query || f.question || '');
                            if (text) followups.push(text);
                        });
                    }
                }
            });

            // Append media references to answer blocks
            if (mediaParts.length > 0) {
                const mediaContent = '\n\n' + mediaParts.join('\n');
                if (enriched.blocks && enriched.blocks.length > 0) {
                    const lastAskBlock = enriched.blocks.find(b => b.intended_usage === 'ask_text' && b.markdown_block);
                    if (lastAskBlock) {
                        // Happy path: append media to the existing answer block.
                        lastAskBlock.markdown_block.answer = (lastAskBlock.markdown_block.answer || '') + mediaContent;
                    } else {
                        // No ask_text block found — rather than silently dropping the media,
                        // append it to the last available block with a markdown_block, or
                        // create a dedicated block so nothing is lost.
                        const anyBlock = enriched.blocks.slice().reverse().find(b => b.markdown_block);
                        if (anyBlock) {
                            anyBlock.markdown_block.answer = (anyBlock.markdown_block.answer || '') + mediaContent;
                        } else {
                            enriched.blocks.push({
                                intended_usage: 'ask_text',
                                markdown_block: { answer: mediaContent.trim() }
                            });
                        }
                    }
                }
            }

            // Attach follow-up suggestions as related_queries
            if (followups.length > 0) {
                enriched.related_queries = (enriched.related_queries || []).concat(followups);
            }

            return enriched;
        });

        // Extract model from first entry if available
        const model = entries[0]?.display_model || entries[0]?.model || '';

        return {
            entries: enrichedEntries,
            title: title,
            uuid: uuid,
            platform: 'Perplexity',
            model: model
        };
    } catch (error) {
        console.error('[OmniExporter] Error fetching thread detail:', error);
        throw error;
    }
}

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
// content.js's getPlatformAdapter() uses window.XAdapter for all detection.
window.PerplexityAdapter = PerplexityAdapter;
