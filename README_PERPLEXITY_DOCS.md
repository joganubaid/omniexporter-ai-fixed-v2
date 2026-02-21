# Perplexity Documentation Index

**OmniExporter AI - Complete Perplexity Integration Package**

---

## 📚 Documentation Files

### 1. [PERPLEXITY_API_REFERENCE.md](./PERPLEXITY_API_REFERENCE.md)
**Complete technical reference** (~37.9 KB)
- HAR analysis overview (77,052 lines, 448 requests)
- All 35 HAR-observed endpoints with call counts
- Authentication and session management
- Request/response formats and pagination rules
- Error handling, testing, and debugging guides
- Code examples and implementation validation

### 2. [PERPLEXITY_ANALYSIS_SUMMARY.md](./PERPLEXITY_ANALYSIS_SUMMARY.md)
**Executive summary** (~5.5 KB)
- Key findings and statistics
- Critical implementation notes
- Performance estimates and recommendations

### 3. [PERPLEXITY_VALIDATION_GUIDE.md](./PERPLEXITY_VALIDATION_GUIDE.md)
**Quick validation checklist** (~3.9 KB)
- HAR vs implementation checks
- Common pitfalls and fixes
- Manual and extension test steps

### 4. [perplexity.har](./perplexity.har)
**Network traffic capture** (~11.0 MB)
- 448 total requests
- 83 Perplexity API calls
- 22 blocked third-party analytics requests
- Full headers and response payloads

### 5. [analyze_perplexity_har.py](./analyze_perplexity_har.py)
**HAR analysis script**
```bash
python analyze_perplexity_har.py perplexity.har
```

---

## 🎯 Quick Start

### For Developers
1. Read PERPLEXITY_ANALYSIS_SUMMARY.md for a high-level overview
2. Use PERPLEXITY_API_REFERENCE.md for full endpoint details
3. Validate adapter behavior with PERPLEXITY_VALIDATION_GUIDE.md
4. Compare results with perplexity.har

### For AI Agents
1. Review the validation checklist
2. Compare adapter logic with HAR examples
3. Confirm slug usage and block use cases
4. Log findings and improvements

---

## 🔍 Key Findings

- **REST API:** `/rest/*` for content, `/api/*` for auth
- **Auth:** Cookie-based, no API keys
- **Pagination:** Offset for list, cursor for detail
- **Critical Endpoints:** Session, list threads, thread detail, collections
- **Blocked Requests:** Analytics only, no impact on export flow

---

## 📊 Stats Snapshot

```
HAR File: perplexity.har
Lines: 77,052
Total Requests: 448
Perplexity API Calls: 83
Unique Endpoints: 35
Blocked Requests: 22 (analytics only)
```

---

## 🔧 Common Tasks

### Validate Implementation
- Check PERPLEXITY_VALIDATION_GUIDE.md
- Verify slug usage for thread detail
- Confirm 28 block use cases in requests

### Debug Issues
- See Debugging Guide section in PERPLEXITY_API_REFERENCE.md
- Use browser DevTools to inspect headers and cookies
- Re-run HAR analysis if API version changes
