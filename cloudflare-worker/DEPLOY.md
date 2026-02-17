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

## Step 7: Update Extension

After deploying, update the extension with your Worker URL:

Open `auth/notion-oauth.js` and update:
```javascript
this.config.tokenEndpoint = 'https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev/api/notion/token';
```

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
