// OmniExporter AI - Export Manager
// Export support: Markdown, JSON
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

}
} // end if (!window.ExportManager)

// Export for use in Node.js test environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.ExportManager;
}
