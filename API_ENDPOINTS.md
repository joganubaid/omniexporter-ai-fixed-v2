# 🔌 OmniExporter AI - API Endpoints Reference
## Last Updated: 2026-01-17

This document contains the current API structure for all supported AI platforms. Use this as a reference when platforms update their APIs.

---

## 📊 Quick Reference Table

| Platform | List Threads Endpoint | Thread Detail Endpoint | Auth Method |
|----------|----------------------|------------------------|-------------|
| Perplexity | `/rest/thread/list_ask_threads` | `/rest/thread/{uuid}` | Session Cookie |
| ChatGPT | `/backend-api/conversations` | `/backend-api/conversation/{uuid}` | Session Cookie |
| Claude | `/api/organizations/{org}/chat_conversations` | `/api/organizations/{org}/chat_conversations/{uuid}` | Session Cookie |
| Gemini | `/_/BardChatUi/data/batchexecute` | RPC via batchexecute | WIZ_global_data |
| Grok | `/api/conversations` | `/api/conversation/{uuid}` | Session Cookie |
| DeepSeek | `/api/v0/chat_session/fetch_page` | `/api/v0/chat/{uuid}/history_message` | userToken (localStorage) |

---

## 🟦 Perplexity

### Base URL
```
https://www.perplexity.ai
```

### List Threads
```http
POST /rest/thread/list_ask_threads?version=2.18&source=default
Content-Type: application/json

{
    "limit": 50,
    "offset": 0
}
```

**Response Structure:**
```json
{
    "threads": [
        {
            "uuid": "abc123",
            "title": "Chat Title",
            "last_query_datetime": "2026-01-17T10:00:00Z"
        }
    ],
    "total": 100
}
```

### Thread Detail
```http
GET /rest/thread/{uuid}?with_parent_info=true&with_schematized_response=true&version=2.18&source=default
```

**Response Structure:**
```json
{
    "uuid": "abc123",
    "title": "Chat Title",
    "entries": [
        {
            "query": "User question",
            "query_str": "User question",
            "blocks": [
                {
                    "intended_usage": "ask_text",
                    "markdown_block": {
                        "answer": "AI response text",
                        "chunks": ["chunk1", "chunk2"]
                    }
                },
                {
                    "intended_usage": "web_results",
                    "web_result_block": {
                        "web_results": [
                            {"url": "...", "title": "..."}
                        ]
                    }
                }
            ]
        }
    ]
}
```

### Spaces (Collections)
```http
GET /rest/collections/list
```

---

## 🟢 ChatGPT

### Base URL
```
https://chatgpt.com
```

### List Conversations
```http
GET /backend-api/conversations?offset=0&limit=50&order=updated
```

**Response Structure:**
```json
{
    "items": [
        {
            "id": "uuid",
            "title": "Chat Title",
            "create_time": "2026-01-17T10:00:00Z",
            "update_time": "2026-01-17T10:00:00Z"
        }
    ],
    "total": 100,
    "limit": 50,
    "offset": 0
}
```

### Conversation Detail
```http
GET /backend-api/conversation/{uuid}
```

**Response Structure:**
```json
{
    "title": "Chat Title",
    "create_time": 1234567890,
    "mapping": {
        "node-id": {
            "message": {
                "author": {"role": "user|assistant"},
                "content": {
                    "parts": ["Message text"]
                }
            }
        }
    }
}
```

---

## 🟠 Claude

### Base URL
```
https://claude.ai
```

### Get Organizations
```http
GET /api/organizations
```

### List Conversations
```http
GET /api/organizations/{org_id}/chat_conversations
```

**Response Structure:**
```json
[
    {
        "uuid": "abc123",
        "name": "Chat Title",
        "created_at": "2026-01-17T10:00:00Z",
        "updated_at": "2026-01-17T10:00:00Z"
    }
]
```

### Conversation Detail
```http
GET /api/organizations/{org_id}/chat_conversations/{uuid}
```

**Response Structure:**
```json
{
    "uuid": "abc123",
    "name": "Chat Title",
    "chat_messages": [
        {
            "uuid": "msg-id",
            "sender": "human|assistant",
            "text": "Message content"
        }
    ]
}
```

---

## 🟣 Gemini

### Base URL
```
https://gemini.google.com
```

### Authentication
Gemini uses `WIZ_global_data` from page context containing:
- `SNlM0e` - Auth token for batchexecute requests
- Requires page context injection to access

### Batch Execute (All Operations)
```http
POST /_/BardChatUi/data/batchexecute
Content-Type: application/x-www-form-urlencoded

f.req=[[["RPC_ID",JSON_PAYLOAD,null,"generic"]]]
```

### RPC IDs
| Operation | RPC ID |
|-----------|--------|
| List Conversations | `xV5YFf` or `h90X4` |
| Get Conversation | `VT4Qac` or `xV5YFf` |

### Response Format
Gemini returns data wrapped in multiple layers:
```
)]}'

[response_array]
```
Parse by:
1. Remove `)]}'\n` prefix
2. Parse as JSON array
3. Navigate: `[0][2]` contains actual data

---

## 🔴 Grok

### Base URL
```
https://grok.com
```

### List Conversations
```http
GET /api/conversations
```

**Headers Required:**
```http
Accept: application/json
X-Requested-With: XMLHttpRequest
```

**Response Structure:**
```json
{
    "conversations": [
        {
            "id": "uuid",
            "title": "Chat Title",
            "created_at": "2026-01-17T10:00:00Z"
        }
    ]
}
```

### Conversation Detail
```http
GET /api/conversation/{uuid}
```

**Alternative Endpoints:**
- `/rest/conversation/{uuid}`
- `/i/api/2/grok/conversation/{uuid}`

---

## 🟤 DeepSeek

### Base URL
```
https://chat.deepseek.com
```

### Authentication
Uses `userToken` from localStorage

### List Sessions
```http
GET /api/v0/chat_session/fetch_page?lte_cursor.pinned=false
Authorization: Bearer {userToken}
```

**Response Structure:**
```json
{
    "data": {
        "biz_data": {
            "chat_sessions": [
                {
                    "id": "uuid",
                    "title": "Chat Title",
                    "updated_at": "2026-01-17T10:00:00Z"
                }
            ],
            "cursor": "next_page_cursor"
        }
    }
}
```

### Chat History
```http
GET /api/v0/chat/{session_id}/history_message?lte_cursor.id=
Authorization: Bearer {userToken}
```

**Response Structure:**
```json
{
    "data": {
        "biz_data": {
            "messages": [
                {
                    "id": "msg-id",
                    "role": "user|assistant",
                    "content": "Message text"
                }
            ]
        }
    }
}
```

---

## 🔄 Common Patterns

### Pagination
Most platforms use offset-based or cursor-based pagination:
- **Offset-based**: `?offset=0&limit=50`
- **Cursor-based**: `?cursor=abc123` or `?lte_cursor.id=abc123`

### Authentication
All platforms use session cookies except:
- **DeepSeek**: Uses `userToken` from localStorage
- **Gemini**: Uses `SNlM0e` token from page context

### Error Codes
| Code | Meaning |
|------|---------|
| 401 | Session expired, need to re-login |
| 403 | Access denied, may need different permissions |
| 429 | Rate limited, wait and retry |
| 404 | Endpoint changed or resource not found |

---

## 📝 How to Capture New Endpoints

1. Open Firefox/Chrome DevTools → Network tab
2. Filter by XHR/Fetch requests
3. Perform the action (load chats, open conversation)
4. Right-click request → Copy as cURL
5. Use the AI prompt below to analyze

---

*Last verified: 2026-01-17*
