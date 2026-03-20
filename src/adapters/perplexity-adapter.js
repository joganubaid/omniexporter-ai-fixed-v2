// OmniExporter AI - Perplexity Platform Adapter
"use strict";

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

    extractUuid: (url) => {
        return platformConfig.extractUuid('Perplexity', url);
    },

    _parseEntries: (json) => {
        if (Array.isArray(json)) return json;
        if (json.entries) return json.entries;
        if (json.results) return json.results;
        if (json.data) return json.data;
        return [];
    },

    // HAR-VERIFIED 2026-03-20:
    // - API hard-caps at 20 items per request regardless of limit sent
    // - total_threads is WRONG (reports ~99 even when account has 500+)
    // - has_next_page on items[0] is the ONLY reliable "more pages" signal
    getThreads: async (page, limit, spaceId = null) => {
        try {
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'listThreads');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const url = `${baseUrl}${endpoint}`;
            const PAGE_SIZE = 20;
            const body = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, ascending: false, search_term: "" };
            if (spaceId) body.collection_uuid = spaceId;

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "accept": "*/*",
                    "content-type": "application/json",
                    "x-app-apiclient": "default",
                    "x-app-apiversion": (typeof platformConfig !== 'undefined' ? platformConfig.activeVersions?.get('Perplexity') : null) || "2.18"
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'listThreads');
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const items = Array.isArray(data) ? data : [];
            // has_next_page is the ONLY reliable signal — total_threads lies.
            const hasMore = items.length > 0 ? (items[0].has_next_page === true) : false;

            return {
                threads: items.map(t => ({
                    uuid: t.slug || t.uuid,
                    title: DataExtractor.extractTitle(t, 'Perplexity'),
                    last_query_datetime: t.last_query_datetime,
                    display_model: t.display_model || '',
                    mode: t.mode || '',
                    search_focus: t.search_focus || '',
                    query_count: t.query_count || 0
                })),
                hasMore,
                total: items.length > 0 ? (items[0].total_threads || 0) : 0,
                page
            };
        } catch (error) {
            console.error('[Perplexity] getThreads error:', error);
            throw error;
        }
    },


    getSpaces: async () => {
        try {
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'spaces');
            const url = baseUrl + endpoint;
            const version = (typeof platformConfig !== 'undefined' ? platformConfig.activeVersions?.get('Perplexity') : null) || '2.18';
            const response = await fetch(url, {
                credentials: "include",
                headers: { "accept": "*/*", "x-app-apiclient": "default", "x-app-apiversion": version }
            });
            if (!response.ok) { platformConfig.markEndpointFailed('Perplexity', 'spaces'); return []; }
            const data = await response.json();
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
                    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) { delayMs = retryAfterSeconds * 1000; }
                }
                if (!delayMs || !Number.isFinite(delayMs) || delayMs <= 0) { delayMs = Math.pow(2, attempt) * 1000; }
                lastError = new Error(`HTTP ${response.status}`);
                if (attempt < maxRetries - 1) {
                    console.warn(`[Perplexity] HTTP ${response.status} on attempt ${attempt + 1}, retrying in ${delayMs}ms`);
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                } else { break; }
            }
            return response;
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries - 1) { await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000)); }
            else { break; }
        }
    }
    throw lastError;
}

async function fetchPerplexityDetailResilient(uuid) {
    console.log('[Perplexity] Fetching thread detail for:', uuid);
    let entries = [];
    let cursor = null;
    let isInitial = true;
    let title = 'Untitled Thread';
    try {
        const MAX_PAGES = 200;
        let pageCount = 0;
        while (true) {
            pageCount++;
            if (pageCount > MAX_PAGES) { console.warn('[Perplexity] Reached max page limit, stopping'); break; }
            const currentVersion = platformConfig.activeVersions.get('Perplexity') || PLATFORM_CONFIGS.Perplexity.versions.current;
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const params = new URLSearchParams({
                with_parent_info: "true", with_schematized_response: "true",
                version: currentVersion, source: "default", limit: isInitial ? "10" : "100"
            });
            if (isInitial) { params.set("offset", "0"); params.set("from_first", "true"); }
            if (cursor) params.append("cursor", cursor);
            PERPLEXITY_BLOCK_USE_CASES.forEach(uc => params.append("supported_block_use_cases", uc));
            const url = `${baseUrl}/rest/thread/${uuid}?${params.toString()}`;
            console.log('[OmniExporter] Fetching:', url);
            const response = await _perplexityFetchWithRetry(url, {
                credentials: "include",
                headers: {
                    "accept": "application/json", "x-app-apiclient": "default",
                    "x-app-apiversion": (typeof platformConfig !== 'undefined' ? platformConfig.activeVersions?.get('Perplexity') : null) || "2.18"
                }
            });
            if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
            const json = await response.json();
            const rawEntries = PerplexityAdapter._parseEntries(json);
            if (rawEntries && Array.isArray(rawEntries)) {
                rawEntries.forEach(entry => { if (!entries.find(e => e.uuid === entry.uuid)) entries.push(entry); });
            }
            if (title === 'Untitled Thread' && entries.length > 0) {
                const firstEntry = entries[0];
                title = firstEntry.thread_title || firstEntry.query_str?.slice(0, 100) || title;
            }
            if (!json.next_cursor || json.next_cursor === cursor) {
                console.log('[OmniExporter] No more pages, total entries:', entries.length);
                break;
            }
            cursor = json.next_cursor;
            isInitial = false;
        }
        console.log('[OmniExporter] Final result - Title:', title, 'Entries:', entries.length);
        const enrichedEntries = entries.map(entry => {
            if (!entry.blocks || !Array.isArray(entry.blocks)) return entry;
            const enriched = { ...entry };
            const mediaParts = [];
            const followups = [];
            entry.blocks.forEach(block => {
                const usage = block.intended_usage || '';
                if (usage === 'media_items' && block.media_items_block) {
                    const items = block.media_items_block.items || block.media_items_block.media_items || [];
                    items.forEach(item => {
                        const type = item.type || item.media_type || 'image';
                        const url = item.url || item.thumbnail_url || '';
                        const alt = item.alt || item.title || item.description || '';
                        if (url) mediaParts.push(type === 'video' ? `🎬 [Video: ${alt || url}](${url})` : `🖼️ [Image: ${alt || url}](${url})`);
                    });
                }
                if (usage === 'inline_images' && block.inline_images_block) {
                    const images = block.inline_images_block.images || block.inline_images_block.items || [];
                    images.forEach(img => {
                        const url = img.url || img.image_url || '';
                        const alt = img.alt || img.caption || '';
                        if (url) mediaParts.push(`🖼️ [Image: ${alt || 'inline image'}](${url})`);
                    });
                }
                if ((usage === 'knowledge_cards' || usage === 'inline_knowledge_cards') && (block.knowledge_card_block || block.inline_knowledge_card_block)) {
                    const card = block.knowledge_card_block || block.inline_knowledge_card_block || {};
                    const cardTitle = card.title || card.name || '';
                    const cardDesc = card.description || card.snippet || '';
                    const cardUrl = card.url || card.source_url || '';
                    if (cardTitle || cardDesc) mediaParts.push(`📋 **${cardTitle}**${cardDesc ? ': ' + cardDesc : ''}${cardUrl ? ' (' + cardUrl + ')' : ''}`);
                }
                if (usage === 'pending_followups') {
                    const items = block.pending_followups_block?.followups || block.followups || block.items || [];
                    if (Array.isArray(items)) items.forEach(f => { const text = typeof f === 'string' ? f : (f.text || f.query || f.question || ''); if (text) followups.push(text); });
                }
            });
            if (mediaParts.length > 0) {
                const mediaContent = '\n\n' + mediaParts.join('\n');
                if (enriched.blocks && enriched.blocks.length > 0) {
                    const lastAskBlock = enriched.blocks.find(b => b.intended_usage === 'ask_text' && b.markdown_block);
                    if (lastAskBlock) {
                        lastAskBlock.markdown_block.answer = (lastAskBlock.markdown_block.answer || '') + mediaContent;
                    } else {
                        const anyBlock = enriched.blocks.slice().reverse().find(b => b.markdown_block);
                        if (anyBlock) { anyBlock.markdown_block.answer = (anyBlock.markdown_block.answer || '') + mediaContent; }
                        else { enriched.blocks.push({ intended_usage: 'ask_text', markdown_block: { answer: mediaContent.trim() } }); }
                    }
                }
            }
            if (followups.length > 0) enriched.related_queries = (enriched.related_queries || []).concat(followups);
            return enriched;
        });
        const model = entries[0]?.display_model || entries[0]?.model || '';
        return { entries: enrichedEntries, title, uuid, platform: 'Perplexity', model };
    } catch (error) {
        console.error('[OmniExporter] Error fetching thread detail:', error);
        throw error;
    }
}

window.PerplexityAdapter = PerplexityAdapter;
