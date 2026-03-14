# OmniExporter AI — Architecture Overview

## High-Level Component Map

```mermaid
graph TD
    User["👤 User (Browser)"]
    Popup["🖼️ popup.html / popup.js\nQuick Export & Sync Toggle"]
    Options["⚙️ options.html / options.js\nDashboard & Bulk Export"]
    Background["🔧 background.js\nService Worker\n(Auto-Sync, Alarms, Context Menus)"]
    Content["📄 content.js\nContent Script\n(Thread List, Detail Extract)"]
    Adapters["🔌 Adapters (per platform)\nPerplexity / ChatGPT / Claude\nGemini / Grok / DeepSeek"]
    GeminiInject["💉 gemini-inject.js\n(page context injection\nfor WIZ_global_data)"]
    PlatformConfig["⚙️ platform-config.js\nShared URL/config per platform"]
    ExportMgr["📦 export-manager.js\nMarkdown / HTML / JSON / PDF"]
    Logger["📋 logger.js\nDebug logging with storage"]
    NetInterceptor["🌐 network-interceptor.js\nAI API traffic sniffer"]
    NotionOAuth["🔐 auth/notion-oauth.js\nOAuth2 Token Manager"]
    CFWorker["☁️ cloudflare-worker/worker.js\nToken Exchange Proxy\n(keeps client secret server-side)"]
    NotionAPI["🗄️ Notion API\napi.notion.com"]
    AIPage["🤖 AI Platform\nChatGPT / Claude / Gemini etc."]

    User -->|Clicks export| Popup
    User -->|Opens dashboard| Options
    Popup -->|sendMessage| Background
    Options -->|sendMessage| Background
    Background -->|sendMessage| Content
    Content -->|Runs on AI page| AIPage
    Content -->|Initializes| Adapters
    Adapters -->|page context bridge| GeminiInject
    Adapters -->|reads config| PlatformConfig
    Adapters -->|captured traffic| NetInterceptor
    Popup & Options -->|toMarkdown/toJSON/toPDF| ExportMgr
    Popup & Options -->|buildNotionProperties| NotionOAuth
    NotionOAuth -->|token exchange| CFWorker
    CFWorker -->|authorized request| NotionAPI
    Background -->|auto-sync POST| NotionAPI
    Logger -.->|debug only| Background & Content
```

## Data Flow: Save to Notion (Manual)

```
User clicks "Save to Notion"
  → popup.js getThreadDataFromContentScript()
    → content.js EXTRACT_CONTENT_BY_UUID
      → Adapter.getThreadDetail(uuid)
        → AI Platform API (fetch with credentials)
      → returns { uuid, title, entries[], platform }
  → popup.js syncToNotionAPI(data, apiKey, dbId)
    → buildNotionProperties(data) → Notion page properties
    → POST /v1/pages  (first 100 blocks)
    → PATCH /v1/blocks/{id}/children  (remaining blocks, 100 at a time)
```

## Key Files

| File | Role |
|---|---|
| `src/background.js` | Service worker — alarms, auto-sync, message routing |
| `src/content.js` | Injected into AI tabs — adapter orchestration |
| `src/ui/popup.js` | Quick export popup |
| `src/ui/options.js` | Full dashboard (bulk export, history, settings) |
| `auth/notion-oauth.js` | OAuth2 token management (authorize, store, re-auth) |
| `cloudflare-worker/worker.js` | Token exchange worker (keeps client secret safe) |
| `src/adapters/*.js` | One file per AI platform |
| `src/utils/export-manager.js` | Export to Markdown, HTML, JSON, PDF |
| `src/utils/logger.js` | Buffered, filterable debug logger |
| `src/utils/network-interceptor.js` | Passive XHR/Fetch sniffer for chat list auto-detection |
| `src/platform-config.js` | Platform URLs, UUID patterns, API base paths |
| `config.js` (gitignored) | Your Notion Client ID + OAuth worker URL |

## Security Model

- **Client secret** lives only in the Cloudflare Worker env var — never in the extension
- **Tokens** stored in `chrome.storage.local` (plain JSON, OS-level isolation per user)
- **CORS** on the worker is restricted to your `chrome-extension://EXTENSION_ID` origin
- **postMessage** in Gemini adapter uses `https://gemini.google.com` as the target origin
- **NetworkInterceptor** only processes URLs matching known AI platform API patterns

## Adding a New Platform

1. Create `src/adapters/myplatform-adapter.js` with `getThreads(page, limit)` and `getThreadDetail(uuid)` methods
2. Register the platform in `src/platform-config.js`
3. Add `matches` entry in `manifest.json` `content_scripts`
4. Add the domain to `host_permissions` in `manifest.json`
5. Add the platform URL builder to `PLATFORM_URLS` in `popup.js` and `options.js`
