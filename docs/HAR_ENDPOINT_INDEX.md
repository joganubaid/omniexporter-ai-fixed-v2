# HAR-Verified API Endpoint Index

> Quick reference of all API endpoints discovered and verified through HAR (HTTP Archive) analysis across 6 AI platforms.

**Last Updated:** 2026-03-16

---

## ChatGPT (chatgpt.har — 35 MB, 112K lines)
**Base URL:** `https://chatgpt.com`
**Auth:** Bearer token via session API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/backend-api/conversations` | GET | List conversations (offset pagination) |
| `/backend-api/conversation/{uuid}` | GET | Get full conversation with messages |
| `/api/auth/session` | GET | Get session & access token |
| `/backend-api/models` | GET | List available models |
| `/backend-api/share/create` | POST | Create share link |

---

## Claude (claude.har — 14.6 MB)
**Base URL:** `https://claude.ai`
**Auth:** Cookie-based (sessionKey) + `anthropic-client-platform: web_claude_ai` header

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/organizations` | GET | Get organization UUID (required for all other calls) |
| `/api/organizations/{org}/chat_conversations` | GET | List conversations (V1, offset-based fallback) |
| `/api/organizations/{org}/chat_conversations_v2?limit=50&consistency=eventual` | GET | List conversations (V2, **offset-based** — no cursor field; use `&offset=N`) |
| `/api/organizations/{org}/chat_conversations/{uuid}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=str` | GET | Get conversation detail with full content blocks |
| `/api/organizations/{org}/artifacts/{uuid}/versions?source=w` | GET | List artifact versions for a conversation |
| `/api/organizations/{org}/artifacts/artifact_version/{id}/manage/storage/info` | GET | Get artifact storage info |
| `/api/{org}/files/{fileId}/preview` | GET | Fetch generated/uploaded file content |
| `/api/organizations/{org}/projects/{uuid}` | GET | Get project details |

---

## Perplexity (perplexity.har — 16.3 MB, 448 requests)
**Base URL:** `https://www.perplexity.ai`
**Auth:** Cookie-based

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/thread/list_ask_threads` | POST | List threads (body: `{limit:20, offset:N}` — API hard-caps at 20/page; use `items[0].has_next_page` to paginate) |
| `/rest/thread/{uuid}?with_schematized_response=true&supported_block_use_cases=...` | GET | Get thread detail with cursor pagination (`next_cursor`) |
| `/rest/collections/list_user_collections` | GET | List spaces/collections |
| `/rest/user/settings` | GET | Get user settings |

---

## Gemini (gemini.har — 22.8 MB)
**Base URL:** `https://gemini.google.com`
**Auth:** Cookie-based (SID, HSID, SSID)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/_/BardChatUi/data/batchexecute` (MaZiqc) | POST | List conversations |
| `/_/BardChatUi/data/batchexecute` (hNvQHb) | POST | Get conversation detail |

---

## Grok (grok.har — 63.1 MB, 231 requests)
**Base URL:** `https://grok.com`
**Auth:** Cookie-based (`sso`, `sso-rw` cookies)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/app-chat/conversations?pageSize=50[&pageToken=cursor]` | GET | List conversations (cursor pagination via `nextPageToken`) |
| `/rest/app-chat/conversations/{uuid}/response-node?includeThreads=true` | GET | Step 1 of detail fetch — get `responseNodes[].responseId` array |
| `/rest/app-chat/conversations/{uuid}/load-responses` | POST | Step 2 of detail fetch — body: `{responseIds:[...]}` → returns messages |
| `/rest/app-chat/conversations_v2/{uuid}?includeWorkspaces=true&includeTaskResult=true` | GET | Get conversation metadata (title, model) |
| `/rest/workspaces?pageSize=50&orderBy=ORDER_BY_LAST_USE_TIME` | GET | List workspaces |

---

## DeepSeek (deepseek.har — 3.7 MB, 60 requests)
**Base URL:** `https://chat.deepseek.com`
**Auth:** Bearer token (`userToken` from localStorage or `/api/v0/users/current`) + `x-client-version: 1.7.1` headers

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v0/chat_session/fetch_page?lte_cursor.pinned=false[&lte_cursor.updated_at=...&lte_cursor.id=...]` | GET | List chat sessions (cursor pagination via last session's `updated_at` + `id`) |
| `/api/v0/chat/history_messages?chat_session_id={uuid}&cache_version=2` | GET | Get all messages for a session (`fragments[]` array — `content` field is always empty) |
| `/api/v0/users/current` | GET | Get user info and Bearer token (`data.biz_data.token`) |
| `/api/v0/client/settings` | GET | Get client feature flags and settings |
