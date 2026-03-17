// OmniExporter AI - Export Manager
// Multi-format export support: Markdown, JSON, HTML, PDF, Plain Text
"use strict";

// REAL-14 FIX: Wrap in window guard to prevent SyntaxError: 'Identifier already declared'
// on SPA re-injection. ExportManager is injected as a content script and re-runs on navigation.
const root = typeof window !== 'undefined' ? window : globalThis;
if (!root.ExportManager) {
root.ExportManager = class ExportManager {
    static formats = {
        markdown: {
            name: 'Markdown',
            extension: '.md',
            mimeType: 'text/markdown',
            icon: '📝'
        },
        json: {
            name: 'JSON',
            extension: '.json',
            mimeType: 'application/json',
            icon: '📊'
        },
        html: {
            name: 'HTML',
            extension: '.html',
            mimeType: 'text/html',
            icon: '🌐'
        },
        txt: {
            name: 'Plain Text',
            extension: '.txt',
            mimeType: 'text/plain',
            icon: '📄'
        },
        pdf: {
            name: 'PDF',
            extension: '.pdf',
            mimeType: 'application/pdf',
            icon: '📕'
        },
        csv: {
            name: 'CSV',
            extension: '.csv',
            mimeType: 'text/csv',
            icon: '📋'
        }
    };

    static export(data, format = 'markdown', platform = 'Unknown') {
        const formatConfig = this.formats[format];
        if (!formatConfig) {
            if (typeof Logger !== 'undefined') Logger.error('Export', 'Unsupported format', { format });
            throw new Error(`Unsupported format: ${format}`);
        }

        if (typeof Logger !== 'undefined') Logger.info('Export', `Exporting as ${format}`, { platform, title: data.title });

        let content;
        switch (format) {
            case 'markdown':
                content = this.toMarkdown(data, platform);
                break;
            case 'json':
                content = this.toJSON(data, platform);
                break;
            case 'html':
                content = this.toHTML(data, platform);
                break;
            case 'txt':
                content = this.toPlainText(data, platform);
                break;
            case 'csv':
                content = this.toCSV(data, platform);
                break;
            case 'pdf':
                return this.toPDF(data, platform);
            default:
                content = this.toMarkdown(data, platform);
        }

        const filename = this.generateFilename(data.title || 'Chat', formatConfig.extension);
        this.downloadFile(content, filename, formatConfig.mimeType);

        if (typeof Logger !== 'undefined') Logger.info('Export', 'Download complete', { filename, format: formatConfig.name });
        return { success: true, filename, format: formatConfig.name };
    }

    // ============================================
    // MARKDOWN FORMAT (WITH PLATFORM LOGOS)
    // ============================================
    static toMarkdown(data, platform) {
        const entries = data.detail?.entries || [];
        const title = data.title || 'Untitled Chat';
        const firstEntry = entries[0] || {};
        const date = firstEntry.updated_datetime
            ? new Date(firstEntry.updated_datetime).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

        // Platform emoji icons
        const platformIcons = {
            'Perplexity': '🧭',
            'ChatGPT': '🤖',
            'Claude': '🎯',
            'Gemini': '✨',
            'Grok': '𝕏',
            'DeepSeek': '🔮'
        };
        const platformIcon = platformIcons[platform] || '💬';

        let md = '---\n';
        md += `title: "${title}"\n`;
        md += `date: ${date}\n`;
        md += `platform: ${platform}\n`;
        md += `uuid: ${data.uuid || 'unknown'}\n`;
        md += `entries: ${entries.length}\n`;
        md += '---\n\n';
        md += `# ${platformIcon} ${title}\n\n`;
        md += `> **Platform:** ${platform} | **Conversations:** ${entries.length} | **Date:** ${date}\n\n`;

        entries.forEach((entry, index) => {
            const query = entry.query || entry.query_str || '';
            if (query) {
                md += `## 🙋 Question ${index + 1}\n\n`;
                md += `${query}\n\n`;
            }

            // Attachments (Claude file uploads)
            const meta = this._extractEntryMeta(entry);
            if (meta.attachments.length > 0) {
                meta.attachments.forEach(att => {
                    const name = att.file_name || att.fileName || 'file';
                    md += `> 📎 **Attachment:** ${name}\n`;
                });
                md += '\n';
            }

            let answer = this.extractAnswer(entry);
            if (answer.trim()) {
                md += `### 🤖 Answer\n\n`;
                md += `${answer.trim()}\n\n`;
            }

            // Sources (from blocks or entry-level)
            if (meta.sources.length > 0) {
                md += `### 📚 Sources\n\n`;
                const seen = {};
                meta.sources.forEach((source, i) => {
                    if (seen[source.url]) return;
                    seen[source.url] = true;
                    const safeUrl = this._sanitizeUrl(source.url);
                    md += `${i + 1}. [${source.title || source.url}](${safeUrl})\n`;
                });
                md += '\n';
            }

            // Knowledge cards
            if (meta.knowledgeCards.length > 0) {
                md += `### 📋 Knowledge Cards\n\n`;
                meta.knowledgeCards.forEach(card => {
                    md += `> **${card.title}**`;
                    if (card.description) md += `: ${card.description}`;
                    md += '\n';
                });
                md += '\n';
            }

            // Media items
            if (meta.media.length > 0) {
                md += `### 🖼️ Media\n\n`;
                meta.media.forEach(m => {
                    const safeUrl = this._sanitizeUrl(m.url);
                    if (safeUrl) md += `![${m.alt || 'Image'}](${safeUrl})\n`;
                });
                md += '\n';
            }

            // Related questions
            if (meta.relatedQuestions.length > 0) {
                md += `### 🔗 Related Questions\n\n`;
                meta.relatedQuestions.slice(0, 5).forEach(q => {
                    if (q) md += `- ${q}\n`;
                });
                md += '\n';
            }

            md += '---\n\n';
        });

        md += `\n*Exported with OmniExporter AI on ${new Date().toLocaleString()}*\n`;
        return md;
    }

    // ============================================
    // JSON FORMAT
    // ============================================
    static toJSON(data, platform) {
        const exportData = {
            meta: {
                exportedAt: new Date().toISOString(),
                platform: platform,
                version: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '5.2.0',
                tool: 'OmniExporter AI'
            },
            conversation: {
                uuid: data.uuid || null,
                title: data.title || 'Untitled Chat',
                spaceName: data.spaceName || null,
                model: data.model || null,
                createdAt: data.detail?.entries?.[0]?.created_datetime || null,
                updatedAt: data.detail?.entries?.[0]?.updated_datetime || null
            },
            entries: (data.detail?.entries || []).map((entry, index) => {
                const entryMeta = this._extractEntryMeta(entry);
                const result = {
                    index: index + 1,
                    query: entry.query || entry.query_str || '',
                    answer: this.extractAnswer(entry),
                    sources: entryMeta.sources,
                    metadata: {
                        createdAt: entry.created_datetime || null,
                        updatedAt: entry.updated_datetime || null,
                        model: entry.display_model || entry.model || null
                    }
                };
                // Include rich content when available
                if (entryMeta.attachments.length > 0) result.attachments = entryMeta.attachments;
                if (entryMeta.media.length > 0) result.media = entryMeta.media;
                if (entryMeta.knowledgeCards.length > 0) result.knowledgeCards = entryMeta.knowledgeCards;
                if (entryMeta.relatedQuestions.length > 0) result.relatedQuestions = entryMeta.relatedQuestions;
                return result;
            })
        };

        return JSON.stringify(exportData, null, 2);
    }

    // ============================================
    // HTML FORMAT (WITH PLATFORM LOGOS)
    // ============================================
    static toHTML(data, platform) {
        const entries = data.detail?.entries || [];
        const title = data.title || 'Untitled Chat';

        // Platform emoji icons
        const platformIcons = {
            'Perplexity': '🧭',
            'ChatGPT': '🤖',
            'Claude': '🎯',
            'Gemini': '✨',
            'Grok': '𝕏',
            'DeepSeek': '🔮'
        };
        const platformIcon = platformIcons[platform] || '💬';

        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(title)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .platform-badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 13px;
            margin-bottom: 12px;
            font-weight: 600;
        }
        .header h1 {
            font-size: 24px;
            margin-bottom: 8px;
        }
        .header .meta {
            opacity: 0.7;
            font-size: 14px;
        }
        .content {
            padding: 30px;
        }
        .entry {
            margin-bottom: 30px;
            padding-bottom: 30px;
            border-bottom: 1px solid #eee;
        }
        .entry:last-child {
            border-bottom: none;
            margin-bottom: 0;
        }
        .question {
            background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
            border-left: 4px solid #3b82f6;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 16px;
        }
        .question-label {
            font-size: 12px;
            color: #3b82f6;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .answer {
            background: #f8fafc;
            padding: 16px;
            border-radius: 8px;
            line-height: 1.6;
        }
        .answer-label {
            font-size: 12px;
            color: #059669;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .sources {
            margin-top: 16px;
            padding: 12px;
            background: #fefce8;
            border-radius: 8px;
        }
        .sources-label {
            font-size: 12px;
            color: #ca8a04;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .sources a {
            color: #2563eb;
            text-decoration: none;
            display: block;
            padding: 4px 0;
        }
        .sources a:hover {
            text-decoration: underline;
        }
        .thinking-block {
            background: #f3e8ff;
            border-left: 4px solid #a855f7;
            padding: 12px 16px;
            border-radius: 8px;
            margin: 12px 0;
            font-style: italic;
            color: #6b21a8;
        }
        .thinking-block summary {
            cursor: pointer;
            font-weight: 600;
            color: #7c3aed;
            font-style: normal;
        }
        .tool-call {
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            padding: 12px 16px;
            border-radius: 8px;
            margin: 12px 0;
        }
        .tool-call summary {
            cursor: pointer;
            font-weight: 600;
            color: #2563eb;
        }
        .tool-result {
            background: #ecfdf5;
            border-left: 4px solid #10b981;
            padding: 12px 16px;
            border-radius: 8px;
            margin: 8px 0;
        }
        .tool-result.error {
            background: #fef2f2;
            border-left-color: #ef4444;
        }
        .code-block {
            background: #1e293b;
            color: #e2e8f0;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 13px;
            line-height: 1.5;
            margin: 12px 0;
        }
        .code-block .lang-label {
            display: block;
            color: #94a3b8;
            font-size: 11px;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .inline-code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 0.9em;
            color: #0f172a;
        }
        .attachment-badge {
            display: inline-block;
            background: #fef3c7;
            border: 1px solid #fbbf24;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 12px;
            margin: 4px 4px 4px 0;
        }
        .knowledge-card {
            background: #f0fdf4;
            border: 1px solid #86efac;
            border-radius: 8px;
            padding: 12px 16px;
            margin: 8px 0;
        }
        .knowledge-card strong { color: #166534; }
        .related-questions {
            margin-top: 12px;
            padding: 12px;
            background: #f8fafc;
            border-radius: 8px;
        }
        .related-questions-label {
            font-size: 12px;
            color: #6366f1;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .related-questions li {
            color: #475569;
            padding: 2px 0;
        }
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8fafc;
            color: #64748b;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="platform-badge">${platformIcon} ${platform}</div>
            <h1>${this.escapeHtml(title)}</h1>
            <div class="meta">${entries.length} exchanges • Exported with OmniExporter AI</div>
        </div>
        <div class="content">`;



        entries.forEach((entry, index) => {
            const query = entry.query || entry.query_str || '';
            const answer = this.extractAnswer(entry);
            const meta = this._extractEntryMeta(entry);

            html += `
            <div class="entry">
                <div class="question">
                    <div class="question-label">🙋 Question ${index + 1}</div>
                    ${this.escapeHtml(query)}
                </div>`;

            // Attachments
            if (meta.attachments.length > 0) {
                meta.attachments.forEach(att => {
                    const name = att.file_name || att.fileName || 'file';
                    html += `<span class="attachment-badge">📎 ${this.escapeHtml(name)}</span>`;
                });
            }

            html += `
                <div class="answer">
                    <div class="answer-label">${platformIcon} Answer</div>
                    <div class="answer-content">${this._markdownToHtml(answer)}</div>
                </div>`;

            // Sources (from blocks or entry-level)
            if (meta.sources.length > 0) {
                html += `
                <div class="sources">
                    <div class="sources-label">📚 Sources</div>`;
                const seen = {};
                meta.sources.forEach((source, i) => {
                    if (seen[source.url]) return;
                    seen[source.url] = true;
                    const safeUrl = this._sanitizeUrl(source.url);
                    html += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${i + 1}. ${this.escapeHtml(source.title || source.url)}</a>`;
                });
                html += `</div>`;
            }

            // Knowledge cards
            if (meta.knowledgeCards.length > 0) {
                meta.knowledgeCards.forEach(card => {
                    html += `<div class="knowledge-card"><strong>${this.escapeHtml(card.title)}</strong>`;
                    if (card.description) html += `<p>${this.escapeHtml(card.description)}</p>`;
                    html += `</div>`;
                });
            }

            // Related questions
            if (meta.relatedQuestions.length > 0) {
                html += `<div class="related-questions"><div class="related-questions-label">🔗 Related Questions</div><ul>`;
                meta.relatedQuestions.slice(0, 5).forEach(q => {
                    if (q) html += `<li>${this.escapeHtml(q)}</li>`;
                });
                html += `</ul></div>`;
            }

            html += `</div>`;
        });

        html += `
        </div>
        <div class="footer">
            Exported with OmniExporter AI on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;

        return html;
    }

    // ============================================
    // PLAIN TEXT FORMAT
    // ============================================
    static toPlainText(data, platform) {
        const entries = data.detail?.entries || [];
        const title = data.title || 'Untitled Chat';
        const divider = '='.repeat(60);

        let txt = `${divider}\n`;
        txt += `${title.toUpperCase()}\n`;
        txt += `${divider}\n`;
        txt += `Platform: ${platform}\n`;
        txt += `Exported: ${new Date().toLocaleString()}\n`;
        txt += `${divider}\n\n`;

        entries.forEach((entry, index) => {
            const query = entry.query || entry.query_str || '';
            const answer = this.extractAnswer(entry);
            const meta = this._extractEntryMeta(entry);

            txt += `[QUESTION ${index + 1}]\n`;
            txt += `${query}\n\n`;

            // Attachments
            if (meta.attachments.length > 0) {
                txt += `[ATTACHMENTS]\n`;
                meta.attachments.forEach(att => {
                    txt += `  📎 ${att.file_name || att.fileName || 'file'}\n`;
                });
                txt += '\n';
            }

            txt += `[ANSWER]\n`;
            txt += `${answer.trim()}\n\n`;

            // Sources (from blocks or entry-level)
            if (meta.sources.length > 0) {
                txt += `[SOURCES]\n`;
                const seen = {};
                meta.sources.forEach((source, i) => {
                    if (seen[source.url]) return;
                    seen[source.url] = true;
                    txt += `  ${i + 1}. ${source.title || 'Link'}: ${source.url}\n`;
                });
                txt += '\n';
            }

            // Knowledge cards
            if (meta.knowledgeCards.length > 0) {
                txt += `[KNOWLEDGE CARDS]\n`;
                meta.knowledgeCards.forEach(card => {
                    txt += `  ${card.title}`;
                    if (card.description) txt += ` - ${card.description}`;
                    txt += '\n';
                });
                txt += '\n';
            }

            // Related questions
            if (meta.relatedQuestions.length > 0) {
                txt += `[RELATED QUESTIONS]\n`;
                meta.relatedQuestions.slice(0, 5).forEach(q => {
                    if (q) txt += `  - ${q}\n`;
                });
                txt += '\n';
            }

            txt += `-`.repeat(40) + '\n\n';
        });

        txt += `\n${divider}\n`;
        txt += `Exported with OmniExporter AI\n`;
        txt += `${divider}\n`;

        return txt;
    }

    // ============================================
    // CSV FORMAT
    // ============================================
    static toCSV(data, platform) {
        const entries = data.detail?.entries || [];
        const title = data.title || 'Untitled Chat';

        // CSV escape: wrap in quotes and double any internal quotes
        const csvEscape = (text) => {
            if (text === null || text === undefined) return '""';
            let str = String(text);
            // Mitigate CSV/Excel formula injection: prefix dangerous leading characters
            if (/^[=+\-@]/.test(str)) {
                str = "'" + str;
            }
            str = str.replace(/"/g, '""');
            return `"${str}"`;
        };

        // Header row
        let csv = '\uFEFF'; // BOM for Excel UTF-8 compat
        csv += 'Index,Platform,Title,Question,Answer,Sources,Model,Date\n';

        entries.forEach((entry, index) => {
            const query = entry.query || entry.query_str || '';
            const answer = this.extractAnswer(entry).replace(/\n+/g, ' ').trim();
            const meta = this._extractEntryMeta(entry);
            const sources = meta.sources.map(s => s.url || s.title || '').join('; ');
            const model = entry.display_model || entry.model || '';
            const date = entry.updated_datetime || entry.created_datetime || '';

            csv += [
                index + 1,
                csvEscape(platform),
                csvEscape(title),
                csvEscape(query),
                csvEscape(answer),
                csvEscape(sources),
                csvEscape(model),
                csvEscape(date)
            ].join(',') + '\n';
        });

        return csv;
    }

    // ============================================
    // PDF FORMAT (Blob-based, no popup required)
    // MISSING-8 FIX: Use Blob URL instead of window.open to avoid popup blockers.
    // ============================================
    static toPDF(data, platform) {
        const html = this.toHTML(data, platform);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);

        // Open the blob URL in a new tab — then the user can Ctrl+P / print from there
        // This avoids the popup blocker hit that window.open('', '_blank') causes
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Revoke after a short delay (allow browser to open the tab)
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        return { success: true, format: 'PDF', note: 'Opened in new tab — use Ctrl+P to print as PDF' };
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    /**
     * Extract the full answer content from a conversation entry.
     * Handles all platform-specific formats:
     *   - Perplexity blocks (ask_text, web_results, media_items, knowledge_cards)
     *   - Claude content blocks (text, tool_use, tool_result, local_resource)
     *   - DeepSeek thinking blocks (<think> tags, thinking/reasoning fragments)
     *   - ChatGPT multimodal_text, file_asset_pointer, code interpreter
     *   - Generic answer/text fallback
     */
    static extractAnswer(entry) {
        let answer = '';

        // Handle Perplexity/Claude block-based entries
        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                // ask_text blocks contain the main answer markdown
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    if (block.markdown_block.answer) {
                        answer += block.markdown_block.answer + '\n\n';
                    } else if (block.markdown_block.chunks) {
                        answer += block.markdown_block.chunks.join('\n') + '\n\n';
                    }
                }
                // Generic markdown_block without intended_usage (some platforms)
                if (!block.intended_usage && block.markdown_block) {
                    const content = block.markdown_block.answer || (block.markdown_block.chunks || []).join('\n') || '';
                    if (content) answer += content + '\n\n';
                }
            });
        }

        if (!answer.trim()) {
            answer = entry.answer || entry.text || '';
        }

        return answer;
    }

    /**
     * Extract rich metadata from an entry, including:
     *   - sources/citations
     *   - media items (images, videos)
     *   - knowledge cards
     *   - related questions
     *   - attachments
     * Returns { sources, media, knowledgeCards, relatedQuestions, attachments }
     */
    static _extractEntryMeta(entry) {
        const meta = {
            sources: [],
            media: [],
            knowledgeCards: [],
            relatedQuestions: [],
            attachments: []
        };

        // Sources from blocks (Perplexity web_results)
        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block.intended_usage === 'web_results' && block.web_result_block) {
                    const webResults = block.web_result_block.web_results || [];
                    webResults.forEach(wr => {
                        if (wr.url) {
                            meta.sources.push({ url: wr.url, title: wr.name || wr.title || wr.url });
                        }
                    });
                }
                // Perplexity media_items
                if (block.intended_usage === 'media_items' && block.media_items_block) {
                    (block.media_items_block.media_items || []).forEach(item => {
                        meta.media.push({
                            type: item.type || 'image',
                            url: item.url || item.image_url || '',
                            alt: item.alt || item.title || ''
                        });
                    });
                }
                // Perplexity knowledge_cards
                if (block.intended_usage === 'knowledge_cards' && block.knowledge_card_block) {
                    (block.knowledge_card_block.cards || [block.knowledge_card_block]).forEach(card => {
                        meta.knowledgeCards.push({
                            title: card.title || card.name || '',
                            description: card.description || card.snippet || '',
                            url: card.url || ''
                        });
                    });
                }
            });
        }

        // Entry-level sources
        if (meta.sources.length === 0 && entry.sources && Array.isArray(entry.sources)) {
            meta.sources = entry.sources.map(s => ({ url: s.url || '', title: s.title || s.name || s.url || '' }));
        }

        // Citations (Gemini, generic)
        if (meta.sources.length === 0 && entry.citations && Array.isArray(entry.citations)) {
            meta.sources = entry.citations.map(s =>
                typeof s === 'string' ? { url: s, title: s } : { url: s.url || '', title: s.title || s.name || s.url || '' }
            );
        }

        // Related questions
        const relQ = entry.related_queries || entry.related_questions || [];
        if (relQ.length > 0) {
            meta.relatedQuestions = relQ.map(q => typeof q === 'string' ? q : (q.text || q.query || ''));
        }

        // Attachments (Claude)
        if (entry.attachments && Array.isArray(entry.attachments)) {
            meta.attachments = entry.attachments.filter(a => a.file_name || a.fileName || a.extracted_content);
        }

        return meta;
    }

    static generateFilename(title, extension) {
        // MIN-4 FIX: Only strip filesystem-illegal characters, preserve unicode (CJK, Arabic, accents etc.)
        const sanitized = title
            .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_') // Only actual filesystem-illegal chars
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')                  // Collapse consecutive underscores
            .replace(/^_|_$/g, '')                   // Trim leading/trailing underscores
            .substring(0, 80)                        // Slightly longer to allow for unicode richness
            || 'export';
        const timestamp = new Date().toISOString().slice(0, 10);
        return `${sanitized}_${timestamp}${extension}`;
    }

    static downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Sanitize URL to prevent javascript: and data: injection in href attributes.
     * Only allows http: and https: protocols.
     */
    static _sanitizeUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        // Only allow http(s) URLs — block javascript:, data:, vbscript:, etc.
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        // Relative URLs are safe
        if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
        return '';
    }

    // ============================================
    // Minimal inline markdown-to-HTML converter
    // No external dependencies — handles the most common markdown patterns in AI responses.
    // Supports: fenced code, inline code, bold, italic, headings, lists,
    //           thinking blocks (💭), tool_call fenced blocks, blockquotes
    // ============================================
    static _markdownToHtml(text) {
        if (!text) return '';
        let html = this.escapeHtml(text); // Start HTML-safe

        // Extract fenced code blocks and replace them with placeholders
        const codeBlocks = [];
        // Handle tool_call:name fenced blocks → collapsible detail element
        html = html.replace(/```tool_call:([^\n]*)\n([\s\S]*?)```/g, (_, toolName, body) => {
            const index = codeBlocks.length;
            const placeholder = `::CODEBLOCK_${index}::`;
            const name = toolName.trim() || 'unknown';
            codeBlocks.push(
                `<details class="tool-call"><summary>🔧 Tool: ${name}</summary>` +
                `<pre class="code-block"><span class="lang-label">json</span><code>${body.trimEnd()}</code></pre></details>`
            );
            return placeholder;
        });

        // Standard fenced code blocks with optional language label
        html = html.replace(/```(\S*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const index = codeBlocks.length;
            const placeholder = `::CODEBLOCK_${index}::`;
            const langLabel = lang ? `<span class="lang-label">${lang}</span>` : '';
            codeBlocks.push(`<pre class="code-block">${langLabel}<code>${code.trimEnd()}</code></pre>`);
            return placeholder;
        });

        // BUG-8 FIX: Extract block elements before wrapping in <p> to avoid invalid HTML
        const blockElements = [];

        // Handle thinking blocks: > 💭 **Thinking:** → collapsible <details>
        html = html.replace(/(?:^|\n)(?:&gt; 💭[\s\S]*?)(?=\n[^&]|\n$|$)/gm, (block) => {
            const index = blockElements.length;
            const placeholder = `::BLOCK_${index}::`;
            const lines = block.split('\n').map(l => l.replace(/^&gt;\s?/, ''));
            const content = lines.join('\n').replace(/💭\s*\*\*Thinking:\*\*\s*/, '');
            blockElements.push(`<details class="thinking-block"><summary>💭 Thinking</summary><p>${content.trim()}</p></details>`);
            return `\n${placeholder}\n`;
        });

        // Handle tool result blocks: > **Tool result:** → styled div
        html = html.replace(/(?:^|\n)(?:&gt; \*\*Tool (result|error):\*\*[\s\S]*?)(?=\n[^&]|\n$|$)/gm, (block, type) => {
            const index = blockElements.length;
            const placeholder = `::BLOCK_${index}::`;
            const lines = block.split('\n').map(l => l.replace(/^&gt;\s?/, ''));
            const content = lines.join('\n').replace(/\*\*Tool (result|error):\*\*\s*/, '');
            const cls = type === 'error' ? 'tool-result error' : 'tool-result';
            const icon = type === 'error' ? '❌' : '✅';
            blockElements.push(`<div class="${cls}">${icon} ${content.trim()}</div>`);
            return `\n${placeholder}\n`;
        });

        // Inline code
        html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

        // Bold (**text** or __text__)
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

        // Italic (*text* or _text_)
        html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');

        // Headings (h1-h3)
        html = html.replace(/^### ([^\n]+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## ([^\n]+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# ([^\n]+)$/gm, '<h1>$1</h1>');

        // Lists (ordered and unordered) - process line by line
        const lines = html.split('\n');
        const processedLines = [];
        let currentListType = null; // 'ol', 'ul', or null

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip placeholder lines
            if (line.trim().match(/^::(?:CODEBLOCK|BLOCK)_\d+::$/)) {
                // Close any open list before block element
                if (currentListType === 'ul') {
                    processedLines.push('</ul>');
                    currentListType = null;
                } else if (currentListType === 'ol') {
                    processedLines.push('</ol>');
                    currentListType = null;
                }
                processedLines.push(line);
                continue;
            }

            let match = line.match(/^(\d+)\. (.+)$/); // ordered list
            if (match) {
                if (currentListType !== 'ol') {
                    if (currentListType === 'ul') {
                        processedLines.push('</ul>');
                    }
                    processedLines.push('<ol>');
                    currentListType = 'ol';
                }
                processedLines.push(`<li>${match[2]}</li>`);
                continue;
            }

            match = line.match(/^[\-*] (.+)$/); // unordered list
            if (match) {
                if (currentListType !== 'ul') {
                    if (currentListType === 'ol') {
                        processedLines.push('</ol>');
                    }
                    processedLines.push('<ul>');
                    currentListType = 'ul';
                }
                processedLines.push(`<li>${match[1]}</li>`);
                continue;
            }

            // Not a list line; close any open list
            if (currentListType === 'ul') {
                processedLines.push('</ul>');
                currentListType = null;
            } else if (currentListType === 'ol') {
                processedLines.push('</ol>');
                currentListType = null;
            }

            processedLines.push(line);
        }

        // Close any remaining open list
        if (currentListType === 'ul') {
            processedLines.push('</ul>');
        } else if (currentListType === 'ol') {
            processedLines.push('</ol>');
        }

        html = processedLines.join('\n');

        // BUG-8 FIX: Don't wrap block element placeholders in <p> tags
        // Split by block placeholders and process each segment
        const segments = html.split(/(::(?:CODEBLOCK|BLOCK)_\d+::)/);
        const finalSegments = segments.map((segment, idx) => {
            // Even indices are content, odd indices are placeholders
            if (segment.match(/^::(?:CODEBLOCK|BLOCK)_\d+::$/)) {
                // This is a placeholder - don't wrap in <p>
                return segment;
            }

            // This is content - wrap in <p> and handle breaks
            let content = segment;

            // Skip empty segments
            if (!content.trim()) return '';

            // Wrap in paragraph
            content = `<p>${content}</p>`;

            // Paragraph breaks (double newline not inside pre/ul/li)
            content = content.replace(/([^>])\n\n([^<])/g, '$1</p><p>$2');

            // Single line breaks -> <br>
            content = content.replace(/([^>\n])\n([^<\n])/g, '$1<br>$2');

            return content;
        });

        html = finalSegments.join('');

        // Restore fenced code blocks
        codeBlocks.forEach((block, index) => {
            const placeholder = `::CODEBLOCK_${index}::`;
            html = html.replace(placeholder, block);
        });

        // Restore block elements
        blockElements.forEach((block, index) => {
            const placeholder = `::BLOCK_${index}::`;
            html = html.replace(placeholder, block);
        });

        return html;
    }
}
} // end if (!window.ExportManager)

// Export for use in Node.js test environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.ExportManager;
}
