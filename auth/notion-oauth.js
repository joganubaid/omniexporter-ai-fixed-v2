/**
 * Notion OAuth2 Authentication Module
 * Uses server-side token exchange for security
 * Client secret is stored on Cloudflare Worker, never exposed to extension
 */
"use strict";

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

        // OAuth proxy endpoint. Forks should deploy their own Cloudflare Worker
        // and set OAUTH_SERVER_URL in config.js — otherwise tokens route through
        // the project's shared default worker. See cloudflare-worker/DEPLOY.md.
        tokenServerEndpoint: typeof OAUTH_SERVER_URL !== 'undefined'
            ? `${OAUTH_SERVER_URL}/api/notion/token`
            : 'https://omniexporter-oauth.jonub250383.workers.dev/api/notion/token',

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
     * @param {{interactive?: boolean}} options - interactive defaults to true.
     *   When false, the call will throw NOTION_REAUTH_REQUIRED instead of
     *   opening a window. Use from alarm/background contexts where popping a
     *   login window unprompted would be jarring.
     */
    async authorize(options = {}) {
        const interactive = options.interactive !== false;
        if (!interactive) {
            // Notion OAuth requires explicit user consent — there is no silent
            // grant path. Surface a tagged error so callers (e.g. auto-sync)
            // can badge the action icon and skip the run without prompting.
            await chrome.storage.local.set({ notion_reauth_required: true });
            throw new Error('NOTION_REAUTH_REQUIRED: Notion session expired. Open the extension to reconnect.');
        }

        if (!this.config.clientId || this.config.clientId === 'YOUR_CLIENT_ID_HERE') {
            throw new Error('OAuth not configured - Client ID missing. See config.example.js for setup instructions.');
        }
        if (this.config.tokenServerEndpoint && this.config.tokenServerEndpoint.includes('YOUR_SUBDOMAIN')) {
            throw new Error('OAuth not configured - tokenServerEndpoint (OAUTH_SERVER_URL) contains placeholder. See config.example.js for setup instructions.');
        }

        const state = crypto.randomUUID();
        const codeVerifier = this._generateCodeVerifier();
        const codeChallenge = await this._generateCodeChallenge(codeVerifier);
        // Flow artifacts live in session storage — they're only meaningful for
        // the ~minute round-trip to Notion and back. session is cleared on
        // browser restart, so abandoned flows can't leave PKCE material on disk.
        await chrome.storage.session.set({
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
                        chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
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
                            chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                            reject(new Error(`OAuth error: ${error}`));
                            return;
                        }

                        if (!code) {
                            chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                            reject(new Error('No authorization code received'));
                            return;
                        }

                        const stored = await chrome.storage.session.get(['notion_oauth_state', 'notion_oauth_state_created']);
                        // Reject null/missing returnedState — short-circuit on && would
                        // otherwise let a null bypass the check entirely.
                        if (!returnedState || !stored.notion_oauth_state || returnedState !== stored.notion_oauth_state) {
                            chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                            reject(new Error('OAuth state mismatch. Please try again.'));
                            return;
                        }

                        const stateCreated = stored.notion_oauth_state_created || 0;
                        if (Date.now() - stateCreated > 10 * 60 * 1000) {
                            chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                            reject(new Error('OAuth state expired. Please try again.'));
                            return;
                        }

                        _logOAuth('info', 'Received authorization code');

                        // Exchange code for access token
                        const tokens = await this.exchangeCodeForToken(code);
                        await chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                        resolve(tokens);
                    } catch (error) {
                        chrome.storage.session.remove(['notion_oauth_state', 'notion_oauth_state_created', 'notion_oauth_code_verifier']);
                        reject(error);
                    }
                }
            );
        });
    },

    // PKCE helpers
    _generateCodeVerifier() {
        // RFC 7636 recommends 43–128 chars from [A-Z][a-z][0-9]-._~.
        // base64url of 32 random bytes = 43 chars and matches the encoding used
        // for the code_challenge below — denser entropy than hex (which uses
        // only 16 of the allowed characters).
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return btoa(String.fromCharCode(...array))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
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

        const stored = await chrome.storage.session.get(['notion_oauth_code_verifier']);

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
            // Mask detailed API error messages to prevent information disclosure
            const safeError = error.error_code || 'unknown_error';
            throw new Error(`Token exchange failed (${safeError}). Please try again.`);
        }

        const tokens = await response.json().catch(() => null);
        if (!tokens) throw new Error('Token exchange returned invalid JSON. Possible Cloudflare challenge.');
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
            const err = await searchResponse.json().catch(() => ({}));
            throw new Error(`Search failed: ${err.message || searchResponse.status}`);
        }

        const pages = await searchResponse.json().catch(() => null);
        if (!pages || !pages.results || pages.results.length === 0) {
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
            const err = await createResponse.json().catch(() => ({}));
            throw new Error(`Database creation failed: ${err.message || createResponse.status}`);
        }

        const database = await createResponse.json().catch(() => null);
        if (!database || !database.id) throw new Error('Database created but response was invalid.');
        _logOAuth('info', 'Database created successfully', { id: database.id });

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
        // Notion's OAuth response does NOT include expires_in for most workspaces —
        // their access tokens are effectively non-expiring. Don't synthesise a
        // fake 1-hour expiry; storing null means getAccessToken won't trigger a
        // refresh, which is what we want (user stays signed in).
        const expiresAt = tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null;
        const existing = await chrome.storage.local.get([
            'notion_oauth_workspace_id',
            'notion_oauth_workspace_name'
        ]);

        // Notion access tokens do not expire (the OAuth response sometimes omits
        // expires_in entirely). Persist the access token alongside the refresh
        // token + workspace metadata so users stay signed in across browser
        // restarts — re-authenticating every time you reopen Chrome is a
        // worse experience than keeping the token in chrome.storage.local
        // (which is OS-encrypted on macOS/Windows/Linux when Chrome has access
        // to the platform keyring).
        await chrome.storage.local.set({
            notion_oauth_access_token: tokens.access_token,
            notion_oauth_refresh_token: tokens.refresh_token,
            notion_oauth_token_expires: expiresAt,
            notion_oauth_workspace_id: tokens.workspace_id || existing.notion_oauth_workspace_id,
            notion_oauth_workspace_name: tokens.workspace_name || existing.notion_oauth_workspace_name,
            notion_auth_method: 'oauth'
        });
        // Best-effort: clear any old session-stored access token from earlier
        // builds so getAccessToken() doesn't read a stale value.
        chrome.storage.session.remove(['notion_oauth_access_token']).catch(() => {});

        _logOAuth('info', 'Tokens stored securely', {
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token
        });

        // Clear any pending reauth flags — the user is reconnected.
        // (Cleared here so all reconnect paths — options page, popup, anywhere
        // future code calls storeTokens — handle the cleanup uniformly.)
        await chrome.storage.local.remove(['notion_reauth_required', 'notion_reauth_logged']);

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
     * Get current access token (refreshing if needed).
     * @param {{interactive?: boolean}} options - When false (background/alarm
     *   context), expired tokens throw NOTION_REAUTH_REQUIRED instead of
     *   opening the OAuth window. Defaults to true.
     */
    async getAccessToken(options = {}) {
        const stored = await chrome.storage.local.get([
            'notion_oauth_access_token',
            'notion_oauth_refresh_token',
            'notion_oauth_token_expires'
        ]);

        if (!stored.notion_oauth_access_token) {
            throw new Error('No OAuth token found. Please authorize first.');
        }

        if (stored.notion_oauth_token_expires && Date.now() >= stored.notion_oauth_token_expires) {
            _logOAuth('info', 'Token expired, refreshing...');
            return await this.refreshAccessToken(stored.notion_oauth_refresh_token, options);
        }

        return stored.notion_oauth_access_token;
    },

    /**
     * Notion OAuth does NOT support refresh tokens — the only way to get a new
     * access token is to run the full authorize() flow again.
     *
     * From an interactive context (user clicks "Reconnect"), this re-opens the
     * OAuth window. From a background context (interactive: false), it sets
     * a reauth flag and throws — callers should badge the action icon and skip
     * the run so the user can reconnect on their own time.
     */
    async refreshAccessToken(_refreshToken, options = {}) {
        const interactive = options.interactive !== false;

        if (!interactive) {
            _logOAuth('info', 'Token expired in background context — flagging for user reconnect (no window opened)');
            await chrome.storage.local.set({ notion_reauth_required: true });
            // Don't disconnect — keep workspace metadata so the UI can prompt
            // "Reconnect to <workspace>" instead of "Connect to Notion".
            throw new Error('NOTION_REAUTH_REQUIRED: Notion session expired. Open the extension to reconnect.');
        }

        _logOAuth('info', 'Token expired — re-authorizing...');
        // Clear the stale token so getActiveToken() doesn't loop
        await this.disconnect();

        try {
            const tokens = await this.authorize({ interactive: true });
            _logOAuth('info', 'Re-authorization successful');
            return tokens.access_token;
        } catch (authErr) {
            _logOAuth('error', 'Re-authorization failed', { error: authErr.message });
            throw new Error('Session expired. Please reconnect to Notion in Settings.');
        }
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
        // Clear any in-flight OAuth artifacts and stale session-stored tokens
        // from earlier builds.
        await chrome.storage.session.remove([
            'notion_oauth_access_token',
            'notion_oauth_state',
            'notion_oauth_state_created',
            'notion_oauth_code_verifier'
        ]);

        _logOAuth('info', 'Disconnected');
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
     * Resolve active Notion token (OAuth preferred).
     * @param {{interactive?: boolean}} options - Forwarded to getAccessToken.
     *   The integration-token fallback path ignores this — it never requires UI.
     */
    async getActiveToken(options = {}) {
        await this.init();
        const status = await this.getStatus();
        if (status.method === 'oauth' && status.connected) {
            return this.getAccessToken(options);
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
                _logOAuth('error', 'API Error details', { status: response.status, message: err.message });
                throw new Error(`Connection test failed (HTTP ${response.status}). Please check your token.`);
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
    }
};

// Make available globally — background.js loads this via importScripts,
// options.js/popup.js via <script>. No CommonJS shim needed.
if (typeof globalThis !== 'undefined') {
    globalThis.NotionOAuth = NotionOAuth;
}
