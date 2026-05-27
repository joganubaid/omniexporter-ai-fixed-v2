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

### 2. [PERPLEXITY_VALIDATION_GUIDE.md](../validation/PERPLEXITY_VALIDATION_GUIDE.md)
**Quick validation checklist**
- HAR vs implementation checks
- Common pitfalls and fixes
- Manual and extension test steps

(Earlier docs referenced `PERPLEXITY_ANALYSIS_SUMMARY.md`, `perplexity.har`, and
`analyze_perplexity_har.py` — none of these exist in the repo. HAR files are
gitignored as `*.har`; capture your own from www.perplexity.ai via DevTools
Network if you need to verify endpoints. Ad-hoc analysis scripts live in
branches, not master.)

---

## 🎯 Quick Start

### For Developers
1. Use PERPLEXITY_API_REFERENCE.md for full endpoint details
2. Validate adapter behavior with PERPLEXITY_VALIDATION_GUIDE.md
3. (Optional) Capture a fresh HAR from www.perplexity.ai to verify endpoints
   against the validation guide before claiming a regression

### For AI Agents
1. Review the validation checklist
2. Confirm slug usage and `supported_block_use_cases` count (currently 40, HAR-verified 2026-05)
3. Log findings and improvements

---

## 🔍 Key Findings

- **REST API:** `/rest/*` for content, `/api/*` for auth
- **Auth:** Cookie-based, no API keys
- **Pagination:** Offset for list, cursor for detail
- **Critical Endpoints:** Session, list threads, thread detail, collections
- **Blocked Requests:** Analytics only, no impact on export flow

---

## 📊 Stats Snapshot (from the original HAR analysis that informed the adapter)

| Metric | Value |
|---|---|
| Total HTTP requests captured | ~450 |
| Perplexity API calls | ~80 |
| Unique endpoints | ~35 |
| Blocked third-party requests | ~20 (analytics only — no impact on export) |

(Numbers are approximate — captured from the original HAR session that
informed the current adapter. To regenerate against a current HAR, capture
fresh traffic via DevTools.)

---

## 🔧 Common Tasks

### Validate Implementation
- Check PERPLEXITY_VALIDATION_GUIDE.md
- Verify slug usage for thread detail
- Confirm 40 block use cases (HAR-verified 2026-05) in requests

### Debug Issues
- See Debugging Guide section in PERPLEXITY_API_REFERENCE.md
- Use browser DevTools to inspect headers and cookies
- Re-run HAR analysis if API version changes

---

## 🆕 v5.3.0 Content Extraction Enhancements (2026-03-16)

### Rich Block Types

The adapter now requests and extracts additional block use cases from the thread detail endpoint:

| Block Type | Description |
|-----------|-------------|
| `media_items` | Embedded images, videos, and media attachments |
| `knowledge_cards` | Structured knowledge panels with entity data |
| `inline_images` | Images rendered inline within the response text |
| `pending_followups` | AI-generated follow-up question suggestions |

These are requested via the `supported_block_use_cases` query parameter alongside the existing `ask_text` and `web_results` types.

### Model Metadata in Thread List

The thread list endpoint now surfaces model information:

- **`display_model`** — The model name shown in the Perplexity UI (e.g., `llama-3.1-sonar-large-128k-online`)
- **`mode`** — Query mode (`copilot`, `default`, etc.)
- **`search_focus`** — Search scope (`internet`, `academic`, `writing`, etc.)

These fields are included in exported thread metadata and used in Notion export callout blocks.
