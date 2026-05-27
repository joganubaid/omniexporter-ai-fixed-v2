# Grok API Reference

**Version:** 1.0  
**Source:** HAR Analysis (grok.har - 47,536 lines, 231 requests)  
**Analysis Date:** February 21, 2026  
**Adapter:** `src/adapters/grok-adapter.js`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [HAR Analysis Overview](#har-analysis-overview)
3. [Authentication & Session](#authentication--session)
4. [Core API Endpoints](#core-api-endpoints)
5. [Additional Endpoints (Non‑Telemetry)](#additional-endpoints-non-telemetry)
6. [Endpoint Directory](#endpoint-directory)
7. [Request/Response Formats](#requestresponse-formats)
8. [Pagination](#pagination)
9. [Error Handling](#error-handling)
10. [Testing & Validation](#testing--validation)
11. [Known Issues & Limitations](#known-issues--limitations)
12. [Changelog](#changelog)
13. [Appendix](#appendix)

---

## Executive Summary

### Key Findings
- **Total Requests Analyzed:** 231
- **Grok API Calls:** 29 (12.6%)
- **Unique Non‑Telemetry Endpoints:** 22
- **Critical Endpoints:** 3 (list, response-node, load-responses)
- **Authentication:** Cookie-based (`sso`, `sso-rw`)
- **API Base URL:** `https://grok.com/rest/app-chat`

### API Architecture
Grok uses a RESTful API under `/rest/app-chat` for conversations and `/rest/*` for related resources. Authentication relies on session cookies.

---

## HAR Analysis Overview

### File Statistics
```
Filename: grok.har
Lines: 47,536
Size: 12.46 MB
Browser: Firefox 147.0.4
Capture Date: February 21, 2026
```

### Request Distribution
```
Total Requests: 231
Grok Domain Requests: 202
Third-party Requests: 29
Blocked Requests: 8
```

---

## Authentication & Session

### Cookie-Based Authentication
Grok uses cookie-based sessions. Requests require `credentials: "include"` to send cookies.

**Primary cookies observed:**
- `sso`
- `sso-rw`

---

## Core API Endpoints

### 1. List Conversations
**Endpoint:** `GET /rest/app-chat/conversations`  
**Purpose:** List conversations  
**Calls in HAR:** 8

**Query Parameters:**
- `pageSize` (required) — Grok caps responses at 60 conversations regardless of the value asked for
- `filterIsStarred` (optional) — when `true`, returns only starred conversations
- `workspaceId` (optional)

**⚠ No pagination available.** HAR-verified 2026-05: response is
`{conversations:[...], textSearchMatches:[]}` with NO `nextPageToken`,
`cursor`, or `hasMore` field. The earlier `pageToken` reference in this doc
was speculative — the field has never been observed in any captured response.
Accounts with more than 60 conversations cannot reach the older ones through
this endpoint.

### 2. Response Nodes
**Endpoint:** `GET /rest/app-chat/conversations/{uuid}/response-node`  
**Purpose:** Fetch response node IDs  
**Calls in HAR:** 4

**Query Parameters:**
- `includeThreads=true`

### 3. Load Responses
**Endpoint:** `POST /rest/app-chat/conversations/{uuid}/load-responses`  
**Purpose:** Fetch full message responses  
**Calls in HAR:** 2

---

## Additional Endpoints (Non‑Telemetry)

### Conversation and Share
- `GET /rest/app-chat/conversations_v2/{uuid}`  
- `POST /rest/app-chat/share_links`  
- `POST /rest/app-chat/conversations/new`

### Workspaces
- `GET /rest/workspaces`
- `GET /rest/workspaces/shared`
- `GET /rest/workspaces/{uuid}`
- `GET /rest/workspaces/{uuid}/conversations`
- `GET /rest/workspaces/{uuid}/permissions`

### Settings, Prompts, and Models
- `GET /rest/user-settings`
- `GET /rest/system-prompt/list`
- `GET /rest/dev/models`

### Tasks and Notifications
- `GET /rest/tasks`
- `GET /rest/tasks/inactive`
- `GET /rest/notifications/list`

### Products, Suggestions, and Highlights
- `GET /rest/products`
- `GET /rest/suggestions/profile`
- `GET /rest/highlights/stories`

### Assets and Connectors
- `GET /rest/assets`
- `GET /api/oauth-connectors`

---

## Endpoint Directory

**All non‑telemetry endpoints observed in HAR (normalized):**

| Endpoint | Method | Calls | Purpose |
|----------|--------|-------|---------|
| `/rest/app-chat/conversations` | GET | 8 | List conversations |
| `/rest/app-chat/conversations/{uuid}/response-node` | GET | 4 | Response node IDs |
| `/rest/app-chat/share_links` | POST | 3 | Share links |
| `/rest/app-chat/conversations_v2/{uuid}` | GET | 3 | Conversation v2 detail |
| `/rest/app-chat/conversations/{uuid}/load-responses` | POST | 2 | Load responses |
| `/rest/assets` | GET | 2 | Assets |
| `/rest/workspaces` | GET | 2 | Workspaces list |
| `/rest/dev/models` | GET | 1 | Model list |
| `/rest/rate-limits` | GET | 1 | Rate limits |
| `/rest/app-chat/conversations/new` | POST | 1 | Create conversation |
| `/rest/workspaces/{uuid}/conversations` | GET | 1 | Workspace conversations |
| `/rest/workspaces/{uuid}/permissions` | GET | 1 | Workspace permissions |
| `/rest/workspaces/shared` | GET | 1 | Shared workspaces |
| `/rest/workspaces/{uuid}` | GET | 1 | Workspace detail |
| `/api/oauth-connectors` | GET | 1 | OAuth connectors |
| `/rest/highlights/stories` | GET | 1 | Highlight stories |
| `/rest/products` | GET | 1 | Products |
| `/rest/suggestions/profile` | GET | 1 | Profile suggestions |
| `/rest/user-settings` | GET | 1 | User settings |
| `/rest/tasks/inactive` | GET | 1 | Inactive tasks |
| `/rest/notifications/list` | GET | 1 | Notifications |
| `/rest/system-prompt/list` | GET | 1 | System prompts |
| `/rest/tasks` | GET | 1 | Tasks |

---

## Request/Response Formats

### List Conversations
```
GET /rest/app-chat/conversations?pageSize=60
GET /rest/app-chat/conversations?pageSize=60&filterIsStarred=true
```

**Response Fields:**
- `conversations[]` — array of conversation summaries (max 60)
  - `conversationId`
  - `title`
  - `createTime`
  - `modifyTime`
  - `starred`
  - `systemPromptName`
  - `temporary`
  - `mediaTypes[]`
  - `workspaces[]`
- `textSearchMatches[]` — empty unless a search query was sent

**No pagination markers.** No `nextPageToken`, `cursor`, or `hasMore` in
the response.

### Response Nodes
```
GET /rest/app-chat/conversations/{uuid}/response-node?includeThreads=true
```

**Typical Fields:**
- `responseNodes[]`
- `responseId`

### Load Responses
```
POST /rest/app-chat/conversations/{uuid}/load-responses
```

**Typical Fields:**
- `responses[]`
- `message`
- `createTime`

---

## Pagination

**Grok's `/rest/app-chat/conversations` endpoint is single-page only.**

HAR-verified 2026-05: the response shape is
```
{ "conversations": [...], "textSearchMatches": [] }
```
with NO `nextPageToken`, `cursor`, `hasMore`, or any other continuation
marker. `pageSize=60` is the maximum count Grok will return per request,
and there is no documented mechanism to fetch page 2.

**User impact:** accounts with more than 60 conversations can only access
the most recent 60 via this endpoint. This is a Grok API constraint, not
an extension limitation. If a future Grok release exposes pagination, the
adapter's `getAllThreads` should be updated to use it.

Earlier versions of this doc speculated about `nextPageToken` / `pageToken`
cursor pagination — that was never observed in any captured HAR and has
been removed to avoid misleading future maintainers.

---

## Error Handling

Common statuses observed:
- **200** Success
- **401/403** Authentication required
- **404** Conversation not found
- **429** Rate limited

---

## Testing & Validation

### Manual Checks
1. List conversations with `pageSize=50`; check for `nextPageToken` in response
2. If `nextPageToken` present, repeat with `pageToken=<value>` until null
3. Fetch response-node for a known conversation
4. Load responses for a known response-node set

### Adapter Checks
- `getThreads` uses `/rest/app-chat/conversations`
- `getThreadDetail` performs response-node then load-responses

---

## Known Issues & Limitations

- Workspace-scoped endpoints may return empty results if user has no workspaces.
- Some conversation data requires the response-node and load-responses sequence.

---

## Changelog

### Version 1.0 (2026-02-21)
- Initial non‑telemetry endpoint reference based on grok.har

---

## Appendix

### Related Files
- `grok.har`
- `GROK_ANALYSIS_SUMMARY.md`
- `src/adapters/grok-adapter.js`
- `src/platform-config.js`

---

## Addendum: v5.3.0 Enrichments (2026-03-16)

### Model Extraction from `conversations_v2` Metadata

The `conversations_v2` endpoint returns metadata for each conversation that now includes the model name:

```json
{
  "conversation_id": "abc-123",
  "title": "My chat",
  "model": "grok-2",
  "create_time": "2026-03-16T12:00:00Z"
}
```

The adapter extracts the `model` field from the conversation metadata and includes it in the exported thread object for use in Notion export metadata callouts and JSON export.
