// OmniExporter AI - Notion Block Builder
// Converts markdown content and structured conversation data into rich Notion API blocks.
"use strict";

const _nbbRoot = typeof window !== 'undefined' ? window : globalThis;
if (!_nbbRoot.NotionBlockBuilder) {

/**
 * Maximum characters allowed per rich_text content field by the Notion API.
 * @const {number}
 */
const NOTION_TEXT_LIMIT = 2000;

/**
 * Platform display icons, matching the convention in export-manager.js.
 * @const {Object<string, string>}
 */
const PLATFORM_ICONS = {
    'Perplexity': '🧭',
    'ChatGPT': '🤖',
    'Claude': '🎯',
    'Gemini': '✨',
    'Grok': '𝕏',
    'DeepSeek': '🔮'
};

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
    // Bold (**) before italic (*). Italic requires non-space after opening
    // and before closing * to avoid false matches on list markers like "* item".
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

function calloutBlock(text, emoji, color) {
    return {
        type: 'callout',
        callout: {
            icon: { emoji: emoji || 'ℹ️' },
            color: color || 'gray_background',
            rich_text: plainRichText(text.slice(0, NOTION_TEXT_LIMIT))
        }
    };
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
            rich_text: plainRichText(summaryText.slice(0, NOTION_TEXT_LIMIT)),
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

            // Detect thinking/reasoning callout: > 💭 **Thinking:**
            if (quoteContent.startsWith('💭')) {
                const thinkLines = [quoteContent];
                i++;
                while (i < lines.length && lines[i].startsWith('> ')) {
                    thinkLines.push(lines[i].slice(2));
                    i++;
                }
                blocks.push(calloutBlock(thinkLines.join('\n'), '💭', 'purple_background'));
                continue;
            }

            // Detect tool result: > **Tool result:**
            if (/^\*\*Tool (result|error)/.test(quoteContent)) {
                const resultLines = [quoteContent.replace(/^\*\*Tool (result|error):\*\*\s*/, '')];
                i++;
                while (i < lines.length && lines[i].startsWith('> ')) {
                    resultLines.push(lines[i].slice(2));
                    i++;
                }
                const isError = /^\*\*Tool error/.test(quoteContent);
                blocks.push(calloutBlock(resultLines.join('\n'), isError ? '❌' : '✅', isError ? 'red_background' : 'green_background'));
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

        // Default: paragraph with inline markdown
        blocks.push(paragraphBlock(parseInlineMarkdown(line)));
        i++;
    }

    return blocks;
}

// ============================================
// Tool-call block parser
// ============================================

/**
 * Detect and convert tool_call fenced code blocks into toggle blocks.
 * Tool calls in the markdown are formatted as:
 *   ```tool_call:tool_name
 *   { json input }
 *   ```
 * This function extracts them before general markdown parsing.
 *
 * @param {string} markdown
 * @returns {{ cleaned: string, toolBlocks: Array<Object> }}
 */
function extractToolCallBlocks(markdown) {
    if (!markdown) return { cleaned: '', toolBlocks: [] };

    const toolBlocks = [];
    const cleaned = markdown.replace(
        /```tool_call:([^\n]*)\n([\s\S]*?)```/g,
        function (_, toolName, body) {
            const name = toolName.trim() || 'unknown';
            toolBlocks.push(
                toggleBlock('🔧 Tool: ' + name, [
                    codeBlock(body.trim(), 'json')
                ])
            );
            return ''; // remove from markdown so it isn't double-parsed
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
            if (block.intended_usage === 'ask_text' && block.markdown_block) {
                if (block.markdown_block.answer) {
                    answer += block.markdown_block.answer + '\n\n';
                } else if (block.markdown_block.chunks && Array.isArray(block.markdown_block.chunks)) {
                    answer += block.markdown_block.chunks.join('\n') + '\n\n';
                }
            }
            // Generic markdown_block without intended_usage (some platforms)
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

    // Merge entry-level sources
    if (sources.length === 0 && entry.sources && Array.isArray(entry.sources)) {
        sources = entry.sources.map(function (s) {
            return { url: s.url || '', name: s.name || s.title || s.url || '' };
        });
    }
    if (sources.length === 0 && entry.citations && Array.isArray(entry.citations)) {
        sources = entry.citations.map(function (s) {
            return typeof s === 'string' ? { url: s, name: s } : { url: s.url || '', name: s.name || s.title || s.url || '' };
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
    var platformIcon = PLATFORM_ICONS[platform] || '💬';
    var exportDate = meta.exportDate || new Date().toISOString().split('T')[0];
    var modelLabel = meta.model ? ' | Model: ' + meta.model : '';

    // ── Metadata callout ──
    children.push(calloutBlock(
        platformIcon + ' Exported from ' + (platform || 'AI') + modelLabel + ' | ' + exportDate,
        '🤖',
        'blue_background'
    ));

    children.push(dividerBlock());

    // ── Process each entry ──
    var safeEntries = Array.isArray(entries) ? entries : [];
    safeEntries.forEach(function (entry, index) {
        // ── Question heading ──
        var query = entry.query || entry.query_str || entry.question || entry.prompt || '';
        if (query) {
            children.push(headingBlock(2, '🙋 ' + query));
        }

        // ── Attachments (as toggle blocks) ──
        if (entry.attachments && Array.isArray(entry.attachments)) {
            entry.attachments.forEach(function (att) {
                var fileName = att.file_name || att.fileName || 'file';
                var size = att.extracted_content ? ' (' + att.extracted_content.length + ' chars)' : '';
                var attChildren = [];
                if (att.extracted_content) {
                    attChildren.push(codeBlock(att.extracted_content.slice(0, 8000), 'plain text'));
                }
                children.push(toggleBlock('📎 ' + fileName + size, attChildren));
            });
        }

        // ── Extract answer and sources ──
        var content = extractEntryContent(entry);
        var answer = content.answer;
        var sources = content.sources;

        if (answer) {
            // ── Answer header ──
            children.push(headingBlock(3, '🤖 Answer'));

            // ── Extract tool_call blocks before markdown parsing ──
            var extracted = extractToolCallBlocks(answer);
            var cleanedAnswer = extracted.cleaned;
            var toolBlocks = extracted.toolBlocks;

            // ── Parse markdown into rich Notion blocks ──
            var answerBlocks = markdownToBlocks(cleanedAnswer);
            answerBlocks.forEach(function (block) { children.push(block); });

            // ── Append tool_call toggle blocks ──
            toolBlocks.forEach(function (block) { children.push(block); });
        }

        // ── Sources ──
        if (sources.length > 0) {
            children.push(headingBlock(3, '📚 Sources'));

            // Deduplicate by URL
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
            children.push(headingBlock(3, '🔗 Related Questions'));
            relatedQueries.slice(0, 5).forEach(function (q) {
                var questionText = typeof q === 'string' ? q : (q.text || q.query || '');
                if (questionText) {
                    children.push(bulletedListItem(questionText));
                }
            });
        }

        // ── Divider between entries ──
        if (index < safeEntries.length - 1) {
            children.push(dividerBlock());
        }
    });

    return children;
}

// ============================================
// Public API
// ============================================

_nbbRoot.NotionBlockBuilder = {
    buildNotionBlocks: buildNotionBlocks,
    // Expose internals for unit testing / reuse
    markdownToBlocks: markdownToBlocks,
    parseInlineMarkdown: parseInlineMarkdown,
    chunkText: chunkText,
    extractEntryContent: extractEntryContent,
    extractToolCallBlocks: extractToolCallBlocks
};

} // end window guard
