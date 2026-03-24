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

## Step 4b: Configure CORS Allow-List (Required after Sec-1 fix)

The worker now restricts CORS to your specific extension ID instead of using `'*'`.

**Find your extension ID:**
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle top-right)
3. Load the extension unpacked from the repo root
4. Copy the 32-character ID shown under the extension name (e.g. `abcdefghijklmnopabcdefghijklmnop`)

**Add it to `cloudflare-worker/worker.js`:**
```js
const ALLOWED_ORIGINS = new Set([
    'chrome-extension://YOUR_32_CHAR_EXTENSION_ID_HERE',
]);
```

Then re-deploy with `wrangler deploy`.

> [!IMPORTANT]
> The extension ID changes if you load the extension from a different path or publish to the Chrome Web Store (which assigns a permanent ID). Update `ALLOWED_ORIGINS` and redeploy whenever your extension ID changes.

---

## Step 5: Test the Worker


```bash
curl https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev/health
```

Should return:
```json
{"status":"ok","service":"omniexporter-oauth"}
```

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
