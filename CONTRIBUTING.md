# Contributing to OmniExporter AI

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. Clone the repository
   ```bash
   git clone https://github.com/joganubaid/omniexporter-ai-fixed-v2.git
   cd omniexporter-ai-fixed-v2
   ```

2. Copy configuration
   ```bash
   cp config.example.js config.js
   # Edit config.js with your Notion Client ID and OAuth server URL
   ```

3. Load in Chrome
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the repository root directory

4. (Optional) Deploy Cloudflare Worker for Notion OAuth
   - See `cloudflare-worker/DEPLOY.md`

## Project Architecture

```
src/
├── background.js          — Service worker (alarms, context menus, messaging, auto-sync)
├── content.js             — Content script orchestration (adapter dispatch, message routing, re-injection guard)
├── platform-config.js     — Endpoint configs, DataExtractor, VersionDetector
├── adapters/              — One file per AI platform
│   ├── chatgpt-adapter.js
│   ├── claude-adapter.js
│   ├── deepseek-adapter.js
│   ├── gemini-adapter.js
│   ├── gemini-inject.js   — Page-context bridge for Gemini session params (XSRF, build id, session id)
│   ├── grok-adapter.js
│   └── perplexity-adapter.js
├── utils/
│   ├── logger.js
│   ├── network-interceptor.js   — Passive XHR/fetch capture (opportunistic cache)
│   ├── export-manager.js        — Markdown/JSON/HTML/CSV/TXT/PDF formatters
│   ├── notion-block-builder.js  — Markdown → Notion rich-block converter
│   ├── shared-utils.js          — LoadingManager, RateLimiter, ExportedUuidStore, PlatformUrlBuilder
│   └── toast.js                 — In-page notification toasts
└── ui/                    — Popup, options/dashboard, notion picker + CSS
```

### Key Design Patterns

- **Adapter Pattern**: Each platform has an adapter with `name`, `extractUuid()`, `getThreads()`, `getThreadDetail()`, and optional `getSpaces()`
- **API-only extraction**: All adapters use real API endpoints — no DOM scraping. When the API fails, surface a clean error so the user can refresh and retry. `NetworkInterceptor` may be checked for opportunistically-captured API responses as a fallback, but the sidebar HTML is never scraped (it's virtualized and would silently return only the visible threads).
- **HAR-verified endpoints**: Every API endpoint, query parameter, and request/response shape is verified against captured real-browser HAR traffic (see `docs/HAR_ENDPOINT_INDEX.md`).
- **Re-injection guard**: `content.js` uses `window.__omniExporterLoaded` to prevent duplicate initialization on extension reload.
- **Per-platform dedup store** (`ExportedUuidStore` in `shared-utils.js`): `exportedUuids_<Platform>` keys with `{uuid → lastSyncedMs}` maps. No global state, no LRU eviction. Legacy bucket auto-migrates on install.

## Making Changes

### Before You Start
- Check existing issues for duplicates
- For large changes, open an issue first to discuss the approach

### Code Guidelines
- Do NOT hardcode API versions — use `src/platform-config.js` for endpoint management
- All fetch calls should include `credentials: 'include'` for session cookie forwarding
- New adapters must implement the full adapter interface: `name`, `extractUuid()`, `getThreads()`, `getThreadDetail()`
- Add JSDoc comments to public functions
- Log with the Logger utility, not raw `console.log` (except in content scripts where Logger may not be available)

### Testing
- Test on each supported platform after changes to shared code (`src/content.js`, `src/platform-config.js`)
- Test with expired/invalid sessions to verify error handling (should surface a clear "API unavailable, refresh and retry" message — not a silent partial result)
- Test bulk export (Load All) to verify pagination — Perplexity, Claude, ChatGPT, DeepSeek, Gemini all paginate; Grok is capped at ~60 by their API
- After any API/payload change, re-capture a HAR from the platform's frontend and verify the request/response shapes still match what the adapter expects

### Pull Request Process
1. Create a feature branch from `master`
2. Make your changes with clear commit messages
3. Ensure the extension loads without errors in Chrome
4. Open a PR with a description of what changed and why
