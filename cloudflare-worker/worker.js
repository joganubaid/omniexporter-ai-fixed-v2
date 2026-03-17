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

// Rate limiting: track requests per IP (in-memory, resets on worker restart)
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // max 10 requests per minute per IP
const RATE_LIMIT_MAP_MAX_SIZE = 10000; // max tracked IPs
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();

    // Periodic cleanup: evict expired entries when map gets large
    if (rateLimitMap.size > RATE_LIMIT_MAP_MAX_SIZE) {
        for (const [key, val] of rateLimitMap) {
            if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) {
                rateLimitMap.delete(key);
            }
        }
    }

    const entry = rateLimitMap.get(ip);
    if (!entry) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        // Reset window
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }
    return false;
}

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';

    if (ALLOWED_ORIGINS.has(origin)) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin'
        };
    }

    // Fallback: if no origins configured yet, allow any chrome-extension:// origin
    // so the extension can bootstrap. Deployers should add their extension ID
    // to ALLOWED_ORIGINS for production security.
    if (ALLOWED_ORIGINS.size === 0 && origin.startsWith('chrome-extension://')) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin'
        };
    }

    // Origin not allowed
    return {
        'Access-Control-Allow-Origin': '',
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

        // Rate limiting for POST endpoints
        if (request.method === 'POST') {
            const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
            if (isRateLimited(clientIp)) {
                return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
                    status: 429,
                    headers: {
                        ...getCorsHeaders(request),
                        'Content-Type': 'application/json',
                        'Retry-After': '60'
                    }
                });
            }
        }

        // Token exchange endpoint
        if (url.pathname === '/api/notion/token' && request.method === 'POST') {
            return handleTokenExchange(request, env);
        }

        // Token refresh endpoint — intentionally removed.
        // Notion does not issue refresh tokens; the extension performs a full re-auth flow.
        // The extension's refreshAccessToken() calls authorize() directly and never hits this path.

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
            // Map known error codes to safe values; do not expose raw API details
            const SAFE_ERROR_CODES = new Set(['invalid_grant', 'invalid_request', 'unauthorized_client', 'invalid_client']);
            const errorCode = SAFE_ERROR_CODES.has(tokenData.error) ? tokenData.error : 'token_exchange_failed';
            return jsonResponse({
                error: 'Token exchange failed',
                error_code: errorCode
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
