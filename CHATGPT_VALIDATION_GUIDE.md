# ChatGPT API Validation Guide

**Quick Reference for Agent Validation**

---

## Critical Endpoints (2)

### 1. List Conversations
```
GET /backend-api/conversations?offset=0&limit=28&order=updated&is_archived=false&is_starred=false
```

**Response:**
```json
{
  "items": [...],
  "total": 17,
  "limit": 28,
  "offset": 0
}
```

### 2. Get Conversation Detail
```
GET /backend-api/conversation/{uuid}
```

**Response:**
```json
{
  "title": "...",
  "create_time": 1731240994.481777,
  "update_time": 1731264793.550262,
  "mapping": { ... }
}
```

---

## Authentication

**Method:** Bearer JWT Token

**Get Token:**
```javascript
const response = await fetch('https://chatgpt.com/api/auth/session');
const { accessToken } = await response.json();
```

**Required Headers:**
```http
Authorization: Bearer {accessToken}
OAI-Device-Id: {from oai-did cookie}
```

---

## Key Differences from Other Platforms

| Feature | ChatGPT | Claude | Gemini |
|---------|---------|--------|--------|
| Auth | Bearer JWT | Cookie | Session params |
| Structure | Tree (mapping) | Linear array | RPC |
| Pagination | Offset | Offset | Cursor |
| Complexity | High | Low | Medium |

---

## Tree Structure

ChatGPT uses a **tree-based mapping** where messages are nodes with parent-child relationships.

**Traversal:**
1. Find root node (parent === null)
2. Follow children[0] for main branch
3. Extract message from each node
4. Skip non-text content types

**Content Types to Skip:**
- `model_editable_context`
- `tether_browsing_display`
- `tether_quote`
- `system_error`

---

## Validation Checklist

- [ ] Bearer token acquired from `/api/auth/session`
- [ ] OAI-Device-Id extracted from `oai-did` cookie
- [ ] Conversations list returns items array
- [ ] Pagination uses offset + limit
- [ ] hasMore calculated from total field
- [ ] Conversation detail returns mapping object
- [ ] Tree traversal extracts messages correctly
- [ ] Content type filtering implemented
- [ ] Retry logic handles 401/429 errors
- [ ] Token cached with 55-minute TTL

---

## Common Issues

**Issue:** 401 Unauthorized  
**Fix:** Refresh Bearer token from `/api/auth/session`

**Issue:** Empty messages  
**Fix:** Check content_type filtering (skip non-text types)

**Issue:** Missing messages  
**Fix:** Verify tree traversal follows children[0]

**Issue:** Rate limited  
**Fix:** Add 300ms delay between requests

---

## Quick Test

```javascript
// 1. Get token
const token = await fetch('https://chatgpt.com/api/auth/session')
    .then(r => r.json()).then(d => d.accessToken);

// 2. List conversations
const list = await fetch('https://chatgpt.com/backend-api/conversations?offset=0&limit=5', {
    headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

console.log(`Found ${list.total} conversations`);

// 3. Get first conversation
if (list.items.length > 0) {
    const detail = await fetch(`https://chatgpt.com/backend-api/conversation/${list.items[0].id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json());
    
    console.log(`Conversation: ${detail.title}`);
    console.log(`Nodes: ${Object.keys(detail.mapping).length}`);
}
```

---

**See CHATGPT_API_REFERENCE.md for complete documentation**
