# Perplexity Validation Guide

**Quick Reference for Extension Validation**

---

## Quick Start

### Files to Review
1. **perplexity.har** - Network capture (77,052 lines, 448 requests)
2. **PERPLEXITY_API_REFERENCE.md** - Complete technical documentation
3. **PERPLEXITY_ANALYSIS_SUMMARY.md** - Executive summary
4. **src/adapters/perplexity-adapter.js** - Main implementation

### Validation Checklist

- [ ] Session endpoint works and returns user data
- [ ] List threads uses POST body with `search_term`
- [ ] Detail endpoint uses `slug` (not `uuid`)
- [ ] All 28 `supported_block_use_cases` included
- [ ] Offset pagination for list, cursor pagination for detail
- [ ] Response parsing checks both `text` and `answer`
- [ ] Rate-limit endpoints are not required for export

---

## Critical Validation Points

### 1. Session Authentication
```
GET /api/auth/session?version=2.18&source=default
```
**Expected:** `user.id` present, status 200

### 2. List Threads (Offset Pagination)
```
POST /rest/thread/list_ask_threads
Body: { "limit": 20, "offset": 0, "ascending": false, "search_term": "" }
```
**Expected:** Array response, each item has `slug`, `total_threads`

### 3. Thread Detail (Slug + Block Use Cases)
```
GET /rest/thread/{slug}?with_parent_info=true&with_schematized_response=true&version=2.18&source=default
```
**Expected:** `entries[]` populated, `next_cursor` used when paging

### 4. Block Use Cases Required
```
supported_block_use_cases=answer_modes
...
supported_block_use_cases=inline_claims
```
**Expected:** All 28 values included

### 5. Pagination Rules
```
List: offset + total_threads
Detail: cursor + has_next_page
```

---

## Common Issues & Fixes

### Issue 1: 404 on Thread Detail
**Cause:** Using `uuid` instead of `slug`  
**Fix:** Use `thread.slug` from list API

### Issue 2: Missing Content
**Cause:** Missing block use cases  
**Fix:** Include all 28 `supported_block_use_cases`

### Issue 3: Empty Answer
**Cause:** Only reading one field  
**Fix:** Check `entry.text` and parse `entry.answer`

### Issue 4: 401 Unauthorized
**Cause:** Session expired  
**Fix:** Re-login and re-check `/api/auth/session`

### Issue 5: 429 Rate Limited
**Cause:** Too many detail requests  
**Fix:** Add backoff and throttle requests

---

## Agent Tasks

### Task 1: Validate Block Use Cases
```javascript
const useCases = PERPLEXITY_BLOCK_USE_CASES;
console.assert(useCases.length === 28);
```

### Task 2: Validate Slug Usage
```javascript
const list = await PerplexityAdapter.getThreads(1, 1);
const slug = list.threads[0].uuid;
console.assert(slug.includes('-'));
```

### Task 3: Validate Pagination
```javascript
const page1 = await PerplexityAdapter.getThreads(1, 20);
const page2 = await PerplexityAdapter.getThreads(2, 20);
console.assert(page1.page === 1 && page2.page === 2);
```

---

## Testing Commands

### Manual Tests
```javascript
// 1. Session check
await fetch('https://www.perplexity.ai/api/auth/session?version=2.18&source=default', {
  credentials: 'include'
});

// 2. List threads
await fetch('https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit: 20, offset: 0, ascending: false, search_term: '' })
});
```

### Extension Tests
1. Open extension options page
2. Go to Dev Tools tab
3. Click **Run All Tests** or **Perplexity** platform test

---

## Performance Metrics (HAR-Verified)

- Session: 2 calls
- List Threads: 2 calls
- Thread Detail: 6 calls
- Collections: 2 calls
- Rate Limit: 13 calls
- Analytics: 23 calls

---

## Quick Reference

### File Locations
```
perplexity.har                         # Network capture
PERPLEXITY_API_REFERENCE.md            # Full documentation
PERPLEXITY_ANALYSIS_SUMMARY.md         # Executive summary
PERPLEXITY_VALIDATION_GUIDE.md         # This guide
src/adapters/perplexity-adapter.js     # Adapter implementation
```
