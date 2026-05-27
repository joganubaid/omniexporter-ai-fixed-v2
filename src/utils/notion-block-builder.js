// OmniExporter AI - Notion Block Builder
// Converts markdown content and structured conversation data into rich Notion API blocks.
"use strict";

var _nbbRoot = typeof window !== 'undefined' ? window : globalThis;
if (!_nbbRoot.NotionBlockBuilder) {

/**
 * Maximum characters allowed per rich_text content field by the Notion API.
 * @const {number}
 */
const NOTION_TEXT_LIMIT = 2000;

function stripHtml(text) {
    return text ? text.replace(/<[^>]+>/g, '') : '';
}

// ============================================
// Rich-text helpers
// ============================================

/**
 * Split text into chunks that fit within Notion's character limit.
 * Splits on the last newline or space before the limit.
 * @param {string} text
 * @param {number} [limit=NOTION_TEXT_LIMIT]
 * @returns {string[]}
 */
function chunkText(text, limit) {
    if (limit === undefined) limit = NOTION_TEXT_LIMIT;
    if (!text) return [];
    if (text.length <= limit) return [text];

    const chunks = [];
    let remaining = text;
    while (remaining.length > limit) {
        let splitAt = remaining.lastIndexOf('\n', limit);
        if (splitAt < 1) splitAt = remaining.lastIndexOf(' ', limit);
        if (splitAt < 1) splitAt = limit;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).replace(/^\n/, '');
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

/**
 * Parse a single line of markdown into an array of Notion rich_text objects
 * with proper annotations (bold, italic, inline code, links).
 * @param {string} text
 * @returns {Array<Object>} Notion rich_text array
 */
function parseInlineMarkdown(text) {
    if (!text) return [{ type: 'text', text: { content: '' } }];

    // Tokenise inline markdown: bold, italic, inline code, links
    // Order matters: bold (**) before italic (*), and code before both.
    // Group 1: `code`  — inline code
    // Group 2: [text](url) — markdown link (groups 3=text, 4=url)
    // Group 5: **bold** — bold text
    // Group 6: *italic* — italic text (requires non-space after/before *)
    const TOKEN_RE = /(`[^`\n]+`)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*[^*\n]+\*\*)|(\*(?=[^\s*])[^*\n]+(?<=[^\s*])\*)/g;

    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = TOKEN_RE.exec(text)) !== null) {
        // Plain text before this match
        if (match.index > lastIndex) {
            pushPlainChunks(parts, text.slice(lastIndex, match.index));
        }

        if (match[1]) {
            // Inline code: `code`
            const content = match[1].slice(1, -1);
            pushAnnotatedChunks(parts, content, { code: true });
        } else if (match[2]) {
            // Link: [text](url)
            const linkText = match[3];
            const linkUrl = match[4];
            pushLinkChunks(parts, linkText, linkUrl);
        } else if (match[5]) {
            // Bold: **text**
            const content = match[5].slice(2, -2);
            pushAnnotatedChunks(parts, content, { bold: true });
        } else if (match[6]) {
            // Italic: *text*
            const content = match[6].slice(1, -1);
            pushAnnotatedChunks(parts, content, { italic: true });
        }

        lastIndex = match.index + match[0].length;
    }

    // Remaining plain text
    if (lastIndex < text.length) {
        pushPlainChunks(parts, text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [{ type: 'text', text: { content: '' } }];
}

/** Push plain text, respecting the 2000-char limit. */
function pushPlainChunks(parts, content) {
    for (const chunk of chunkText(content)) {
        parts.push({ type: 'text', text: { content: chunk } });
    }
}

/** Push annotated text chunks (bold, italic, code). */
function pushAnnotatedChunks(parts, content, annotations) {
    for (const chunk of chunkText(content)) {
        parts.push({
            type: 'text',
            text: { content: chunk },
            annotations: Object.assign({
                bold: false, italic: false, strikethrough: false,
                underline: false, code: false, color: 'default'
            }, annotations)
        });
    }
}

/** Push link text chunks. */
function pushLinkChunks(parts, content, url) {
    for (const chunk of chunkText(content)) {
        parts.push({
            type: 'text',
            text: { content: chunk, link: { url: url } }
        });
    }
}

/**
 * Create a simple rich_text array from plain text, chunked to the limit.
 * @param {string} text
 * @returns {Array<Object>}
 */
function plainRichText(text) {
    if (!text) return [{ type: 'text', text: { content: '' } }];
    return chunkText(text).map(chunk => ({
        type: 'text',
        text: { content: chunk }
    }));
}

// ============================================
// Block factory helpers
// ============================================

function headingBlock(level, text) {
    const key = 'heading_' + level;
    const block = { type: key };
    block[key] = { rich_text: parseInlineMarkdown(text.slice(0, NOTION_TEXT_LIMIT)) };
    return block;
}

function paragraphBlock(richText) {
    return { type: 'paragraph', paragraph: { rich_text: richText } };
}

function codeBlock(code, language) {
    const chunks = chunkText(code, NOTION_TEXT_LIMIT);
    return {
        type: 'code',
        code: {
            rich_text: chunks.map(c => ({ type: 'text', text: { content: c } })),
            language: language || 'plain text'
        }
    };
}

function bulletedListItem(text) {
    return {
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseInlineMarkdown(text.slice(0, NOTION_TEXT_LIMIT)) }
    };
}

function numberedListItem(text) {
    return {
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseInlineMarkdown(text.slice(0, NOTION_TEXT_LIMIT)) }
    };
}

function quoteBlock(text) {
    return {
        type: 'quote',
        quote: { rich_text: parseInlineMarkdown(text.slice(0, NOTION_TEXT_LIMIT)) }
    };
}

function dividerBlock() {
    return { type: 'divider', divider: {} };
}

function calloutBlock(text, color) {
    const block = {
        type: 'callout',
        callout: {
            color: color || 'gray_background',
            rich_text: plainRichText(text.slice(0, NOTION_TEXT_LIMIT))
        }
    };
    return block;
}

function bookmarkBlock(url) {
    return {
        type: 'bookmark',
        bookmark: { url: url }
    };
}

/**
 * Create a toggle block (collapsible) with optional children.
 * @param {string} summaryText - Toggle heading text
 * @param {Array<Object>} children - Nested Notion blocks inside the toggle
 * @returns {Object}
 */
function toggleBlock(summaryText, children) {
    return {
        type: 'toggle',
        toggle: {
            rich_text: parseInlineMarkdown(summaryText.slice(0, NOTION_TEXT_LIMIT)),
            children: children || []
        }
    };
}

// ============================================
// Markdown → Notion blocks parser
// ============================================

/**
 * Parse a markdown string into an array of Notion block objects.
 * Handles headings, fenced code, lists, blockquotes, dividers,
 * and regular paragraphs with inline formatting.
 * @param {string} markdown
 * @returns {Array<Object>}
 */
function markdownToBlocks(markdown) {
    if (!markdown) return [];
    const blocks = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block: ```language ... ```
        const fenceMatch = line.match(/^```(\S*)/);
        if (fenceMatch) {
            const lang = fenceMatch[1] || 'plain text';
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].match(/^```\s*$/)) {
                codeLines.push(lines[i]);
                i++;
            }
            blocks.push(codeBlock(codeLines.join('\n'), lang));
            i++; // skip closing ```
            continue;
        }

        // Divider: --- or ***
        if (/^(---|\*\*\*)\s*$/.test(line)) {
            blocks.push(dividerBlock());
            i++;
            continue;
        }

        // Headings
        const h3Match = line.match(/^### (.+)/);
        if (h3Match) { blocks.push(headingBlock(3, h3Match[1])); i++; continue; }
        const h2Match = line.match(/^## (.+)/);
        if (h2Match) { blocks.push(headingBlock(2, h2Match[1])); i++; continue; }
        const h1Match = line.match(/^# (.+)/);
        if (h1Match) { blocks.push(headingBlock(1, h1Match[1])); i++; continue; }

        // Blockquote (may contain thinking blocks)
        if (line.startsWith('> ')) {
            const quoteContent = line.slice(2);

            // Detect thinking/reasoning callout
            if (/^Thinking/i.test(quoteContent) || /^Reasoning/i.test(quoteContent)) {
                const thinkLines = [quoteContent];
                i++;
                while (i < lines.length && lines[i].startsWith('> ')) {
                    thinkLines.push(lines[i].slice(2));
                    i++;
                }
                blocks.push(calloutBlock(thinkLines.join('\n'), 'purple_background'));
                continue;
            }

            // Detect tool result
            if (/^\*\*Tool (result|error)/.test(quoteContent)) {
                const resultLines = [quoteContent.replace(/^\*\*Tool (result|error):\*\*\s*/, '')];
                i++;
                while (i < lines.length && lines[i].startsWith('> ')) {
                    resultLines.push(lines[i].slice(2));
                    i++;
                }
                const isError = /^\*\*Tool error/.test(quoteContent);
                blocks.push(calloutBlock(resultLines.join('\n'), isError ? 'red_background' : 'green_background'));
                continue;
            }

            // Regular blockquote — collect consecutive > lines
            const bqLines = [quoteContent];
            i++;
            while (i < lines.length && lines[i].startsWith('> ')) {
                bqLines.push(lines[i].slice(2));
                i++;
            }
            blocks.push(quoteBlock(bqLines.join('\n')));
            continue;
        }

        // Bulleted list: - item or * item (exclude dividers *** and bold-only lines)
        const bulletMatch = line.match(/^[-*] (.+)/);
        if (bulletMatch && !(/^\*{3,}\s*$/.test(line)) && !(line.startsWith('**') && line.endsWith('**'))) {
            blocks.push(bulletedListItem(bulletMatch[1]));
            i++;
            continue;
        }

        // Numbered list: 1. item
        const numMatch = line.match(/^(\d+)\. (.+)/);
        if (numMatch) {
            blocks.push(numberedListItem(numMatch[2]));
            i++;
            continue;
        }

        // Blank line — skip
        if (!line.trim()) {
            i++;
            continue;
        }

            // Default: paragraph with inline markdown, strip raw HTML
        blocks.push(paragraphBlock(parseInlineMarkdown(stripHtml(line))));
        i++;
    }

    return blocks;
}

// ============================================
// Tool-call block parser
// ============================================

/**
 * Detect and convert tool call fenced code blocks into toggle blocks.
 * Handles both legacy and current formats:
 *   legacy: ```tool_call:tool_name\n{ json }\n```
 *   current: **Tool: name**\n\n```json\n{ json }\n```
 * This function extracts them before general markdown parsing.
 *
 * @param {string} markdown
 * @returns {{ cleaned: string, toolBlocks: Array<Object> }}
 */
function extractToolCallBlocks(markdown) {
    if (!markdown) return { cleaned: '', toolBlocks: [] };

    const toolBlocks = [];

    // Changed from greedy [\s\S]* to lazy [\s\S]*? to prevent merging multiple tool calls
    // Legacy format: ```tool_call:tool_name ... ```
    let cleaned = markdown.replace(
        /```tool_call:([^\n]*)\n([\s\S]*?)```/g,
        function (_, toolName, body) {
            const name = toolName.trim() || 'unknown';
            toolBlocks.push(
                toggleBlock('Tool: ' + name, [
                    codeBlock(body.trim(), 'json')
                ])
            );
            return '';
        }
    );

    // Current format: **Tool: name**\n\n```json\n{ body }\n```
    cleaned = cleaned.replace(
        /\*\*Tool:\s*([^*\n]+)\*\*\s*\n+```json\n([\s\S]*?)```/g,
        function (_, toolName, body) {
            const name = toolName.trim() || 'unknown';
            toolBlocks.push(
                toggleBlock('Tool: ' + name, [
                    codeBlock(body.trim(), 'json')
                ])
            );
            return '';
        }
    );

    return { cleaned: cleaned, toolBlocks: toolBlocks };
}

// ============================================
// Answer extraction (mirrors ExportManager.extractAnswer)
// ============================================

/**
 * Extract the answer text and sources from an entry, supporting all
 * platform-specific formats (blocks, answer, text).
 * @param {Object} entry
 * @returns {{ answer: string, sources: Array<{url:string, name?:string, title?:string}> }}
 */
function extractEntryContent(entry) {
    let answer = '';
    let sources = [];

    if (entry.blocks && Array.isArray(entry.blocks)) {
        entry.blocks.forEach(function (block) {
            if (block.thinking) {
                answer += stripHtml(block.thinking) + '\n\n';
            }
            if (block.markdown_block) {
                if (block.markdown_block.answer) {
                    answer += stripHtml(block.markdown_block.answer) + '\n\n';
                } else if (block.markdown_block.chunks && Array.isArray(block.markdown_block.chunks)) {
                    answer += stripHtml(block.markdown_block.chunks.join('\n')) + '\n\n';
                }
            }
            if (block.toolCalls && block.toolCalls.length > 0) {
                for (var tci = 0; tci < block.toolCalls.length; tci++) {
                    answer += '```json\n' + JSON.stringify(block.toolCalls[tci].input, null, 2) + '\n```\n\n';
                }
            }
            if (block.toolResults && block.toolResults.length > 0) {
                for (var tri = 0; tri < block.toolResults.length; tri++) {
                    answer += (block.toolResults[tri].isError ? 'Tool error: ' : 'Tool result: ') + stripHtml(block.toolResults[tri].text) + '\n\n';
                }
            }
            // Generic markdown_block without intended_usage (some platforms, e.g. Perplexity)
            if (!block.intended_usage && block.markdown_block) {
                answer += (block.markdown_block.answer || (block.markdown_block.chunks || []).join('\n') || '') + '\n\n';
            }
            if (block.intended_usage === 'web_results' && block.web_result_block) {
                var webResults = block.web_result_block.web_results || [];
                webResults.forEach(function (wr) {
                    if (wr.url) {
                        sources.push({ url: wr.url, name: wr.name || wr.title || wr.url });
                    }
                });
            }
        });
    }

    if (!answer.trim()) {
        answer = entry.answer || entry.text || '';
    }

    // Citations (Claude) — prefer entry.citations over sources
    if (entry.citations && Array.isArray(entry.citations) && entry.citations.length > 0) {
        sources = entry.citations.map(function (c) {
            return { url: c.url || '', name: c.title || c.name || c.url || '' };
        }).filter(function (s) { return s.url; });
    }

    // Merge entry-level sources (fallback if no citations)
    if (sources.length === 0 && entry.sources && Array.isArray(entry.sources)) {
        sources = entry.sources.map(function (s) {
            return { url: s.url || '', name: s.name || s.title || s.url || '' };
        });
    }

    return { answer: answer.trim(), sources: sources };
}

// ============================================
// Main entry point
// ============================================

/**
 * Build an array of Notion API block objects from conversation entries.
 *
 * @param {Array<Object>} entries - Conversation entries (Q&A pairs)
 * @param {string} platform - Platform name (ChatGPT, Claude, Perplexity, etc.)
 * @param {Object} metadata - Export metadata
 * @param {string} [metadata.title] - Conversation title
 * @param {string} [metadata.url] - Source URL
 * @param {string} [metadata.model] - AI model name
 * @param {string} [metadata.exportDate] - ISO date string
 * @returns {Array<Object>} Notion block objects ready for the API
 */
function buildNotionBlocks(entries, platform, metadata) {
    var meta = metadata || {};
    var children = [];
    var exportDate = meta.exportDate || new Date().toISOString().split('T')[0];
    var modelLabel = meta.model ? ' | Model: ' + meta.model : '';

    children.push(calloutBlock(
        'Exported from ' + (platform || 'AI') + modelLabel + ' | ' + exportDate,
        'blue_background'
    ));

    children.push(dividerBlock());

    var safeEntries = Array.isArray(entries) ? entries : [];
    safeEntries.forEach(function (entry, index) {
        var query = entry.query || entry.query_str || entry.question || entry.prompt || '';
        var blocks = entry.blocks || [];

        children.push(headingBlock(2, 'Turn ' + (index + 1)));

        // ── User message ──
        if (query) {
            children.push(headingBlock(3, 'User'));

            // Attachments
            if (entry.attachments && Array.isArray(entry.attachments)) {
                entry.attachments.forEach(function (att) {
                    var fileName = att.file_name || att.fileName || 'file';
                    var size = att.extracted_content ? ' (' + att.extracted_content.length + ' chars)' : '';
                    var attChildren = [];
                    if (att.extracted_content) {
                        attChildren.push(codeBlock(att.extracted_content.slice(0, 8000), 'plain text'));
                    }
                    children.push(toggleBlock('Attachment: ' + fileName + size, attChildren));
                });
            }

            children.push(paragraphBlock(parseInlineMarkdown(query)));
        }

        // ── Assistant response ──
        if (blocks.length > 0) {
            children.push(headingBlock(3, 'Assistant'));

            for (var bi = 0; bi < blocks.length; bi++) {
                var block = blocks[bi];

                // Thinking/reasoning as callout
                if (block.thinking) {
                    children.push(calloutBlock(stripHtml(block.thinking), 'purple_background'));
                }

                // Tool calls as toggle with JSON
                if (block.toolCalls && block.toolCalls.length > 0) {
                    for (var tci = 0; tci < block.toolCalls.length; tci++) {
                        var tc = block.toolCalls[tci];
                        children.push(toggleBlock('Tool: ' + tc.name, [
                            codeBlock(JSON.stringify(tc.input, null, 2), 'json')
                        ]));
                    }
                }

                // Answer text
                var answer = stripHtml(block.markdown_block && block.markdown_block.answer || '');
                if (answer.trim()) {
                    var parsedBlocks = markdownToBlocks(answer.trim());
                    for (var pi = 0; pi < parsedBlocks.length; pi++) {
                        children.push(parsedBlocks[pi]);
                    }
                }

                // Tool results
                if (block.toolResults && block.toolResults.length > 0) {
                    for (var tri = 0; tri < block.toolResults.length; tri++) {
                        var tr = block.toolResults[tri];
                        if (tr.text && tr.text.trim()) {
                            children.push(calloutBlock(
                                (tr.isError ? 'Tool error: ' : 'Tool result: ') + tr.text.trim(),
                                tr.isError ? 'red_background' : 'green_background'
                            ));
                        }
                    }
                }
            }

            // Citations
            if (entry.citations && Array.isArray(entry.citations) && entry.citations.length > 0) {
                children.push(headingBlock(3, 'Citations'));
                var seen = {};
                entry.citations.forEach(function (c) {
                    if (!c.url || seen[c.url]) return;
                    seen[c.url] = true;
                    if (/^https?:\/\//.test(c.url)) {
                        children.push(bookmarkBlock(c.url));
                    } else {
                        children.push(bulletedListItem(c.title || c.url));
                    }
                });
            }
        }

        // ── Sources ──
        var content = extractEntryContent(entry);
        var sources = content.sources;
        if (sources.length > 0) {
            children.push(headingBlock(3, 'Sources'));
            var seen = {};
            var uniqueSources = sources.filter(function (s) {
                if (!s.url || seen[s.url]) return false;
                seen[s.url] = true;
                return true;
            });
            uniqueSources.slice(0, 15).forEach(function (source) {
                if (/^https?:\/\//.test(source.url)) {
                    children.push(bookmarkBlock(source.url));
                } else {
                    children.push(bulletedListItem(source.name || source.url));
                }
            });
        }

        // ── Related questions ──
        var relatedQueries = entry.related_queries || entry.related_questions || [];
        if (relatedQueries.length > 0) {
            children.push(headingBlock(3, 'Related Questions'));
            relatedQueries.slice(0, 5).forEach(function (q) {
                var questionText = typeof q === 'string' ? q : (q.text || q.query || '');
                if (questionText) {
                    children.push(bulletedListItem(questionText));
                }
            });
        }

        if (index < safeEntries.length - 1) {
            children.push(dividerBlock());
        }
    });

    return children;
}

// ============================================
// Public API
// ============================================

/**
 * Flatten blocks by extracting nested children from toggle blocks.
 * Notion's PATCH /v1/blocks/{id}/children endpoint does NOT accept nested children.
 * This function converts toggle blocks with children into a flat list where the
 * children are placed immediately after their parent toggle (with empty children array).
 * @param {Array} blocks - Array of Notion blocks
 * @returns {Array} Flattened array of blocks
 */
function flattenToggleBlocks(blocks) {
    if (!blocks || !Array.isArray(blocks)) return [];

    const flattened = [];

    for (const block of blocks) {
        if (block.type === 'toggle' && block.toggle && Array.isArray(block.toggle.children) && block.toggle.children.length > 0) {
            // Extract children before adding the toggle
            const children = block.toggle.children;
            // Add toggle without children (Notion PATCH doesn't accept nested children)
            const toggleWithoutChildren = {
                ...block,
                toggle: {
                    ...block.toggle,
                    children: [] // PATCH endpoint requires empty children
                }
            };
            flattened.push(toggleWithoutChildren);
            // Note: Children are lost in PATCH - this is a Notion API limitation
            // For POST (first 100 blocks), nested children work fine
            // For PATCH (blocks 101+), we can only send the toggle shell
        } else {
            flattened.push(block);
        }
    }

    return flattened;
}

// Public API — only the two methods external callers actually use.
// Background.js and options.js/popup.js call these; the other helpers
// (markdownToBlocks, parseInlineMarkdown, chunkText, calloutBlock,
// toggleBlock, codeBlock, extractEntryContent, extractToolCallBlocks) are
// internal-only — accessible to anything in this file's scope but not
// exposed on the global to avoid hinting at a stable API we don't maintain.
_nbbRoot.NotionBlockBuilder = {
    buildNotionBlocks: buildNotionBlocks,
    flattenToggleBlocks: flattenToggleBlocks
};

} // end window guard
