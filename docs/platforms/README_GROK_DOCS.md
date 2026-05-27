# Grok Documentation Index (Non‑Telemetry)

**OmniExporter AI - Grok Integration Package**

---

## Documentation Files

1. **GROK_API_REFERENCE.md**  
   Complete non‑telemetry endpoint reference with HAR coverage and endpoint directory.

2. **GROK_VALIDATION_GUIDE.md**  
   Quick validation checklist for non‑telemetry API coverage.

3. **GROK_ADAPTER_VALIDATION.md**  
   Implementation vs HAR validation report (non‑telemetry only).

(Earlier docs referenced `GROK_ANALYSIS_SUMMARY.md` and a committed `grok.har`
file — neither exists in the repo. HAR files are gitignored as `*.har`; capture
your own from grok.com via DevTools Network if you need to verify endpoints.)

---

## Quick Start

### For Developers
1. Read GROK_API_REFERENCE.md  
2. Validate the adapter with GROK_VALIDATION_GUIDE.md  
3. Review validation results in GROK_ADAPTER_VALIDATION.md  
4. (Optional) Capture a fresh HAR from grok.com to verify endpoints against
   the validation guide before declaring an API change is real.

---

## Key Non‑Telemetry Endpoints

- `/rest/app-chat/conversations`
- `/rest/app-chat/conversations/{uuid}/response-node`
- `/rest/app-chat/conversations/{uuid}/load-responses`
- `/rest/app-chat/conversations_v2/{uuid}`
- `/rest/workspaces/*`
- `/rest/user-settings`
- `/rest/system-prompt/list`
- `/rest/dev/models`
- `/rest/tasks`, `/rest/tasks/inactive`
- `/rest/notifications/list`

---

## Adapter Location

`src/adapters/grok-adapter.js`
