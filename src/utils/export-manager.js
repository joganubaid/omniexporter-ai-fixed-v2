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

            let answer = this.extractAnswer(entry);
            if (answer.trim()) {
                md += `### 🤖 Answer\n\n`;
                md += `${answer.trim()}\n\n`;
            }

            // Add sources if available
            if (entry.sources && entry.sources.length > 0) {
                md += `### 📚 Sources\n\n`;
                entry.sources.forEach((source, i) => {
                    const safeUrl = this._sanitizeUrl(source.url);
                    md += `${i + 1}. [${source.title || source.url}](${safeUrl})\n`;
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
                version: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '5.2.0', // Missing 32 fix: use manifest version
                tool: 'OmniExporter AI'
            },
            conversation: {
                uuid: data.uuid || null,
                title: data.title || 'Untitled Chat',
                spaceName: data.spaceName || null,
                createdAt: data.detail?.entries?.[0]?.created_datetime || null,
                updatedAt: data.detail?.entries?.[0]?.updated_datetime || null
            },
            entries: (data.detail?.entries || []).map((entry, index) => ({
                index: index + 1,
                query: entry.query || entry.query_str || '',
                answer: this.extractAnswer(entry),
                sources: entry.sources || [],
                metadata: {
                    createdAt: entry.created_datetime || null,
                    updatedAt: entry.updated_datetime || null
                }
            }))
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

            html += `
            <div class="entry">
                <div class="question">
                    <div class="question-label">🙋 Question ${index + 1}</div>
                    ${this.escapeHtml(query)}
                </div>
                <div class="answer">
                    <div class="answer-label">${platformIcon} Answer</div>
                    <div class="answer-content">${this._markdownToHtml(answer)}</div>
                </div>`;

            if (entry.sources && entry.sources.length > 0) {
                html += `
                <div class="sources">
                    <div class="sources-label">📚 Sources</div>`;
                entry.sources.forEach((source, i) => {
                    // SEC: Sanitize URL to prevent javascript: injection in href
                    const safeUrl = this._sanitizeUrl(source.url);
                    html += `<a href="${this.escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${i + 1}. ${this.escapeHtml(source.title || source.url)}</a>`;
                });
                html += `</div>`;
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

            txt += `[QUESTION ${index + 1}]\n`;
            txt += `${query}\n\n`;
            txt += `[ANSWER]\n`;
            txt += `${answer.trim()}\n\n`;

            if (entry.sources && entry.sources.length > 0) {
                txt += `[SOURCES]\n`;
                entry.sources.forEach((source, i) => {
                    txt += `  ${i + 1}. ${source.title || 'Link'}: ${source.url}\n`;
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
    static extractAnswer(entry) {
        let answer = '';

        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block.intended_usage === 'ask_text' && block.markdown_block) {
                    if (block.markdown_block.answer) {
                        answer += block.markdown_block.answer + '\n\n';
                    } else if (block.markdown_block.chunks) {
                        answer += block.markdown_block.chunks.join('\n') + '\n\n';
                    }
                }
            });
        }

        if (!answer.trim()) {
            answer = entry.answer || entry.text || '';
        }

        return answer;
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
    // MISSING-1: Minimal inline markdown-to-HTML converter
    // No external dependencies — handles the most common markdown patterns in AI responses.
    // ============================================
    static _markdownToHtml(text) {
        if (!text) return '';
        let html = this.escapeHtml(text); // Start HTML-safe

        // Extract fenced code blocks and replace them with placeholders
        const codeBlocks = [];
        html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
            const index = codeBlocks.length;
            const placeholder = `::CODEBLOCK_${index}::`;
            codeBlocks.push(`<pre class="code-block"><code>${code.trimEnd()}</code></pre>`);
            return placeholder;
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

        // Wrap entire content in a paragraph so inserted breaks are well-formed
        html = `<p>${html}</p>`;

        // Paragraph breaks (double newline not inside pre/ul/li)
        html = html.replace(/([^>])\n\n([^<])/g, '$1</p><p>$2');

        // Single line breaks -> <br>
        html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br>$2');

        // Restore fenced code blocks
        codeBlocks.forEach((block, index) => {
            const placeholder = `::CODEBLOCK_${index}::`;
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
