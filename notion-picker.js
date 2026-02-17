// OmniExporter AI - Notion Workspace Picker
// Visual workspace/database selector for Notion integration

class NotionPicker {
    static modal = null;
    static workspaces = [];
    static databases = [];
    static selectedWorkspace = null;
    static selectedDatabase = null;
    static isLoading = false;
    static onSelect = null;

    static async show(apiKey, onSelect) {
        this.onSelect = onSelect;
        this.createModal();
        this.showModal();

        await this.loadWorkspaces(apiKey);
    }

    static createModal() {
        // Remove existing modal if any
        this.removeModal();

        this.modal = document.createElement('div');
        this.modal.id = 'notion-picker-modal';
        this.modal.className = 'notion-picker-overlay';
        this.modal.innerHTML = `
            <div class="notion-picker-container">
                <div class="notion-picker-header">
                    <h3>📚 Select Notion Database</h3>
                    <button class="notion-picker-close" id="notion-picker-close">&times;</button>
                </div>
                
                <div class="notion-picker-search">
                    <input type="text" id="notion-picker-search" placeholder="Search databases..." />
                </div>
                
                <div class="notion-picker-content" id="notion-picker-content">
                    <div class="notion-picker-loading">
                        <div class="notion-picker-spinner"></div>
                        <span>Loading databases...</span>
                    </div>
                </div>
                
                <div class="notion-picker-footer">
                    <button class="notion-picker-btn secondary" id="notion-picker-cancel">Cancel</button>
                    <button class="notion-picker-btn primary" id="notion-picker-confirm" disabled>Select</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);
        this.attachEvents();
    }

    static attachEvents() {
        // Close button
        document.getElementById('notion-picker-close')?.addEventListener('click', () => this.hide());
        document.getElementById('notion-picker-cancel')?.addEventListener('click', () => this.hide());

        // Confirm button
        document.getElementById('notion-picker-confirm')?.addEventListener('click', () => this.confirm());

        // Search
        document.getElementById('notion-picker-search')?.addEventListener('input', (e) => {
            this.filterDatabases(e.target.value);
        });

        // Click outside to close
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });

        // Escape key
        document.addEventListener('keydown', this.escapeHandler);
    }

    static escapeHandler = (e) => {
        if (e.key === 'Escape') NotionPicker.hide();
    };

    static async loadWorkspaces(apiKey) {
        this.isLoading = true;
        const content = document.getElementById('notion-picker-content');

        try {
            // Fetch databases from Notion API
            const response = await fetch('https://api.notion.com/v1/search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify({
                    filter: { property: 'object', value: 'database' },
                    page_size: 50
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to fetch databases');
            }

            const data = await response.json();
            this.databases = data.results.map(db => ({
                id: db.id,
                title: this.getDatabaseTitle(db),
                icon: this.getDatabaseIcon(db),
                lastEdited: db.last_edited_time
            }));

            this.renderDatabases(this.databases);
        } catch (error) {
            content.innerHTML = `
                <div class="notion-picker-error">
                    <span class="error-icon">⚠️</span>
                    <p>${error.message}</p>
                    <button class="notion-picker-btn secondary" onclick="NotionPicker.hide()">Close</button>
                </div>
            `;
        } finally {
            this.isLoading = false;
        }
    }

    static getDatabaseTitle(db) {
        const titleProp = db.title || [];
        if (titleProp.length > 0) {
            return titleProp.map(t => t.plain_text || '').join('');
        }
        return 'Untitled Database';
    }

    static getDatabaseIcon(db) {
        if (db.icon?.type === 'emoji') return db.icon.emoji;
        if (db.icon?.type === 'external') return '🔗';
        return '📊';
    }

    static renderDatabases(databases) {
        const content = document.getElementById('notion-picker-content');

        if (databases.length === 0) {
            content.innerHTML = `
                <div class="notion-picker-empty">
                    <span>📭</span>
                    <p>No databases found</p>
                    <small>Make sure your integration has access to at least one database</small>
                </div>
            `;
            return;
        }

        content.innerHTML = `
            <div class="notion-picker-list">
                ${databases.map(db => `
                    <div class="notion-picker-item" data-id="${db.id}" data-title="${db.title}">
                        <span class="item-icon">${db.icon}</span>
                        <div class="item-info">
                            <span class="item-title">${this.escapeHtml(db.title)}</span>
                            <span class="item-id">${db.id.substring(0, 8)}...</span>
                        </div>
                        <div class="item-check">✓</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Add click handlers
        content.querySelectorAll('.notion-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                // Remove previous selection
                content.querySelectorAll('.notion-picker-item').forEach(i => i.classList.remove('selected'));
                // Add selection
                item.classList.add('selected');
                this.selectedDatabase = {
                    id: item.getAttribute('data-id'),
                    title: item.getAttribute('data-title')
                };
                // Enable confirm button
                document.getElementById('notion-picker-confirm').disabled = false;
            });
        });
    }

    static filterDatabases(query) {
        const filtered = this.databases.filter(db =>
            db.title.toLowerCase().includes(query.toLowerCase())
        );
        this.renderDatabases(filtered);
    }

    static confirm() {
        if (this.selectedDatabase && this.onSelect) {
            this.onSelect(this.selectedDatabase);
        }
        this.hide();
    }

    static showModal() {
        if (this.modal) {
            this.modal.classList.add('visible');
        }
    }

    static hide() {
        if (this.modal) {
            this.modal.classList.remove('visible');
            setTimeout(() => this.removeModal(), 200);
        }
        document.removeEventListener('keydown', this.escapeHandler);
    }

    static removeModal() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.NotionPicker = NotionPicker;
}
