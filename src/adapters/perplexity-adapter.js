// OmniExporter AI - Perplexity Platform Adapter
// Extracted from content.js for maintainability
"use strict";

// Dependencies (loaded before this file via manifest content_scripts):
// - platformConfig (from platform-config.js)
// - DataExtractor (from platform-config.js)
// - Logger (from logger.js)

// HAR-verified: supported_block_use_cases required for full response
const PERPLEXITY_BLOCK_USE_CASES = window.PERPLEXITY_BLOCK_USE_CASES = window.PERPLEXITY_BLOCK_USE_CASES || [
    'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
    'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
    'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
    'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
    'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
    'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
    'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
    'pending_followups', 'inline_claims'
];

const PerplexityAdapter = window.PerplexityAdapter = window.PerplexityAdapter || {
    name: "Perplexity",

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

            return {
                threads: items.map(t => ({
                    // HAR-verified: use slug for detail API (it expects slug, not UUID)
                    uuid: t.slug || t.uuid,
                    title: DataExtractor.extractTitle(t, 'Perplexity'),
                    last_query_datetime: t.last_query_datetime
                })),
                hasMore: totalThreads > 0
                    ? ((page - 1) * limit + items.length < totalThreads)
                    : items.length === limit,
                page
            };
        } catch (error) {
            console.error('[Perplexity] getThreads error:', error);
            throw error;
        }
    },

    // ============================================
    // HAR-VERIFIED 2026-03-16: Fetch user collections (Spaces)
    // GET /rest/collections/list_user_collections?limit=30&offset=0&version=2.18&source=default
    // Response: [{uuid, title, description, thread_count, emoji, ...}]
    // ============================================
    getSpaces: async () => {
        try {
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const version = (typeof platformConfig !== 'undefined'
                ? platformConfig.activeVersions?.get('Perplexity')
                : null) || '2.18';
            const url = `${baseUrl}/rest/collections/list_user_collections?limit=30&offset=0&version=${version}&source=default`;

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

            const response = await fetch(url, {
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

        return {
            entries: entries,
            title: title,
            uuid: uuid
        };
    } catch (error) {
        console.error('[OmniExporter] Error fetching thread detail:', error);
        throw error;
    }
}

// ARCH-1 FIX: Standardize adapter export pattern across all adapters.
// content.js's getPlatformAdapter() uses window.XAdapter for all detection.
window.PerplexityAdapter = PerplexityAdapter;
