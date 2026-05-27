# 🚀 OmniExporter AI - Enterprise Edition

![Version](https://img.shields.io/badge/version-5.5.0-blue) ![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green) ![Platforms](https://img.shields.io/badge/platforms-6-orange) ![Formats](https://img.shields.io/badge/export%20formats-2-purple)

Export AI conversations from **Perplexity, ChatGPT, Claude, Gemini, Grok & DeepSeek** to **Markdown, JSON, and Notion** — with a full dashboard, auto-sync, and OAuth2 Notion integration.

## 📋 Table of Contents

- [Features](#-features)
- [Supported Platforms](#-supported-platforms)
- [Installation](#-installation)
- [Configuration](#️-configuration)
- [Usage](#-usage)
- [Project Structure](#-project-structure)
- [Security](#-security)
- [Development](#️-development)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### Multi-Platform Support
- ✅ **Perplexity** — REST API with cursor pagination + `has_next_page` paging
- ✅ **ChatGPT** — `backend-api/conversations` (offset-based) + tree-mapping detail parser
- ✅ **Claude** — Organization-scoped V2 API + full-fidelity content blocks (text, thinking, tool_use, tool_result)
- ✅ **Gemini** — `batchexecute` RPC (MaZiqc list, hNvQHb detail, limit=100)
- ✅ **Grok** — `rest/app-chat/conversations` + two-step detail (response-node + load-responses)
- ✅ **DeepSeek** — `chat_session/fetch_page` with cursor + fragment-based message parser (handles FILE attachments)

### Export Formats
- 📝 **Markdown** (.md) — With YAML frontmatter metadata, sources, attachments, knowledge cards
- 📊 **JSON** — Structured data export with rich metadata (model, citations, media)

### Enterprise Features
- 🔄 **Auto-Sync** — Automatic Notion synchronization on a configurable schedule
- 📊 **Dashboard** — Bulk export management with thread browser and pagination
- 🔍 **Bulk Export** — Export all conversations at once with per-platform offset/cursor pagination
- 🔐 **OAuth2** — Secure Notion integration with automatic re-authorization
- 🎨 **Platform Logos** — SVG branding in Markdown exports
- 📦 **Rich Notion Blocks** — Full markdown-to-Notion-block conversion via `NotionBlockBuilder`

## 🌐 Supported Platforms

| Platform | URL | Status | Extraction Method |
|----------|-----|--------|-------------------|
| Perplexity | perplexity.ai | ✅ Working | REST API + cursor pagination |
| ChatGPT | chatgpt.com | ✅ Working | `backend-api` + tree-mapping parser |
| Claude | claude.ai | ✅ Working | V2 API + full-fidelity content blocks |
| Gemini | gemini.google.com | ✅ Working | `batchexecute` RPC (MaZiqc / hNvQHb) |
| Grok | grok.com / x.com | ✅ Working | `rest/app-chat` (capped at ~60 by Grok) |
| DeepSeek | chat.deepseek.com | ✅ Working | `api/v0/chat_session` + fragment parser |

> **Note:** All adapters use real API extraction (verified against captured HAR traffic). When an API fails, the extension surfaces a clear "API unavailable, refresh the tab and retry" error rather than falling back to sidebar DOM scraping (which would silently return only the most-recent visible items and hide the rest of your history). Opportunistically-captured API responses via `NetworkInterceptor` are used as a fallback when available.

## 🔧 Installation

### From Chrome Web Store
1. Visit the Chrome Web Store *(link will be added after approval)*
2. Click "Add to Chrome"
3. Grant the requested permissions

### Manual Installation (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/joganubaid/omniexporter-ai-fixed-v2.git
   cd omniexporter-ai-fixed-v2
   ```
2. Copy and configure `config.js` (see [Configuration](#️-configuration) below)
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked** and select the repository root directory

## ⚙️ Configuration

### 1. Create `config.js`

```bash
cp config.example.js config.js
```

Edit `config.js` with your values. The file is listed in `.gitignore` and will **not** be committed.

### 2. Notion OAuth2 Setup (Recommended)

> **Security note:** The Notion Client **Secret** is stored on the Cloudflare Worker — it is **never** placed in the extension or `config.js`. Only the Client **ID** (a public value) goes in `config.js`.

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations) and create an integration
2. After loading the extension, open DevTools console and run:
   ```javascript
   chrome.identity.getRedirectURL('notion')
   ```
3. Copy the returned URL (e.g. `https://<extension-id>.chromiumapp.org/notion`) and add it to your Notion integration's **OAuth Redirect URLs**
4. Copy the **Client ID** into `config.js` as `NOTION_CLIENT_ID`
5. Deploy the Cloudflare Worker (see `cloudflare-worker/DEPLOY.md`) and set your **Client Secret** there as an environment variable
6. Set `OAUTH_SERVER_URL` in `config.js` to your Worker URL
7. In the extension options, click **Connect to Notion** and complete the OAuth flow

### 3. Notion Integration Token (Fallback)
1. Create a Notion internal integration and copy the token
2. In extension options, paste the token in the **Integration Token** field
3. Select or create a database for exports

### 4. Platform Authentication
No extra configuration needed. The extension uses your existing browser session cookies — just make sure you are logged in to each AI platform in Chrome.

### 5. Cloudflare Worker Deployment
See [`cloudflare-worker/DEPLOY.md`](cloudflare-worker/DEPLOY.md) for step-by-step instructions on deploying the OAuth proxy worker.

## 📖 Usage

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Alt+Shift+E` | Open extension popup |
| `Alt+Shift+D` | Open dashboard |

### Quick Export (Current Conversation)
1. Navigate to any supported AI platform and open a conversation
2. Click the OmniExporter AI icon in the toolbar (or press `Alt+Shift+E`)
3. Choose **Markdown** or **JSON** from the dropdown, or click **Save to Notion**

### Bulk Export via Dashboard
1. Open the dashboard (`Alt+Shift+D` or click **Open Dashboard** in the popup)
2. Click **Load All Threads** to paginate through all conversations
3. Select the conversations you want to export
4. Choose a destination: **Save to Notion** or **Export MD** (Markdown download)
5. Click the corresponding button in the bulk action bar

### Auto-Sync
1. Open **Extension Options**
2. Enable **Auto-Sync to Notion**
3. Set the sync interval (default: 60 minutes)
4. The extension will automatically sync new conversations in the background

## 📁 Project Structure

PR #2 reorganized all source files from a flat root into the `src/` directory:

```
omniexporter-ai-fixed-v2/
├── manifest.json                  # Extension manifest (MV3)
├── config.example.js              # Configuration template (copy to config.js)
├── src/
│   ├── background.js              # Service worker (alarms, context menus, messaging)
│   ├── content.js                 # Content script orchestration layer + re-injection guard
│   ├── platform-config.js         # Endpoint configs, DataExtractor, VersionDetector
│   ├── adapters/
│   │   ├── chatgpt-adapter.js     # ChatGPT conversation adapter
│   │   ├── claude-adapter.js      # Claude conversation adapter (full-fidelity blocks)
│   │   ├── deepseek-adapter.js    # DeepSeek conversation adapter (fragments, R1 thinking)
│   │   ├── gemini-adapter.js      # Gemini conversation adapter (batchexecute RPC)
│   │   ├── gemini-inject.js       # Page-context bridge for Gemini session params
│   │   ├── grok-adapter.js        # Grok conversation adapter
│   │   └── perplexity-adapter.js  # Perplexity conversation adapter (cursor + has_next_page)
│   ├── utils/
│   │   ├── logger.js              # Logger with storage
│   │   ├── network-interceptor.js # Passive XHR/fetch capture for opportunistic caching
│   │   ├── export-manager.js      # Format conversion and file export
│   │   ├── shared-utils.js        # Shared helpers (LoadingManager, RateLimiter, ExportedUuidStore, PlatformUrlBuilder)
│   │   ├── notion-block-builder.js # Markdown → Notion rich block converter
│   │   └── toast.js               # In-page notification toasts
│   └── ui/
│       ├── popup.html / popup.js / popup.css      # Extension popup
│       ├── options.html / options.js / options.css # Settings & dashboard
│       ├── notion-picker.js / notion-picker.css   # Notion database picker
│       └── toast.css              # Toast notification styles
├── auth/
│   ├── notion-oauth.js            # OAuth2 implementation (loaded via importScripts)
│   └── callback.html              # OAuth redirect handler
├── cloudflare-worker/
│   ├── worker.js                  # OAuth proxy worker (handles client secret server-side)
│   ├── wrangler.toml              # Cloudflare deployment config
│   └── DEPLOY.md                  # Deployment guide
└── icons/
    ├── icon16.png                 # 16x16 extension icon
    ├── icon32.png                 # 32x32 extension icon
    ├── icon48.png                 # 48x48 extension icon
    ├── icon128.png                # 128x128 extension icon
    └── logos/                     # Platform SVG logos
        ├── perplexity.svg
        ├── chatgpt.svg
        ├── claude.svg
        ├── gemini.svg
        ├── grok.svg
        └── deepseek.svg
├── docs/
│   ├── api-references/            # Per-platform API reference docs
│   │   ├── CHATGPT_API_REFERENCE.md
│   │   ├── CLAUDE_API_REFERENCE.md
│   │   ├── DEEPSEEK_API_REFERENCE.md
│   │   ├── GEMINI_API_REFERENCE.md
│   │   ├── GROK_API_REFERENCE.md
│   │   └── PERPLEXITY_API_REFERENCE.md
│   ├── validation/                # Adapter and integration validation guides
│   │   ├── AGENT_VALIDATION_GUIDE.md
│   │   ├── CHATGPT_VALIDATION_GUIDE.md
│   │   ├── CLAUDE_VALIDATION_GUIDE.md
│   │   ├── DEEPSEEK_ADAPTER_VALIDATION.md
│   │   ├── DEEPSEEK_VALIDATION_GUIDE.md
│   │   ├── GROK_ADAPTER_VALIDATION.md
│   │   ├── GROK_VALIDATION_GUIDE.md
│   │   └── PERPLEXITY_VALIDATION_GUIDE.md
│   ├── platforms/                 # Platform-specific README docs
│   │   ├── README_CHATGPT_DOCS.md
│   │   ├── README_CLAUDE_DOCS.md
│   │   ├── README_DEEPSEEK_DOCS.md
│   │   ├── README_GEMINI_DOCS.md
│   │   ├── README_GROK_DOCS.md
│   │   └── README_PERPLEXITY_DOCS.md
│   ├── ARCHITECTURE.md            # High-level component map
│   ├── HAR_ENDPOINT_INDEX.md      # HAR-verified endpoint reference
│   ├── NOTION_EXPORT.md           # Notion export format spec
│   └── TESTING_PLAN.md
```

## 🔐 Security

OmniExporter AI includes the following security hardening measures:

- **Server-side OAuth secret** — The Notion Client Secret lives only on the Cloudflare Worker; it is never bundled in the extension
- **Content Security Policy** — `script-src 'self'` prevents remote script execution; `connect-src` is limited to known API domains
- **Scoped `web_accessible_resources`** — Resources are accessible only from the specific platform origins that need them (not `<all_urls>`)
- **`postMessage` origin validation** — Listeners in `gemini-adapter.js` and `gemini-inject.js` validate `event.origin` against the expected platform domain
- **UUID validation** — `SecurityUtils.isValidUuid()` is called at `content.js` entry points before any API calls
- **HTML escaping at injection sites** — `options.js` wraps every user-controlled string in `escapeHtml()` before inserting into `innerHTML` template literals; Notion-picker entries use the same helper
- **OAuth tokens in `chrome.storage.local`** — Stored in Chrome's persistent local storage (file-backed under your profile; encrypted at rest where the OS keyring is available — macOS Keychain, Windows DPAPI, Linux libsecret/kwallet — and plain on platforms without a keyring). In-flight OAuth artifacts (state, PKCE verifier) live in `chrome.storage.session` and are wiped on browser restart.

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability reporting process.

## 🛠️ Development

### Prerequisites
- Chrome or Edge browser
- A deployed Cloudflare Worker (optional, only needed for Notion OAuth)

### Running Locally
1. Clone and configure as described in [Installation](#-installation)
2. Make your source changes under `src/`
3. Reload the extension at `chrome://extensions/`
4. Check the **service worker console** (click "Service worker" on the extensions page) for background logs

### Adding a New Platform Adapter
1. Create `src/adapters/newplatform-adapter.js` implementing:
   - `name` — platform identifier string
   - `extractUuid(url)` — parse the conversation UUID from the page URL
   - `getThreads(page, limit)` — paginated list of conversations
   - `getThreadDetail(uuid)` — full conversation content
2. Add endpoint configuration in `src/platform-config.js`
3. Register the adapter in `manifest.json` content scripts and in `src/content.js`
4. Add a logo SVG to `icons/logos/`
5. Verify API extraction works against a real captured HAR (no DOM-scraping fallback — the sidebar is virtualized and would silently truncate exports). On API failure, surface a clear "API unavailable" error.
6. Add the new platform to `chrome.tabs.query` URL list in `src/background.js`'s `performAutoSync` so auto-sync picks it up.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## 🐛 Troubleshooting

### "API Access Failed" Errors

**ChatGPT:**
- Make sure you are logged in and have the conversation open in your browser
- The extension tries three API endpoints automatically; check the Dev Tools logs for which one failed

**Gemini:**
- Verify you are on `gemini.google.com`
- Gemini uses internal RPC IDs that may change — check logs for which RPC ID succeeded

**DeepSeek:**
- Make sure you are logged in
- The extension tries multiple auth token sources from `localStorage`; refresh the page and try again

**Perplexity / Claude / Grok:**
- Confirm you are on the correct domain and logged in
- Re-enable the extension or clear extension storage if authentication state is stale

### Notion Sync Issues

**OAuth2:**
- Verify `NOTION_CLIENT_ID` in `config.js` matches your Notion integration
- Ensure the redirect URI registered in Notion matches `chrome.identity.getRedirectURL('notion')`
- The Client Secret must be set as an environment variable in the Cloudflare Worker, not in `config.js`
- Re-authorize via Options if tokens have expired

**Integration Token:**
- Verify the token has the correct capabilities (read/write content)
- Ensure the target database is shared with your integration
- Check that the database ID is correct

### Extension Not Loading
1. Confirm the extension is enabled at `chrome://extensions/`
2. Click **Reload** on the extension card
3. Check the service worker console for errors (click the "Service worker" link on the extensions page)
4. Clear extension storage via Options → Advanced → Reset, then reconfigure

## ⚠️ Known Limitations

### Service Worker Lifecycle
MV3 service workers terminate after ~30s of inactivity. OmniExporter does **not** try to "keep the SW alive" with a no-op heartbeat alarm — empty alarms just briefly wake the worker without preventing termination once the event queue drains. All state lives in `chrome.storage`, and the SW is re-spawned automatically when an alarm fires, when a content script or popup sends a message, or when a context-menu/command/action event fires. Auto-sync runs on its own dedicated alarm and isn't affected by SW termination.

### Notion Block Limit
Notion allows a maximum of 100 blocks per API request. OmniExporter handles this by creating a page with the first 100 blocks, then appending the rest in subsequent PATCH requests. Very long conversations (> 100 Q&A pairs) are fully exported across multiple API calls.

### Cloudflare Bot Detection
If Cloudflare intercepts a Notion API call, the extension detects the non-JSON or HTML response and fails the sync with an actionable error. Depending on the exact response, the message will be one of:
- **"Cloudflare challenge detected — please open the Notion tab and refresh"** — when Notion returns a non-200 HTML page (Turnstile/bot-check).
- **"Notion returned a non-JSON response — cannot determine page ID. Possible Cloudflare challenge."** — when the page-create call returns a 2xx but non-JSON body.

This guard applies only to Notion sync API calls. AI-site content extraction runs inside the page's own tab context and is not affected.

### Storage Quota
The extension uses Chrome's standard `chrome.storage.local` (10MB cap). Logs are auto-trimmed to ≤5MB by a periodic cleanup task; threads themselves are never persisted locally (they're streamed to Notion or downloaded). Heavy users with very long sync histories (thousands of exported UUIDs) may eventually hit the cap — a future release will add LRU pruning of `exportedUuids`.

---

## 🗺️ Architecture Roadmap

These are planned improvements for future major versions:

### ES Module Migration (v6.0)
Currently, `background.js` uses `importScripts()` to load dependencies — a legacy pattern for Chrome service workers. A future v6.0 will:
- Update `manifest.json` with `"type": "module"` under the `background` key
- Replace all `importScripts()` calls with `import { Logger } from './utils/logger.js'` syntax
- Remove all `window.X = window.X || {}` content-script guards (ES modules run once per scope — re-declaration is impossible)
- Enable proper compile-time syntax errors rather than vague script-load failures

This is the most impactful architectural improvement but requires updating every source file.

### Custom OAuth Domain (Enterprise)
The Cloudflare Worker for Notion OAuth is currently hosted at `omniexporter-oauth.jonub250383.workers.dev`. Enterprise deployments should move this to a custom domain (e.g., `oauth.yourdomain.com`) for:
- Corporate firewall compatibility (many block `*.workers.dev` as untrusted)
- Trust signals for enterprise users who audit extension network traffic
- Better branding for white-label deployments

See [`cloudflare-worker/DEPLOY.md`](cloudflare-worker/DEPLOY.md) for deployment instructions including custom domain setup.

### Consistent `platform-config.js` usage across all 6 adapters
Three adapters (Perplexity, Claude, ChatGPT) build URLs through the central
endpoint registry in `src/platform-config.js`. The other three (Grok, Gemini,
DeepSeek) mostly hardcode paths via string interpolation on `this.apiBase`.

**Today:** no user-visible bug — exports work. But when a platform changes
their endpoint paths (which happens), Perplexity/Claude/ChatGPT need a one-line
config update while Grok/Gemini/DeepSeek require grepping through the adapter
for every literal path string.

**Right time to fix:** the next time you have to touch one of the hardcoded
adapters for a real API change. At that point, refactoring that single adapter
to use the registry is a small marginal cost. Don't bulk-refactor all three at
once — Gemini's `_buildBatchUrl` (with 7 dynamic query params) is genuinely
awkward to express in a generic registry and may not benefit. See the
`// TODO(v6):` marker in each hardcoded adapter for context.

### Standardise the `getThreads()` adapter signature
Adapter contract per `CONTRIBUTING.md` is `getThreads(page, limit)`, but three
adapters take a divergent third parameter:
- `PerplexityAdapter.getThreads(page, limit, spaceId)` — collection filter
- `GeminiAdapter.getThreads(page, limit, cursor)` — cursor for cursor pagination
- All others: 2 params

**Today:** orchestration code in `content.js handleGetThreadListOffset`
special-cases each platform with `if (adapter.name === 'X')` branches, so the
divergent signatures don't actively bite. Latent bug if someone writes a
generic "iterate any adapter" helper that calls `adapter.getThreads(page,
limit, x)`.

**Proposed fix:** replace the positional third arg with an options bag in all
6 adapters: `getThreads(page, limit, options = {})`, where `options` carries
`{ spaceId }` / `{ cursor }` / nothing as needed. Estimated cost: ~2-3 hours
including HAR re-verification on all platforms. See `// TODO(v6):` markers on
each `getThreads` definition.

---

## 📝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code guidelines, and the pull request process.

## 📄 License

MIT License — see [LICENSE](LICENSE)

## 🙏 Acknowledgments

- The teams behind Perplexity, ChatGPT, Claude, Gemini, Grok, and DeepSeek for their platforms
- Notion for their powerful API
- The Chrome Extensions developer community

---

**Made with ❤️ for the AI community**
