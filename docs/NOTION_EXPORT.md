# Notion Rich Block Export

> How OmniExporter AI converts AI conversations into rich Notion pages using the `NotionBlockBuilder` utility.

**Source:** `src/utils/notion-block-builder.js`  
**Last Updated:** 2026-03-16

---

## Overview

When exporting a conversation to Notion, OmniExporter AI no longer sends plain text. The `NotionBlockBuilder` module parses markdown answers, tool calls, thinking blocks, and sources into native Notion API block objects so the resulting page is fully formatted.

```
Adapter → entries[] → NotionBlockBuilder.buildNotionBlocks() → Notion API blocks → Page children
```

---

## Supported Block Types

| Notion Block Type | Markdown / Content Source | Example Input |
|-------------------|--------------------------|---------------|
| `heading_1` | `# Heading` | `# Introduction` |
| `heading_2` | `## Heading` | `## Details` |
| `heading_3` | `### Heading` | `### Sub-section` |
| `paragraph` | Plain text lines | `This is a paragraph.` |
| `code` | Fenced code blocks | `` ```python\nprint("hi")\n``` `` |
| `bulleted_list_item` | `- item` or `* item` | `- First point` |
| `numbered_list_item` | `1. item` | `1. Step one` |
| `quote` | `> text` | `> A wise quote` |
| `divider` | `---` or `***` | `---` |
| `callout` | Thinking blocks, tool results, metadata | `> 💭 **Thinking:** …` |
| `bookmark` | Source URLs | `https://example.com` |
| `toggle` | Tool calls | `` ```tool_call:search\n{}\n``` `` |

---

## How Markdown Is Parsed into Notion Blocks

The `markdownToBlocks(markdown)` function processes a markdown string line-by-line:

1. **Fenced code blocks** — Lines between `` ``` `` fences become `code` blocks with language detection.
2. **Dividers** — `---` or `***` become `divider` blocks.
3. **Headings** — `#`, `##`, `###` become `heading_1`, `heading_2`, `heading_3`.
4. **Blockquotes** — Lines starting with `> ` become `quote` blocks (or special callouts — see below).
5. **Lists** — `- item` / `* item` → `bulleted_list_item`; `1. item` → `numbered_list_item`.
6. **Paragraphs** — Everything else becomes a `paragraph` block with inline formatting.

### Inline Markdown Handling

The `parseInlineMarkdown(text)` function converts inline formatting into Notion `rich_text` annotation objects:

| Markdown Syntax | Notion Annotation |
|----------------|-------------------|
| `**bold**` | `{ bold: true }` |
| `*italic*` | `{ italic: true }` |
| `` `code` `` | `{ code: true }` |
| `[text](url)` | `{ link: { url } }` |

Example output for `**Hello** *world*`:

```json
[
  { "type": "text", "text": { "content": "Hello" }, "annotations": { "bold": true } },
  { "type": "text", "text": { "content": " " } },
  { "type": "text", "text": { "content": "world" }, "annotations": { "italic": true } }
]
```

---

## Special Block Conversions

### Tool Calls → Toggle Blocks

Tool calls in the markdown are formatted as fenced code blocks with a `tool_call:` prefix:

````markdown
```tool_call:web_search
{"query": "latest news"}
```
````

`extractToolCallBlocks()` detects these before general parsing and converts each into a collapsible toggle block:

```
🔧 Tool: web_search          ← toggle heading
  └─ code block (json)       ← nested child
```

### Thinking Blocks → Callout Blocks

Blockquotes that start with the 💭 emoji are treated as thinking/reasoning traces:

```markdown
> 💭 **Thinking:** Let me analyze this step by step...
> First, I need to consider...
```

These become purple callout blocks:

```json
{
  "type": "callout",
  "callout": {
    "icon": { "emoji": "💭" },
    "color": "purple_background",
    "rich_text": [{ "type": "text", "text": { "content": "..." } }]
  }
}
```

### Tool Results → Callout Blocks

Blockquotes beginning with `**Tool result:**` or `**Tool error:**` become green or red callout blocks:

| Pattern | Emoji | Color |
|---------|-------|-------|
| `> **Tool result:** …` | ✅ | `green_background` |
| `> **Tool error:** …` | ❌ | `red_background` |

### Sources → Bookmark Blocks

Source URLs extracted from conversation entries become clickable `bookmark` blocks:

```json
{ "type": "bookmark", "bookmark": { "url": "https://example.com/article" } }
```

Sources are deduplicated by URL, and a maximum of 15 are included per entry.

---

## Metadata Callout

Every exported page begins with a metadata callout block:

```
🤖  🧭 Exported from Perplexity | Model: llama-3.1-sonar-large | 2026-03-16
```

The callout includes:
- Platform icon (🧭 Perplexity, 🤖 ChatGPT, 🎯 Claude, ✨ Gemini, 𝕏 Grok, 🔮 DeepSeek)
- Platform name
- Model name (if available from adapter metadata)
- Export date

---

## Character Limits

The Notion API enforces a **2 000 character limit** per `rich_text` content field. The `chunkText()` function handles this transparently:

1. If text ≤ 2 000 chars → single `rich_text` object.
2. If text > 2 000 chars → split on the last `\n` or space before the limit, producing multiple `rich_text` objects.

This applies to all block types that contain text: paragraphs, headings, callouts, quotes, list items, code blocks, and toggle headings.

---

## Page Structure

A fully exported conversation page has this structure:

```
📌 Metadata callout (platform, model, date)
───────────────────────────────
## 🙋 [User question 1]
   📎 [Attachment toggle] (if any)
   ### 🤖 Answer
      [Parsed markdown blocks]
      🔧 Tool: name (toggle, if any)
   ### 📚 Sources
      🔖 bookmark 1
      🔖 bookmark 2
   ### 🔗 Related Questions (if any)
      • question 1
      • question 2
───────────────────────────────
## 🙋 [User question 2]
   ...
```

---

## Integration Points

The `NotionBlockBuilder` is consumed by three integration points:

| Component | File | Usage |
|-----------|------|-------|
| Background auto-sync | `src/background.js` | Calls `buildNotionBlocks()` when syncing conversations to Notion in the background |
| Popup export | `src/ui/popup.js` | Calls `buildNotionBlocks()` on manual "Export to Notion" button click |
| Options dashboard | `src/ui/options.js` | Calls `buildNotionBlocks()` for bulk export from the dashboard view |

### Example Usage

```javascript
const entries = await adapter.getThreadDetail(threadId);
const blocks = NotionBlockBuilder.buildNotionBlocks(
  entries,
  'Claude',
  { title: 'My conversation', model: 'claude-3.5-sonnet', exportDate: '2026-03-16' }
);

// blocks is now an array of Notion block objects ready for:
// POST https://api.notion.com/v1/blocks/{page_id}/children
// { children: blocks }
```

---

## Public API

The module exposes the following functions via `window.NotionBlockBuilder` (or `globalThis.NotionBlockBuilder`):

| Method | Signature | Description |
|--------|-----------|-------------|
| `buildNotionBlocks` | `(entries, platform, metadata) → Block[]` | Main entry point for full conversation export |
| `markdownToBlocks` | `(markdown) → Block[]` | Convert a markdown string to Notion blocks |
| `parseInlineMarkdown` | `(text) → RichText[]` | Parse inline formatting to `rich_text` array |
| `chunkText` | `(text, limit?) → string[]` | Split text at the 2 000-char boundary |
| `extractEntryContent` | `(entry) → { answer, sources }` | Extract answer and sources from any platform entry |
| `extractToolCallBlocks` | `(markdown) → { cleaned, toolBlocks }` | Pull tool-call fences out of markdown |
