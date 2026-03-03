# Claude Validation Guide

**Quick Reference for AI Agents**

---

## Quick Start

### Files to Review
1. **claude.har** - Network traffic capture (60,432 lines, 293 requests)
2. **CLAUDE_API_REFERENCE.md** - Complete technical documentation
3. **CLAUDE_ANALYSIS_SUMMARY.md** - Executive summary
4. **src/adapters/claude-adapter.js** - Main implementation

### Validation Checklist

- [ ] HAR file matches current implementation
- [ ] Cookie-based authentication working
- [ ] Organization ID extraction correct
- [ ] Message parsing uses content[0].text (NOT msg.text)
- [ ] Offset-based pagination functional
- [ ] Error handling covers edge cases
- [ ] Retry logic with exponential backoff

---

## Critical Validation Points

### 1. API Endpoints (✅ Verified)
```
GET /api/organizations
GET /api/organizations/{org}/chat_conversations
GET /api/organizations/{org}/chat_conversations/{uuid}
```

### 2. Authentication (✅ Verified)
```
Cookie: sessionKey=sk-ant-sid02-...
Status: Working
Method: credentials: 'include'
```

### 3. Message Structure (⚠️ CRITICAL)
```javascript
// ❌ WRONG - msg.text is ALWAYS empty
const text = msg.text;

// ✅ CORRECT - Use content array
const text = msg.content[0]?.text || '';
```

### 4. Organization ID (✅ Verified)
```javascript
// Cached after first fetch
const orgId = await ClaudeAdapter.getOrgId();
// Returns: "1a0bc2b2-1fed-4d00-b396-5c50e2e53c44"
```

### 5. Pagination (✅ Verified)
```javascript
// Offset-based pagination
?limit=30&offset=0&consistency=eventual
```

---

## Common Issues & Fixes

### Issue 1: Empty Messages
**Symptom:** All messages show as empty  
**Cause:** Using `msg.text` instead of `msg.content[0].text`  
**Fix:** Update transformClaudeData() to use content array

### Issue 2: 401 Unauthorized
**Symptom:** API returns 401  
**Cause:** Session expired  
**Fix:** User needs to log in to Claude again

### Issue 3: Organization Not Found
**Symptom:** No organization ID  
**Cause:** User not logged in or no organizations  
**Fix:** Check login status, verify /api/organizations returns data

---

## Agent Tasks

### Task 1: Validate Message Parsing
```javascript
// Check transformClaudeData() in claude-adapter.js
// Line ~180-210

// Should use:
const msgText = (msg.content && msg.content[0]?.text) || msg.text || '';

// NOT:
const msgText = msg.text;  // ❌ Always empty
```

### Task 2: Test Pagination
```javascript
// Test offset-based pagination
const page1 = await ClaudeAdapter.getThreads(1, 10);
const page2 = await ClaudeAdapter.getThreads(2, 10);

console.assert(page1.threads.length === 10);
console.assert(page2.threads[0].uuid !== page1.threads[0].uuid);
```

### Task 3: Verify Error Handling
```javascript
// Should retry on 429
// Should throw on 401/403
// Should use exponential backoff

try {
  await ClaudeAdapter.getThreadDetail('invalid-uuid');
} catch (error) {
  console.assert(error.message.includes('Authentication') || 
                 error.message.includes('HTTP'));
}
```

---

## Testing Commands

### Manual Tests
```javascript
// 1. Get organization ID
const orgId = await ClaudeAdapter.getOrgId();
console.log('Org ID:', orgId);

// 2. List conversations
const result = await ClaudeAdapter.getThreads(1, 5);
console.log('Conversations:', result.threads.length);

// 3. Get conversation detail
const detail = await ClaudeAdapter.getThreadDetail(result.threads[0].uuid);
console.log('Messages:', detail.entries.length);
```

### Automated Tests
```javascript
// Run from extension options page
TestFramework.runAllTests('Claude');
```

---

## Performance Metrics

### Current
- Organizations API: ~200ms
- List API: ~300ms
- Detail API: ~500ms
- Cache hit rate: ~60%

### Optimization Opportunities
1. Increase cache TTL to 5 minutes
2. Implement request batching
3. Add response compression
4. Prefetch next page

---

## Security Checklist

- [x] Cookie-based authentication
- [x] HTTPS only
- [x] credentials: 'include'
- [x] UUID validation
- [x] Error sanitization
- [ ] Rate limiting (basic)
- [ ] Request timeout (30s)
- [ ] Retry limit (3 attempts)

---

## Quick Reference

### File Locations
```
claude.har                          # Network capture
CLAUDE_API_REFERENCE.md             # Full documentation
CLAUDE_ANALYSIS_SUMMARY.md          # Executive summary
src/adapters/claude-adapter.js      # Main adapter
```

### Key Functions
```javascript
ClaudeAdapter.extractUuid(url)
ClaudeAdapter.getOrgId()
ClaudeAdapter.getThreads(page, limit)
ClaudeAdapter.getThreadDetail(uuid)
ClaudeAdapter._fetchWithRetry(url, options)
transformClaudeData(data)
```

### Important Constants
```javascript
API_BASE: '/api/organizations'
CACHE_TTL: 60000 (1 minute)
MAX_RETRIES: 3
RETRY_DELAY: Exponential (1s, 2s, 4s)
```

---

## Next Steps for Agents

1. **Read CLAUDE_ANALYSIS_SUMMARY.md** - Understand what was done
2. **Analyze claude.har** - See actual network traffic
3. **Review claude-adapter.js** - Current implementation
4. **Verify message parsing** - Critical: use content[0].text
5. **Test pagination** - Ensure offset-based works
6. **Implement improvements** - Based on recommendations

---

## Support

For detailed information, see **CLAUDE_API_REFERENCE.md**.

For issues, check the **Common Issues & Fixes** section above.

For improvements, see **Recommendations** in CLAUDE_ANALYSIS_SUMMARY.md.

---

**Last Updated:** 2026-02-21  
**Status:** Production Ready ✅
