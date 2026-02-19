# Changelog

All notable changes to OmniExporter AI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.0] - 2026-02-19

### 🔐 Security Hardening

#### Sensitive Data Removal
- Deleted committed user data files (claude_chat_detail_pretty.json, etc.)
- Added comprehensive .gitignore patterns for response dumps, HAR files, and platform-specific JSON

#### Token Refresh Fix (auth/notion-oauth.js)
- Fixed broken `refreshAccessToken()` that referenced non-existent `this.config.tokenEndpoint` and `this.config.clientSecret`
- Now routes through Cloudflare Worker (`tokenServerEndpoint`) — client secret stays server-side
- Added `this.disconnect()` on refresh failure with user-actionable error

#### Manifest Permissions Tightened
- Replaced `<all_urls>` in `web_accessible_resources` with minimal-scope blocks
- Removed `auth/notion-oauth.js` from `web_accessible_resources` (loaded via `importScripts`, not web-accessible)
- `auth/callback.html` scoped to `https://api.notion.com/*` only
- `icons/logos/*.svg` scoped to 8 supported platform origins only

#### Input Validation
- Added `event.origin` guard on `postMessage` listeners in `gemini-adapter.js` and `gemini-inject.js`
- Changed `postMessage` target from `'*'` to `window.location.origin`
- Added `SecurityUtils.isValidUuid()` checks at `content.js` entry points before API calls

### 🏗️ Architecture Restructure
- Reorganized flat root into `src/` folder structure
- New folders: `src/adapters/`, `src/utils/`, `src/ui/`
- Updated all `manifest.json`, HTML, and cross-reference paths
- Zero functional changes — pure organizational improvement

### 📝 Documentation
- Complete README.md rewrite with accurate project structure, security practices, and configuration guide
- Updated CHANGELOG.md with v5.1.0 security and architecture changes
- Enhanced config.example.js with inline documentation
- Added SECURITY.md with vulnerability reporting policy
- Added CONTRIBUTING.md with development setup and code guidelines

---

## [5.0.0] - 2024-01-16

### 🎉 Major Release - Platform Fixes & OAuth2

This release focuses on fixing the three non-working platforms (ChatGPT, Gemini, DeepSeek) and adding enterprise-grade OAuth2 authentication for Notion.

### Added

#### OAuth2 Integration
- ✨ **NEW:** Notion OAuth2 authentication support
  - Secure authorization flow with automatic token refresh
  - Fallback to integration token method for backward compatibility
  - User-friendly authorization UI
  - Automatic token expiration handling
  - Redirect URI uses `chrome.identity.getRedirectURL('notion')`
  - Register redirect URL in Notion integration settings
  - `auth/notion-oauth.js` - Complete OAuth2 implementation
  - `auth/callback.html` - OAuth redirect handler (chromiumapp redirect)

#### Platform Logos
- ✨ **NEW:** Platform logo SVGs extracted to `icons/logos/`
  - `perplexity.svg` - Compass icon in teal
  - `chatgpt.svg` - OpenAI logo in green
  - `claude.svg` - Anthropic clock icon in terracotta
  - `gemini.svg` - Google star gradient
  - `grok.svg` - X/Twitter logo
  - `deepseek.svg` - Deep blue gradient with eyes
- ✨ Platform logos now appear in all export formats
  - HTML exports show platform badge in header
  - Markdown exports include platform emoji
  - PDF exports inherit HTML styling

### Fixed

#### ChatGPT Adapter (content.js)
- 🐛 **FIXED:** Multiple API endpoint fallbacks to handle API changes
  - Primary: `/backend-api/conversation/{uuid}`
  - Fallback 1: `/api/conversation/{uuid}`
  - Fallback 2: `/backend-api/conversations/{uuid}`
- 🐛 **FIXED:** Enhanced `OAI-Device-Id` header extraction
  - Now attempts to read from localStorage with error handling
  - Logs Device ID status for debugging
  - Includes session token detection
- 🐛 **FIXED:** Updated DOM extraction selectors for 2024 ChatGPT UI
  - Strategy 1: `[data-message-author-role]` attributes
  - Strategy 2: Article elements with role detection
  - Strategy 3: Alternating message blocks with grouping
  - Better duplicate detection and filtering
- 🐛 **FIXED:** Improved response validation
  - Checks for `mapping`, `messages`, or `conversation` structures
  - Better error messages when API fails
  - Title extraction from multiple sources

#### Gemini Adapter (gemini-adapter.js)
- 🐛 **FIXED:** Multiple RPC ID attempts to handle Google API changes
  - Primary: `hNvQHb` (message history)
  - Fallback 1: `WqGlee`
  - Fallback 2: `Mklfhc`
- 🐛 **FIXED:** Enhanced payload variations
  - Standard format: `[uuid, 50, null, 1, [0], [4], null, 1]`
  - Simple format: `[uuid, 100]`
  - Minimal format: `[uuid]`
- 🐛 **FIXED:** Improved response parsing
  - Better handling of ")]}'  prefix removal
  - Multiple data structure parsing strategies
  - Enhanced turn/message extraction logic
  - Better role detection (user vs model)
- 🐛 **FIXED:** Updated DOM extraction
  - Modern UI selectors: `[data-message-author-role]`
  - Query-response pair detection
  - Alternating block patterns
  - Generic text extraction fallback

#### DeepSeek Adapter (deepseek-adapter.js)
- 🐛 **FIXED:** Multiple auth token source detection
  - Primary: `userToken`
  - Fallback 1: `deepseek_token`
  - Fallback 2: `auth_token`
  - Fallback 3: `access_token`
  - Fallback 4: `ds_token`
  - JSON parsing with nested value extraction
- 🐛 **FIXED:** Multiple API endpoint attempts
  - Primary: `/chat/history_messages?chat_session_id={uuid}`
  - Fallback 1: `/chat/{uuid}/history_message?lte_cursor.id=`
  - Fallback 2: `/chat_session/{uuid}`
  - Fallback 3: `/chat/{uuid}`
- 🐛 **FIXED:** Enhanced response path detection
  - Tries 6 different message array paths
  - Better role detection (USER/ASSISTANT/BOT/AI)
  - Handles empty roles with index-based detection
  - Multiple title source attempts
- 🐛 **FIXED:** Improved DOM extraction
  - Role-based attribute detection
  - Class-based message detection with multiple selectors
  - Markdown container fallback
  - Generic text block extraction

### Improved

#### Logging & Debugging
- 📝 Added comprehensive console logging across all adapters
  - Strategy indication (which extraction method succeeded)
  - Success markers (✓) for easy scanning
  - Detailed error messages with context
  - API endpoint attempt logging

#### Error Handling
- 🛡️ Better error messages for users
  - Specific guidance based on error type
  - Platform-specific troubleshooting hints
  - "Try opening conversation first" suggestions

#### Code Quality
- 📚 Added JSDoc-style comments to key functions
- 🎯 Separated concerns with clear function boundaries
- 🔄 Consistent error handling patterns
- 🧹 Removed duplicate code

### Changed

#### Manifest (manifest.json)
- Updated `version` to `5.0.0`
- Added `identity` permission for OAuth2
- Added `web_accessible_resources` for:
  - `auth/callback.html` (chromiumapp redirect)
  - `auth/notion-oauth.js`
  - `icons/logos/*.svg`

#### Export Manager (export-manager.js)
- Enhanced HTML export template with platform badges
- Added platform emoji icons to Markdown exports
- Improved export metadata in frontmatter

### Developer Notes

#### Breaking Changes
- None - all changes are backward compatible

#### Migration Guide
- Existing token-based Notion auth continues to work
- OAuth2 is optional but recommended for new users
- Platform adapters automatically fall back if primary methods fail

#### Technical Debt Addressed
- ✅ Fixed hardcoded endpoints with fallbacks
- ✅ Improved DOM selector resilience
- ✅ Better auth token handling
- ✅ Enhanced error recovery

#### Known Issues
- Gemini RPC IDs may change in future Google updates
- ChatGPT DOM selectors may need updates if UI changes significantly
- OAuth2 requires extension reload after first authorization

#### Testing Recommendations
1. Test each platform individually
2. Verify both API and DOM extraction methods
3. Test OAuth2 flow end-to-end
4. Export to all formats to verify logos appear
5. Test with expired/invalid tokens

### Security

- 🔐 OAuth2 tokens stored securely in chrome.storage.local
- 🔐 Client secrets never logged or exposed
- 🔐 Automatic token refresh prevents credential expiration
- 🔐 Authorization follows Notion's official OAuth2 spec

### Performance

- ⚡ Multiple endpoint attempts happen sequentially (fail fast)
- ⚡ DOM extraction only triggers when API fails
- ⚡ Logo SVGs are lightweight and cached by browser
- ⚡ OAuth token refresh is automatic and transparent

---

## [4.2.0] - Previous Release

### Features
- Multi-platform support (6 platforms)
- Multiple export formats
- Auto-sync functionality
- Dashboard for bulk operations

### Platforms
- ✅ Perplexity (Working)
- ✅ Grok (Working)
- ✅ Claude (Working)
- ⚠️ ChatGPT (Not working - fixed in 5.0.0)
- ⚠️ Gemini (Not working - fixed in 5.0.0)
- ⚠️ DeepSeek (Not working - fixed in 5.0.0)

---

## Version History

- **5.1.0** - Security hardening, architecture restructure, documentation overhaul (Current)
- **5.0.0** - Platform fixes, OAuth2, logos
- **4.2.0** - Multi-platform support, dashboard
- **4.0.0** - Enterprise features, auto-sync
- **3.0.0** - Multiple export formats
- **2.0.0** - Notion integration
- **1.0.0** - Initial release (Perplexity only)

---

## Contributors

- [@AI Assistant] - Platform adapter fixes, OAuth2 implementation, logos
- [Original Author] - Core functionality, dashboard, auto-sync

## Feedback

Found a bug? Have a feature request? 
- Open an issue on GitHub
- Contact via email
- Join our Discord community

---

**Legend:**
- ✨ NEW - New features
- 🐛 FIXED - Bug fixes
- 📝 DOCS - Documentation
- 🎨 STYLE - UI/UX improvements
- ⚡ PERF - Performance improvements
- 🔐 SECURITY - Security improvements
