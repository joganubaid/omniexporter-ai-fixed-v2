// OmniExporter AI - Platform Configuration Layer
// Provides resilience against API changes with auto-fallback support

// ============================================
// PLATFORM CONFIGURATIONS
// Use window properties to avoid re-declaration on re-injection
// ============================================
window.PLATFORM_CONFIGS = window.PLATFORM_CONFIGS || {
        Perplexity: {
            name: 'Perplexity',
            baseUrl: 'https://www.perplexity.ai',
            versions: {
                current: '2.18',
                fallback: '2.17',
                experimental: '3.0'
            },
            endpoints: {
                listThreads: {
                    primary: '/rest/thread/list_ask_threads',
                    fallback: '/api/threads/list',
                    params: (version) => `?version=${version}&source=default`
                },
                threadDetail: {
                    primary: '/rest/thread/{uuid}',
                    fallback: '/api/threads/{uuid}',
                    params: (version) => `?with_parent_info=true&with_schematized_response=true&version=${version}&source=default`
                },
                spaces: {
                    primary: '/rest/collections/list',
                    fallback: '/api/collections'
                }
            },
            patterns: {
                uuidExtract: [
                    /\/search\/([^/?#]+)/,
                    /\/thread\/([^/?#]+)/,
                    /\/chat\/([^/?#]+)/,
                    /\/conversation\/([^/?#]+)/
                ]
            },
            dataFields: {
                answer: ['blocks[].markdown_block.answer', 'blocks[].markdown_block.chunks', 'answer', 'text', 'content'],
                query: ['query', 'query_str', 'question', 'prompt'],
                title: ['title', 'name', 'query_str'],
                sources: ['blocks[].web_result_block.web_results', 'sources', 'citations']
            }
        },

        Claude: {
            name: 'Claude',
            baseUrl: 'https://claude.ai',
            versions: {
                current: 'v1',
                fallback: 'v1'
            },
            endpoints: {
                organizations: {
                    primary: '/api/organizations',
                    fallback: '/api/v1/organizations'
                },
                conversations: {
                    primary: '/api/organizations/{org}/chat_conversations',
                    fallback: '/api/v1/organizations/{org}/conversations'
                },
                conversationDetail: {
                    primary: '/api/organizations/{org}/chat_conversations/{uuid}?tree=True&rendering_mode=messages&render_all_tools=true',
                    fallback: '/api/v1/organizations/{org}/conversations/{uuid}'
                }
            },
            patterns: {
                uuidExtract: [
                    /\/chat\/([^/?#]+)/,
                    /\/conversation\/([^/?#]+)/,
                    /\/thread\/([^/?#]+)/
                ]
            },
            dataFields: {
                answer: ['text', 'content', 'response.text', 'message'],
                query: ['text', 'content', 'query', 'prompt'],
                title: ['name', 'title', 'summary']
            }
        },

        ChatGPT: {
            name: 'ChatGPT',
            baseUrl: 'https://chatgpt.com',
            versions: {
                current: 'backend-api',
                fallback: 'api/v1'
            },
            endpoints: {
                conversations: {
                    primary: '/backend-api/conversations', // Verified by HAR (200 OK)
                    fallback: '/api/conversations'
                },
                conversationDetail: {
                    primary: '/backend-api/conversation/{uuid}', // Verified by HAR (Singular)
                    fallback: '/api/conversation/{uuid}'
                }
            },
            patterns: {
                uuidExtract: [
                    /\/c\/([^/?#]+)/,
                    /\/chat\/([^/?#]+)/,
                    /\/conversation\/([^/?#]+)/
                ]
            },
            dataFields: {
                answer: ['content.parts', 'message.content.parts', 'text', 'content'],
                query: ['content.parts', 'message.content.parts', 'text'],
                title: ['title', 'name']
            }
        },

        // ============================================
        // NEW PLATFORMS (Phase 10-11)
        // ============================================

        Gemini: {
            name: 'Gemini',
            baseUrl: 'https://gemini.google.com',
            versions: {
                current: 'v1',
                fallback: 'v1'
            },
            endpoints: {
                // HAR-verified: batchexecute is the single endpoint for all Gemini API calls
                conversations: {
                    primary: '/_/BardChatUi/data/batchexecute',
                    fallback: '/app'
                }
            },
            // HAR-verified RPC IDs (2026-02-16)
            rpcIds: {
                listChats: 'MaZiqc',          // Chat list (sidebar history) — HAR verified
                getMessages: 'hNvQHb',         // Message detail — HAR verified 2026-02-17
                getMessagesFallback: 'WqGlee', // Message detail fallback
                modelInfo: 'otAQ7b',           // Model type (Fast/Thinking)
                userProfile: 'o30O0e',         // User profile data
                userSettings: 'K4WWud',        // Location/language settings
                uiState: 'L5adhe',            // Side-nav state
                extensions: 'cYRIkd'           // Extension states (Drive/Gmail)
            },
            // HAR-verified payload for MaZiqc (chat list)
            listPayload: [13, null, [0, null, 1]],
            patterns: {
                uuidExtract: [
                    /\/app\/([a-zA-Z0-9._-]+)/,
                    /\/gem\/([a-zA-Z0-9._-]+)/,
                    /\/chat\/([a-zA-Z0-9._-]+)/,
                    /\/(c_[a-f0-9]{16})/,      // Gemini chat IDs (e.g., c_ec00ff04a46f7fa6)
                    /\/([a-zA-Z0-9._-]{10,})/  // Catch-all for long IDs
                ]
            },
            dataFields: {
                answer: ['content', 'text', 'response', 'markdown'],
                query: ['query', 'prompt', 'input', 'text'],
                title: ['title', 'name', 'conversationTitle']
            },
            // Gemini-specific: Uses page context injection
            requiresInjection: true,
            globalDataKey: 'WIZ_global_data',
            // WIZ_global_data key mappings → batchexecute params
            sessionKeys: {
                authToken: 'SNlM0e',   // → "at" POST param (XSRF token)
                buildId: 'cfb2h',      // → "bl" query param (build version)
                sessionId: 'FdrFJe'    // → "f.sid" query param (session ID)
            },
            authTokenKey: 'SNlM0e'
        },

        Grok: {
            name: 'Grok',
            baseUrl: 'https://grok.com',
            versions: {
                current: 'v1',
                fallback: 'v1'
            },
            endpoints: {
                // HAR-verified: real Grok API is under /rest/app-chat/
                conversations: {
                    primary: '/rest/app-chat/conversations',
                    fallback: '/rest/app-chat/conversations',
                    params: () => '?pageSize=60'
                },
                // HAR-verified: step 1 of detail fetch
                responseNode: {
                    primary: '/rest/app-chat/conversations/{uuid}/response-node',
                    fallback: '/rest/app-chat/conversations/{uuid}/response-node',
                    params: () => '?includeThreads=true'
                },
                // HAR-verified: step 2 of detail fetch (POST)
                loadResponses: {
                    primary: '/rest/app-chat/conversations/{uuid}/load-responses',
                    fallback: '/rest/app-chat/conversations/{uuid}/load-responses'
                },
                // Optional: metadata (returns {} for some convos but has title when available)
                conversationMeta: {
                    primary: '/rest/app-chat/conversations_v2/{uuid}',
                    fallback: '/rest/app-chat/conversations_v2/{uuid}',
                    params: () => '?includeWorkspaces=true'
                }
            },
            patterns: {
                uuidExtract: [
                    /\/c\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
                    /\/chat\/([a-zA-Z0-9_-]+)/,
                    /\/c\/([a-zA-Z0-9_-]+)/,
                    /\/conversation\/([a-zA-Z0-9_-]+)/
                ]
            },
            dataFields: {
                // HAR-verified: messages use 'message' not 'content', 'sender' not 'role'
                answer: ['message', 'content', 'text', 'response'],
                query: ['message', 'query', 'prompt', 'text', 'input'],
                title: ['title', 'name', 'summary'],
                // HAR-verified: sender values are 'human' and 'assistant'
                role: ['sender', 'role', 'author']
            }
        },

        DeepSeek: {
            name: 'DeepSeek',
            baseUrl: 'https://chat.deepseek.com',
            versions: {
                current: 'v0',
                fallback: 'v1',
                experimental: 'v2'
            },
            endpoints: {
                conversations: {
                    primary: '/api/v0/chat_session/fetch_page',
                    fallback: '/api/v0/chat/list',
                    params: () => '?lte_cursor.pinned=false'
                },
                // HAR-verified: correct endpoint is flat with chat_session_id param + cache_version=2
                conversationDetail: {
                    primary: '/api/v0/chat/history_messages',
                    fallback: '/api/v0/chat/history_messages',
                    params: (uuid) => `?chat_session_id=${uuid}&cache_version=2`
                },
                chatSession: {
                    primary: '/api/v0/chat_session/{uuid}',
                    fallback: '/api/chat/{uuid}'
                }
            },
            patterns: {
                uuidExtract: [
                    /chat\.deepseek\.com(?:\/a)?\/chat\/s?\/([a-zA-Z0-9-]+)/,
                    /[?&](?:s|session|chat_session_id)=([a-zA-Z0-9-]+)/,
                    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
                ]
            },
            dataFields: {
                answer: ['content', 'message.content', 'text', 'assistant_message', 'response'],
                query: ['content', 'message.content', 'text', 'user_message', 'query', 'prompt'],
                title: ['title', 'name', 'summary', 'first_query'],
                role: ['role', 'message.role', 'sender', 'author']
            },
            // DeepSeek-specific settings
            authTokenKey: 'userToken',
            useCursorPagination: true,
            rateLimit: {
                requestsPerMinute: 30,
                delayMs: 300
            }
        }
    };

    // ============================================
    // PLATFORM CONFIG MANAGER (Enhanced with Test Mode)
    // ============================================
    class PlatformConfigManager {
        constructor() {
            this.activeVersions = new Map();
            this.failedEndpoints = new Map();
            this.testMode = false;
        }

        enableTestMode() {
            this.testMode = true;
            console.warn('[PlatformConfig] TEST MODE ENABLED - All primary endpoints will fail');
        }

        disableTestMode() {
            this.testMode = false;
            this.failedEndpoints.clear();
            console.log('[PlatformConfig] Test mode disabled');
        }

        getConfig(platformName) {
            const config = window.PLATFORM_CONFIGS[platformName];
            if (!config) {
                console.warn(`[PlatformConfig] Unknown platform: ${platformName}`);
                return null;
            }
            return config;
        }

        buildEndpoint(platformName, endpointKey, params = {}) {
            const config = this.getConfig(platformName);
            if (!config) return null;

            const endpoint = config.endpoints[endpointKey];
            if (!endpoint) {
                console.warn(`[PlatformConfig] Unknown endpoint: ${endpointKey}`);
                return null;
            }

            const failKey = `${platformName}:${endpointKey}`;

            // In test mode, always use fallback if available
            let url = (this.testMode || this.failedEndpoints.get(failKey)) && endpoint.fallback
                ? endpoint.fallback
                : endpoint.primary;

            if (this.testMode && endpoint.fallback) {
                console.log(`[PlatformConfig] TEST MODE: Using fallback for ${failKey}`);
            }

            // Replace placeholders
            for (const [key, value] of Object.entries(params)) {
                url = url.replace(`{${key}}`, value);
            }

            // Add query parameters
            if (endpoint.params && typeof endpoint.params === 'function') {
                const version = this.activeVersions.get(platformName) || config.versions.current;
                url += endpoint.params(version);
            }

            return url;
        }

        markEndpointFailed(platformName, endpointKey) {
            const failKey = `${platformName}:${endpointKey}`;
            this.failedEndpoints.set(failKey, true);
            console.warn(`[PlatformConfig] Marked endpoint as failed: ${failKey}`);
        }

        extractUuid(platformName, url) {
            const config = this.getConfig(platformName);
            if (!config) return null;

            for (const pattern of config.patterns.uuidExtract) {
                const match = url.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            console.warn(`[PlatformConfig] No UUID pattern matched for ${platformName}`);
            return null;
        }

        getBaseUrl(platformName) {
            const config = this.getConfig(platformName);
            return config ? config.baseUrl : null;
        }

        setActiveVersion(platformName, version) {
            this.activeVersions.set(platformName, version);
        }

        getHealthReport() {
            return {
                failedEndpoints: Array.from(this.failedEndpoints.keys()),
                activeVersions: Object.fromEntries(this.activeVersions),
                testMode: this.testMode
            };
        }
    }

    // Keep existing DataExtractor class unchanged (lines 192-326)

    class DataExtractor {
        /**
         * Extract answer with multiple fallback strategies
         */
        static extractAnswer(entry, platformName = 'Perplexity') {
            const config = window.PLATFORM_CONFIGS[platformName];
            if (!config) return '';

            const paths = config.dataFields.answer || [];

            for (const path of paths) {
                const value = this.getValueByPath(entry, path);
                if (value) {
                    return typeof value === 'string' ? value :
                        Array.isArray(value) ? value.join('\n') : String(value);
                }
            }

            // Generic fallbacks
            if (entry.answer) return entry.answer;
            if (entry.text) return entry.text;
            if (entry.content) return typeof entry.content === 'string' ? entry.content : '';

            return '';
        }

        /**
         * Extract query/question
         */
        static extractQuery(entry, platformName = 'Perplexity') {
            const config = window.PLATFORM_CONFIGS[platformName];
            if (!config) return '';

            const paths = config.dataFields.query || [];

            for (const path of paths) {
                const value = this.getValueByPath(entry, path);
                if (value) {
                    return typeof value === 'string' ? value :
                        Array.isArray(value) ? value[0] : String(value);
                }
            }

            return entry.query || entry.query_str || entry.question || '';
        }

        /**
         * Extract title
         */
        static extractTitle(data, platformName = 'Perplexity') {
            const config = window.PLATFORM_CONFIGS[platformName];
            if (!config) return 'Untitled';

            const paths = config.dataFields.title || [];

            for (const path of paths) {
                const value = this.getValueByPath(data, path);
                if (value && typeof value === 'string' && value.trim()) {
                    return value.slice(0, 100);
                }
            }

            return 'Untitled';
        }

        /**
         * Get value from object using dot notation
         * Supports array notation: blocks[].markdown_block.answer
         */
        static getValueByPath(obj, path) {
            if (!obj || !path) return null;

            // Handle array extraction: blocks[].field
            if (path.includes('[]')) {
                const [arrayPath, ...rest] = path.split('[].');
                const array = this.getValueByPath(obj, arrayPath);

                if (!Array.isArray(array)) return null;

                // Extract from first matching item
                for (const item of array) {
                    const value = this.getValueByPath(item, rest.join('.'));
                    if (value) return value;
                }
                return null;
            }

            // Standard dot notation
            const parts = path.split('.');
            let current = obj;

            for (const part of parts) {
                if (current === null || current === undefined) return null;
                current = current[part];
            }

            return current;
        }

        /**
         * Extract from Perplexity blocks specifically
         */
        static extractFromPerplexityBlocks(entry) {
            if (!entry.blocks || !Array.isArray(entry.blocks)) {
                return { answer: '', sources: [] };
            }

            let answer = '';
            let sources = [];

            for (const block of entry.blocks) {
                // Answer extraction
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    const blockAnswer = block.markdown_block.answer ||
                        (block.markdown_block.chunks || []).join('\n');
                    if (blockAnswer) answer += blockAnswer + '\n\n';
                }

                // Alternative answer fields
                if (block.text_block?.content) {
                    answer += block.text_block.content + '\n\n';
                }

                // Source extraction
                if (block.intended_usage === 'web_results' && block.web_result_block?.web_results) {
                    sources = sources.concat(block.web_result_block.web_results);
                }
            }

            return { answer: answer.trim(), sources };
        }
    }

    // ============================================
    // PLATFORM VERSION DETECTOR
    // ============================================
    class PlatformVersionDetector {
        constructor() {
            this.cache = new Map();
            this.cacheTTL = 3600000; // 1 hour
        }

        async detect(platformName) {
            // Check cache
            const cached = this.cache.get(platformName);
            if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.version;
            }

            const version = await this.detectVersion(platformName);
            this.cache.set(platformName, { version, timestamp: Date.now() });
            return version;
        }

        async detectVersion(platformName) {
            switch (platformName) {
                case 'Perplexity':
                    return await this.detectPerplexityVersion();
                case 'Claude':
                    return await this.detectClaudeVersion();
                case 'ChatGPT':
                    return await this.detectChatGPTVersion();
                default:
                    return 'unknown';
            }
        }

        async detectPerplexityVersion() {
            const versions = ['2.18', '2.19', '3.0'];

            for (const version of versions) {
                try {
                    const url = `https://www.perplexity.ai/rest/thread/list_ask_threads?version=${version}&source=default`;
                    const response = await fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ limit: 1, offset: 0 })
                    });

                    if (response.ok || response.status === 400) {
                        console.log(`[VersionDetector] Perplexity version: ${version}`);
                        return version;
                    }
                } catch (e) {
                    continue;
                }
            }

            return PLATFORM_CONFIGS.Perplexity.versions.current;
        }

        async detectClaudeVersion() {
            try {
                const response = await fetch('https://claude.ai/api/organizations', {
                    credentials: 'include'
                });

                if (response.ok) {
                    return 'v1';
                }
            } catch (e) {
                console.warn('[VersionDetector] Claude detection failed');
            }

            return PLATFORM_CONFIGS.Claude.versions.current;
        }

        async detectChatGPTVersion() {
            try {
                const response = await fetch('https://chatgpt.com/backend-api/models', {
                    credentials: 'include'
                });

                if (response.ok) {
                    return 'backend-api';
                }
            } catch (e) {
                console.warn('[VersionDetector] ChatGPT detection failed');
            }

            return PLATFORM_CONFIGS.ChatGPT.versions.current;
        }
    }

    // ============================================
    // PLATFORM HEALTH MONITOR
    // ============================================
    class PlatformHealthMonitor {
        constructor() {
            this.healthStatus = new Map();
            this.lastCheck = new Map();
            this.failureCount = new Map();
            this.checkInterval = 60000; // 1 minute
        }

        async checkHealth(platformName, adapter) {
            const lastCheck = this.lastCheck.get(platformName) || 0;

            // Don't check too frequently
            if (Date.now() - lastCheck < this.checkInterval) {
                return this.healthStatus.get(platformName) || { healthy: true };
            }

            const health = await this.performHealthCheck(platformName, adapter);

            this.healthStatus.set(platformName, health);
            this.lastCheck.set(platformName, Date.now());

            if (!health.healthy) {
                const failures = (this.failureCount.get(platformName) || 0) + 1;
                this.failureCount.set(platformName, failures);

                if (failures >= 3) {
                    await this.recordPlatformIssue(platformName, health.error);
                }
            } else {
                this.failureCount.set(platformName, 0);
            }

            return health;
        }

        async performHealthCheck(platformName, adapter) {
            try {
                // Try minimal data fetch
                const testResult = await adapter.getThreads(1, 1);

                if (testResult && testResult.threads !== undefined) {
                    return {
                        healthy: true,
                        lastCheck: Date.now(),
                        threadsFound: testResult.threads.length
                    };
                }

                return { healthy: false, error: 'No data returned' };
            } catch (error) {
                return {
                    healthy: false,
                    error: error.message,
                    lastCheck: Date.now(),
                    recoveryAction: this.suggestRecovery(error)
                };
            }
        }

        suggestRecovery(error) {
            const msg = (error.message || '').toLowerCase();

            if (msg.includes('unauthorized') || msg.includes('401')) return 'SESSION_EXPIRED';
            if (msg.includes('not found') || msg.includes('404')) return 'ENDPOINT_CHANGED';
            if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED';
            if (msg.includes('network') || msg.includes('fetch')) return 'NETWORK_ERROR';

            return 'UNKNOWN';
        }

        async recordPlatformIssue(platformName, error) {
            try {
                const { platformIssues = [] } = await chrome.storage.local.get('platformIssues');

                platformIssues.unshift({
                    platform: platformName,
                    error,
                    timestamp: Date.now(),
                    severity: 'high'
                });

                await chrome.storage.local.set({
                    platformIssues: platformIssues.slice(0, 10)
                });

                console.error(`[HealthMonitor] Platform issue: ${platformName} - ${error}`);
            } catch (e) {
                console.error('[HealthMonitor] Failed to record issue:', e);
            }
        }

        getRecoveryMessage(action) {
            const messages = {
                'SESSION_EXPIRED': 'Please refresh the platform page and log in again',
                'ENDPOINT_CHANGED': 'Platform API may have changed. Try updating the extension',
                'RATE_LIMITED': 'Too many requests. Wait a few minutes and try again',
                'NETWORK_ERROR': 'Network issue. Check your internet connection',
                'UNKNOWN': 'An unknown error occurred. Try refreshing the page'
            };

            return messages[action] || messages['UNKNOWN'];
        }

        getStatus(platformName) {
            return this.healthStatus.get(platformName) || { healthy: true, status: 'unknown' };
        }
    }

// ============================================
// GLOBAL INSTANCES (Always re-create on every injection)
// ============================================
window.platformConfig = new (window.PlatformConfigManager || PlatformConfigManager)();
window.versionDetector = new (window.PlatformVersionDetector || PlatformVersionDetector)();
window.healthMonitor = new (window.PlatformHealthMonitor || PlatformHealthMonitor)();

// Expose classes to window only once
if (!window.PlatformConfigManager) {
    window.PlatformConfigManager = PlatformConfigManager;
    window.PlatformVersionDetector = PlatformVersionDetector;
    window.PlatformHealthMonitor = PlatformHealthMonitor;
    window.DataExtractor = DataExtractor;
}

// Export for content script usage
console.log('[PlatformConfig] Platform resilience layer loaded');

