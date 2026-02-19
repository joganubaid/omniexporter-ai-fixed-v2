/**
 * OmniExporter AI — Configuration
 *
 * SETUP:
 * 1. Copy this file to 'config.js' (which is gitignored)
 * 2. Fill in the values below
 * 3. Reload the extension in chrome://extensions/
 *
 * SECURITY:
 * - config.js is listed in .gitignore — it will NOT be committed
 * - The Notion Client Secret is stored on the Cloudflare Worker, NOT here
 * - Only the Client ID (public) is needed in this file
 */

// ─── Notion OAuth ────────────────────────────────────────────────
// Get your Client ID from: https://www.notion.so/my-integrations
// The Client Secret goes in your Cloudflare Worker environment variables (see cloudflare-worker/DEPLOY.md)
const NOTION_CLIENT_ID = 'YOUR_CLIENT_ID_HERE';

// ─── OAuth Server ────────────────────────────────────────────────
// Your deployed Cloudflare Worker URL (see cloudflare-worker/DEPLOY.md for deployment guide)
// Default: https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev
const OAUTH_SERVER_URL = 'https://omniexporter-oauth.YOUR_SUBDOMAIN.workers.dev';
