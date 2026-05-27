// OmniExporter AI - Export Manager
// Export support: Markdown, JSON
"use strict";

// Wrap in window guard to prevent SyntaxError: 'Identifier already declared'
// on SPA re-injection. ExportManager is injected as a content script and re-runs on navigation.
var root = typeof window !== 'undefined' ? window : globalThis;
if (!root.ExportManager) {
root.ExportManager = class ExportManager {
    static formats = {
        markdown: {
            name: 'Markdown',
            extension: '.md',
            mimeType: 'text/markdown'
        },
        json: {
            name: 'JSON',
            extension: '.json',
            mimeType: 'application/json'
        }
    };

    static _stripHtml(text) {
        return text ? text.replace(/<[^>]+>/g, '') : '';
    }

    // YAML-safe scalar: double-quoted with internal " and \ escaped, newlines collapsed.
    // Keeps frontmatter parseable for titles containing quotes, colons, or unicode.
    static _yamlString(value) {
        if (value == null) return '""';
        const s = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
        return `"${s}"`;
    }

    // True for plain-text URLs that look like images (common image suffixes or
    // known image-host hostnames). Used to surface image attachments inline.
    static _looksLikeImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(url);
    }

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
    // MARKDOWN EXPORT — Linear narrative format
    // ============================================
    static toMarkdown(data, platform) {
        const entries = data.detail?.entries || [];
        const title = data.title || 'Untitled Chat';
        const firstEntry = entries[0] || {};
        const date = firstEntry.updated_datetime
            ? new Date(firstEntry.updated_datetime).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
        const model = data.detail?.model || data.model || null;

        // Count tagged metadata across all turns for the frontmatter summary
        const allMeta = entries.map(e => this._extractEntryMeta(e));
        const totalSources = allMeta.reduce((sum, m) => sum + m.sources.length, 0);
        const totalAttachments = allMeta.reduce((sum, m) => sum + m.attachments.length, 0);
        const totalMedia = allMeta.reduce((sum, m) => sum + m.media.length, 0);

        let md = '---\n';
        md += `title: ${this._yamlString(title)}\n`;
        md += `date: ${date}\n`;
        md += `platform: ${this._yamlString(platform)}\n`;
        md += `uuid: ${this._yamlString(data.uuid || 'unknown')}\n`;
        md += `entries: ${entries.length}\n`;
        if (model) md += `model: ${this._yamlString(model)}\n`;
        if (totalSources > 0) md += `sources: ${totalSources}\n`;
        if (totalAttachments > 0) md += `attachments: ${totalAttachments}\n`;
        if (totalMedia > 0) md += `media: ${totalMedia}\n`;
        md += `tags: [chat, ${platform.toLowerCase()}]\n`;
        md += '---\n\n';
        md += `# ${title}\n\n`;
        md += `**Platform:** ${platform} | **Conversations:** ${entries.length} | **Date:** ${date}\n`;
        if (model) md += `**Model:** ${model}\n`;
        md += '\n';

        entries.forEach((entry, index) => {
            const query = entry.query || entry.query_str || '';
            const meta = entries.length === allMeta.length ? allMeta[index] : this._extractEntryMeta(entry);
            const turnDate = entry.updated_datetime || entry.created_datetime || null;

            md += `---\n\n`;
            md += `## Turn ${index + 1}`;
            if (turnDate) {
                try {
                    md += ` — *${new Date(turnDate).toISOString().replace('T', ' ').slice(0, 19)} UTC*`;
                } catch (_) { /* ignore bad dates */ }
            }
            md += `\n\n`;

            // === User message ===
            if (query || meta.attachments.length > 0) {
                md += `### User\n\n`;
                // Attachments — inline-render images, collapsible-render extracted text
                if (meta.attachments.length > 0) {
                    meta.attachments.forEach(att => {
                        const name = att.file_name || att.fileName || 'file';
                        const url = att.url || att.fileUrl || att.preview_url || '';
                        const safeUrl = this._sanitizeUrl(url);

                        if (safeUrl && this._looksLikeImageUrl(safeUrl)) {
                            md += `![${name}](${safeUrl})\n\n`;
                        } else if (att.extracted_content) {
                            // Use ~~~ fence when content already contains ``` to avoid breaking out
                            const fence = att.extracted_content.includes('```') ? '~~~' : '```';
                            md += `<details>\n<summary><strong>Attachment: ${name}</strong> (${att.extracted_content.length} chars)</summary>\n\n`;
                            md += `${fence}\n${att.extracted_content}\n${fence}\n\n`;
                            md += `</details>\n\n`;
                        } else {
                            md += `> *Attachment: ${name}*`;
                            if (safeUrl) md += ` — [link](${safeUrl})`;
                            md += '\n\n';
                        }
                    });
                }
                if (query) md += `${query}\n\n`;
            }

            // === Assistant response ===
            const blocks = entry.blocks || [];
            if (blocks.length > 0) {
                md += `### Assistant\n\n`;

                for (const block of blocks) {
                    // Thinking/reasoning
                    if (block.thinking) {
                        const thinkLines = block.thinking.trim().split('\n');
                        md += thinkLines.map(l => `> *${l}*`).join('\n') + '\n\n';
                    }

                    // Tool calls (collapsible)
                    if (block.toolCalls && block.toolCalls.length > 0) {
                        for (const tc of block.toolCalls) {
                            md += `<details>\n<summary><strong>Tool: ${tc.name}</strong></summary>\n\n`;
                            md += '```json\n' + JSON.stringify(tc.input, null, 2) + '\n```\n\n';
                            md += `</details>\n\n`;
                        }
                    }

                    // Answer text
                    const answer = ExportManager._stripHtml(block.markdown_block?.answer || '');
                    if (answer.trim()) {
                        md += `${answer.trim()}\n\n`;
                    }

                    // Tool results (collapsible)
                    if (block.toolResults && block.toolResults.length > 0) {
                        for (const tr of block.toolResults) {
                            const trText = ExportManager._stripHtml(tr.text);
                            if (trText.trim()) {
                                const resultBody = trText.trim().split('\n').join('\n> ');
                                if (tr.isError) {
                                    md += `<details>\n<summary><strong>Tool error</strong></summary>\n\n> ${resultBody}\n\n</details>\n\n`;
                                } else {
                                    md += `<details>\n<summary><strong>Tool result</strong></summary>\n\n> ${resultBody}\n\n</details>\n\n`;
                                }
                            }
                        }
                    }
                }

                // Citations (from Claude API)
                if (entry.citations && entry.citations.length > 0) {
                    md += '**Citations:**\n\n';
                    const seen = {};
                    entry.citations.forEach(c => {
                        if (!c.url || seen[c.url]) return;
                        seen[c.url] = true;
                        const safeUrl = this._sanitizeUrl(c.url);
                        if (safeUrl) md += `- [${c.title || c.url}](${safeUrl})\n`;
                    });
                    md += '\n';
                }
            }

            // Sources (from blocks or entry-level, not already shown as citations)
            if (meta.sources.length > 0) {
                md += '**Sources:**\n\n';
                const seen = {};
                meta.sources.forEach((source, i) => {
                    if (seen[source.url]) return;
                    seen[source.url] = true;
                    const safeUrl = this._sanitizeUrl(source.url);
                    if (safeUrl) md += `${i + 1}. [${source.title || source.url}](${safeUrl})\n`;
                });
                md += '\n';
            }

            // Knowledge cards
            if (meta.knowledgeCards.length > 0) {
                md += '**Knowledge Cards:**\n\n';
                meta.knowledgeCards.forEach(card => {
                    md += `> **${card.title}**`;
                    if (card.description) md += `: ${card.description}`;
                    md += '\n';
                });
                md += '\n';
            }

            // Media items
            if (meta.media.length > 0) {
                md += '**Media:**\n\n';
                meta.media.forEach(m => {
                    const safeUrl = this._sanitizeUrl(m.url);
                    if (safeUrl) md += `![${m.alt || 'Image'}](${safeUrl})\n`;
                });
                md += '\n';
            }

            // Related questions
            if (meta.relatedQuestions.length > 0) {
                md += '**Related Questions:**\n\n';
                meta.relatedQuestions.slice(0, 5).forEach(q => {
                    if (q) md += `- ${q}\n`;
                });
                md += '\n';
            }
        });

        md += `---\n\n*Exported with OmniExporter AI on ${new Date().toISOString()}*\n`;
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
                version: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || 'unknown',
                tool: 'OmniExporter AI'
            },
            conversation: {
                uuid: data.uuid || null,
                title: data.title || 'Untitled Chat',
                settings: data.detail?.settings || null,
                project_uuid: data.detail?.project_uuid || null,
                model: data.model || data.detail?.model || null,
                createdAt: data.detail?.created_at || data.detail?.entries?.[0]?.created_datetime || null,
                updatedAt: data.detail?.updated_at || data.detail?.entries?.[0]?.updated_datetime || null
            },
            entries: (data.detail?.entries || []).map((entry, index) => {
                const entryMeta = this._extractEntryMeta(entry);
                const answer = this.extractAnswer(entry);
                const blocks = (entry.blocks || []).map(b => {
                    const blockData = { answer: ExportManager._stripHtml(b.markdown_block?.answer || '') };
                    if (b.thinking) blockData.thinking = ExportManager._stripHtml(b.thinking);
                    if (b.toolCalls) blockData.toolCalls = b.toolCalls;
                    if (b.toolResults) blockData.toolResults = b.toolResults;
                    return blockData;
                });
                const result = {
                    turn: index + 1,
                    query: entry.query || entry.query_str || '',
                    blocks,
                    answer,
                    sources: entryMeta.sources,
                    citations: entry.citations || [],
                    metadata: {
                        createdAt: entry.created_datetime || null,
                        updatedAt: entry.updated_datetime || null,
                        model: entry.display_model || entry.model || null
                    }
                };
                if (entry.artifactIds && entry.artifactIds.length > 0) result.artifactIds = entry.artifactIds;
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

        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block.thinking) {
                    answer += `> *${ExportManager._stripHtml(block.thinking).trim()}*\n\n`;
                }
                if (block.toolCalls && block.toolCalls.length > 0) {
                    for (const tc of block.toolCalls) {
                        answer += `<details>\n<summary><strong>Tool: ${tc.name}</strong></summary>\n\n\`\`\`json\n${JSON.stringify(tc.input, null, 2)}\n\`\`\`\n\n</details>\n\n`;
                    }
                }
                if (block.markdown_block) {
                    if (block.markdown_block.answer) {
                        answer += ExportManager._stripHtml(block.markdown_block.answer) + '\n\n';
                    } else if (block.markdown_block.chunks) {
                        answer += ExportManager._stripHtml(block.markdown_block.chunks.join('\n')) + '\n\n';
                    }
                }
                if (block.toolResults && block.toolResults.length > 0) {
                    for (const tr of block.toolResults) {
                        const text = ExportManager._stripHtml(tr.text);
                        if (text.trim()) {
                            const resultBody = text.trim().split('\n').join('\n> ');
                            if (tr.isError) {
                                answer += `<details>\n<summary><strong>Tool error</strong></summary>\n\n> ${resultBody}\n\n</details>\n\n`;
                            } else {
                                answer += `<details>\n<summary><strong>Tool result</strong></summary>\n\n> ${resultBody}\n\n</details>\n\n`;
                            }
                        }
                    }
                }
                if (!block.intended_usage && block.markdown_block) {
                    const content = ExportManager._stripHtml(block.markdown_block.answer || (block.markdown_block.chunks || []).join('\n') || '');
                    if (content) answer += content + '\n\n';
                }
            });
        }

        if (!answer.trim()) {
            answer = ExportManager._stripHtml(entry.answer || entry.text || '');
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

        // Citations (Claude/HAR-verified)
        if (entry.citations && Array.isArray(entry.citations)) {
            meta.sources = entry.citations.map(c => ({
                url: c.url || '',
                title: c.title || c.name || c.url || ''
            })).filter(c => c.url);
        }

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
// ExportManager is attached to window inside the block above; popup/options
// pages access it via the global. No CommonJS shim — the extension is never
// `require()`'d.
