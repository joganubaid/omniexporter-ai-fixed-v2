# 🚀 OmniExporter AI - Enterprise Edition

**Version 5.0.0** - Export AI conversations from Perplexity, ChatGPT, Claude, Gemini, Grok & DeepSeek to Markdown, JSON, HTML, PDF & Notion.

## 📋 Table of Contents

- [Features](#features)
- [Supported Platforms](#supported-platforms)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Recent Improvements](#recent-improvements)
- [Project Structure](#project-structure)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## ✨ Features

### Multi-Platform Support
- ✅ **Perplexity** - Full API integration
- ✅ **ChatGPT** - Enhanced with multiple endpoint fallbacks
- ✅ **Claude** - Complete conversation export
- ✅ **Gemini** - Improved RPC ID handling
- ✅ **Grok** - Full support with retries
- ✅ **DeepSeek** - Enhanced auth token detection

### Export Formats
- 📝 **Markdown** (.md) - With frontmatter metadata
- 📊 **JSON** - Structured data export
- 🌐 **HTML** - Beautiful styled exports with platform logos
- 📄 **Plain Text** (.txt) - Simple text format
- 📕 **PDF** - Print-ready format

### Enterprise Features
- 🔄 **Auto-Sync** - Automatic Notion synchronization
- 📊 **Dashboard** - Comprehensive export management
- 🔍 **Bulk Export** - Export all conversations at once
- 📈 **Analytics** - Export history and failure tracking
- 🔐 **OAuth2** - Secure Notion integration (NEW!)
- 🎨 **Platform Logos** - Visual branding in exports (NEW!)

## 🌐 Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| Perplexity | ✅ Working | API-based, full pagination |
| ChatGPT | ✅ **Fixed** | Multiple endpoints, DOM fallback |
| Claude | ✅ Working | Organization-based access |
| Gemini | ✅ **Fixed** | Multiple RPC IDs, enhanced parsing |
| Grok | ✅ Working | Rate limit handling |
| DeepSeek | ✅ **Fixed** | Multiple token sources, cursor pagination |

## 🔧 Installation

### From Chrome Web Store
1. Visit the [Chrome Web Store](#) (link to be added)
2. Click "Add to Chrome"
3. Grant necessary permissions

### Manual Installation (Development)
1. Clone this repository
```bash
git clone <repository-url>
cd chats-export-to-notion
```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the extension directory

## ⚙️ Configuration

### Notion Setup

#### Option 1: OAuth2 (Recommended)
1. Create a Notion integration at [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Load the extension in Chrome, then open DevTools console and run:
   - `chrome.identity.getRedirectURL('notion')`
3. Copy the returned URL (looks like `https://<extension-id>.chromiumapp.org/notion`)
4. Add it to your Notion integration **OAuth Redirect URLs**
5. Copy Client ID and Client Secret into the extension settings
6. Click "Connect OAuth2" and authorize

#### Option 2: Integration Token (Fallback)
1. Create a Notion integration
2. Copy the Internal Integration Token
3. In extension options, paste the token
4. Select or create a database for exports

### Platform Authentication
- All platforms require you to be logged in through your browser
- The extension uses your existing session cookies
- No additional authentication needed

## 📖 Usage

### Quick Export (Current Conversation)
1. Navigate to any supported AI platform
2. Open a conversation
3. Click the extension icon
4. Choose export format or "Save to Notion"

### Bulk Export (Dashboard)
1. Click "Open Dashboard" in popup
2. Click "Load All Threads"
3. Select conversations to export
4. Choose destination (Notion or file export)
5. Click "Export Selected"

### Auto-Sync
1. Open extension options
2. Enable "Auto-Sync to Notion"
3. Set sync interval (default: 60 minutes)
4. Conversations are automatically synced

## 🆕 Recent Improvements (v5.0)

### Platform Adapter Fixes
- **ChatGPT Adapter**
  - ✅ Multiple endpoint fallbacks (`/backend-api/conversation`, `/api/conversation`)
  - ✅ Enhanced OAI-Device-Id header handling
  - ✅ Improved DOM extraction with updated selectors for 2024 UI
  - ✅ Better error messages for debugging

- **Gemini Adapter**
  - ✅ Multiple RPC ID attempts (`hNvQHb`, `WqGlee`, `Mklfhc`)
  - ✅ Enhanced response parsing with multiple strategies
  - ✅ Improved error handling and logging
  - ✅ Updated DOM selectors for latest UI

- **DeepSeek Adapter**
  - ✅ Multiple auth token source detection
  - ✅ Enhanced API endpoint fallbacks
  - ✅ Better role detection (USER/ASSISTANT)
  - ✅ Improved response path validation

### New Features
- ✅ **Notion OAuth2 Integration** - Secure authentication with automatic token refresh
- ✅ **Platform Logos** - SVG logos in exported HTML/Markdown files
- ✅ **Enterprise Logging System** - Comprehensive debugging with storage
- ✅ **Dev Tools Tab** - Built-in log viewer in Options page
- ✅ **Better Error Messages** - User-friendly error descriptions

### Developer Tools (v5.1)
New debugging features for troubleshooting:

- 🔧 **Debug Mode Toggle** - Enable/disable detailed logging
- 📊 **Log Viewer** - View logs directly in Options → Dev Tools tab
- 🔍 **Filtering** - Filter by level (Error/Warn/Info/Debug) and module
- 📥 **Export Logs** - Download as JSON or text file
- 🤖 **Copy for AI** - Generate AI-friendly debug reports
- ⏰ **Auto-Refresh** - Real-time log updates (every 3 seconds)

### Code Quality
- ✅ Comprehensive error handling across all adapters
- ✅ Multiple fallback strategies for robustness
- ✅ Enterprise logging with 30+ instrumentation points
- ✅ Service worker keep-alive for MV3 compatibility

## 📁 Project Structure

```
chats-export-to-notion/
├── auth/                   # Authentication modules
│   ├── notion-oauth.js    # OAuth2 implementation
│   └── callback.html      # OAuth callback page (chromiumapp redirect)
├── icons/                  # Extension icons
│   └── logos/             # Platform logo SVGs
│       ├── perplexity.svg
│       ├── chatgpt.svg
│       ├── claude.svg
│       ├── gemini.svg
│       ├── grok.svg
│       └── deepseek.svg

├── background.js           # Service worker
├── content.js              # Content script (contains adapters)
├── manifest.json           # Extension manifest
├── platform-config.js      # Platform configuration
├── export-manager.js       # Export logic
├── *-adapter.js           # Platform-specific adapters
├── popup.html/js/css      # Extension popup
├── options.html/js/css    # Settings page
└── README.md              # This file
```

## 🛠️ Development

### Prerequisites
- Node.js 16+ (for development tools)
- Chrome/Edge browser
- Basic knowledge of Chrome Extensions

### Running in Development
1. Make changes to source files
2. Reload extension in `chrome://extensions/`
3. Test functionality
4. Check console logs for debugging

### Adding a New Platform
1. Create adapter file: `newplatform-adapter.js`
2. Implement required methods:
   - `extractUuid(url)`
   - `getThreads(page, limit)`
   - `getThreadDetail(uuid)`
   - `extractFromDOM(uuid)`
3. Add configuration in `platform-config.js`
4. Update `content.js` to include new adapter
5. Add logo SVG in `icons/logos/`
6. Test thoroughly

### Code Style
- Use clear, descriptive variable names
- Add comments for complex logic
- Follow existing error handling patterns
- Include console.log statements for debugging

## 🐛 Troubleshooting

### "API Access Failed" Errors
**ChatGPT:**
- Open the conversation in your browser first
- Check if you're logged in
- Try using DOM extraction (works for current conversation only)

**Gemini:**
- Verify you're on gemini.google.com
- Check browser console for detailed errors
- RPC IDs may have changed - check logs for alternative IDs

**DeepSeek:**
- Ensure you're logged in
- Check localStorage for auth token
- Try refreshing the page

### Notion Sync Issues
**OAuth2:**
- Verify Client ID and Secret are correct
- Check redirect URI matches extension ID
- Re-authorize if tokens expired

**Token Auth:**
- Verify token has correct permissions
- Ensure database is shared with integration
- Check database ID is correct

### Extension Not Working
1. Check extension is enabled in `chrome://extensions/`
2. Reload the extension
3. Clear extension storage and reconfigure
4. Check browser console (F12) for errors
5. Report issue with console logs

## 📝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request with detailed description

### Areas for Contribution
- 🌐 Add support for new AI platforms
- 🎨 Improve UI/UX
- 🐛 Fix bugs and improve error handling
- 📖 Improve documentation
- ✅ Add automated tests

## 📄 License

[Add your license here]

## 🙏 Acknowledgments

- All AI platforms for their amazing services
- Notion for the powerful API
- Chrome Extension community for resources and support

## 📞 Support

- **Issues:** [GitHub Issues](#)
- **Email:** [Add email]
- **Discord:** [Add Discord server]

---

**Made with ❤️ for the AI community**
