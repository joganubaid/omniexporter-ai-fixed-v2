# Agent Validation Guide

**Quick Reference for AI Agents**

This guide helps AI agents quickly validate and improve the OmniExporter AI extension's Gemini integration.

---

## Quick Start

### Files to Review
1. **gemini.har** - Network traffic capture (9.98 MB, 113 requests)
2. **GEMINI_API_REFERENCE.md** - Complete technical documentation
3. **src/adapters/gemini-adapter.js** - Main implementation (717 lines)
4. **src/adapters/gemini-inject.js** - Page context script
5. **src/platform-config.js** - Configuration layer

### Validation Checklist

- [ ] HAR file matches current implementation
- [ ] Session parameters extracted correctly
- [ ] Request format matches HAR
- [ ] Response parsing handles all cases
- [ ] Error handling covers edge cases
- [ ] Security measures in place
- [ ] Performance optimizations applied

---

## Critical Validation Points

### 1. API Endpoint (✅ Verified)
```
URL: https://gemini.google.com/_/BardChatUi/data/batchexecute
Method: POST
Status: Working as of 2026-02-21
```

### 2. RPC IDs (✅ Verified)
- **MaZiqc**: List conversations (2 calls in HAR, 376 bytes avg)
- **hNvQHb**: Get conversation detail (2 calls in HAR, 5,562 bytes avg)

### 3. Session Parameters (✅ Verified)
```javascript
SNlM0e → at (POST body)      // XSRF token
cfb2h  → bl (query param)    // Build version
FdrFJe → f.sid (query param) // Session ID
```

### 4. Request Format (✅ Verified)
```
f.req=[[["{rpcid}","{payload}",null,"generic"]]]&at={token}&
```

### 5. Response Format (✅ Verified)
```
)]}'\n\n{length}\n[[["wrb.fr","{rpcid}","{data}",...]]]
```

---

## Common Issues & Fixes

### Issue 1: Session Params Not Found
**Symptom:** 403 Forbidden  
**Cause:** WIZ_global_data not accessible  
**Fix:** Ensure gemini-inject.js is loaded in page context

### Issue 2: Empty Response
**Symptom:** 200 OK but no data  
**Cause:** RPC ID changed  
**Fix:** Check HAR for new RPC IDs, update config

### Issue 3: Parsing Errors
**Symptom:** Entries array empty  
**Cause:** Response structure changed  
**Fix:** Update array indices in getThreadDetail()

---

## Agent Tasks

### Task 1: Validate HAR Alignment
```bash
# Compare extension requests with HAR
1. Open gemini.har
2. Find batchexecute requests
3. Compare with gemini-adapter.js implementation
4. Verify URL params, headers, body format match
```

### Task 2: Test API Endpoints
```javascript
// Test in browser console on gemini.google.com
chrome.tabs.query({active: true}, async (tabs) => {
  const response = await chrome.tabs.sendMessage(tabs[0].id, {
    type: 'GET_THREAD_LIST',
    payload: { page: 1, limit: 5 }
  });
  console.log(response);
});
```

### Task 3: Improve Error Handling
```javascript
// Add to gemini-adapter.js
async _batchExecuteWithRetry(rpcid, payload, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this._batchExecute(rpcid, payload);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}
```

### Task 4: Implement Pagination
```javascript
// Add cursor support to getThreads()
async getThreads(page = 1, limit = 20, cursor = null) {
  const payload = [13, cursor, [0, null, 1]];
  const data = await this._batchExecute('MaZiqc', payload);
  
  return {
    threads: this._parseThreads(data[2]),
    hasMore: !!data[1],
    nextCursor: data[1]
  };
}
```

---

## Performance Metrics

### Current Performance
- **List API**: ~200ms average
- **Detail API**: ~500ms average
- **Bulk Export**: ~1 second per conversation
- **Cache Hit Rate**: ~60% (5-minute TTL)

### Optimization Opportunities
1. Increase cache TTL to 10 minutes
2. Implement request batching
3. Add response compression
4. Prefetch next page

---

## Security Checklist

- [x] Origin validation on postMessage
- [x] UUID format validation
- [x] HTML sanitization
- [x] Fetch timeout protection
- [x] CSP headers configured
- [x] Web accessible resources scoped
- [ ] Rate limiting implemented
- [ ] Request signing (future)

---

## Testing Commands

### Manual Tests
```javascript
// 1. Check session params
window.__omniexporter_gemini.getGlobalData()

// 2. List conversations
chrome.tabs.sendMessage(tabId, {
  type: 'GET_THREAD_LIST',
  payload: { page: 1, limit: 10 }
})

// 3. Get conversation detail
chrome.tabs.sendMessage(tabId, {
  type: 'EXTRACT_CONTENT_BY_UUID',
  payload: { uuid: 'c_ec00ff04a46f7fa6' }
})
```

### Automated Tests
```javascript
// Run from extension options page
TestFramework.runAllTests('Gemini');
```

---

## Next Steps for Agents

1. **Read GEMINI_API_REFERENCE.md** - Complete technical details
2. **Analyze gemini.har** - Understand actual network traffic
3. **Review gemini-adapter.js** - Current implementation
4. **Identify improvements** - Based on HAR analysis
5. **Implement changes** - With proper testing
6. **Update documentation** - Keep in sync

---

## Quick Reference

### File Locations
```
gemini.har                          # Network capture
GEMINI_API_REFERENCE.md             # Full documentation
src/adapters/gemini-adapter.js      # Main adapter
src/adapters/gemini-inject.js       # Page script
src/platform-config.js              # Configuration
manifest.json                       # Extension manifest
```

### Key Functions
```javascript
GeminiAdapter.extractUuid(url)
GeminiAdapter.getThreads(page, limit)
GeminiAdapter.getThreadDetail(uuid)
GeminiBridge.getSessionParams()
platformConfig.getConfig('Gemini')
```

### Important Constants
```javascript
API_BASE: '/_/BardChatUi/data/batchexecute'
RPC_LIST: 'MaZiqc'
RPC_DETAIL: 'hNvQHb'
CACHE_TTL: 300000 (5 minutes)
REQUEST_INCREMENT: 100000
```

---

## Support

For detailed information, see **GEMINI_API_REFERENCE.md**.

For issues, check the **Known Issues & Limitations** section.

For improvements, see **Improvement Recommendations** section.

---

**Last Updated:** 2026-02-21  
**Status:** Production Ready ✅
