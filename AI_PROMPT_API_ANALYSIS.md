# 🤖 AI Prompt for API Endpoint Analysis
## Use this prompt to analyze network logs when platforms update their APIs

---

## Instructions

1. **Capture network logs** from Firefox/Chrome DevTools
2. **Copy the relevant requests** (list chats, get chat detail)
3. **Paste into ChatGPT/Claude/Gemini** with this prompt

---

## The Prompt

```
You are an expert API reverse engineer. I have network logs from [PLATFORM NAME] that I need to analyze to update my Chrome extension's API integration.

## Current Known Endpoints

### List Chats Endpoint:
[PASTE CURRENT ENDPOINT FROM API_ENDPOINTS.md]

### Chat Detail Endpoint:
[PASTE CURRENT ENDPOINT FROM API_ENDPOINTS.md]

---

## Network Logs from DevTools

### Request 1 (List Chats):
```
[PASTE cURL OR REQUEST HEADERS HERE]
```

### Response 1:
```json
[PASTE RESPONSE JSON HERE]
```

### Request 2 (Chat Detail):
```
[PASTE cURL OR REQUEST HEADERS HERE]
```

### Response 2:
```json
[PASTE RESPONSE JSON HERE]
```

---

## Your Task

1. **Compare** the new endpoints/structure with the old ones
2. **Identify changes** in:
   - URL paths
   - Query parameters
   - Request headers
   - Request body format
   - Response structure (field names, nesting)
3. **Provide updated code** for my adapter:

### Current Adapter Code:
```javascript
[PASTE RELEVANT ADAPTER FUNCTION]
```

### Please provide:
1. Summary of API changes detected
2. Updated JavaScript code for the adapter
3. Any new headers or parameters needed
4. Updated response parsing logic
```

---

## Example Usage

### For Perplexity:

```
You are an expert API reverse engineer. I have network logs from Perplexity that I need to analyze to update my Chrome extension's API integration.

## Current Known Endpoints

### List Chats Endpoint:
POST /rest/thread/list_ask_threads?version=2.18&source=default

### Chat Detail Endpoint:
GET /rest/thread/{uuid}?with_parent_info=true&version=2.18

---

## Network Logs from DevTools

### Request 1 (List Chats):
curl 'https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.19&source=default' \
  -H 'content-type: application/json' \
  --data-raw '{"limit":50,"offset":0}'

### Response 1:
{
  "threads": [...],
  "total": 150,
  "next_cursor": "abc123"
}

... [continue with your actual logs]
```

---

## Tips for Capturing Good Logs

### Firefox DevTools:
1. Open DevTools (F12) → Network tab
2. Check "Persist Logs" to keep logs across page loads
3. Filter: `XHR` or `Fetch`
4. Clear logs, then perform action
5. Right-click request → Copy → Copy as cURL

### Chrome DevTools:
1. Open DevTools (F12) → Network tab
2. Check "Preserve log"
3. Filter: `Fetch/XHR`
4. Right-click request → Copy → Copy as cURL (bash)

### What to Capture:
- **List chats**: Navigate to chat list, scroll to load more
- **Chat detail**: Open a specific conversation
- **Search**: If searching chats
- **Pagination**: Load more results

---

## Quick Checklist for API Changes

When analyzing AI response, verify:

- [ ] Base URL same?
- [ ] Endpoint path changed?
- [ ] Query parameters changed?
- [ ] New headers required?
- [ ] Request body format changed?
- [ ] Response field names changed?
- [ ] Pagination method changed?
- [ ] Authentication method changed?

---

## Platform-Specific Notes

### Perplexity
- Watch for `version` parameter changes (currently 2.18)
- `blocks` structure in responses may change

### ChatGPT
- Uses `backend-api` prefix
- `mapping` structure for messages is complex

### Claude
- Requires `organization_id` from `/api/organizations` first
- Structure is relatively stable

### Gemini
- Uses RPC-style `batchexecute` endpoint
- RPC IDs change frequently
- Response is non-standard JSON (wrapped)

### Grok
- API is newer and may change more frequently
- Watch for x.com/Twitter integration changes

### DeepSeek
- Uses cursor-based pagination
- `userToken` from localStorage

---

*Use this prompt whenever you see "API blocked" or "Failed to fetch" errors*
