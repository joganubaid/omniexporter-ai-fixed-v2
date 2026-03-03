/**
 * Notion OAuth2 Authentication Module
 * Uses server-side token exchange for security
 * Client secret is stored on Cloudflare Worker, never exposed to extension
 */
"use strict";

// Named constants
const TOKEN_EXPIRY_FALLBACK_SECONDS = 3600; // Default when expires_in is not returned

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
        // Set OAUTH_SERVER_URL in config.js to use your own worker.
        // The fallback below is the project's default OAuth server (public, shared instance).
        tokenServerEndpoint: typeof OAUTH_SERVER_URL !== 'undefined'
            ? `${OAUTH_SERVER_URL}/api/notion/token`
            : 'https://omniexporter-oauth.jonub250383.workers.dev/api/notion/token', // Project default — set OAUTH_SERVER_URL in config.js for custom deployment

        // Standard Notion endpoints
        redirectUri: null, // Set dynamically
        authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
        scopes: ['read_content', 'insert_content']
    },

    // Rate limiting for token requests
    _lastTokenRequest: 0,
    _TOKEN_COOLDOWN_MS: 5000,

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
        const codeVerifier = this._generateCodeVerifier();
        const codeChallenge = await this._generateCodeChallenge(codeVerifier);
        await chrome.storage.local.set({
            notion_oauth_state: state,
            notion_oauth_state_created: Date.now(),
            notion_oauth_code_verifier: codeVerifier
        });

        // Build authorization URL
        const authUrl = new URL(this.config.authorizationEndpoint);
        authUrl.searchParams.set('client_id', this.config.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
        authUrl.searchParams.set('owner', 'user');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('scope', this.config.scopes.join(' '));
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

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

                        const stored = await chrome.storage.local.get(['notion_oauth_state', 'notion_oauth_state_created']);
                        if (stored.notion_oauth_state && returnedState !== stored.notion_oauth_state) {
                            reject(new Error('OAuth state mismatch. Please try again.'));
                            return;
                        }

                        const stateCreated = stored.notion_oauth_state_created || 0;
                        if (Date.now() - stateCreated > 10 * 60 * 1000) {
                            reject(new Error('OAuth state expired. Please try again.'));
                            return;
                        }

                        _logOAuth('info', 'Received authorization code');

                        // Exchange code for access token
                        const tokens = await this.exchangeCodeForToken(code);
                        await chrome.storage.local.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                        resolve(tokens);
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    },

    // PKCE helpers
    _generateCodeVerifier() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    },

    async _generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    },

    /**
     * Exchange authorization code for access token
     * Sends code to our Cloudflare Worker which has the client secret
     */
    async exchangeCodeForToken(code) {
        const now = Date.now();
        if (now - this._lastTokenRequest < this._TOKEN_COOLDOWN_MS) {
            throw new Error('Token request rate limited. Please wait a few seconds.');
        }
        this._lastTokenRequest = now;

        _logOAuth('debug', 'Exchanging code for token via server...');

        const stored = await chrome.storage.local.get(['notion_oauth_code_verifier']);

        // Send code to our server which has the client secret
        const response = await fetch(this.config.tokenServerEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: code,
                redirect_uri: this.config.redirectUri,
                code_verifier: stored.notion_oauth_code_verifier || undefined
            })
        });

        if (!response.ok) {
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || '60';
                _logOAuth('warn', 'Rate limited by token server', { retryAfter });
                throw new Error(`Rate limited. Please try again in ${retryAfter} seconds.`);
            }
            const error = await response.json().catch(() => ({}));
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
        const expiresIn = tokens.expires_in || TOKEN_EXPIRY_FALLBACK_SECONDS;
        const expiresAt = Date.now() + (expiresIn * 1000);
        const existing = await chrome.storage.local.get([
            'notion_oauth_workspace_id',
            'notion_oauth_workspace_name'
        ]);

        // Access token in session storage (ephemeral — cleared on browser close)
        if (chrome.storage.session) {
            await chrome.storage.session.set({
                notion_oauth_access_token: tokens.access_token
            });
        } else {
            // Fallback for older Chrome versions
            await chrome.storage.local.set({
                notion_oauth_access_token: tokens.access_token
            });
        }

        // Refresh token + metadata in local storage (persistent)
        await chrome.storage.local.set({
            notion_oauth_refresh_token: tokens.refresh_token,
            notion_oauth_token_expires: expiresAt,
            notion_oauth_workspace_id: tokens.workspace_id || existing.notion_oauth_workspace_id,
            notion_oauth_workspace_name: tokens.workspace_name || existing.notion_oauth_workspace_name,
            notion_auth_method: 'oauth' // Track which auth method is active
        });

        _logOAuth('info', 'Tokens stored securely', {
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            sessionStorage: !!chrome.storage.session
        });

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
        // Try session storage first (preferred — ephemeral)
        if (chrome.storage.session) {
            const sessionData = await chrome.storage.session.get('notion_oauth_access_token');
            if (sessionData.notion_oauth_access_token) {
                // Check if token is expired
                const { notion_oauth_token_expires, notion_oauth_refresh_token } =
                    await chrome.storage.local.get(['notion_oauth_token_expires', 'notion_oauth_refresh_token']);
                if (notion_oauth_token_expires && Date.now() >= notion_oauth_token_expires) {
                    _logOAuth('info', 'Token expired, refreshing...');
                    return await this.refreshAccessToken(notion_oauth_refresh_token);
                }
                return sessionData.notion_oauth_access_token;
            }
        }

        // Fallback to local storage
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
            throw new Error('No refresh token available. Please re-authorize.');
        }

        const now = Date.now();
        if (now - this._lastTokenRequest < this._TOKEN_COOLDOWN_MS) {
            throw new Error('Token request rate limited. Please wait a few seconds.');
        }
        this._lastTokenRequest = now;

        _logOAuth('info', 'Refreshing access token via server...');

        // Route through Cloudflare Worker — same as exchangeCodeForToken
        // The server holds the client secret; we never expose it client-side
        const response = await fetch(this.config.tokenServerEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || '60';
                _logOAuth('warn', 'Rate limited by token server', { retryAfter });
                throw new Error(`Rate limited. Please try again in ${retryAfter} seconds.`);
            }
            const errorData = await response.json().catch(() => ({}));
            _logOAuth('error', 'Token refresh failed', { status: response.status });
            // If refresh fails, user needs to re-authorize
            await this.disconnect();
            throw new Error('Session expired. Please reconnect to Notion.');
        }

        const tokens = await response.json();
        await this.storeTokens(tokens);

        _logOAuth('info', 'Token refreshed successfully via server');
        return tokens.access_token;
    },

    /**
     * Revoke OAuth access and clear tokens
     */
    async disconnect() {
        // Clear session storage
        if (chrome.storage.session) {
            await chrome.storage.session.remove(['notion_oauth_access_token']);
        }

        // Clear local storage
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
            'notion_oauth_token_expires',
            'notion_oauth_workspace_name',
            'notion_auth_method'
        ]);

        // Check session storage for access token first
        let hasAccessToken = false;
        if (chrome.storage.session) {
            const sessionData = await chrome.storage.session.get('notion_oauth_access_token');
            hasAccessToken = !!sessionData.notion_oauth_access_token;
        }
        if (!hasAccessToken) {
            const localData = await chrome.storage.local.get('notion_oauth_access_token');
            hasAccessToken = !!localData.notion_oauth_access_token;
        }

        return {
            connected: hasAccessToken,
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
                const err = await response.json().catch(() => ({}));
                throw new Error(`API Error: ${err.message || response.statusText}`);
            }

            const data = await response.json().catch(() => null);
            if (!data) throw new Error('Failed to parse API response');
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
            const err = await response.json().catch(() => ({}));
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
