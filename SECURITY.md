# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 5.1.x   | ✅ Current |
| 5.0.x   | ⚠️ Upgrade recommended |
| < 5.0   | ❌ No longer supported |

## Security Practices

### Authentication
- Notion OAuth2 client secret is stored server-side on the Cloudflare Worker — never exposed in the extension
- OAuth tokens stored in `chrome.storage.local` (encrypted by Chrome)
- Bearer tokens for ChatGPT are fetched per-session from the auth endpoint and cached with TTL

### Content Security Policy
- `script-src 'self'` — no remote script execution
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` is required because `src/ui/options.html` uses inline `style=""` attributes (dev tools section). Migrating all inline styles to CSS classes is tracked as a future improvement.
- `connect-src` limited to known API domains only (including the specific OAuth worker URL, not a wildcard)
- `object-src 'self'` — no plugin-based content

### Input Validation
- All UUIDs validated with `SecurityUtils.isValidUuid()` before reaching API calls
- HTML content sanitized via `SecurityUtils.sanitizeHtml()` to prevent XSS
- `postMessage` listeners validate `event.origin` against expected platform domains

### Permissions (Principle of Least Privilege)
- `web_accessible_resources` scoped to specific platform origins (not `<all_urls>`)
- `host_permissions` limited to the 8 supported platform domains + Notion API
- `downloads` is an optional permission (not required by default)

### Data Handling
- No user conversation data is stored by the extension itself
- Exports are generated client-side and saved locally or to the user's own Notion workspace
- No telemetry, analytics, or data collection

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Email: [Add your security contact email]
3. Include: description, reproduction steps, and potential impact
4. Expected response time: 48 hours

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for security-related changes in each version.
