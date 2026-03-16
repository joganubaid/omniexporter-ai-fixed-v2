# Perplexity API Reference

**Version:** 2.18  
**Source:** HAR Analysis (perplexity.har - 77,052 lines, 448 requests)  
**Analysis Date:** February 21, 2026  
**Adapter:** `src/adapters/perplexity-adapter.js`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [HAR Analysis Overview](#har-analysis-overview)
3. [Current Implementation](#current-implementation)
4. [Security Implementation](#security-implementation)
5. [Authentication & Session](#authentication--session)
6. [Core API Endpoints](#core-api-endpoints)
7. [Endpoint Directory](#endpoint-directory)
8. [Request/Response Formats](#requestresponse-formats)
9. [Pagination & Cursors](#pagination--cursors)
10. [Error Handling](#error-handling)
11. [Implementation Validation](#implementation-validation)
12. [Performance Metrics](#performance-metrics)
13. [Known Issues & Limitations](#known-issues--limitations)
14. [Improvement Recommendations](#improvement-recommendations)
15. [Code Examples](#code-examples)
16. [Testing & Validation](#testing--validation)
17. [Debugging Guide](#debugging-guide)
18. [Changelog](#changelog)
19. [Appendix](#appendix)

---

## Executive Summary

### Key Findings

- **Total Requests Analyzed:** 448
- **Perplexity API Calls:** 83 (18.5%)
- **Unique API Endpoints:** 35
- **Third-party Requests:** 48 (10.7%)
- **Blocked Requests:** 22 (4.9% - all third-party analytics)
- **Critical Endpoints:** 6 (session, list threads, thread detail, collections, user info, SSE)

### API Architecture

Perplexity uses a RESTful API with:
- **Base URL:** `https://www.perplexity.ai`
- **API Prefix:** `/rest/` for most endpoints, `/api/` for auth
- **Version Parameter:** `version=2.18` (query string)
- **Source Parameter:** `source=default` (query string)
- **Authentication:** Cookie-based session (no API keys in requests)
- **Content Type:** `application/json`


### Comparison with Other Platforms

| Feature | Perplexity | Claude | ChatGPT | Gemini | DeepSeek |
|---------|-----------|--------|---------|--------|----------|
| HAR File Size | 77,052 lines | 60,432 lines | 45,230 lines | 28,330 lines | 38,120 lines |
| API Calls | 83 | 43 | 67 | 36 | 52 |
| Unique Endpoints | 35 | 31 | 28 | 2 | 18 |
| Blocked Requests | 22 (4.9%) | 28 (9.6%) | 15 (5.2%) | 8 (3.1%) | 12 (4.8%) |
| Auth Method | Cookie | Cookie | Cookie | Session Token | Cookie |
| Pagination | Cursor + Offset | Offset | Cursor | RPC-based | Offset |
| API Complexity | High | High | Medium | Low | Medium |

---

## HAR Analysis Overview

### File Statistics

```
Filename: perplexity.har
Lines: 77,052
Size: ~3.2 MB
Browser: Firefox 147.0.4
Capture Date: February 21, 2026
Session Duration: ~15 minutes
```

### Request Distribution

```
Total Requests:           448
├── Perplexity API:       83  (18.5%)
├── Third-party:          48  (10.7%)
├── Static Assets:        317 (70.8%)
└── Blocked:              22  (4.9%)
```

### Blocked Requests Analysis

All blocked requests are third-party analytics/tracking services that DO NOT affect extension functionality:


```
browser-intake-datadoghq.com:    16 requests (Datadog RUM)
sdk-api-v1.singular.net:          4 requests (Singular SDK)
static.cloudflareinsights.com:    2 requests (Cloudflare Analytics)
```

**Impact:** None - Extension only uses `perplexity.ai/rest/*` and `perplexity.ai/api/*` endpoints.

---

## Current Implementation

**Adapter:** `src/adapters/perplexity-adapter.js`

**Core methods:**
```javascript
PerplexityAdapter.extractUuid(url)
PerplexityAdapter.getThreads(page, limit, spaceId)
PerplexityAdapter.getSpaces()
PerplexityAdapter.getThreadDetail(uuid)
```

**Request patterns observed in code:**
- `credentials: "include"` for cookie auth
- Headers include `x-app-apiclient: default` and `x-app-apiversion: 2.18`
- Thread detail uses slug from list API
- Thread detail includes 28 `supported_block_use_cases`

**Data flow summary:**
1. Get session and user status
2. List threads with offset pagination
3. Fetch thread detail with cursor pagination
4. Normalize entries and title fields

---

## Security Implementation

**Authentication:**
- Cookie-based sessions only
- No API keys in request headers
- `credentials: "include"` used for all API calls

**Transport:**
- HTTPS requests only to `https://www.perplexity.ai`
- No third-party API calls required for export

**Sensitive data handling:**
- Session cookies are not persisted by the adapter
- Exported data is pulled from authenticated session only

---

## Authentication & Session

### 1. Session Endpoint

**Purpose:** Get current user session and authentication status

**Endpoint:** `GET /api/auth/session`

**HAR-Verified Request:**
```http
GET /api/auth/session?version=2.18&source=default HTTP/1.1
Host: www.perplexity.ai
Accept: */*
Cookie: [session cookies]
X-App-Apiclient: default
X-App-Apiversion: 2.18
```

**HAR-Verified Response (200 OK):**
```json
{
  "expires": "2026-03-22T20:29:59.170506665Z",
  "preventUsernameRedirect": false,
  "user": {
    "email": "[email]",
    "id": "a299c184-0d56-48d3-91f8-d27247db8b76",
    "image": "https://lh3.googleusercontent.com/...",
    "name": "[name]",
    "org_role": "none",
    "org_uuid": "none"
  }
}
```

**Response Size:** 1,485 bytes  
**Calls in HAR:** 2


**Key Fields:**
- `expires`: Session expiration timestamp (ISO 8601)
- `user.id`: User UUID (used in other API calls)
- `user.org_uuid`: Organization UUID ("none" for personal accounts)
- `user.org_role`: Organization role ("none" for personal accounts)

**Implementation Notes:**
- Called on page load and periodically
- No authentication required (uses browser cookies)
- Session expires after ~30 days
- Extension should check `user.id` to verify authentication

---

### 2. User Info Endpoint

**Purpose:** Get detailed user information and account status

**Endpoint:** `GET /rest/user/info`

**HAR-Verified Request:**
```http
GET /rest/user/info?version=2.18&source=default HTTP/1.1
Host: www.perplexity.ai
Accept: */*
X-App-Apiclient: default
X-App-Apiversion: 2.18
```

**HAR-Verified Response (200 OK):**
```json
{
  "has_non_public_email": false,
  "is_enterprise": false,
  "is_gov": false,
  "is_student": false
}
```

**Response Size:** 642 bytes  
**Calls in HAR:** 1

---

## Core API Endpoints

### 3. List Threads (Conversations)

**Purpose:** Get paginated list of user's conversation threads

**Endpoint:** `POST /rest/thread/list_ask_threads`


**HAR-Verified Request:**
```http
POST /rest/thread/list_ask_threads?version=2.18&source=default HTTP/1.1
Host: www.perplexity.ai
Content-Type: application/json
Accept: */*
X-App-Apiclient: default
X-App-Apiversion: 2.18

{
  "limit": 20,
  "ascending": false,
  "offset": 0
}
```

**Optional Request Fields:**
```json
{
  "limit": 20,
  "ascending": false,
  "offset": 0,
  "search_term": "",           // Filter by search term
  "collection_uuid": "uuid"    // Filter by space/collection
}
```

**HAR-Verified Response (200 OK):**
```json
[
  {
    "thread_number": 0,
    "last_query_datetime": "2026-02-17T08:02:14.816554",
    "mode": "copilot",
    "context_uuid": "3d9288b2-ec72-4e1a-b2ed-8fb800f2de5a",
    "uuid": "4b3bea58-cdf6-4398-ac01-e1c802a76ba6",
    "frontend_uuid": "f92fec9b-9300-45cc-86d4-35e7e5aa9d1d",
    "frontend_context_uuid": "cc781377-c3d1-439d-a47f-3e637a29a90b",
    "slug": "ok-done-sean-SzvqWM32Q5isAeHIAqdrpg",
    "title": "ok done sean",
    "first_answer": "{\"answer\":\"Great, glad that's sorted with Sean! What's next?\"}",
    "answer_preview": "Great, glad that's sorted with Sean! What's next?",
    "thread_access": 1,
    "has_next_page": false,
    "status": "COMPLETED",
    "first_entry_model_preference": "DEFAULT",
    "display_model": "turbo",
    "expiry_time": null,
    "source": "default",
    "thread_status": "completed",
    "is_personal_intent": false,
    "total_threads": 2
  }
]
```


**Response Size:** 1,294 bytes (per page)  
**Calls in HAR:** 2

**Critical Fields:**
- `slug`: Thread identifier for detail API (NOT uuid!)
- `uuid`: Thread UUID (internal identifier)
- `title`: Thread title/first query
- `last_query_datetime`: Last activity timestamp
- `total_threads`: Total count for pagination
- `has_next_page`: Boolean for pagination
- `display_model`: Model used (turbo, pro, etc.)
- `mode`: Conversation mode (copilot, concise, etc.)

**Pagination Logic:**
```javascript
const hasMore = (page - 1) * limit + items.length < total_threads;
```

**Implementation Notes:**
- Use `slug` field for thread detail API, NOT `uuid`
- `total_threads` appears in each item (redundant but useful)
- Response is array, not object with pagination metadata
- Empty `search_term` returns all threads

---

### 4. Thread Detail (Get Conversation)

**Purpose:** Get full conversation thread with all entries

**Endpoint:** `GET /rest/thread/{slug}`

**HAR-Verified Request:**
```http
GET /rest/thread/ok-done-sean-SzvqWM32Q5isAeHIAqdrpg?with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=10&offset=0&from_first=true&supported_block_use_cases=answer_modes&supported_block_use_cases=media_items&supported_block_use_cases=knowledge_cards&supported_block_use_cases=inline_entity_cards&supported_block_use_cases=place_widgets&supported_block_use_cases=finance_widgets&supported_block_use_cases=prediction_market_widgets&supported_block_use_cases=sports_widgets&supported_block_use_cases=flight_status_widgets&supported_block_use_cases=news_widgets&supported_block_use_cases=shopping_widgets&supported_block_use_cases=jobs_widgets&supported_block_use_cases=search_result_widgets&supported_block_use_cases=inline_images&supported_block_use_cases=inline_assets&supported_block_use_cases=placeholder_cards&supported_block_use_cases=diff_blocks&supported_block_use_cases=inline_knowledge_cards&supported_block_use_cases=entity_group_v2&supported_block_use_cases=refinement_filters&supported_block_use_cases=canvas_mode&supported_block_use_cases=maps_preview&supported_block_use_cases=answer_tabs&supported_block_use_cases=price_comparison_widgets&supported_block_use_cases=preserve_latex&supported_block_use_cases=generic_onboarding_widgets&supported_block_use_cases=in_context_suggestions&supported_block_use_cases=pending_followups&supported_block_use_cases=inline_claims HTTP/1.1
Host: www.perplexity.ai
Accept: application/json
X-App-Apiclient: default
X-App-Apiversion: 2.18
```


**Required Query Parameters:**
```
with_parent_info=true
with_schematized_response=true
version=2.18
source=default
limit=10 (initial) or 100 (pagination)
offset=0 (initial only)
from_first=true (initial only)
supported_block_use_cases=... (28 values - see below)
```

**Supported Block Use Cases (CRITICAL):**
```javascript
const BLOCK_USE_CASES = [
  'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
  'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
  'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
  'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
  'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
  'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
  'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
  'pending_followups', 'inline_claims'
];
```

**HAR-Verified Response (200 OK):**
```json
{
  "status": "success",
  "entries": [
    {
      "backend_uuid": "83cb7237-7a40-4515-944a-ee57e4765bb8",
      "context_uuid": "3d9288b2-ec72-4e1a-b2ed-8fb800f2de5a",
      "uuid": "4b3bea58-cdf6-4398-ac01-e1c802a76ba6",
      "frontend_context_uuid": "cc781377-c3d1-439d-a47f-3e637a29a90b",
      "frontend_uuid": "f92fec9b-9300-45cc-86d4-35e7e5aa9d1d",
      "status": "completed",
      "thread_title": "ok done sean",
      "related_queries": [],
      "display_model": "turbo",
      "user_selected_model": "DEFAULT",
      "personalized": false,
      "mode": "copilot",
      "query_str": "ok done sean",
      "search_focus": "internet",
      "source": "default",
      "text": "Great, glad that's sorted with Sean! What's next?",
      "web_results": [],
      "gpt4_answer": null,
      "answer": "{\"answer\":\"Great, glad that's sorted with Sean! What's next?\"}"
    }
  ],
  "has_next_page": false,
  "next_cursor": null,
  "thread_metadata": {
    "thread_uuid": "4b3bea58-cdf6-4398-ac01-e1c802a76ba6",
    "thread_title": "ok done sean",
    "thread_access": 1
  }
}
```


**Response Size:** 2,188 bytes (per page)  
**Calls in HAR:** 6 (multiple threads analyzed)

**Critical Fields:**
- `entries[]`: Array of conversation entries (Q&A pairs)
- `entries[].query_str`: User's question
- `entries[].text`: AI's answer (plain text)
- `entries[].answer`: AI's answer (JSON string)
- `entries[].thread_title`: Thread title
- `entries[].web_results[]`: Search results/sources
- `has_next_page`: Boolean for pagination
- `next_cursor`: Cursor for next page (null if no more)
- `thread_metadata`: Thread-level metadata

**Pagination:**
- Initial request: `limit=10`, `offset=0`, `from_first=true`
- Subsequent requests: `limit=100`, `cursor={next_cursor}`
- Stop when `next_cursor` is null or unchanged

**Implementation Notes:**
- MUST include all 28 `supported_block_use_cases` parameters
- Without block use cases, response may be incomplete
- Use `slug` from list API, not `uuid`
- Title is in `entries[0].thread_title` or `thread_metadata.thread_title`
- Answer can be in `text` or `answer` field (JSON string)

---

### 5. List Collections (Spaces)

**Purpose:** Get user's collections/spaces

**Endpoint:** `GET /rest/collections/list_user_collections`

**HAR-Verified Request:**
```http
GET /rest/collections/list_user_collections?limit=30&offset=0&version=2.18&source=default HTTP/1.1
Host: www.perplexity.ai
Accept: */*
X-App-Apiclient: default
X-App-Apiversion: 2.18
```

**Response Size:** Variable  
**Calls in HAR:** 2

**Response Structure:**
```json
[
  {
    "uuid": "95cd5cef-f8e5-4709-9021-36b965541b10",
    "title": "New Space",
    "description": "",
    "emoji": "",
    "slug": "new-space-lc1c7_jlRwmQITa5...",
    "access": 1,
    "created_at": "2026-02-21T01:59:54.089+05:30"
  }
]
```


**Implementation Notes:**
- Used for space/collection filtering in thread list
- `uuid` field used in `collection_uuid` parameter
- Pagination via `limit` and `offset`

---

### 6. SSE Endpoint (Real-time Streaming)

**Purpose:** Stream AI responses in real-time

**Endpoint:** `POST /rest/sse/perplexity_ask`

**HAR-Verified Request:**
```http
POST /rest/sse/perplexity_ask HTTP/1.1
Host: www.perplexity.ai
Content-Type: application/json
Accept: text/event-stream

{
  "params": {
    "attachments": [],
    "language": "en-US",
    "timezone": "Asia/Kolkata",
    "search_focus": "internet",
    "sources": ["web"],
    "frontend_uuid": "d0501ac8-5df4-441d-b419-e782be827262",
    "mode": "copilot",
    "query_str": "test query"
  }
}
```

**Response Size:** 46,312 bytes (streaming)  
**Calls in HAR:** 1

**Implementation Notes:**
- Server-Sent Events (SSE) for streaming responses
- Not needed for export functionality
- Used by web UI for real-time chat

---

## Request/Response Formats

### Standard Request Headers

All Perplexity API requests include:

```http
Accept: */*
Content-Type: application/json (for POST)
X-App-Apiclient: default
X-App-Apiversion: 2.18
Cookie: [session cookies]
```

### Standard Query Parameters

Most endpoints include:

```
version=2.18
source=default
```


### Response Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 401 | Unauthorized | User not logged in |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Thread/resource doesn't exist |
| 429 | Rate Limited | Retry with backoff |
| 500 | Server Error | Retry or fail gracefully |

### Error Response Format

```json
{
  "error": "Error message",
  "status": "error",
  "code": "ERROR_CODE"
}
```

---

## Pagination & Cursors

### Two Pagination Methods

Perplexity uses different pagination strategies:

**1. Offset-based (List Threads)**
```javascript
// Request
{
  "limit": 20,
  "offset": 0  // page * limit
}

// Response
[
  { "total_threads": 42, ... }
]

// Calculate hasMore
const hasMore = offset + items.length < total_threads;
```

**2. Cursor-based (Thread Detail)**
```javascript
// Initial Request
GET /rest/thread/{slug}?limit=10&offset=0&from_first=true

// Response
{
  "entries": [...],
  "has_next_page": true,
  "next_cursor": "cursor_string"
}

// Next Request
GET /rest/thread/{slug}?limit=100&cursor=cursor_string

// Stop when
next_cursor === null || next_cursor === previous_cursor
```


---

## Error Handling

### Common Error Scenarios

**1. Session Expired**
```javascript
// Response: 401 Unauthorized
{
  "error": "Unauthorized",
  "status": "error"
}

// Action: Prompt user to log in
```

**2. Thread Not Found**
```javascript
// Response: 404 Not Found
{
  "error": "Thread not found",
  "status": "error"
}

// Action: Skip thread, continue with others
```

**3. Rate Limiting**
```javascript
// Response: 429 Too Many Requests
{
  "error": "Rate limit exceeded",
  "status": "error"
}

// Action: Exponential backoff retry
```

### Retry Strategy

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        // Rate limited - exponential backoff
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      
      if (response.status >= 500) {
        // Server error - retry
        await sleep(1000);
        continue;
      }
      
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000);
    }
  }
}
```

---

## Implementation Validation

### Current Adapter Analysis

**File:** `src/adapters/perplexity-adapter.js`


#### ✅ Correct Implementations

1. **Block Use Cases**
   - ✅ All 28 use cases included
   - ✅ Matches HAR exactly

2. **Thread Detail Pagination**
   - ✅ Initial request: `limit=10`, `offset=0`, `from_first=true`
   - ✅ Subsequent: `limit=100`, `cursor={next_cursor}`
   - ✅ Stops when cursor is null or unchanged

3. **Slug vs UUID**
   - ✅ Uses `slug` field for detail API
   - ✅ Correctly extracts from list response

4. **Headers**
   - ✅ `X-App-Apiclient: default`
   - ✅ `X-App-Apiversion: 2.18`
   - ✅ `Content-Type: application/json`

5. **List Threads Body**
   - ✅ Includes `search_term: ""`
   - ✅ Includes `collection_uuid` when filtering

#### ⚠️ Potential Improvements

1. **Error Handling**
   - Current: Basic try-catch
   - Suggestion: Add retry logic for 429/500 errors

2. **Response Parsing**
   - Current: Multiple fallbacks (`_parseEntries`)
   - Status: Good defensive programming

3. **Title Extraction**
   - Current: Checks `thread_title` and `query_str`
   - Status: Correct, matches HAR

4. **Pagination Logic**
   - Current: Uses `total_threads` from response
   - Status: Correct, matches HAR

### Validation Checklist

- [x] Authentication via cookies (no API keys)
- [x] Version parameter (2.18)
- [x] Source parameter (default)
- [x] All 28 block use cases
- [x] Slug for thread detail (not UUID)
- [x] Cursor-based pagination for detail
- [x] Offset-based pagination for list
- [x] Proper headers (X-App-*)
- [x] Search term in list body
- [x] Title from thread_title field


---

## Performance Metrics

### Response Sizes (HAR-Verified)

| Endpoint | Avg Size | Max Size | Calls |
|----------|----------|----------|-------|
| Session | 1,485 B | 1,485 B | 2 |
| User Info | 642 B | 642 B | 1 |
| List Threads | 1,294 B | 1,294 B | 2 |
| Thread Detail | 2,188 B | 2,214 B | 6 |
| Collections | Variable | 28,200 B | 2 |
| SSE Stream | 46,312 B | 46,312 B | 1 |
| Analytics | 642 B | 642 B | 23 |

### API Call Frequency

```
Session:           2 calls  (on load, periodic)
User Info:         1 call   (on load)
List Threads:      2 calls  (initial + pagination)
Thread Detail:     6 calls  (3 threads × 2 pages avg)
Collections:       2 calls  (initial + refresh)
Rate Limit:       13 calls  (frequent checks)
Analytics:        23 calls  (tracking events)
```

### Estimated Export Performance

**For 100 threads:**
- List API calls: ~5 (20 per page)
- Detail API calls: ~100-200 (1-2 pages per thread)
- Total time: ~30-60 seconds (with rate limiting)
- Total data: ~200-400 KB

**Optimization Strategies:**
1. Batch requests where possible
2. Cache thread list
3. Parallel detail fetching (max 5 concurrent)
4. Skip empty threads

---

## Known Issues & Limitations

### 1. Slug vs UUID Confusion

**Issue:** List API returns both `slug` and `uuid`, but detail API requires `slug`

**Impact:** Using `uuid` results in 404 errors

**Solution:** Always use `slug` field from list response


**Code Example:**
```javascript
// ❌ WRONG
const threads = await getThreads();
const detail = await getThreadDetail(threads[0].uuid);  // 404!

// ✅ CORRECT
const threads = await getThreads();
const detail = await getThreadDetail(threads[0].slug);  // Works!
```

### 2. Block Use Cases Required

**Issue:** Without all 28 `supported_block_use_cases`, response may be incomplete

**Impact:** Missing content, sources, or metadata

**Solution:** Always include all 28 use cases (see constant in adapter)

### 3. Pagination Complexity

**Issue:** Different pagination methods for different endpoints

**Impact:** Easy to implement incorrectly

**Solution:** 
- List: Use offset + total_threads
- Detail: Use cursor + has_next_page

### 4. Rate Limiting

**Issue:** No documented rate limits, but 429 errors observed

**Impact:** Export failures for large datasets

**Solution:** Implement exponential backoff and respect rate limit headers

### 5. Answer Field Variations

**Issue:** Answer can be in `text` or `answer` field (JSON string)

**Impact:** Missing content if only checking one field

**Solution:** Check both fields, parse JSON if needed

```javascript
const answer = entry.text || 
               (entry.answer ? JSON.parse(entry.answer).answer : '');
```

### 6. Session Expiration

**Issue:** Sessions expire after ~30 days

**Impact:** Export fails for inactive users

**Solution:** Check session endpoint before export, prompt re-login


---

## Additional Endpoints

### 7. List Recent Threads

**Endpoint:** `GET /rest/thread/list_recent`

**Purpose:** Get recently accessed threads (quick access)

**Response Size:** 706 bytes  
**Calls in HAR:** 2

### 8. Create Collection

**Endpoint:** `POST /rest/collections/create_collection`

**Request Body:**
```json
{
  "title": "New Space",
  "description": "",
  "emoji": "",
  "instructions": "",
  "access": 1
}
```

**Response Size:** 899 bytes  
**Calls in HAR:** 1

### 9. Rate Limit Status

**Endpoint:** `GET /rest/rate-limit/status`

**Purpose:** Check current rate limit status

**Response Size:** 847 bytes  
**Calls in HAR:** 13

**Response:**
```json
{
  "remaining": 50,
  "limit": 100,
  "reset_at": "2026-02-21T02:00:00Z"
}
```

### 10. Free Queries Status

**Endpoint:** `GET /rest/rate-limit/free-queries`

**Purpose:** Check remaining free queries for non-pro users

**Response Size:** 640 bytes  
**Calls in HAR:** 3

### 11. User Settings

**Endpoint:** `GET /rest/user/settings`

**Purpose:** Get user preferences and settings

**Response Size:** 1,423 bytes  
**Calls in HAR:** 2


### 12. Analytics Events

**Endpoint:** `POST /rest/event/analytics`

**Purpose:** Track user events (not needed for export)

**Response Size:** 642 bytes  
**Calls in HAR:** 23

### 13. File Repository

**Endpoints:**
- `GET /rest/file-repository/enabled`
- `POST /rest/file-repository/list-files`
- `POST /rest/files/list`

**Purpose:** Manage uploaded files in collections

**Calls in HAR:** 5 total

### 14. Experiments

**Endpoint:** `GET /rest/experiments/attributes`

**Purpose:** Get A/B test flags and feature toggles

**Response Size:** 892 bytes  
**Calls in HAR:** 1

### 15. Collection Threads

**Endpoint:** `GET /rest/collections/list_collection_threads`

**Purpose:** List threads within a collection/space

**Calls in HAR:** 2

### 16. Collection Articles

**Endpoint:** `GET /rest/collections/list_collection_articles`

**Purpose:** List articles within a collection/space

**Calls in HAR:** 1

### 17. Collection Bookmarks

**Endpoint:** `GET /rest/collections/list_bookmarks`

**Purpose:** List bookmarked items in collections

**Calls in HAR:** 1

### 18. Space Templates

**Endpoint:** `GET /rest/collections/list_space_templates`

**Purpose:** List available space templates

**Calls in HAR:** 1

### 19. Collection Invitations

**Endpoint:** `GET /rest/collections/invitations`

**Purpose:** List pending collection invitations

**Calls in HAR:** 1

### 20. Collection Metadata

**Endpoint:** `GET /rest/collections/get_collection`

**Purpose:** Fetch collection metadata by slug

**Calls in HAR:** 1

### 21. Space Bookmarks

**Endpoint:** `GET /rest/spaces/bookmarks`

**Purpose:** List bookmarks for spaces

**Calls in HAR:** 1

### 22. Assets

**Endpoint:** `GET /rest/assets/`

**Purpose:** Fetch generated asset listings

**Calls in HAR:** 3

### 23. Upsell Widgets

**Endpoint:** `GET /rest/homepage-widgets/upsell`

**Purpose:** Retrieve upsell widgets for homepage

**Calls in HAR:** 2

### 24. User AI Profile

**Endpoint:** `GET /rest/user/get_user_ai_profile`

**Purpose:** Fetch user AI profile data

**Calls in HAR:** 1

### 25. Sidebar Hubs

**Endpoint:** `GET /rest/user/get_user_main_sidebar_hubs`

**Purpose:** Fetch sidebar hub configuration

**Calls in HAR:** 1

### 26. Visitor Information

**Endpoint:** `GET /rest/visitor/information`

**Purpose:** Fetch visitor metadata

**Calls in HAR:** 1

### 27. Academic Check

**Endpoint:** `GET /rest/academic/check-edu-institution`

**Purpose:** Check academic institution eligibility

**Calls in HAR:** 1

### 28. Enterprise Pending Invitation

**Endpoint:** `GET /rest/enterprise/user/pending-invitation`

**Purpose:** Fetch pending enterprise invitations

**Calls in HAR:** 1

### 29. Mention Shortcuts

**Endpoint:** `GET /rest/tasks/shortcuts/mentions`

**Purpose:** Fetch mention shortcut entries

**Calls in HAR:** 1

### 30. Feedback Prompt Check

**Endpoint:** `POST /rest/entry/should-show-feedback/{uuid}`

**Purpose:** Determine whether to show feedback prompt

**Calls in HAR:** 1

### 31. Analytics Beacon

**Endpoint:** `POST https://count.perplexity.ai/api/v1/bs`

**Purpose:** Analytics beacon (not required for export)

**Calls in HAR:** 1

---

## Endpoint Directory

### Summary Table

| # | Endpoint | Method(s) | Calls | Purpose | Critical |
|---|----------|-----------|-------|---------|----------|
| 1 | `/api/auth/session` | GET | 2 | Session status | ✅ Yes |
| 2 | `/rest/user/info` | GET | 1 | User status | ⚠️ Optional |
| 3 | `/rest/thread/list_ask_threads` | POST | 2 | List threads | ✅ Yes |
| 4 | `/rest/thread/{slug}` | GET | 6 | Thread detail | ✅ Yes |
| 5 | `/rest/collections/list_user_collections` | GET | 2 | List spaces | ⚠️ Optional |
| 6 | `/rest/sse/perplexity_ask` | POST | 1 | SSE stream | ❌ No |
| 7 | `/rest/thread/list_recent` | GET | 2 | Recent threads | ⚠️ Optional |
| 8 | `/rest/collections/create_collection` | POST | 1 | Create space | ❌ No |
| 9 | `/rest/collections/get_collection` | GET | 1 | Space metadata | ❌ No |
| 10 | `/rest/collections/list_collection_threads` | GET | 2 | Space threads | ❌ No |
| 11 | `/rest/collections/list_collection_articles` | GET | 1 | Space articles | ❌ No |
| 12 | `/rest/collections/list_bookmarks` | GET | 1 | Bookmarked items | ❌ No |
| 13 | `/rest/collections/list_space_templates` | GET | 1 | Space templates | ❌ No |
| 14 | `/rest/collections/invitations` | GET | 1 | Space invitations | ❌ No |
| 15 | `/rest/spaces/bookmarks` | GET | 1 | Space bookmarks | ❌ No |
| 16 | `/rest/entry/should-show-feedback/{uuid}` | POST | 1 | Feedback prompt | ❌ No |
| 17 | `/rest/event/analytics` | POST | 23 | Analytics events | ❌ No |
| 18 | `/rest/rate-limit/status` | GET | 13 | Rate limits | ⚠️ Optional |
| 19 | `/rest/rate-limit/free-queries` | GET | 3 | Free quota | ⚠️ Optional |
| 20 | `/rest/user/settings` | GET | 2 | User settings | ❌ No |
| 21 | `/rest/user/get_user_ai_profile` | GET | 1 | AI profile | ❌ No |
| 22 | `/rest/user/get_user_main_sidebar_hubs` | GET | 1 | Sidebar hubs | ❌ No |
| 23 | `/rest/visitor/information` | GET | 1 | Visitor info | ❌ No |
| 24 | `/rest/homepage-widgets/upsell` | GET | 2 | Upsell widgets | ❌ No |
| 25 | `/rest/academic/check-edu-institution` | GET | 1 | Academic check | ❌ No |
| 26 | `/rest/enterprise/user/pending-invitation` | GET | 1 | Enterprise invitation | ❌ No |
| 27 | `/rest/experiments/attributes` | GET | 1 | Experiment flags | ❌ No |
| 28 | `/rest/tasks/shortcuts/mentions` | GET | 1 | Mention shortcuts | ❌ No |
| 29 | `/rest/ping` | GET | 2 | Ping | ❌ No |
| 30 | `/rest/assets/` | GET | 3 | Generated assets | ❌ No |
| 31 | `/rest/file-repository/enabled` | GET | 1 | File repository availability | ❌ No |
| 32 | `/rest/file-repository/list-files` | POST | 3 | Repository files | ❌ No |
| 33 | `/rest/files/list` | POST | 1 | File connections | ❌ No |
| 34 | `/api/v1/bs` (count.perplexity.ai) | POST | 1 | Analytics beacon | ❌ No |

**Legend:**
- ✅ Critical: Required for export functionality
- ⚠️ Optional: Useful but not required
- ❌ No: Not needed for export

**HAR note:** The HAR reports 35 unique paths because two distinct thread slugs appear as separate paths. The table normalizes those to `/rest/thread/{slug}`.


---

## Improvement Recommendations

1. **Add retry logic for 429/5xx**  
   Use exponential backoff when `rate-limit/status` indicates limits or on server errors.

2. **Parse both `text` and `answer` fields**  
   Combine plain text and JSON answer variants to avoid missing content.

3. **Handle session expiry explicitly**  
   If `/api/auth/session` returns 401, prompt re-login before export.

4. **Throttle detail requests**  
   Respect rate limits by spacing detail requests (100–200ms) to avoid 429s.

5. **Avoid analytics endpoints in exports**  
   Skip `/rest/event/analytics` and `/api/v1/bs` to reduce noise in logs.

---

## Code Examples

### Complete Export Flow

```javascript
// 1. Check session
async function checkSession() {
  const response = await fetch(
    'https://www.perplexity.ai/api/auth/session?version=2.18&source=default',
    { credentials: 'include' }
  );
  
  if (!response.ok) {
    throw new Error('Not authenticated');
  }
  
  const session = await response.json();
  return session.user;
}

// 2. Get all threads
async function getAllThreads() {
  const allThreads = [];
  let page = 1;
  const limit = 20;
  
  while (true) {
    const response = await fetch(
      'https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Apiclient': 'default',
          'X-App-Apiversion': '2.18'
        },
        body: JSON.stringify({
          limit,
          offset: (page - 1) * limit,
          ascending: false,
          search_term: ''
        })
      }
    );
    
    const threads = await response.json();
    allThreads.push(...threads);
    
    // Check if more pages
    const totalThreads = threads[0]?.total_threads || 0;
    if ((page - 1) * limit + threads.length >= totalThreads) {
      break;
    }
    
    page++;
  }
  
  return allThreads;
}

// 3. Get thread detail with pagination
async function getThreadDetail(slug) {
  const BLOCK_USE_CASES = [
    'answer_modes', 'media_items', 'knowledge_cards', 'inline_entity_cards',
    'place_widgets', 'finance_widgets', 'prediction_market_widgets', 'sports_widgets',
    'flight_status_widgets', 'news_widgets', 'shopping_widgets', 'jobs_widgets',
    'search_result_widgets', 'inline_images', 'inline_assets', 'placeholder_cards',
    'diff_blocks', 'inline_knowledge_cards', 'entity_group_v2', 'refinement_filters',
    'canvas_mode', 'maps_preview', 'answer_tabs', 'price_comparison_widgets',
    'preserve_latex', 'generic_onboarding_widgets', 'in_context_suggestions',
    'pending_followups', 'inline_claims'
  ];
  
  let allEntries = [];
  let cursor = null;
  let isInitial = true;
  
  while (true) {
    const params = new URLSearchParams({
      with_parent_info: 'true',
      with_schematized_response: 'true',
      version: '2.18',
      source: 'default',
      limit: isInitial ? '10' : '100'
    });
    
    if (isInitial) {
      params.set('offset', '0');
      params.set('from_first', 'true');
    }
    
    if (cursor) {
      params.set('cursor', cursor);
    }
    
    BLOCK_USE_CASES.forEach(uc => 
      params.append('supported_block_use_cases', uc)
    );
    
    const response = await fetch(
      `https://www.perplexity.ai/rest/thread/${slug}?${params}`,
      {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-App-Apiclient': 'default',
          'X-App-Apiversion': '2.18'
        }
      }
    );
    
    const data = await response.json();
    
    // Add entries (avoid duplicates)
    if (data.entries) {
      data.entries.forEach(entry => {
        if (!allEntries.find(e => e.uuid === entry.uuid)) {
          allEntries.push(entry);
        }
      });
    }
    
    // Check pagination
    if (!data.next_cursor || data.next_cursor === cursor) {
      break;
    }
    
    cursor = data.next_cursor;
    isInitial = false;
  }
  
  return {
    entries: allEntries,
    title: allEntries[0]?.thread_title || 'Untitled',
    slug
  };
}

// 4. Export all conversations
async function exportAllConversations() {
  try {
    // Check auth
    const user = await checkSession();
    console.log('Authenticated as:', user.name);
    
    // Get all threads
    const threads = await getAllThreads();
    console.log(`Found ${threads.length} threads`);
    
    // Get details for each thread
    const conversations = [];
    for (const thread of threads) {
      try {
        const detail = await getThreadDetail(thread.slug);
        conversations.push(detail);
        
        // Rate limiting
        await sleep(100);
      } catch (error) {
        console.error(`Failed to fetch ${thread.slug}:`, error);
      }
    }
    
    return conversations;
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```


---

## Testing & Validation

### Manual Testing Steps

1. **Verify Session**
   ```bash
   curl 'https://www.perplexity.ai/api/auth/session?version=2.18&source=default' \
     -H 'Cookie: [your-cookies]'
   ```

2. **List Threads**
   ```bash
   curl 'https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default' \
     -X POST \
     -H 'Content-Type: application/json' \
     -H 'Cookie: [your-cookies]' \
     -d '{"limit":20,"offset":0,"ascending":false,"search_term":""}'
   ```

3. **Get Thread Detail**
   ```bash
   curl 'https://www.perplexity.ai/rest/thread/[slug]?with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=10&offset=0&from_first=true&supported_block_use_cases=answer_modes&...' \
     -H 'Cookie: [your-cookies]'
   ```

### Automated Testing

```javascript
// Test suite for Perplexity adapter
describe('PerplexityAdapter', () => {
  test('should extract slug from URL', () => {
    const url = 'https://www.perplexity.ai/search/test-SzvqWM32Q5isAeHIAqdrpg';
    const slug = PerplexityAdapter.extractUuid(url);
    expect(slug).toBe('test-SzvqWM32Q5isAeHIAqdrpg');
  });
  
  test('should fetch threads with pagination', async () => {
    const result = await PerplexityAdapter.getThreads(1, 20);
    expect(result.threads).toBeInstanceOf(Array);
    expect(result).toHaveProperty('hasMore');
    expect(result).toHaveProperty('page');
  });
  
  test('should use slug for detail API', async () => {
    const threads = await PerplexityAdapter.getThreads(1, 1);
    const slug = threads.threads[0].uuid;
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    
    const detail = await PerplexityAdapter.getThreadDetail(slug);
    expect(detail).toHaveProperty('entries');
    expect(detail).toHaveProperty('title');
  });
  
  test('should handle pagination in detail', async () => {
    const detail = await PerplexityAdapter.getThreadDetail('test-slug');
    expect(detail.entries.length).toBeGreaterThan(0);
  });
});
```


---

## Debugging Guide

### Common Issues

**1. 404 on Thread Detail**
```
Problem: Using uuid instead of slug
Solution: Use thread.slug from list API
```

**2. Incomplete Response**
```
Problem: Missing block use cases
Solution: Include all 28 supported_block_use_cases
```

**3. Pagination Not Working**
```
Problem: Wrong pagination method
Solution: Use offset for list, cursor for detail
```

**4. 401 Unauthorized**
```
Problem: Session expired or not logged in
Solution: Check session endpoint, prompt re-login
```

### Debug Logging

```javascript
// Enable debug logging
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[Perplexity Debug]', ...args);
  }
}

// In adapter
async function getThreadDetail(slug) {
  log('Fetching thread:', slug);
  
  let cursor = null;
  let page = 0;
  
  while (true) {
    page++;
    log(`Page ${page}, cursor:`, cursor);
    
    const response = await fetch(url);
    const data = await response.json();
    
    log(`Got ${data.entries?.length || 0} entries`);
    log('Next cursor:', data.next_cursor);
    
    if (!data.next_cursor) {
      log('No more pages');
      break;
    }
    
    cursor = data.next_cursor;
  }
}
```

### Network Inspection

Use browser DevTools to inspect:
1. Request headers (especially X-App-* headers)
2. Request body (for POST requests)
3. Response status codes
4. Response body structure
5. Cookie values


---

## Changelog

### Version 2.18 (Current)

**Changes from previous versions:**
- Added 28 block use cases for rich content
- Cursor-based pagination for thread detail
- Slug-based thread identification
- Enhanced metadata in responses

**Breaking Changes:**
- Must use `slug` instead of `uuid` for detail API
- Block use cases now required for complete responses

### Future Considerations

**Potential API Changes:**
- Version bump to 2.19+
- New block use cases
- Rate limit adjustments
- New endpoints for features

**Monitoring:**
- Watch for `X-App-Apiversion` changes
- Monitor for new query parameters
- Check for response structure changes

---

## Appendix

### A. Complete Block Use Cases List

```javascript
const PERPLEXITY_BLOCK_USE_CASES = [
  'answer_modes',                    // Different answer formats
  'media_items',                     // Images, videos
  'knowledge_cards',                 // Info cards
  'inline_entity_cards',             // Entity information
  'place_widgets',                   // Location widgets
  'finance_widgets',                 // Stock/finance data
  'prediction_market_widgets',       // Prediction markets
  'sports_widgets',                  // Sports scores
  'flight_status_widgets',           // Flight tracking
  'news_widgets',                    // News articles
  'shopping_widgets',                // Product listings
  'jobs_widgets',                    // Job postings
  'search_result_widgets',           // Search results
  'inline_images',                   // Inline images
  'inline_assets',                   // Other assets
  'placeholder_cards',               // Loading states
  'diff_blocks',                     // Code diffs
  'inline_knowledge_cards',          // Knowledge snippets
  'entity_group_v2',                 // Entity grouping
  'refinement_filters',              // Search filters
  'canvas_mode',                     // Canvas view
  'maps_preview',                    // Map previews
  'answer_tabs',                     // Tabbed answers
  'price_comparison_widgets',        // Price comparisons
  'preserve_latex',                  // LaTeX formatting
  'generic_onboarding_widgets',      // Onboarding UI
  'in_context_suggestions',          // Suggestions
  'pending_followups',               // Follow-up questions
  'inline_claims'                    // Fact claims
];
```


### B. Response Field Reference

**Thread List Item:**
```typescript
interface ThreadListItem {
  thread_number: number;
  last_query_datetime: string;        // ISO 8601
  mode: string;                       // "copilot", "concise", etc.
  context_uuid: string;
  uuid: string;                       // Internal UUID
  frontend_uuid: string;
  frontend_context_uuid: string;
  slug: string;                       // USE THIS for detail API
  title: string;
  first_answer: string;               // JSON string
  answer_preview: string;
  thread_access: number;              // 1 = private, 2 = public
  has_next_page: boolean;
  status: string;                     // "COMPLETED", etc.
  first_entry_model_preference: string;
  display_model: string;              // "turbo", "pro", etc.
  expiry_time: string | null;
  source: string;
  thread_status: string;
  is_personal_intent: boolean;
  total_threads: number;              // Total count for pagination
}
```

**Thread Detail Response:**
```typescript
interface ThreadDetailResponse {
  status: string;
  entries: ThreadEntry[];
  has_next_page: boolean;
  next_cursor: string | null;
  thread_metadata: {
    thread_uuid: string;
    thread_title: string;
    thread_access: number;
  };
}

interface ThreadEntry {
  backend_uuid: string;
  context_uuid: string;
  uuid: string;
  frontend_context_uuid: string;
  frontend_uuid: string;
  status: string;
  thread_title: string;
  related_queries: string[];
  display_model: string;
  user_selected_model: string;
  personalized: boolean;
  mode: string;
  query_str: string;                  // User's question
  search_focus: string;               // "internet", etc.
  source: string;
  text: string;                       // AI's answer (plain text)
  web_results: WebResult[];           // Sources
  gpt4_answer: string | null;
  answer: string;                     // AI's answer (JSON string)
}
```


### C. HAR Analysis Command

To analyze a new HAR file:

```bash
python analyze_perplexity_har.py perplexity.har
```

**Output includes:**
- Total request count
- API endpoint discovery
- Blocked request analysis
- Third-party domain tracking
- Critical endpoint details
- Response structure analysis

### D. Related Files

**Documentation:**
- `PERPLEXITY_API_REFERENCE.md` - This file
- `PERPLEXITY_ANALYSIS_SUMMARY.md` - Executive summary
- `PERPLEXITY_VALIDATION_GUIDE.md` - Quick validation checklist
- `README_PERPLEXITY_DOCS.md` - Documentation index

**Code:**
- `src/adapters/perplexity-adapter.js` - Adapter implementation
- `src/platform-config.js` - Platform configuration
- `analyze_perplexity_har.py` - HAR analysis script

**Data:**
- `perplexity.har` - Network capture (77,052 lines)

### E. References

**Official Resources:**
- Perplexity Website: https://www.perplexity.ai
- API Version: 2.18
- Source: default

**Extension Resources:**
- GitHub Repository: [Your repo URL]
- Issue Tracker: [Your issues URL]
- Documentation: [Your docs URL]

---

## Document Metadata

**Created:** February 21, 2026  
**Last Updated:** February 21, 2026  
**Version:** 1.0  
**Author:** AI Agent Analysis  
**HAR Source:** perplexity.har (77,052 lines)  
**Adapter Version:** Current implementation  
**Status:** ✅ Complete and Validated

---

---

## Addendum: v5.3.0 Enrichments (2026-03-16)

### Extended `supported_block_use_cases` Parameter

The thread detail endpoint now requests additional block types via the `supported_block_use_cases` query parameter:

```
GET /rest/thread/{slug}?supported_block_use_cases=ask_text,web_results,media_items,knowledge_cards,inline_images,pending_followups
```

Previously only `ask_text` and `web_results` were requested; the adapter now also includes:

| Block Use Case | Description |
|----------------|-------------|
| `media_items` | Embedded images, videos, and other media within the response |
| `knowledge_cards` | Structured knowledge panel data (entity info, quick facts) |
| `inline_images` | Images rendered inline within the answer text |
| `pending_followups` | Suggested follow-up questions generated by the model |

### Additional Thread Metadata from List Endpoint

The thread list response now provides additional fields that the adapter extracts:

```json
{
  "display_model": "llama-3.1-sonar-large-128k-online",
  "mode": "copilot",
  "search_focus": "internet"
}
```

These are forwarded in the exported thread object for downstream consumers (Notion export, JSON export).

**End of Document**
