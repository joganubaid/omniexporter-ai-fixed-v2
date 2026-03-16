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
**Base URL:** `https://api.claude.ai`
**Auth:** Cookie-based (sessionKey)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/organizations/{org}/chat_conversations` | GET | List conversations (v1, offset) |
| `/api/organizations/{org}/chat_conversations_v2` | GET | List conversations (v2, cursor) |
| `/api/organizations/{org}/chat_conversations/{uuid}` | GET | Get conversation detail |
| `/api/organizations/{org}/projects` | GET | List projects |

---

## Perplexity (perplexity.har — 16.3 MB, 448 requests)
**Base URL:** `https://www.perplexity.ai`
**Auth:** Cookie-based

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/thread/list_threads` | POST | List threads (offset pagination) |
| `/rest/thread/get_thread` | POST | Get thread detail (cursor pagination) |
| `/rest/collections/list_user_collections` | POST | List spaces/collections |
| `/rest/user/get_current_user` | GET | Get user status |

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
**Auth:** Cookie-based

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/app-chat/conversations` | GET | List conversations |
| `/rest/app-chat/conversations/{uuid}/response-node` | GET | Get response nodes |
| `/rest/app-chat/conversations/{uuid}/responses/{id}` | GET | Get response content |
| `/rest/app-chat/conversations_v2/{uuid}` | GET | Get conversation metadata (model) |
| `/rest/workspaces` | GET | List workspaces |

---

## DeepSeek (deepseek.har — 3.7 MB, 60 requests)
**Base URL:** `https://chat.deepseek.com`
**Auth:** Bearer token + custom headers

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v0/chat/history` | GET | List chat history |
| `/api/v0/chat/{uuid}` | GET | Get chat detail |
| `/api/v0/users/login` | POST | Login / token refresh |
| `/api/v0/chat/session/info` | GET | Get session info (model, agent_mode) |
