/**
 * OmniExporter AI - Notion OAuth Token Exchange Worker
 * Deploy to Cloudflare Workers
 * 
 * This worker securely exchanges OAuth authorization codes for access tokens.
 * The client secret is stored as an environment variable, never exposed to clients.
 */

// SEC-1 FIX: Restrict CORS to known Chrome extension origin instead of wildcard '*'.
// Add your extension's ID to the set below. Find it on chrome://extensions while loaded unpacked.
// For forks: deploy your own Cloudflare Worker and add YOUR extension ID here.
const ALLOWED_ORIGINS = new Set([
    // Add your extension ID here, e.g.:
    // 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
]);

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    // Allow listed extension origins; fall back to same-origin for health checks
    const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
    };
}
// Legacy alias for endpoints that haven't been updated yet
const corsHeaders = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export default {
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: getCorsHeaders(request) });
        }

        const url = new URL(request.url);

        // Health check endpoint
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', service: 'omniexporter-oauth' }), {
                headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' }
            });
        }

        // Token exchange endpoint
        if (url.pathname === '/api/notion/token' && request.method === 'POST') {
            return handleTokenExchange(request, env);
        }

        // Token refresh endpoint
        if (url.pathname === '/api/notion/refresh' && request.method === 'POST') {
            return handleTokenRefresh(request, env);
        }

        return new Response('Not Found', { status: 404, headers: getCorsHeaders(request) });
    }
};

async function handleTokenExchange(request, env) {
    try {
        const { code, redirect_uri, code_verifier } = await request.json();

        if (!code) {
            return jsonResponse({ error: 'Missing authorization code' }, 400, request);
        }

        // Get credentials from environment variables
        const clientId = env.NOTION_CLIENT_ID;
        const clientSecret = env.NOTION_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('Missing environment variables');
            return jsonResponse({ error: 'Server configuration error' }, 500, request);
        }

        // Exchange authorization code for access token
        const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${btoa(clientId + ':' + clientSecret)}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirect_uri,
                ...(code_verifier && { code_verifier })
            })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('Notion token exchange failed:', tokenData);
            return jsonResponse({
                error: tokenData.error || 'Token exchange failed',
                error_description: tokenData.error_description
            }, tokenResponse.status, request);
        }

        // Return successful token response
        // Only return what the extension needs (not the full response for security)
        return jsonResponse({
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            workspace_id: tokenData.workspace_id,
            workspace_name: tokenData.workspace_name,
            workspace_icon: tokenData.workspace_icon,
            bot_id: tokenData.bot_id,
            owner: tokenData.owner
        }, 200, request);

    } catch (error) {
        console.error('Token exchange error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500, request);
    }
}

async function handleTokenRefresh(request, env) {
    // Notion doesn't support refresh tokens yet, but this is here for future use
    return jsonResponse({ error: 'Refresh not supported by Notion API' }, 501, request);
}

function jsonResponse(data, status = 200, request = null) {
    const headers = request ? getCorsHeaders(request) : corsHeaders;
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        }
    });
}
