# OmniExporter OAuth Worker - Deployment Guide

## Prerequisites

1. **Cloudflare account** - [Sign up free](https://dash.cloudflare.com/sign-up)
2. **Node.js** installed
3. **Your Notion Integration credentials**

---

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

## Step 2: Login to Cloudflare

```bash
wrangler login
```
This opens a browser window - click "Allow" to authorize.

## Step 3: Deploy the Worker

```bash
cd cloudflare-worker
wrangler deploy
```

You'll see output like:
```
Uploaded omniexporter-oauth
Published omniexporter-oauth
  https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev
```

**Save this URL!** You'll need it for the extension.

## Step 4: Set Secret Environment Variables

```bash
wrangler secret put NOTION_CLIENT_ID
# Enter: YOUR_CLIENT_ID_HERE

wrangler secret put NOTION_CLIENT_SECRET
# Enter: YOUR_CLIENT_SECRET_HERE
```

## Step 4b: Configure the CORS Allow-List (env var, no code edit needed)

The worker restricts CORS to a configurable list of Chrome extension origins.
It reads them from an `ALLOWED_ORIGINS` environment variable — **no code edits
required**, even for forks.

**Find your extension ID:**
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle top-right)
3. Load the extension unpacked from the repo root
4. Copy the 32-character ID shown under the extension name (e.g. `abcdefghijklmnopabcdefghijklmnop`)

**Set the variable** via the dashboard (easiest):

1. **Workers & Pages → Your Worker → Settings → Variables and Secrets → Add variable**
2. Name: `ALLOWED_ORIGINS`
3. Value: `chrome-extension://YOUR_EXTENSION_ID`
4. Save → the worker reloads automatically (no redeploy needed).

Or commit the value to `wrangler.toml` under `[vars]` and run `wrangler deploy`. Either way, **no code edit required**.

**Supporting multiple extensions on one worker** (e.g. dev install + Chrome Web Store
ID + a fork you trust): set a comma-separated list — no whitespace requirements.
```
chrome-extension://abcd...,chrome-extension://efgh...,chrome-extension://ijkl...
```

> [!IMPORTANT]
> If `ALLOWED_ORIGINS` is unset, the worker accepts **any** `chrome-extension://` origin (bootstrap mode). Fine for local testing, weak for production — set it before publishing.

---

## Step 4c: Create the Rate-Limit KV Namespace (free, no credit card)

The worker uses Cloudflare KV to share rate-limit state across all worker
isolates. KV is on the **Workers Free plan** with no credit card needed.

```bash
cd cloudflare-worker
wrangler kv namespace create RATE_LIMIT
```

Wrangler prints something like:
```
🌀 Creating namespace with title "omniexporter-oauth-RATE_LIMIT"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "abc123def456..."
```

Open `wrangler.toml`, uncomment the `kv_namespaces` block at the bottom, and
paste the printed `id`. Then re-deploy with `wrangler deploy`.

> [!NOTE]
> Skipping this step is allowed — the worker falls back to per-isolate in-memory
> tracking. That works for low traffic but means a single IP can effectively
> get `10 × number_of_isolates` requests per minute. Always create the KV
> namespace for production.

---

## Step 5: Test the Worker


```bash
curl https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev/health
```

Should return:
```json
{
  "status": "ok",
  "service": "omniexporter-oauth",
  "rate_limit": "kv",
  "allowed_origins_configured": true
}
```

`rate_limit: "in-memory"` means you haven't completed Step 4c yet.
`allowed_origins_configured: false` means you haven't completed Step 4b yet.

---

## Step 6: Update Notion Integration

Go to [Notion Integrations](https://www.notion.so/my-integrations) and update:

1. **OAuth Domain**: Add your worker URL
2. **Redirect URIs**: Add your extension's redirect URI

---

## Step 7: Update Extension Configuration

After deploying, tell the extension your Worker URL via `config.js`:

```javascript
// In config.js (copy from config.example.js if you haven't already)
const OAUTH_SERVER_URL = 'https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev';
```

The extension reads `OAUTH_SERVER_URL` at startup and builds the token endpoint URL automatically. Do **not** edit `auth/notion-oauth.js` directly.

### CSP — no manifest edit needed for `*.workers.dev` URLs

`manifest.json`'s `content_security_policy.connect-src` includes
`https://*.workers.dev`, so any worker URL on Cloudflare's default domain is
allowed without editing the manifest. **If you deploy your worker to a custom
domain** (e.g. `oauth.yourdomain.com`), you'll need to add that origin to
the `connect-src` whitelist in `manifest.json`.

---

## Troubleshooting

### "Missing authorization code"
- Check that the extension is sending the `code` parameter

### "Server configuration error"
- Verify secrets are set: `wrangler secret list`

### CORS errors
- The worker includes CORS headers, but check browser console for details

---

## Security Notes

- ✅ Client secret is stored securely on Cloudflare
- ✅ Never exposed to browser/extension
- ✅ HTTPS only
- ✅ Environment variables encrypted

---

## Alternative: Cloudflare Dashboard Deployment

If you prefer GUI:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → Create Worker
3. Paste the `worker.js` code
4. Go to Settings → Variables
5. Add `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` (encrypt them)
6. Deploy!
