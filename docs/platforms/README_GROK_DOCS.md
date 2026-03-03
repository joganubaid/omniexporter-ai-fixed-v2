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

4. **GROK_ANALYSIS_SUMMARY.md**  
   Executive summary of HAR analysis.

5. **grok.har**  
   Network capture source (47,536 lines).

---

## Quick Start

### For Developers
1. Read GROK_API_REFERENCE.md  
2. Validate the adapter with GROK_VALIDATION_GUIDE.md  
3. Review validation results in GROK_ADAPTER_VALIDATION.md  

### For Agents
1. Start with GROK_ANALYSIS_SUMMARY.md  
2. Compare with GROK_API_REFERENCE.md  
3. Validate implementation in grok-adapter.js  

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
