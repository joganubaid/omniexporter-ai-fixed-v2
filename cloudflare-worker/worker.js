/**
 * OmniExporter AI - Notion OAuth Token Exchange Worker
 * Deploy to Cloudflare Workers
 * 
 * This worker securely exchanges OAuth authorization codes for access tokens.
 * The client secret is stored as an environment variable, never exposed to clients.
 */

// CORS headers for cross-origin requests from extension
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);

        // Health check endpoint
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', service: 'omniexporter-oauth' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};

async function handleTokenExchange(request, env) {
    try {
        const { code, redirect_uri } = await request.json();

        if (!code) {
            return jsonResponse({ error: 'Missing authorization code' }, 400);
        }

        // Get credentials from environment variables
        const clientId = env.NOTION_CLIENT_ID;
        const clientSecret = env.NOTION_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('Missing environment variables');
            return jsonResponse({ error: 'Server configuration error' }, 500);
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
                redirect_uri: redirect_uri
            })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('Notion token exchange failed:', tokenData);
            return jsonResponse({
                error: tokenData.error || 'Token exchange failed',
                error_description: tokenData.error_description
            }, tokenResponse.status);
        }

        // Return successful token response
        // Only return what the extension needs (not the full response for security)
        return jsonResponse({
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            workspace_id: tokenData.workspace_id,
            workspace_name: tokenData.workspace_name,
            workspace_icon: tokenData.workspace_icon,
            bot_id: tokenData.bot_id,
            owner: tokenData.owner
        });

    } catch (error) {
        console.error('Token exchange error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

async function handleTokenRefresh(request, env) {
    // Notion doesn't support refresh tokens yet, but this is here for future use
    return jsonResponse({ error: 'Refresh not supported by Notion API' }, 501);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
        }
    });
}
