/**
 * OmniExporter AI - Notion OAuth Token Exchange Worker
 * Deploy to Cloudflare Workers (free plan, no credit card required).
 *
 * Configuration (all read from Worker env — no code edits required for forks):
 *   - NOTION_CLIENT_ID      (secret) — your Notion integration's client id
 *   - NOTION_CLIENT_SECRET  (secret) — your Notion integration's client secret
 *   - ALLOWED_ORIGINS       (plain var) — comma-separated extension origins,
 *                             e.g. "chrome-extension://abc...,chrome-extension://def..."
 *                             If unset, ANY chrome-extension:// origin is allowed
 *                             (bootstrap mode — fine for local dev, weak for prod).
 *   - RATE_LIMIT_KV         (KV namespace binding) — optional. When bound, the
 *                             per-IP rate limit is shared across all worker
 *                             isolates globally. When unbound, falls back to
 *                             per-isolate in-memory tracking (defense in depth only).
 *
 * See cloudflare-worker/DEPLOY.md for the full setup walkthrough.
 */

// Rate limit window: 10 POSTs per 60 seconds per source IP.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
// KV TTL must clear the window (60s) by a wide margin so an in-flight window
// is never evicted mid-decrement. Minimum KV TTL is 60s.
const RATE_LIMIT_KV_TTL_SECONDS = 120;

// In-memory fallback (per-isolate) for when RATE_LIMIT_KV is not bound.
const RATE_LIMIT_MAP_MAX_SIZE = 10_000;
const rateLimitMap = new Map();

function getAllowedOrigins(env) {
    const raw = (env && env.ALLOWED_ORIGINS) || '';
    return new Set(
        raw.split(',')
            .map(s => s.trim())
            .filter(Boolean)
    );
}

function getCorsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = getAllowedOrigins(env);

    if (allowed.has(origin)) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin'
        };
    }

    // Bootstrap fallback: if the deployer hasn't configured ALLOWED_ORIGINS yet,
    // accept any chrome-extension:// origin so the worker is testable out of the
    // box. PRODUCTION deployments should set ALLOWED_ORIGINS.
    if (allowed.size === 0 && origin.startsWith('chrome-extension://')) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin'
        };
    }

    // Origin not allowed — return headers without an Allow-Origin so the
    // browser blocks the response.
    return {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
    };
}

async function isRateLimited(ip, env) {
    const now = Date.now();

    if (env && env.RATE_LIMIT_KV) {
        // KV-backed (shared across all isolates).
        // TOCTOU note: two concurrent requests from the same IP can both read
        // the same count and both write count+1. Acceptable slop for a
        // defense-in-depth limit on a low-traffic OAuth endpoint.
        const key = `rl:${ip}`;
        let entry = null;
        try {
            entry = await env.RATE_LIMIT_KV.get(key, { type: 'json' });
        } catch (e) {
            console.error('RATE_LIMIT_KV get failed:', e.message);
        }

        if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
            await safeKvPut(env.RATE_LIMIT_KV, key, { count: 1, windowStart: now });
            return false;
        }

        if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
            return true;
        }

        await safeKvPut(env.RATE_LIMIT_KV, key, { count: entry.count + 1, windowStart: entry.windowStart });
        return false;
    }

    // In-memory fallback — per isolate. Useful before deployer creates the KV namespace.
    if (rateLimitMap.size > RATE_LIMIT_MAP_MAX_SIZE) {
        for (const [key, val] of rateLimitMap) {
            if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) {
                rateLimitMap.delete(key);
            }
        }
    }

    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }
    entry.count++;
    return false;
}

async function safeKvPut(kv, key, value) {
    try {
        await kv.put(key, JSON.stringify(value), { expirationTtl: RATE_LIMIT_KV_TTL_SECONDS });
    } catch (e) {
        console.error('RATE_LIMIT_KV put failed:', e.message);
    }
}

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: getCorsHeaders(request, env) });
        }

        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                service: 'omniexporter-oauth',
                rate_limit: env && env.RATE_LIMIT_KV ? 'kv' : 'in-memory',
                allowed_origins_configured: getAllowedOrigins(env).size > 0
            }), {
                headers: { ...getCorsHeaders(request, env), 'Content-Type': 'application/json' }
            });
        }

        if (request.method === 'POST') {
            const clientIp = request.headers.get('CF-Connecting-IP')
                || request.headers.get('X-Forwarded-For')
                || 'unknown';
            if (await isRateLimited(clientIp, env)) {
                return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
                    status: 429,
                    headers: {
                        ...getCorsHeaders(request, env),
                        'Content-Type': 'application/json',
                        'Retry-After': '60'
                    }
                });
            }
        }

        if (url.pathname === '/api/notion/token' && request.method === 'POST') {
            return handleTokenExchange(request, env);
        }

        // Token refresh endpoint intentionally removed — Notion does not issue
        // refresh tokens; the extension re-runs the full authorize() flow.

        return new Response('Not Found', { status: 404, headers: getCorsHeaders(request, env) });
    }
};

async function handleTokenExchange(request, env) {
    try {
        const { code, redirect_uri, code_verifier } = await request.json();

        if (!code) {
            return jsonResponse({ error: 'Missing authorization code' }, 400, request, env);
        }

        const clientId = env.NOTION_CLIENT_ID;
        const clientSecret = env.NOTION_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('Missing NOTION_CLIENT_ID or NOTION_CLIENT_SECRET');
            return jsonResponse({ error: 'Server configuration error' }, 500, request, env);
        }

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
            console.error('Notion token exchange failed status=' + tokenResponse.status);
            const SAFE_ERROR_CODES = new Set(['invalid_grant', 'invalid_request', 'unauthorized_client', 'invalid_client']);
            const errorCode = SAFE_ERROR_CODES.has(tokenData.error) ? tokenData.error : 'token_exchange_failed';
            return jsonResponse({
                error: 'Token exchange failed',
                error_code: errorCode
            }, tokenResponse.status, request, env);
        }

        return jsonResponse({
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            workspace_id: tokenData.workspace_id,
            workspace_name: tokenData.workspace_name,
            workspace_icon: tokenData.workspace_icon,
            bot_id: tokenData.bot_id,
            owner: tokenData.owner
        }, 200, request, env);

    } catch (error) {
        console.error('Token exchange error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500, request, env);
    }
}


function jsonResponse(data, status, request, env) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...getCorsHeaders(request, env),
            'Content-Type': 'application/json'
        }
    });
}
