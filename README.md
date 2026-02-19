# 🚀 OmniExporter AI - Enterprise Edition

![Version](https://img.shields.io/badge/version-5.1.0-blue) ![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green) ![Platforms](https://img.shields.io/badge/platforms-6-orange) ![Formats](https://img.shields.io/badge/export%20formats-5-purple)

Export AI conversations from **Perplexity, ChatGPT, Claude, Gemini, Grok & DeepSeek** to Markdown, JSON, HTML, PDF, Plain Text, and Notion — with a full dashboard, auto-sync, and OAuth2 Notion integration.

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
- ✅ **Perplexity** — API-based, full pagination
- ✅ **ChatGPT** — Multiple endpoint fallbacks, DOM fallback
- ✅ **Claude** — Organization-based access
- ✅ **Gemini** — Multiple RPC IDs, enhanced parsing
- ✅ **Grok** — Rate limit handling with retries
- ✅ **DeepSeek** — Multiple auth token sources, cursor pagination

### Export Formats
- 📝 **Markdown** (.md) — With YAML frontmatter metadata
- 📊 **JSON** — Structured data export
- 🌐 **HTML** — Styled exports with platform logos
- 📄 **Plain Text** (.txt) — Simple text format
- 📕 **PDF** — Print-ready format (via browser print dialog)

### Enterprise Features
- 🔄 **Auto-Sync** — Automatic Notion synchronization on a configurable schedule
- 📊 **Dashboard** — Bulk export management with history and failure tracking
- 🔍 **Bulk Export** — Export all conversations at once with pagination
- 📈 **Analytics** — Export history and audit logging
- 🔐 **OAuth2** — Secure Notion integration with automatic token refresh
- 🎨 **Platform Logos** — SVG branding in HTML/Markdown exports
- 🔧 **Dev Tools** — Built-in log viewer with filtering and export

## 🌐 Supported Platforms

| Platform | URL | Status | Extraction Method |
|----------|-----|--------|-------------------|
| Perplexity | perplexity.ai | ✅ Working | API-first + DOM fallback |
| ChatGPT | chatgpt.com | ✅ Working | API-first + DOM fallback |
| Claude | claude.ai | ✅ Working | API-first + DOM fallback |
| Gemini | gemini.google.com | ✅ Working | API-first (RPC) + DOM fallback |
| Grok | grok.com / x.com | ✅ Working | API-first + DOM fallback |
| DeepSeek | chat.deepseek.com | ✅ Working | API-first + DOM fallback |

## 🔧 Installation

### From Chrome Web Store
1. Visit the [Chrome Web Store](#) *(link coming soon)*
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
3. Choose an export format or click **Save to Notion**

### Bulk Export via Dashboard
1. Open the dashboard (`Alt+Shift+D` or click **Open Dashboard** in the popup)
2. Click **Load All Threads** to paginate through all conversations
3. Select the conversations you want to export
4. Choose a destination (Notion or local file export)
5. Click **Export Selected**

### Auto-Sync
1. Open **Extension Options**
2. Enable **Auto-Sync to Notion**
3. Set the sync interval (default: 60 minutes)
4. The extension will automatically sync new conversations in the background

## 📁 Project Structure

PR #2 reorganized all source files from a flat root into the `src/` directory:

```
omniexporter-ai-fixed-v2/
├── manifest.json                  # Extension manifest (MV3, v5.1.0)
├── config.example.js              # Configuration template (copy to config.js)
├── src/
│   ├── background.js              # Service worker (alarms, context menus, messaging)
│   ├── content.js                 # Content script (Perplexity, ChatGPT, Claude adapters + re-injection guard)
│   ├── platform-config.js         # Endpoint configs, DataExtractor, VersionDetector
│   ├── adapters/
│   │   ├── gemini-adapter.js      # Gemini conversation adapter
│   │   ├── gemini-inject.js       # Injected script for Gemini RPC interception
│   │   ├── gemini-page-interceptor.js  # Page-level interceptor (web_accessible_resource)
│   │   ├── grok-adapter.js        # Grok conversation adapter
│   │   └── deepseek-adapter.js    # DeepSeek conversation adapter
│   ├── utils/
│   │   ├── logger.js              # Enterprise logging with storage
│   │   ├── network-interceptor.js # XHR/fetch interception utility
│   │   ├── export-manager.js      # Format conversion and file export
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
    ├── icon128.png                # Extension icon
    └── logos/                     # Platform SVG logos
        ├── perplexity.svg
        ├── chatgpt.svg
        ├── claude.svg
        ├── gemini.svg
        ├── grok.svg
        └── deepseek.svg
```

## 🔐 Security

OmniExporter AI v5.1.0 includes several security hardening measures:

- **Server-side OAuth secret** — The Notion Client Secret lives only on the Cloudflare Worker; it is never bundled in the extension
- **Content Security Policy** — `script-src 'self'` prevents remote script execution; `connect-src` is limited to known API domains
- **Scoped `web_accessible_resources`** — Resources are accessible only from the specific platform origins that need them (not `<all_urls>`)
- **`postMessage` origin validation** — Listeners in `gemini-adapter.js` and `gemini-inject.js` validate `event.origin` against the expected platform domain
- **UUID validation** — `SecurityUtils.isValidUuid()` is called at `content.js` entry points before any API calls
- **HTML sanitization** — `SecurityUtils.sanitizeHtml()` prevents XSS in exported content
- **OAuth tokens in `chrome.storage.local`** — Encrypted at rest by Chrome; never written to disk by the extension

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability reporting process.

## 🛠️ Development

### Prerequisites
- Chrome or Edge browser
- A deployed Cloudflare Worker (optional, only needed for Notion OAuth)

### Running Locally
1. Clone and configure as described in [Installation](#-installation)
2. Make your source changes under `src/`
3. Reload the extension at `chrome://extensions/`
4. Use the **Dev Tools** tab in Options to view real-time logs

### Adding a New Platform Adapter
1. Create `src/adapters/newplatform-adapter.js` implementing:
   - `name` — platform identifier string
   - `extractUuid(url)` — parse the conversation UUID from the page URL
   - `getThreads(page, limit)` — paginated list of conversations
   - `getThreadDetail(uuid)` — full conversation content
2. Add endpoint configuration in `src/platform-config.js`
3. Register the adapter in `manifest.json` content scripts and in `src/content.js`
4. Add a logo SVG to `icons/logos/`
5. Test API extraction **and** DOM fallback paths

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
