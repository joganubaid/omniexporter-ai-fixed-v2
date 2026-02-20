// Error boundary — must load before other scripts
window.onerror = function(msg, src, line, col, err) {
    console.error('[OmniExporter] Uncaught error:', msg, src, line);
    const el = document.getElementById('error-boundary');
    if (el) {
        el.style.display = 'block';
        el.textContent = 'Something went wrong. Please reload the extension. Error: ' + msg;
    }
    return false;
};
window.onunhandledrejection = function(event) {
    console.error('[OmniExporter] Unhandled promise rejection:', event.reason);
};
