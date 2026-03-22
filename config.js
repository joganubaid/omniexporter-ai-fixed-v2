/**
 * OmniExporter AI — Configuration (safe defaults)
 *
 * This file is committed with placeholder values so that the extension loads
 * correctly on a fresh install without any setup.  The script tags in
 * popup.html and options.html (../../config.js) and the importScripts call in
 * background.js (../config.js) all resolve to this file.
 *
 * TO CUSTOMISE:
 * 1. Replace the placeholder values below with your own credentials.
 * 2. To avoid accidentally committing real credentials, run:
 *      git update-index --assume-unchanged config.js
 *
 * See config.example.js and cloudflare-worker/DEPLOY.md for full instructions.
 *
 * SECURITY:
 * - The Notion Client Secret MUST NOT be placed here — store it in your
 *   Cloudflare Worker environment variables only.
 * - Only the Client ID (public) is needed in this file.
 */

// ─── Notion OAuth ────────────────────────────────────────────────
// Replace with your Client ID from https://www.notion.so/my-integrations
// Leave as-is to use the project's shared default integration.
const NOTION_CLIENT_ID = "2ebd872b-594c-8001-bf30-00373781f7d9";

// ─── OAuth Server ────────────────────────────────────────────────
// Replace with your deployed Cloudflare Worker URL.
// When null the extension falls back to the shared default worker
// (https://omniexporter-oauth.jonub250383.workers.dev).
const OAUTH_SERVER_URL = "https://omniexporter-oauth.jonub250383.workers.dev";
