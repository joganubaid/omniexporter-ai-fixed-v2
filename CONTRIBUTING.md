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
├── background.js          — Service worker (alarms, context menus, messaging)
├── content.js             — Content script with inline Perplexity/ChatGPT/Claude adapters
├── platform-config.js     — Endpoint configs, DataExtractor, VersionDetector
├── adapters/              — Standalone platform adapters (Gemini, Grok, DeepSeek)
├── utils/                 — Logger, network interceptor, export manager, toast
└── ui/                    — Popup, options/dashboard, notion picker + CSS
```

### Key Design Patterns

- **Adapter Pattern**: Each platform has an adapter with `name`, `extractUuid()`, `getThreads()`, `getThreadDetail()`, and optional `getSpaces()`
- **API-first + DOM fallback**: All adapters try API extraction first, then fall back to DOM scraping
- **HAR-verified endpoints**: All API endpoints are verified against real browser HAR captures
- **Re-injection guard**: `content.js` uses `window.__omniExporterLoaded` to prevent duplicate initialization on extension reload

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
- Verify both API extraction and DOM fallback paths
- Test with expired/invalid sessions to verify error handling
- Test bulk export (Load All) to verify pagination

### Pull Request Process
1. Create a feature branch from `master`
2. Make your changes with clear commit messages
3. Ensure the extension loads without errors in Chrome
4. Open a PR with a description of what changed and why
