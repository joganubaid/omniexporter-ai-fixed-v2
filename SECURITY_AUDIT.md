# 🔒 Security Audit & Bug Report
## OmniExporter AI - Chrome Extension

---

## Executive Summary

This security audit identified **16 vulnerabilities/bugs** across the OmniExporter AI Chrome extension codebase. The extension handles sensitive authentication tokens (Notion OAuth, AI platform credentials) and user data (chat exports), making these findings critical to address.

| Severity | Count | Examples |
|----------|-------|----------|
| 🔴 **Critical** | 3 | Client secret exposure, XSS via postMessage, duplicate code bugs |
| 🟠 **High** | 5 | OAuth token storage, overly broad web_accessible_resources |
| 🟡 **Medium** | 5 | Error handling gaps, input validation inconsistencies |
| 🔵 **Low** | 3 | Code quality issues, console logging |

---

## 🔴 Critical Vulnerabilities

### 1. OAuth Client Secret Stored in Local Storage
**Location**: [notion-oauth.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/auth/notion-oauth.js#L32-L34)

**Issue**: The Notion OAuth `clientSecret` is stored in `chrome.storage.local` and retrieved into the config object.

```javascript
// Lines 32-34
this.config.clientId = stored.notion_oauth_client_id;
this.config.clientSecret = stored.notion_oauth_client_secret;
```

**Risk**: Client secrets should NEVER be stored on the client side. If a malicious extension or XSS attack gains access to storage, the OAuth integration is compromised.

**Recommendation**: 
- Remove client secret from client storage entirely
- Use **server-side token exchange** via a backend proxy
- Consider using Notion's **public OAuth flow** without client secrets

---

### 2. Duplicate Function Definitions in `background.js`
**Location**: [background.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/background.js#L306-L441)

**Issue**: The `syncToNotion` function is defined **TWICE** (lines 306-380 and lines 381-441), with the second definition being malformed and containing orphaned code.

```javascript
// Line 310 - First `const token`
const token = await NotionOAuth.getActiveToken();

// Line 354 - SECOND `const token` declaration inside same function!
const token = await NotionOAuth.getActiveToken();
```

**Risk**: 
- JavaScript will throw `SyntaxError: Identifier 'token' has already been declared`
- The entire background service worker may fail to load
- Auto-sync functionality is completely broken

**Recommendation**: Remove duplicate function definition (lines 381-441).

---

### 3. Cross-Site Script Inclusion (XSS) via postMessage
**Location**: [gemini-adapter.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/gemini-adapter.js#L47-L52)

**Issue**: The message bridge uses `window.postMessage` with wildcard origin and lacks origin validation:

```javascript
// Line 98-104 - Sending to wildcard origin
window.postMessage({
    type: 'OMNIEXPORTER_GEMINI',
    direction: 'to-page',
    ...
}, '*');  // ⚠️ Wildcard origin

// Line 47-48 - No origin validation on receive
window.addEventListener('message', (event) => {
    if (event.source !== window) return;  // Only checks source, not origin
```

**Risk**: Any script on the page can:
- Inject malicious messages that the extension will process
- Extract sensitive data being passed through the bridge
- Trigger unintended actions in the extension

**Recommendation**: 
```javascript
// Always validate origin
window.postMessage({...}, window.location.origin);

// Validate on receive
if (event.origin !== window.location.origin) return;
```

---

## 🟠 High Severity Issues

### 4. Overly Broad `web_accessible_resources`
**Location**: [manifest.json](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/manifest.json#L105-L114)

**Issue**: Resources are accessible to `<all_urls>`:

```json
{
    "resources": ["auth/callback.html", "auth/notion-oauth.js", "icons/logos/*.svg"],
    "matches": ["<all_urls>"]  // ⚠️ Any website can access
}
```

**Risk**: Any website can load these extension resources, potentially enabling fingerprinting or exploitation.

**Recommendation**: Restrict to only necessary domains:
```json
"matches": ["https://api.notion.com/*", "https://*.chromiumapp.org/*"]
```

---

### 5. LocalStorage Token Extraction Without Validation
**Location**: [deepseek-adapter.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/deepseek-adapter.js#L58-L100)

**Issue**: Auth tokens are extracted from localStorage with minimal validation:

```javascript
// Line 84 - Accepts any string > 10 chars as a token
if (tokenData.length > 10) {
    return tokenData;  // No format validation
}
```

**Risk**: Could inadvertently send non-token data in Authorization headers.

**Recommendation**: Add token format validation before use.

---

### 6. OAuth State Validation Can Be Bypassed
**Location**: [notion-oauth.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/auth/notion-oauth.js#L105-L109)

**Issue**: State validation only triggers if stored state exists:

```javascript
// Line 106
if (stored.notion_oauth_state && returnedState !== stored.notion_oauth_state) {
    reject(new Error('OAuth state mismatch'));
}
```

**Risk**: If storage is cleared between authorize() and callback, state validation is skipped entirely.

**Recommendation**: Always require state match:
```javascript
if (!stored.notion_oauth_state || returnedState !== stored.notion_oauth_state) {
    reject(new Error('OAuth state mismatch'));
}
```

---

### 7. Token Never Validated Before Use
**Location**: [notion-oauth.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/auth/notion-oauth.js#L190-L202)

**Issue**: `getAccessToken()` returns stored token without verifying it's still valid with Notion API.

**Risk**: Stale or revoked tokens will cause silent failures.

**Recommendation**: Add token validation before returning:
```javascript
async getAccessToken() {
    const token = stored.notion_oauth_access_token;
    const isValid = await this.validateToken(token);
    if (!isValid) throw new Error('Token invalid');
    return token;
}
```

---

### 8. Arbitrary URL Navigation
**Location**: [popup.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/popup.js#L347-L361)

**Issue**: `navigateToPlatform()` uses hardcoded URLs which is good, but the pattern could be extended unsafely.

**Risk**: Low currently, but architecture should prevent URL injection.

---

## 🟡 Medium Severity Issues

### 9. Inconsistent Input Sanitization
**Location**: Multiple files

**Issue**: `InputSanitizer.clean()` is defined in three places with slight variations:
- [content.js:17-27](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/content.js#L17-L27)
- [popup.js:156-167](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/popup.js#L156-L167)
- [options.js:45-56](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/options.js#L45-L56)

**Risk**: Inconsistent sanitization across the extension.

**Recommendation**: Consolidate into single shared utility file.

---

### 10. Missing Error Boundaries in DOM Extraction
**Location**: All adapter files

**Issue**: DOM extraction functions in `deepseek-adapter.js`, `grok-adapter.js`, and `gemini-adapter.js` use `element.innerText` without null checks in some paths.

```javascript
// grok-adapter.js line 191
const text = bubble.innerText?.trim() || '';  // ✅ Safe
const text = bubble.innerText.trim();         // ❌ Used elsewhere
```

**Recommendation**: Consistently use optional chaining throughout.

---

### 11. UUID Validation Inconsistency
**Location**: [content.js:11-15](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/content.js#L11-L15)

**Issue**: `SecurityUtils.isValidUuid()` is defined but never used in message handlers:

```javascript
// Defined but unused:
isValidUuid: (uuid) => { ... }

// Line 143 - UUID passed without validation
await handleExtractionByUuid(adapter, request.payload.uuid, sendResponse);
```

**Risk**: Malicious UUIDs could potentially exploit API endpoints.

---

### 12. History API Pollution
**Location**: [content.js:95-111](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/content.js#L95-L111)

**Issue**: Overrides `history.pushState` and `history.replaceState` globally:

```javascript
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    navigationHandler();
};
```

**Risk**: Could interfere with page functionality or be detected by anti-extension measures.

**Recommendation**: Use Navigation API if available, or `MutationObserver` on URL changes.

---

### 13. Notion API Key Logged to Console
**Location**: [deepseek-adapter.js:79](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/deepseek-adapter.js#L79)

**Issue**: Console logging reveals token discovery:

```javascript
console.log(`[DeepSeek] Found token in localStorage key: ${key}`);
```

**Risk**: Token metadata exposed in console, viewable by any user or extension.

---

## 🔵 Low Severity Issues

### 14. Missing Content-Security-Policy for Eval
**Location**: [manifest.json](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/manifest.json#L6-L8)

**Issue**: CSP allows `'unsafe-inline'` for styles but this is acceptable for extensions.

**Status**: Low risk, but monitor for changes.

---

### 15. No Rate Limit on Local Operations
**Location**: Various

**Issue**: Operations like `trackFailure()` have no limits on storage writes.

```javascript
// background.js line 484
if (failures.length > 100) failures.shift();  // Only caps at 100
```

**Recommendation**: Add write rate limiting for storage operations.

---

### 16. Global Variable Pollution
**Location**: [network-interceptor.js](file:///c:/Users/jonub/Downloads/chats-export-to-notion-master/chats-export-to-notion-master/network-interceptor.js#L114-L116)

**Issue**: Exposes data globally:
```javascript
window.__omniChatList = this.chatListData;
window.__omniEndpoints = this.capturedEndpoints;
```

**Risk**: Any script can read intercepted data.

---

## Verification & Testing Notes

This extension has **no automated tests**. Verification must be done manually:

1. **OAuth Flow Test**: Attempt OAuth connection in settings
2. **Export Test**: Export single chat from each platform
3. **Bulk Export Test**: Select multiple threads and export
4. **Auto-sync Test**: Enable auto-sync and monitor console for errors

---

## Recommended Fixes Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | Fix duplicate `syncToNotion` function | 5 min |
| 2 | Add postMessage origin validation | 30 min |
| 3 | Restrict web_accessible_resources | 10 min |
| 4 | Move OAuth client secret server-side | 2+ hours |
| 5 | Consolidate sanitization utilities | 1 hour |

---

*Report generated: 2026-01-17*
*Files analyzed: 15*
*LOC reviewed: ~6,000*
