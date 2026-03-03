# Grok Validation Guide (Non‑Telemetry)

**Quick Reference for Non‑Telemetry API Coverage**

---

## Quick Start

### Files to Review
1. **grok.har** - Network capture (47,536 lines)
2. **GROK_API_REFERENCE.md** - Non‑telemetry endpoint reference
3. **GROK_ANALYSIS_SUMMARY.md** - Executive summary
4. **src/adapters/grok-adapter.js** - Implementation

---

## Critical Endpoints

### 1. List Conversations
```
GET /rest/app-chat/conversations?pageSize=60
```

### 2. Response Nodes
```
GET /rest/app-chat/conversations/{uuid}/response-node?includeThreads=true
```

### 3. Load Responses
```
POST /rest/app-chat/conversations/{uuid}/load-responses
```

---

## Validation Checklist

- [ ] Requests send cookies with `credentials: "include"`
- [ ] Conversation list uses `pageSize`
- [ ] Response-node call includes `includeThreads=true`
- [ ] Load-responses is called after response-node
- [ ] Workspace endpoints work when workspaceId is present
- [ ] Non‑telemetry endpoints match GROK_API_REFERENCE.md

---

## Common Issues & Fixes

### 1. 401/403 Unauthorized
**Cause:** Session cookies missing or expired  
**Fix:** Log in to grok.com and retry

### 2. Empty Responses
**Cause:** Conversations in different workspace  
**Fix:** Use workspaceId or workspace endpoints

### 3. Missing Messages
**Cause:** Skipping response-node step  
**Fix:** Always call response-node before load-responses

---

## Manual Testing Steps

1. Open grok.com and sign in  
2. Call list conversations with `pageSize=60`  
3. Pick a `conversationId` and call response-node  
4. Call load-responses for the same conversation  
5. Verify message content is returned

---

## Quick Reference

### Non‑Telemetry Endpoints (Summary)
- `/rest/app-chat/conversations`
- `/rest/app-chat/conversations/{uuid}/response-node`
- `/rest/app-chat/conversations/{uuid}/load-responses`
- `/rest/app-chat/conversations_v2/{uuid}`
- `/rest/app-chat/share_links`
- `/rest/workspaces`, `/rest/workspaces/{uuid}`, `/rest/workspaces/{uuid}/conversations`
- `/rest/user-settings`, `/rest/system-prompt/list`, `/rest/dev/models`
- `/rest/tasks`, `/rest/tasks/inactive`, `/rest/notifications/list`
- `/rest/products`, `/rest/suggestions/profile`, `/rest/highlights/stories`
- `/rest/assets`
- `/api/oauth-connectors`
