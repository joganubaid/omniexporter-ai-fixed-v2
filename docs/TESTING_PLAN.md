# OmniExporter AI Testing Plan

**Goal:** Full coverage across background, content, adapters, UI, exports, and Notion integration with repeatable checks.

---

## Scope

**In scope**
- Background service worker (alarms, auto‑sync, storage cleanup, context menu)
- Content script messaging and normalization
- Platform adapters (thread list + detail extraction)
- UI popup + dashboard interactions
- Export formats (Markdown, JSON, HTML, TXT, PDF, CSV)
- Notion OAuth + database + page upload
- Logging, interception, and storage limits

**Out of scope**
- Third‑party platform UI changes outside extension control

---

## Test Layers

1. **Unit Tests**
   - Pure functions (export formatting, sanitizers)
   - Logger utilities
2. **Integration Tests**
   - Message passing (options → content → adapters)
   - Background worker flows (auto‑sync, storage cleanup)
3. **E2E Tests**
   - Real tabs open to each platform
   - Fetch threads → extract detail → export → Notion upload
4. **Manual Smoke Checks**
   - UI usability and regression verification

---

## Coverage Matrix

### Background (src/background.js)
- Alarm scheduling and auto‑sync flow
- Lock acquisition + release
- Storage cleanup for logs
- Context menu export

### Content Script (src/content.js)
- Message types: GET_THREAD_LIST, EXTRACT_CONTENT_BY_UUID, GET_PLATFORM_INFO
- SPA navigation handling
- normalizeEntries behavior per platform

### Adapters (src/adapters/*)
- getThreads returns valid list
- getThreadDetail returns entries
- Fallbacks for auth errors and empty responses

### UI (src/ui/*)
- Platform selector switches active platform
- Thread list selection via row and checkbox
- Pagination state and loading states
- Export buttons enabled/disabled
- Popup quick export
 - Dropdowns and menus open on click
 - Keyboard focus and tab navigation
 - Error and empty states render correctly
 - Loading and success toasts appear

### Export Manager (src/utils/export-manager.js)
- Markdown and JSON output matches expected structure
- Metadata present (title, date, url, source)
- `_extractEntryMeta` correctly extracts sources, media, knowledge cards, attachments
- Thinking blocks render in Markdown as blockquotes, in JSON as plain text
- Tool calls render correctly in both formats
- Rich content (sources, attachments, knowledge cards, related questions) present in both export formats

### Notion OAuth + Sync
- OAuth configuration and token storage
- Database selection/creation
- Page upload
- Error mapping for 401/403/429

### Logger + Network Interceptor
- Log storage size enforcement
- Export log download
- Interceptor captures fetch/XHR data

---

## Current Gaps (Observed)
- No automated background worker tests
- No real platform adapter validation in tests
- No golden file tests for export formats
- Limited UI behavior tests
- No Notion upload verification inside test suite

---

## Phased Implementation Plan

### Phase 1: Baseline Reliability
- Add fixtures for export format validation
- Expand UI behavior tests
- Add message‑passing tests for content script

### Phase 2: Adapter Validation
- Platform‑specific adapter checks for list + detail
- Validate extracted data quality

### Phase 3: Background + Auto‑Sync
- Tests for alarms, auto‑sync pipeline, and cleanup

### Phase 4: Notion Integration
- OAuth + upload tests with mocked and real flows

### Phase 5: Regression Pack
- Full E2E suite for all platforms
- Golden output regression checks

---

## Test Data Strategy

- Minimal mock conversation fixture for export tests
- One live thread per platform for E2E
- Controlled “empty” account tests

---

## Live Platform Health Checks (Logged‑In Required)

Because platform APIs require live sessions, add a **manual health checklist** that confirms if each platform is working today:

**Per Platform (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity)**
1. Open a logged‑in tab for the platform
2. Open the extension popup — verify platform is detected
3. Confirm:
   - Thread list returns at least 1 item
   - Detail extraction returns non‑empty content
   - No auth error or API 401/403

**Record Results**
- Save results into test history so you can track API breakages over time
- Mark failures as “platform change” vs “extension bug” when possible

---

## Current Testing Issues (Observed)

- Platform tests rely on real tabs and can be flaky due to page load timing
- Some tests open active tabs, which can interrupt user workflow
- Parallel test groups may mask dependencies and timing issues
- Notion upload checks are optional and can produce side effects
- UI tests mostly check existence and miss state transitions

---

## Acceptance Criteria

- All layers have at least one automated test per module
- Each platform has list + detail extraction validation
- Export formats match expected structure
- Background auto‑sync does not regress

---

## Implementation Start (This Commit)

- Add shared test fixtures for export validation
- Expand UI tests for clickability and selection

---

## Final Production Readiness Checklist

### Answer Extraction Consistency
All three Notion sync paths (background.js, popup.js, options.js) must extract answers
identically from block structures. The canonical pattern:
```javascript
if (block.markdown_block) {
    answer += (block.markdown_block.answer || block.markdown_block.chunks?.join('\n') || '') + '\n\n';
}
```
- ✅ background.js — handles all `markdown_block` regardless of `intended_usage`
- ✅ popup.js — updated to match background.js (was filtering on `intended_usage === 'ask_text'` only)
- ✅ options.js — `ResilientDataExtractor.extractAnswer` updated to accumulate all blocks
- ✅ ExportManager.extractAnswer — handles both `intended_usage` and generic blocks

### HAR Data Security
- ✅ `*.har` added to `.gitignore`
- ✅ HAR files removed from git tracking (contain session data, 352MB total)

### Platform Adapters — HAR-Verified Features
| Platform   | Thread List | Detail | Model | Thinking | Tool Use | Attachments | Citations |
|------------|:-----------:|:------:|:-----:|:--------:|:--------:|:-----------:|:---------:|
| ChatGPT    | ✅          | ✅     | ✅    | —        | ✅       | ✅          | ✅        |
| Claude     | ✅          | ✅     | ✅    | ✅       | ✅       | ✅          | —         |
| Perplexity | ✅          | ✅     | ✅    | —        | —        | —           | ✅        |
| Gemini     | ✅          | ✅     | ✅    | —        | —        | —           | ✅        |
| Grok       | ✅          | ✅     | ✅    | —        | —        | —           | ✅        |
| DeepSeek   | ✅          | ✅     | ✅    | ✅       | —        | —           | —         |

### Cloudflare Worker
- ✅ CORS restricted to known chrome-extension:// origins
- ✅ Rate limiting (10 req/min per IP)
- ✅ Safe error code mapping (only known Notion error codes forwarded)
- ✅ PKCE code_verifier support
- ✅ Only required fields returned from token exchange

### Notion Sync
- ✅ NotionBlockBuilder used when available (background, popup, options)
- ✅ Fallback block generation consistent across all sync paths
- ✅ 100-block batch limit respected with continuation batches
- ✅ Rate limiting with 350ms delays between batches
- ✅ Database schema introspection for dynamic property mapping
