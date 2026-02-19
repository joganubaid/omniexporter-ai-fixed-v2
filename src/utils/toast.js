// OmniExporter AI - Toast Notification System
// Lightweight toast notifications for user feedback

class Toast {
    static container = null;
    static toasts = new Map();
    static counter = 0;

    static init() {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.id = 'omni-toast-container';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
    }

    static create(message, type = 'info', duration = 3000) {
        this.init();

        const id = ++this.counter;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('data-toast-id', id);

        // Icon based on type
        const icons = {
            success: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>`,
            error: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>`,
            info: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>`,
            loading: `<svg class="toast-spinner" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
            </svg>`,
            warning: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>`
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-message">${this.escapeHtml(message)}</div>
            ${type !== 'loading' ? '<button class="toast-close" aria-label="Close">×</button>' : ''}
            ${duration > 0 && type !== 'loading' ? '<div class="toast-progress"></div>' : ''}
        `;

        // Close button handler
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.dismiss(id));
        }

        // Add to container
        this.container.appendChild(toast);
        this.toasts.set(id, { element: toast, type });

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('toast-visible');
        });

        // Progress bar animation
        const progressBar = toast.querySelector('.toast-progress');
        if (progressBar && duration > 0) {
            progressBar.style.animationDuration = `${duration}ms`;
        }

        // Auto-dismiss
        if (duration > 0 && type !== 'loading') {
            setTimeout(() => this.dismiss(id), duration);
        }

        return id;
    }

    static dismiss(id) {
        const toast = this.toasts.get(id);
        if (!toast) return;

        toast.element.classList.remove('toast-visible');
        toast.element.classList.add('toast-hiding');

        setTimeout(() => {
            toast.element.remove();
            this.toasts.delete(id);
        }, 300);
    }

    static dismissAll() {
        this.toasts.forEach((_, id) => this.dismiss(id));
    }

    static success(message, duration = 3000) {
        return this.create(message, 'success', duration);
    }

    static error(message, duration = 5000) {
        return this.create(message, 'error', duration);
    }

    static info(message, duration = 3000) {
        return this.create(message, 'info', duration);
    }

    static warning(message, duration = 4000) {
        return this.create(message, 'warning', duration);
    }

    static loading(message) {
        return this.create(message, 'loading', 0);
    }

    static promise(promise, { loading, success, error }) {
        const id = this.loading(loading);

        return promise
            .then(result => {
                this.dismiss(id);
                if (success) this.success(typeof success === 'function' ? success(result) : success);
                return result;
            })
            .catch(err => {
                this.dismiss(id);
                if (error) this.error(typeof error === 'function' ? error(err) : error);
                throw err;
            });
    }

    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Toast;
}
