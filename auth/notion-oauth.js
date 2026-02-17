/**
 * Notion OAuth2 Authentication Module
 * Uses server-side token exchange for security
 * Client secret is stored on Cloudflare Worker, never exposed to extension
 */

// Helper to safely call Logger (use var to allow redeclaration in service worker context)
var _logOAuth = _logOAuth || function (level, message, data) {
    if (typeof Logger !== 'undefined') {
        Logger[level]('OAuth', message, data);
    }
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[NotionOAuth] ${message}`, data || '');
};

var NotionOAuth = {
    // OAuth2 Configuration
    // Client ID is loaded from config, Secret is on server only
    config: {
        // Client ID - set via config.js or environment
        // To configure: Create config.js with NOTION_CLIENT_ID
        clientId: typeof NOTION_CLIENT_ID !== 'undefined' ? NOTION_CLIENT_ID : null,

        // Server endpoint for secure token exchange
        // Your deployed Cloudflare Worker
        tokenServerEndpoint: typeof OAUTH_SERVER_URL !== 'undefined'
            ? `${OAUTH_SERVER_URL}/api/notion/token`
            : 'https://omniexporter-oauth.jonub250383.workers.dev/api/notion/token',

        // Standard Notion endpoints
        redirectUri: null, // Set dynamically
        authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
        scopes: ['read_content', 'insert_content']
    },

    /**
     * Initialize OAuth configuration
     * No need for user to enter Client ID/Secret anymore!
     */
    async init() {
        try {
            // Set redirect URI dynamically from extension ID
            this.config.redirectUri = chrome.identity.getRedirectURL('notion');

            _logOAuth('info', 'OAuth initialized', { redirectUri: this.config.redirectUri });
            return true;
        } catch (error) {
            _logOAuth('error', 'Init failed', { error: error.message });
            return false;
        }
    },

    /**
     * Check if OAuth is properly configured
     * Now always returns true since Client ID is hardcoded
     */
    isConfigured() {
        return !!(this.config.clientId && this.config.tokenServerEndpoint);
    },

    /**
     * Start OAuth2 authorization flow
     */
    async authorize() {
        if (!this.config.clientId) {
            throw new Error('OAuth not configured - Client ID missing');
        }

        const state = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await chrome.storage.local.set({ notion_oauth_state: state });

        // Build authorization URL
        const authUrl = new URL(this.config.authorizationEndpoint);
        authUrl.searchParams.set('client_id', this.config.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
        authUrl.searchParams.set('owner', 'user');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('scope', this.config.scopes.join(' '));

        _logOAuth('info', 'Starting authorization flow');

        // Open authorization window
        return new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow(
                {
                    url: authUrl.toString(),
                    interactive: true
                },
                async (redirectUrl) => {
                    if (chrome.runtime.lastError) {
                        _logOAuth('error', 'Auth flow error', { error: chrome.runtime.lastError.message });
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    try {
                        // Extract authorization code from redirect URL
                        const url = new URL(redirectUrl);
                        const code = url.searchParams.get('code');
                        const error = url.searchParams.get('error');
                        const returnedState = url.searchParams.get('state');

                        if (error) {
                            reject(new Error(`OAuth error: ${error}`));
                            return;
                        }

                        if (!code) {
                            reject(new Error('No authorization code received'));
                            return;
                        }

                        const stored = await chrome.storage.local.get(['notion_oauth_state']);
                        if (stored.notion_oauth_state && returnedState !== stored.notion_oauth_state) {
                            reject(new Error('OAuth state mismatch. Please try again.'));
                            return;
                        }

                        _logOAuth('info', 'Received authorization code');

                        // Exchange code for access token
                        const tokens = await this.exchangeCodeForToken(code);
                        await chrome.storage.local.remove(['notion_oauth_state']);
                        resolve(tokens);
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    },

    /**
     * Exchange authorization code for access token
     * Sends code to our Cloudflare Worker which has the client secret
     */
    async exchangeCodeForToken(code) {
        _logOAuth('debug', 'Exchanging code for token via server...');

        // Send code to our server which has the client secret
        const response = await fetch(this.config.tokenServerEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: code,
                redirect_uri: this.config.redirectUri
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
        }

        const tokens = await response.json();
        _logOAuth('info', 'Token exchange successful');

        // Store tokens securely
        await this.storeTokens(tokens);

        return tokens;
    },

    /**
     * Create export database in user's workspace
     * Called automatically after OAuth token exchange
     */
    async createExportDatabase(accessToken) {
        _logOAuth('debug', 'Creating export database...');

        // 1. Search for a parent page to create database under
        const searchResponse = await fetch('https://api.notion.com/v1/search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filter: { property: 'object', value: 'page' },
                page_size: 10
            })
        });

        if (!searchResponse.ok) {
            const err = await searchResponse.json();
            throw new Error(`Search failed: ${err.message || searchResponse.status}`);
        }

        const pages = await searchResponse.json();
        if (!pages.results || pages.results.length === 0) {
            throw new Error('No pages found. Please share at least one page with the integration in Notion.');
        }

        // Use first available page as parent
        const parentPageId = pages.results[0].id;
        _logOAuth('debug', 'Using parent page for database', { parentPageId });

        // 2. Create database with export schema
        const createResponse = await fetch('https://api.notion.com/v1/databases', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                parent: { page_id: parentPageId },
                title: [{ text: { content: '🤖 AI Chats Export' } }],
                properties: {
                    'Title': { title: {} },
                    'Platform': {
                        select: {
                            options: [
                                { name: 'Perplexity', color: 'blue' },
                                { name: 'ChatGPT', color: 'green' },
                                { name: 'Claude', color: 'orange' },
                                { name: 'Gemini', color: 'purple' },
                                { name: 'Grok', color: 'red' },
                                { name: 'DeepSeek', color: 'pink' }
                            ]
                        }
                    },
                    'Exported': { date: {} },
                    'URL': { url: {} }
                }
            })
        });

        if (!createResponse.ok) {
            const err = await createResponse.json();
            throw new Error(`Database creation failed: ${err.message || createResponse.status}`);
        }

        const database = await createResponse.json();
        console.log('[NotionOAuth] ✓ Database created:', database.id);

        // 3. Save database ID to storage
        await chrome.storage.local.set({
            notionDbId: database.id,
            notionDbName: 'AI Chats Export',
            notionDbCreatedAt: Date.now()
        });

        return database;
    },

    /**
     * Store OAuth tokens securely
     */
    async storeTokens(tokens) {
        const expiresAt = Date.now() + (tokens.expires_in * 1000);
        const existing = await chrome.storage.local.get([
            'notion_oauth_workspace_id',
            'notion_oauth_workspace_name'
        ]);

        await chrome.storage.local.set({
            notion_oauth_access_token: tokens.access_token,
            notion_oauth_refresh_token: tokens.refresh_token,
            notion_oauth_token_expires: expiresAt,
            notion_oauth_workspace_id: tokens.workspace_id || existing.notion_oauth_workspace_id,
            notion_oauth_workspace_name: tokens.workspace_name || existing.notion_oauth_workspace_name,
            notion_auth_method: 'oauth' // Track which auth method is active
        });

        _logOAuth('info', 'Tokens stored successfully');

        // Auto-create export database if not exists
        const { notionDbId } = await chrome.storage.local.get('notionDbId');
        if (!notionDbId) {
            try {
                await this.createExportDatabase(tokens.access_token);
            } catch (e) {
                _logOAuth('warn', 'Could not auto-create database', { error: e.message });
                // Don't throw - user can still manually configure later
            }
        } else {
            _logOAuth('debug', 'Database already exists', { notionDbId });
        }
    },

    /**
     * Get current access token (refreshing if needed)
     */
    async getAccessToken() {
        const stored = await chrome.storage.local.get([
            'notion_oauth_access_token',
            'notion_oauth_refresh_token',
            'notion_oauth_token_expires'
        ]);

        // Check if token exists
        if (!stored.notion_oauth_access_token) {
            throw new Error('No OAuth token found. Please authorize first.');
        }

        // Check if token is expired
        if (stored.notion_oauth_token_expires && Date.now() >= stored.notion_oauth_token_expires) {
            _logOAuth('info', 'Token expired, refreshing...');
            return await this.refreshAccessToken(stored.notion_oauth_refresh_token);
        }

        return stored.notion_oauth_access_token;
    },

    /**
     * Refresh expired access token
     */
    async refreshAccessToken(refreshToken) {
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        _logOAuth('debug', 'Refreshing access token...');

        const response = await fetch(this.config.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${this.config.clientId}:${this.config.clientSecret}`),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            throw new Error('Token refresh failed');
        }

        const tokens = await response.json();
        await this.storeTokens(tokens);

        console.log('[NotionOAuth] ✓ Token refreshed successfully');
        return tokens.access_token;
    },

    /**
     * Revoke OAuth access and clear tokens
     */
    async disconnect() {
        await chrome.storage.local.remove([
            'notion_oauth_access_token',
            'notion_oauth_refresh_token',
            'notion_oauth_token_expires',
            'notion_oauth_workspace_id',
            'notion_oauth_workspace_name',
            'notion_auth_method'
        ]);

        console.log('[NotionOAuth] Disconnected');
    },

    /**
     * Get OAuth connection status
     */
    async getStatus() {
        const stored = await chrome.storage.local.get([
            'notion_oauth_access_token',
            'notion_oauth_token_expires',
            'notion_oauth_workspace_name',
            'notion_auth_method'
        ]);

        return {
            connected: !!stored.notion_oauth_access_token,
            method: stored.notion_auth_method || 'token',
            workspace: stored.notion_oauth_workspace_name || null,
            expires: stored.notion_oauth_token_expires ? new Date(stored.notion_oauth_token_expires) : null
        };
    },

    /**
     * Resolve active Notion token (OAuth preferred)
     */
    async getActiveToken() {
        await this.init();
        const status = await this.getStatus();
        if (status.method === 'oauth' && status.connected) {
            return this.getAccessToken();
        }
        const stored = await chrome.storage.local.get(['notionApiKey', 'notionKey']);
        const token = stored.notionApiKey || stored.notionKey;
        if (!token) {
            throw new Error('No Notion API key or OAuth token configured');
        }
        if (!stored.notionApiKey && stored.notionKey) {
            await chrome.storage.local.set({ notionApiKey: stored.notionKey });
        }
        return token;
    },

    /**
     * Test Notion connection validity
     * Verifies token works against API
     */
    async testConnection() {
        try {
            const token = await this.getActiveToken();
            _logOAuth('info', 'Testing connection with token...');

            // Use the users/me endpoint (lightweight check)
            const response = await fetch('https://api.notion.com/v1/users/me', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Notion-Version': '2022-06-28'
                }
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(`API Error: ${err.message || response.statusText}`);
            }

            const data = await response.json();
            const workspaceName = data?.bot?.owner?.workspace ?
                data.bot.owner.workspace.name :
                (data.name || 'Notion Workspace');

            _logOAuth('info', 'Connection Verified', { workspace: workspaceName });

            return {
                success: true,
                workspaceName: workspaceName,
                botName: data.name
            };
        } catch (error) {
            _logOAuth('error', 'Connection test failed', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    },

    /**
     * Upload a page content to Notion (Used for Verification)
     */
    async uploadPage(properties, children, token) {
        if (!token) token = await this.getActiveToken();

        // Ensure database ID exists
        const stored = await chrome.storage.local.get('notionDbId');
        if (!stored.notionDbId) {
            throw new Error('No Notion Database configured. Please run setup first.');
        }

        const response = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                parent: { database_id: stored.notionDbId },
                properties: properties,
                children: children
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Upload failed: ${err.message || response.statusText}`);
        }

        return await response.json();
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotionOAuth;
}

// Make available globally
if (typeof globalThis !== 'undefined') {
    globalThis.NotionOAuth = NotionOAuth;
}
