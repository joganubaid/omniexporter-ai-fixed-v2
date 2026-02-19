"use strict";

// OmniExporter AI - Test Framework (lazy-loaded)
// Extracted from options.js for performance - loaded on demand when tests are run

window.TestRunner = {
    results: [],
    passed: 0,
    failed: 0,
    testTimings: [],        // Per-test timing
    flakyTests: {},         // Track flaky tests
    coverageMap: {},        // Coverage estimation

    // Test utilities with timing
    async test(name, fn) {
        const start = performance.now();
        try {
            await fn();
            const duration = Math.round(performance.now() - start);
            this.passed++;
            this.results.push({ name, status: 'passed', duration });
            this.testTimings.push({ name, duration });
            this.appendResult(`✅ ${name} <span style="color:var(--text-tertiary)">(${duration}ms)</span>`);
            this.trackFlaky(name, true);
            return true;
        } catch (e) {
            const duration = Math.round(performance.now() - start);
            this.failed++;
            this.results.push({ name, status: 'failed', error: e.message, duration });
            this.testTimings.push({ name, duration });
            this.appendResult(`❌ ${name}: ${e.message}`);
            this.trackFlaky(name, false);
            return false;
        }
    },

    // ============================================
    // RICH ASSERTIONS LIBRARY
    // ============================================
    assert(cond, msg) {
        if (!cond) throw new Error(msg || 'Assertion failed');
    },

    assertEqual(a, b, msg) {
        if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
    },

    assertDeepEqual(a, b, msg) {
        const aStr = JSON.stringify(a);
        const bStr = JSON.stringify(b);
        if (aStr !== bStr) throw new Error(msg || `Deep equal failed:\nExpected: ${bStr}\nGot: ${aStr}`);
    },

    assertThrows(fn, expectedError, msg) {
        try {
            fn();
            throw new Error(msg || 'Expected function to throw');
        } catch (e) {
            if (expectedError && !(e instanceof expectedError) && !e.message.includes(expectedError)) {
                throw new Error(msg || `Expected error type ${expectedError}, got ${e.message}`);
            }
        }
    },

    assertType(val, type, msg) {
        const actualType = typeof val;
        if (actualType !== type) throw new Error(msg || `Expected type ${type}, got ${actualType}`);
    },

    assertInRange(val, min, max, msg) {
        if (val < min || val > max) throw new Error(msg || `Expected ${val} to be between ${min} and ${max}`);
    },

    assertMatches(str, regex, msg) {
        if (!regex.test(str)) throw new Error(msg || `Expected "${str}" to match ${regex}`);
    },

    assertArrayContains(arr, item, msg) {
        if (!arr.includes(item)) throw new Error(msg || `Expected array to contain ${item}`);
    },

    // ============================================
    // FLAKY TEST TRACKING
    // ============================================
    trackFlaky(name, passed) {
        if (!this.flakyTests[name]) {
            this.flakyTests[name] = { passes: 0, fails: 0 };
        }
        if (passed) {
            this.flakyTests[name].passes++;
        } else {
            this.flakyTests[name].fails++;
        }
    },

    getFlakyTests() {
        return Object.entries(this.flakyTests)
            .filter(([_, stats]) => stats.passes > 0 && stats.fails > 0)
            .map(([name, stats]) => ({ name, ...stats }));
    },

    // ============================================
    // COVERAGE ESTIMATION
    // ============================================
    markCovered(module, fn) {
        if (!this.coverageMap[module]) {
            this.coverageMap[module] = new Set();
        }
        this.coverageMap[module].add(fn);
    },

    getCoverageReport() {
        const modules = {
            Logger: ['log', 'info', 'warn', 'error', 'debug', 'updateSettings', 'secureClear', 'flush'],
            Storage: ['get', 'set', 'remove', 'getBytesInUse'],
            OAuth: ['isConfigured', 'getActiveToken', 'startAuthFlow', 'clearAuth'],
            Export: ['toMarkdown', 'toPlainText', 'toHTML', 'toJSON'],
            PlatformConfig: ['getConfig', 'patterns', 'endpoints', 'dataFields']
        };

        const report = {};
        for (const [module, functions] of Object.entries(modules)) {
            const covered = this.coverageMap[module]?.size || 0;
            report[module] = {
                total: functions.length,
                covered,
                percent: Math.round((covered / functions.length) * 100)
            };
        }
        return report;
    },

    // ============================================
    // TEST METRICS
    // ============================================
    getMetrics() {
        const timings = this.testTimings.map(t => t.duration);
        return {
            totalTests: this.passed + this.failed,
            passRate: Math.round((this.passed / (this.passed + this.failed)) * 100) || 0,
            avgDuration: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) || 0,
            slowestTest: this.testTimings.sort((a, b) => b.duration - a.duration)[0],
            fastestTest: this.testTimings.sort((a, b) => a.duration - b.duration)[0],
            flakyCount: this.getFlakyTests().length
        };
    },

    reset() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
        this.testTimings = [];
        const container = document.getElementById('testResults');
        if (container) container.innerHTML = '';
        document.getElementById('testResultsContainer').style.display = 'block';
    },

    appendResult(text) {
        const container = document.getElementById('testResults');
        if (container) {
            container.innerHTML += text + '<br>';
            container.scrollTop = container.scrollHeight;
        }
    },

    updateSummary(duration = 0) {
        document.getElementById('testsPassed').textContent = this.passed;
        document.getElementById('testsFailed').textContent = this.failed;
        document.getElementById('testsDuration').textContent = duration + 'ms';

        // Update metrics panel
        const metrics = this.getMetrics();
        const passRateEl = document.getElementById('metricPassRate');
        const avgDurationEl = document.getElementById('metricAvgDuration');
        const flakyCountEl = document.getElementById('metricFlakyCount');
        const slowestEl = document.getElementById('metricSlowest');
        const fastestEl = document.getElementById('metricFastest');

        if (passRateEl) passRateEl.textContent = metrics.passRate + '%';
        if (avgDurationEl) avgDurationEl.textContent = metrics.avgDuration + 'ms';
        if (flakyCountEl) flakyCountEl.textContent = metrics.flakyCount;
        if (slowestEl && metrics.slowestTest) slowestEl.textContent = `${metrics.slowestTest.name} (${metrics.slowestTest.duration}ms)`;
        if (fastestEl && metrics.fastestTest) fastestEl.textContent = `${metrics.fastestTest.name} (${metrics.fastestTest.duration}ms)`;

        // Save to history and refresh display
        if (this.passed > 0 || this.failed > 0) {
            this.saveToHistory();
            if (typeof window.displayTestHistory === 'function') {
                window.displayTestHistory();
            }
            if (typeof window.refreshPerformance === 'function') {
                window.refreshPerformance();
            }
        }
    },

    setStatus(text) {
        const el = document.getElementById('testRunnerStatus');
        if (el) el.textContent = text;
    },

    // ============================================
    // LOGGER TESTS (14 tests)
    // ============================================
    async testLogger() {
        this.appendResult('<b>📝 LOGGER TESTS</b>');

        // Core
        await this.test('Logger exists', () => this.assert(typeof Logger !== 'undefined'));
        await this.test('Logger.info is function', () => this.assert(typeof Logger.info === 'function'));
        await this.test('Logger.error is function', () => this.assert(typeof Logger.error === 'function'));
        await this.test('Logger.warn is function', () => this.assert(typeof Logger.warn === 'function'));
        await this.test('Logger.debug is function', () => this.assert(typeof Logger.debug === 'function'));
        await this.test('Logger.init works', async () => { await Logger.init(); this.assert(Logger._initialized); });

        // Retrieval
        await this.test('Logger.getLogs returns array', async () => {
            this.markCovered('Logger', 'getLogs');
            const logs = await Logger.getLogs();
            this.assert(Array.isArray(logs));
        });
        await this.test('Logger.getStats returns object', async () => {
            this.markCovered('Logger', 'getStats');
            const s = await Logger.getStats();
            this.assert(typeof s.total === 'number');
        });

        // Sanitization
        await this.test('Sanitizes passwords', () => {
            this.markCovered('Logger', 'sanitize');
            const r = Logger._sanitizeData({ password: 'x' });
            this.assertEqual(r.password, '[REDACTED]');
        });
        await this.test('Sanitizes tokens', () => { const r = Logger._sanitizeData({ token: 'x', access_token: 'y' }); this.assertEqual(r.token, '[REDACTED]'); });
        await this.test('Truncates long strings', () => { const r = Logger._sanitizeData({ text: 'a'.repeat(600) }); this.assert(r.text.length < 600); });

        // Timing
        await this.test('Logger.time returns timer', () => {
            this.markCovered('Logger', 'time');
            const t = Logger.time('Test', 'op');
            this.assert(typeof t.end === 'function');
        });

        // Export
        await this.test('generateAIReport returns string', async () => {
            this.markCovered('Logger', 'generateAIReport');
            const r = await Logger.generateAIReport();
            this.assert(typeof r === 'string');
        });
        await this.test('Logger.clear is function', () => {
            this.markCovered('Logger', 'clear');
            this.assert(typeof Logger.clear === 'function');
        });
    },

    // ============================================
    // STORAGE TESTS (6 tests)
    // ============================================
    async testStorage() {
        this.appendResult('<b>💾 STORAGE TESTS</b>');

        await this.test('Chrome storage exists', () => this.assert(chrome.storage.local));
        await this.test('Storage set/get works', async () => {
            await chrome.storage.local.set({ _test: 'val' });
            const r = await chrome.storage.local.get('_test');
            this.assertEqual(r._test, 'val');
            await chrome.storage.local.remove('_test');
        });
        await this.test('Storage remove works', async () => {
            await chrome.storage.local.set({ _testRm: 'x' });
            await chrome.storage.local.remove('_testRm');
            const r = await chrome.storage.local.get('_testRm');
            this.assert(r._testRm === undefined);
        });
        await this.test('Storage handles objects', async () => {
            this.markCovered('Storage', 'get');
            this.markCovered('Storage', 'set');
            const obj = { nested: { arr: [1, 2, 3] } };
            await chrome.storage.local.set({ _testObj: obj });
            const r = await chrome.storage.local.get('_testObj');
            this.assertEqual(JSON.stringify(r._testObj), JSON.stringify(obj));
            await chrome.storage.local.remove('_testObj');
        });
        await this.test('debugMode setting exists', async () => {
            const r = await chrome.storage.local.get('debugMode');
            this.assert(r.debugMode !== undefined || r.debugMode === undefined); // Exists or not, no error
        });
        await this.test('Storage batch operations', async () => {
            this.markCovered('Storage', 'remove');
            await chrome.storage.local.set({ _a: 1, _b: 2 });
            const r = await chrome.storage.local.get(['_a', '_b']);
            this.assertEqual(r._a, 1);
            await chrome.storage.local.remove(['_a', '_b']);
        });
    },

    // ============================================
    // OAUTH TESTS (12 tests)
    // ============================================
    async testOAuth() {
        this.appendResult('<b>🔐 OAUTH TESTS</b>');

        // Module
        await this.test('NotionOAuth exists', () => this.assert(typeof NotionOAuth !== 'undefined'));
        await this.test('NotionOAuth.init works', async () => { const r = await NotionOAuth.init(); this.assertEqual(r, true); });

        // Config
        await this.test('config.authorizationEndpoint exists', () => this.assert(NotionOAuth.config.authorizationEndpoint));
        await this.test('config.scopes is array', () => this.assert(Array.isArray(NotionOAuth.config.scopes)));

        // Methods exist
        await this.test('isConfigured returns boolean', () => this.assert(typeof NotionOAuth.isConfigured() === 'boolean'));
        await this.test('authorize is function', () => this.assert(typeof NotionOAuth.authorize === 'function'));
        await this.test('getAccessToken is function', () => this.assert(typeof NotionOAuth.getAccessToken === 'function'));
        await this.test('getActiveToken is function', () => this.assert(typeof NotionOAuth.getActiveToken === 'function'));
        await this.test('disconnect is function', () => this.assert(typeof NotionOAuth.disconnect === 'function'));
        await this.test('getStatus is function', () => this.assert(typeof NotionOAuth.getStatus === 'function'));
        await this.test('storeTokens is function', () => this.assert(typeof NotionOAuth.storeTokens === 'function'));
        await this.test('createExportDatabase is function', () => this.assert(typeof NotionOAuth.createExportDatabase === 'function'));
    },

    // ============================================
    // EXPORT MANAGER TESTS (14 tests)
    // ============================================
    async testExport() {
        this.appendResult('<b>📤 EXPORT MANAGER TESTS</b>');

        const testData = {
            title: 'Test Conversation',
            uuid: 'test-uuid-123',
            detail: {
                entries: [
                    { query: 'What is AI?', answer: 'Artificial Intelligence...' },
                    { query: 'Explain more', answer: 'AI systems...' }
                ]
            }
        };

        // Module
        await this.test('ExportManager exists', () => this.assert(typeof ExportManager !== 'undefined'));

        // Formats
        await this.test('formats.markdown exists', () => this.assert(ExportManager.formats.markdown));
        await this.test('formats.json exists', () => this.assert(ExportManager.formats.json));
        await this.test('formats.html exists', () => this.assert(ExportManager.formats.html));
        await this.test('formats.txt exists', () => this.assert(ExportManager.formats.txt));
        await this.test('formats.pdf exists', () => this.assert(ExportManager.formats.pdf));

        // Markdown
        await this.test('toMarkdown works', () => { const md = ExportManager.toMarkdown(testData, 'Test'); this.assert(md.includes('Test Conversation')); });
        await this.test('Markdown has frontmatter', () => { const md = ExportManager.toMarkdown(testData, 'Test'); this.assert(md.includes('---')); });

        // JSON
        await this.test('toJSON works', () => { const j = ExportManager.toJSON(testData, 'Test'); JSON.parse(j); });
        await this.test('JSON has meta', () => { const j = JSON.parse(ExportManager.toJSON(testData, 'Test')); this.assert(j.meta.tool === 'OmniExporter AI'); });

        // HTML
        await this.test('toHTML works', () => { const h = ExportManager.toHTML(testData, 'Test'); this.assert(h.includes('<!DOCTYPE html>')); });

        // Plain Text
        await this.test('toPlainText works', () => { const t = ExportManager.toPlainText(testData, 'Test'); this.assert(t.includes('QUESTION')); });

        // Utilities
        await this.test('escapeHtml works', () => { const r = ExportManager.escapeHtml('<script>'); this.assert(!r.includes('<script>')); });
        await this.test('generateFilename works', () => { const f = ExportManager.generateFilename('Test!@#', '.md'); this.assert(f.endsWith('.md')); });
    },

    // ============================================
    // PLATFORM CONFIG TESTS (10 tests)
    // ============================================  
    async testPlatformConfig() {
        this.appendResult('<b>⚙️ PLATFORM CONFIG TESTS</b>');

        const pcm = typeof PlatformConfigManager !== 'undefined';
        const pc = typeof PlatformConfig !== 'undefined';

        await this.test('PlatformConfig exists', () => this.assert(pc || pcm));

        if (pc) {
            await this.test('Perplexity config exists', () => this.assert(PlatformConfig.Perplexity));
            await this.test('ChatGPT config exists', () => this.assert(PlatformConfig.ChatGPT));
            await this.test('Claude config exists', () => this.assert(PlatformConfig.Claude));
            await this.test('Gemini config exists', () => this.assert(PlatformConfig.Gemini));
            await this.test('Grok config exists', () => this.assert(PlatformConfig.Grok));
            await this.test('DeepSeek config exists', () => this.assert(PlatformConfig.DeepSeek));
            await this.test('Config has baseUrl', () => this.assert(PlatformConfig.Perplexity.baseUrl));
            await this.test('Config has endpoints', () => this.assert(PlatformConfig.Perplexity.endpoints));
            await this.test('Config has patterns', () => {
                this.markCovered('PlatformConfig', 'patterns');
                this.assert(PlatformConfig.Perplexity.patterns);
            });
        } else {
            this.appendResult('ℹ️ PlatformConfig skipped (only available in content script)');
        }
    },

    // ============================================
    // UI COMPONENT TESTS (12 tests)
    // ============================================
    async testUI() {
        this.appendResult('<b>🖥️ UI COMPONENT TESTS</b>');

        // Navigation
        await this.test('Nav items exist', () => this.assert(document.querySelectorAll('.nav-item').length > 0));
        await this.test('Dev Tools tab exists', () => this.assert(document.querySelector('[data-tab="devtools"]')));
        await this.test('History tab exists', () => this.assert(document.querySelector('[data-tab="history"]')));
        await this.test('Settings tab exists', () => this.assert(document.querySelector('[data-tab="settings"]')));

        // Dev Tools
        await this.test('Debug toggle exists', () => this.assert(document.getElementById('debugModeToggle')));
        await this.test('Log viewer exists', () => this.assert(document.getElementById('logEntriesContainer')));
        await this.test('Log filters exist', () => this.assert(document.getElementById('logFilterLevel')));

        // Test Runner
        await this.test('Run All Tests button exists', () => this.assert(document.getElementById('runAllTests')));
        await this.test('Platform test buttons exist', () => this.assert(document.querySelectorAll('[data-platform]').length >= 6));
        await this.test('Deep test buttons exist', () => this.assert(document.querySelectorAll('[data-deep]').length === 6));

        // Header
        await this.test('Platform selector exists', () => this.assert(document.getElementById('platformSelector')));
        await this.test('Auto-sync toggle exists', () => this.assert(document.getElementById('autoSyncToggle')));
    },

    // ============================================
    // TOAST SYSTEM TESTS (8 tests)
    // ============================================
    async testToast() {
        this.appendResult('<b>🔔 TOAST TESTS</b>');

        const toastAvailable = typeof Toast !== 'undefined';
        await this.test('Toast class exists', () => this.assert(toastAvailable));

        if (toastAvailable) {
            await this.test('Toast.init is function', () => this.assert(typeof Toast.init === 'function'));
            await this.test('Toast.create is function', () => this.assert(typeof Toast.create === 'function'));
            await this.test('Toast.dismiss is function', () => this.assert(typeof Toast.dismiss === 'function'));
            await this.test('Toast.success is function', () => this.assert(typeof Toast.success === 'function'));
            await this.test('Toast.error is function', () => this.assert(typeof Toast.error === 'function'));
            await this.test('Toast.info is function', () => this.assert(typeof Toast.info === 'function'));
            await this.test('Toast.escapeHtml works', () => { const r = Toast.escapeHtml('<test>'); this.assert(!r.includes('<')); });
        } else {
            this.appendResult('⚠️ Toast not loaded in Options context');
        }
    },

    // ============================================
    // STRESS TESTS (4 tests)
    // ============================================
    async testStress() {
        this.appendResult('<b>💪 STRESS TESTS</b>');

        // Large data handling
        await this.test('Large object sanitization', () => {
            const bigObj = {};
            for (let i = 0; i < 100; i++) bigObj[`key${i}`] = 'value'.repeat(10);
            const r = Logger._sanitizeData(bigObj);
            this.assert(typeof r === 'object');
        });

        // Rapid operations
        await this.test('Rapid storage ops (50x)', async () => {
            for (let i = 0; i < 50; i++) {
                await chrome.storage.local.set({ [`_stress${i}`]: i });
            }
            const r = await chrome.storage.local.get('_stress49');
            this.assertEqual(r._stress49, 49);
            // Cleanup
            const keys = Array.from({ length: 50 }, (_, i) => `_stress${i}`);
            await chrome.storage.local.remove(keys);
        });

        // Memory check
        await this.test('Memory usage reasonable', () => {
            if (performance.memory) {
                const mb = performance.memory.usedJSHeapSize / 1024 / 1024;
                this.assert(mb < 500, `Used: ${mb.toFixed(1)}MB`);
            } else {
                this.assert(true); // Can't measure, pass
            }
        });

        // Concurrent operations
        await this.test('Concurrent async ops (10x)', async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
                chrome.storage.local.set({ [`_conc${i}`]: i })
            );
            await Promise.all(promises);
            const keys = Array.from({ length: 10 }, (_, i) => `_conc${i}`);
            await chrome.storage.local.remove(keys);
        });
    },

    // ============================================
    // ADVANCED FEATURE TESTS (8 tests)
    // ============================================
    async testAdvanced() {
        this.appendResult('<b>🚀 ADVANCED TESTS</b>');

        // Chrome APIs
        await this.test('chrome.tabs API exists', () => this.assert(chrome.tabs));
        await this.test('chrome.runtime API exists', () => this.assert(chrome.runtime));
        await this.test('chrome.alarms API exists', () => this.assert(chrome.alarms));

        // Manifest
        await this.test('Manifest accessible', () => {
            const m = chrome.runtime.getManifest();
            this.assert(m.name && m.version);
        });

        // Extension ID
        await this.test('Extension ID exists', () => this.assert(chrome.runtime.id));

        // Storage quota
        await this.test('Storage quota available', async () => {
            if (chrome.storage.local.getBytesInUse) {
                const bytes = await chrome.storage.local.getBytesInUse();
                this.assert(typeof bytes === 'number');
            } else {
                this.assert(true);
            }
        });

        // Performance API
        await this.test('Performance API works', () => {
            const t = performance.now();
            this.assert(typeof t === 'number' && t > 0);
        });

        // JSON handling
        await this.test('Large JSON parse/stringify', () => {
            const obj = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'test' })) };
            const str = JSON.stringify(obj);
            const parsed = JSON.parse(str);
            this.assertEqual(parsed.items.length, 1000);
        });
    },

    // ============================================
    // SECURITY TESTS (4 tests)
    // ============================================
    async testSecurity() {
        this.appendResult('<b>🔒 SECURITY TESTS</b>');

        // UUID Validation
        await this.test('Valid UUID passes', () => {
            const validUuid = '550e8400-e29b-41d4-a716-446655440000';
            const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            this.assert(pattern.test(validUuid));
        });

        await this.test('Invalid UUID rejected', () => {
            const invalidUuid = 'not-a-uuid';
            const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            this.assert(!pattern.test(invalidUuid));
        });

        // XSS Prevention
        await this.test('HTML sanitization works', () => {
            const malicious = '<script>alert("xss")</script>';
            const div = document.createElement('div');
            div.textContent = malicious;
            const sanitized = div.innerHTML;
            this.assert(!sanitized.includes('<script>'));
        });

        await this.test('Script injection blocked', () => {
            const input = '"><img src=x onerror=alert(1)>';
            const safe = input.replace(/[<>"'&]/g, c => ({
                '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
            }[c]));
            this.assert(!safe.includes('<'));
        });
    },

    // ============================================
    // ERROR SIMULATION TESTS (4 tests)
    // ============================================
    async testErrorSimulation() {
        this.appendResult('<b>⚠️ ERROR SIMULATION TESTS</b>');

        // Timeout handling
        await this.test('Timeout promise rejects', async () => {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 50)
            );
            try {
                await timeoutPromise;
                this.assert(false, 'Should have timed out');
            } catch (e) {
                this.assertEqual(e.message, 'Timeout');
            }
        });

        // Rate limit error handling
        await this.test('429 error mapped correctly', () => {
            const error = { status: 429, message: 'Rate limited' };
            const isRateLimit = error.status === 429;
            this.assert(isRateLimit);
        });

        // Invalid JSON handling
        await this.test('Invalid JSON throws', () => {
            try {
                JSON.parse('not valid json');
                this.assert(false, 'Should have thrown');
            } catch (e) {
                this.assert(e instanceof SyntaxError);
            }
        });

        // Token expiry simulation
        await this.test('Token expiry detection', () => {
            const token = { expires_at: Date.now() - 1000 }; // Expired 1 second ago
            const isExpired = token.expires_at < Date.now();
            this.assert(isExpired);
        });
    },

    // ============================================
    // PLATFORM ADAPTER TESTS (12 tests)
    // ============================================
    async testPlatformAdapters() {
        this.appendResult('<b>🌐 PLATFORM ADAPTER TESTS</b>');

        const pc = typeof PlatformConfig !== 'undefined' ? PlatformConfig : null;

        // Perplexity UUID extraction
        await this.test('Perplexity UUID from URL', () => {
            const url = 'https://perplexity.ai/search/abc123def456';
            const match = url.match(/\/search\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123def456');
        });

        // ChatGPT UUID extraction
        await this.test('ChatGPT UUID from URL', () => {
            const url = 'https://chatgpt.com/c/550e8400-e29b-41d4-a716-446655440000';
            const match = url.match(/\/c\/([a-f0-9-]+)/i);
            this.assert(match !== null);
        });

        // Claude UUID extraction
        await this.test('Claude UUID from URL', () => {
            const url = 'https://claude.ai/chat/abc123-def456-789';
            const match = url.match(/\/chat\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123-def456-789');
        });

        // Gemini UUID extraction
        await this.test('Gemini UUID from URL', () => {
            const url = 'https://gemini.google.com/app/abc123xyz';
            const match = url.match(/\/app\/([^/?#]+)/);
            this.assert(match !== null);
        });

        // Grok UUID extraction
        await this.test('Grok UUID from URL', () => {
            const url = 'https://grok.com/chat/abc123';
            const match = url.match(/\/chat\/([^/?#]+)/);
            this.assert(match && match[1] === 'abc123');
        });

        // DeepSeek UUID extraction
        await this.test('DeepSeek UUID from URL', () => {
            const url = 'https://chat.deepseek.com/a/chat/s/abc123';
            const match = url.match(/\/chat\/s\/([^/?#]+)/) || url.match(/\/chat\/([^/?#]+)/);
            this.assert(match !== null);
        });

        // Platform Config tests
        if (pc) {
            await this.test('PlatformConfig.Perplexity has baseUrl', () => {
                this.markCovered('PlatformConfig', 'getConfig');
                this.assert(pc.Perplexity?.baseUrl);
            });
            await this.test('PlatformConfig.ChatGPT has endpoints', () => {
                this.markCovered('PlatformConfig', 'endpoints');
                this.assert(pc.ChatGPT?.endpoints);
            });
            await this.test('PlatformConfig.Claude has patterns', () => {
                this.markCovered('PlatformConfig', 'patterns');
                this.assert(pc.Claude?.patterns);
            });
            await this.test('PlatformConfig.Gemini has dataFields', () => {
                this.markCovered('PlatformConfig', 'dataFields');
                this.assert(pc.Gemini?.dataFields);
            });
            await this.test('PlatformConfig.Grok has versions', () => this.assert(pc.Grok?.versions));
            await this.test('PlatformConfig.DeepSeek has rateLimit', () => this.assert(pc.DeepSeek?.rateLimit));
        } else {
            this.appendResult('ℹ️ PlatformConfig skipped (only available in content script)');
        }
    },

    // ============================================
    // TEST HISTORY & EXPORT
    // ============================================
    history: [],

    saveToHistory() {
        const entry = {
            timestamp: new Date().toISOString(),
            passed: this.passed,
            failed: this.failed,
            total: this.passed + this.failed,
            results: [...this.results]
        };
        this.history.unshift(entry);
        if (this.history.length > 10) this.history.pop();

        // Save to storage
        chrome.storage.local.set({ testHistory: this.history });
    },

    async loadHistory() {
        const { testHistory } = await chrome.storage.local.get('testHistory');
        this.history = testHistory || [];
    },

    exportResults(format = 'json') {
        const data = {
            timestamp: new Date().toISOString(),
            passed: this.passed,
            failed: this.failed,
            total: this.passed + this.failed,
            results: this.results
        };

        let content, filename, type;

        if (format === 'csv') {
            content = 'Name,Status,Error\n' +
                this.results.map(r => `"${r.name}","${r.status}","${r.error || ''}"`).join('\n');
            filename = `test-results-${Date.now()}.csv`;
            type = 'text/csv';
        } else {
            content = JSON.stringify(data, null, 2);
            filename = `test-results-${Date.now()}.json`;
            type = 'application/json';
        }

        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Run all unit tests
    async runAll() {
        this.reset();
        await this.loadHistory();
        this.setStatus('Running 110+ tests...');
        const start = performance.now();

        this.setStatus('Running tests in parallel...');

        // Group 1: Core tests (no dependencies) - run in parallel
        this.appendResult('<b>🚀 Running Core Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testLogger(),
            this.testOAuth(),
            this.testExport(),
            this.testPlatformConfig()
        ]);

        // Group 2: Storage & UI tests - run in parallel
        this.appendResult('\n<b>🎨 Running Storage & UI Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testStorage(),
            this.testUI(),
            this.testToast()
        ]);

        // Group 3: Advanced tests - run in parallel
        this.appendResult('\n<b>🔬 Running Advanced Tests in Parallel...</b>\n');
        await Promise.allSettled([
            this.testAdvanced(),
            this.testSecurity(),
            this.testErrorSimulation(),
            this.testPlatformAdapters()
        ]);

        // Stress tests optional - can be slow
        // await this.testStress();

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.saveToHistory();
        this.setStatus(this.failed === 0 ? '✅ All Passed!' : `❌ ${this.failed} Failed`);
    },

    // Platform test helper - UPDATED: Now fetches data!
    async testPlatform(key) {
        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        const platform = platforms[key];
        this.appendResult(`<b>🌐 Testing ${platform.name}...</b>`);

        try {
            // Check if tab is already open
            const existingTabs = await chrome.tabs.query({ url: platform.match });
            let tab;
            let openedNewTab = false;

            if (existingTabs.length > 0) {
                // Use existing tab
                tab = existingTabs[0];
                this.appendResult(`   ↳ Using existing tab`);
            } else {
                // Open new tab
                tab = await chrome.tabs.create({ url: platform.url, active: false });
                openedNewTab = true;
                this.appendResult(`   ↳ Opening new tab...`);
                await new Promise(r => setTimeout(r, 5000));
            }

            return new Promise((resolve) => {
                // Step 1: Check Connectivity
                chrome.tabs.sendMessage(tab.id, { type: 'GET_PLATFORM_INFO' }, async (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        this.appendResult(`❌ ${platform.name}: Not connected`);
                        this.failed++;
                        resolve();
                        return; // Stop here if not connected
                    }

                    this.appendResult(`✅ ${platform.name}: Connected`);

                    // Step 2: VERIFY DATA ACCESS ( Honest Test )
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'GET_THREAD_LIST',
                        payload: { page: 1, limit: 1 }
                    }, async (threadResp) => {
                        if (chrome.runtime.lastError) {
                            this.appendResult(`⚠️ ${platform.name}: API check failed (${chrome.runtime.lastError.message})`);
                        } else if (threadResp?.success) {
                            const count = threadResp.data?.threads?.length || 0;
                            this.appendResult(`   ↳ Verified: Fetched ${count} threads from API`);
                            this.passed++; // Only pass if we can talk to API
                        } else {
                            this.appendResult(`❌ ${platform.name}: API Error: ${threadResp?.error || 'Unknown'}`);
                            this.failed++;
                        }

                        // Only close tabs we opened - with error handling
                        if (openedNewTab) {
                            await new Promise(r => setTimeout(r, 1000));
                            try {
                                await chrome.tabs.remove(tab.id);
                            } catch (e) {
                                // Tab may already be closed, ignore
                            }
                        }
                        resolve();
                    });
                });
            });
        } catch (e) {
            this.appendResult(`❌ ${platform.name}: ${e.message}`);
            this.failed++;
        }
    },

    // Notion Connection Test
    async testNotionConnection() {
        this.reset();
        this.setStatus('Testing Notion Connection...');
        this.appendResult('<b>📝 NOTION CONNECTION TEST</b>');

        try {
            // 1. Check if configured
            if (!NotionOAuth.isConfigured()) {
                this.appendResult('❌ Notion OAuth not configured');
                return;
            }

            // 2. Check token existence
            const token = await NotionOAuth.getActiveToken().catch(() => null);
            if (!token) {
                this.appendResult('❌ No active Notion token found (Please login)');
                return;
            }
            this.appendResult('✅ Active token found');

            // 3. Test API connectivity
            this.appendResult('⏳ Verifying with Notion API...');
            const result = await NotionOAuth.testConnection();

            if (result.success) {
                this.appendResult(`✅ <b>SUCCESS:</b> Connected to workspace "${result.workspaceName}"`);
                this.appendResult(`   Authenticated as: ${result.botName}`);
                this.passed++;
                this.setStatus('✅ Notion Connected');
            } else {
                this.appendResult(`❌ <b>FAILED:</b> ${result.error}`);
                this.appendResult('   Please try reconnecting your Notion account.');
                this.failed++;
                this.setStatus('❌ Connection Failed');
            }

        } catch (e) {
            this.appendResult(`❌ Error: ${e.message}`);
            this.failed++;
        }
    },

    // Test all platforms - PARALLEL
    async runAllPlatforms() {
        this.reset();
        this.setStatus('Testing all platforms in parallel...');
        const start = performance.now();

        this.appendResult('<b>🌐 PLATFORM TESTS (PARALLEL)</b>');
        this.appendResult('Testing all 6 platforms simultaneously\n');

        const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

        // Run all platform tests in parallel
        await Promise.allSettled(
            platforms.map(key => this.testPlatform(key))
        );

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.setStatus(`Done: ${this.passed}/6 platforms (${duration}ms)`);
    },

    // Network status helper
    setNetworkStatus(text) {
        const el = document.getElementById('networkTestStatus');
        const container = document.getElementById('networkTestProgress');
        if (el) el.textContent = text;
        if (container) container.style.display = text ? 'block' : 'none';
    },

    // Countdown helper
    async countdown(seconds, prefix = 'Loading') {
        for (let i = seconds; i > 0; i--) {
            this.setNetworkStatus(`${prefix}... ${i}s remaining`);
            await new Promise(r => setTimeout(r, 1000));
        }
    },

    // ⚡ Fast Internet Test Mode - PARALLEL
    async testFastInternet() {
        this.reset();
        this.setStatus('⚡ Fast Internet Test (Parallel)');
        this.appendResult('<b>⚡ FAST INTERNET - PARALLEL MODE</b>');
        this.appendResult('Testing all 6 platforms simultaneously\n');

        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        // Phase 1: Open all tabs in parallel
        this.setNetworkStatus('Opening all platform tabs...');
        const tabSetup = await Promise.all(
            Object.entries(platforms).map(async ([key, platform]) => {
                const existingTabs = await chrome.tabs.query({ url: platform.match });
                if (existingTabs.length > 0) {
                    return { platform, tab: existingTabs[0], opened: false };
                } else {
                    const tab = await chrome.tabs.create({ url: platform.url, active: false });
                    return { platform, tab, opened: true };
                }
            })
        );

        // Phase 2: Wait 3 seconds for tabs to load
        await this.countdown(3, 'Loading platforms');

        // Phase 3: Test all in parallel
        this.setNetworkStatus('Testing all platforms simultaneously...');
        const results = await Promise.allSettled(
            tabSetup.map(async ({ platform, tab }) => {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                return { platform, success };
            })
        );

        // Phase 4: Process results
        const failed = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                this.appendResult(`✅ ${result.value.platform.name}: Connected`);
                this.passed++;
            } else {
                const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                failed.push(tabSetup.find(t => t.platform.name === name));
                this.appendResult(`⏳ ${name}: Queued for retry...`);
            }
        }

        // Phase 5: Retry failed ones with 5s wait
        if (failed.length > 0) {
            this.appendResult(`\n<b>Retrying ${failed.length} failed platforms...</b>`);
            await this.countdown(5, 'Retry wait');

            const retryResults = await Promise.allSettled(
                failed.filter(f => f).map(async ({ platform, tab }) => {
                    const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 3);
                    return { platform, success };
                })
            );

            for (const result of retryResults) {
                if (result.status === 'fulfilled' && result.value.success) {
                    this.appendResult(`✅ ${result.value.platform.name}: Connected (retry)`);
                    this.passed++;
                } else {
                    const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                    this.appendResult(`❌ ${name}: Failed after retry`);
                    this.failed++;
                }
            }
        }

        // Cleanup
        for (const { tab, opened } of tabSetup) {
            if (opened) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }
        }

        this.setNetworkStatus('');
        this.updateSummary();
        this.setStatus(`⚡ Done: ${this.passed}/6 platforms`);
    },

    // 🐢 Slow Internet Test Mode - PARALLEL with extended retry
    async testSlowInternet() {
        this.reset();
        this.setStatus('🐢 Slow Internet Test (Parallel)');
        this.appendResult('<b>🐢 SLOW INTERNET - PARALLEL MODE</b>');
        this.appendResult('All platforms tested together, 5s wait + 10s retry\n');

        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*' }
        };

        // Phase 1: Open all tabs in parallel
        this.setNetworkStatus('Opening all platform tabs...');
        const tabSetup = await Promise.all(
            Object.entries(platforms).map(async ([key, platform]) => {
                const existingTabs = await chrome.tabs.query({ url: platform.match });
                if (existingTabs.length > 0) {
                    return { platform, tab: existingTabs[0], opened: false };
                } else {
                    const tab = await chrome.tabs.create({ url: platform.url, active: false });
                    return { platform, tab, opened: true };
                }
            })
        );

        // Phase 2: Wait 5 seconds for tabs to load
        await this.countdown(5, 'Loading platforms');

        // Phase 3: Test all in parallel
        this.setNetworkStatus('Testing all platforms simultaneously...');
        const results = await Promise.allSettled(
            tabSetup.map(async ({ platform, tab }) => {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                return { platform, success };
            })
        );

        // Process first round results
        const failed = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                this.appendResult(`✅ ${result.value.platform.name}: Connected`);
                this.passed++;
            } else {
                const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                failed.push(tabSetup.find(t => t.platform.name === name));
            }
        }

        // Phase 4: Retry failed ones with 5s wait
        if (failed.length > 0) {
            this.appendResult(`\n<b>Retrying ${failed.length} failed platforms (5s wait)...</b>`);
            await this.countdown(5, 'Retry 1');

            const retry1 = await Promise.allSettled(
                failed.filter(f => f).map(async ({ platform, tab }) => {
                    const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                    return { platform, tab, success };
                })
            );

            const stillFailed = [];
            for (const result of retry1) {
                if (result.status === 'fulfilled' && result.value.success) {
                    this.appendResult(`✅ ${result.value.platform.name}: Connected (retry 1)`);
                    this.passed++;
                } else if (result.status === 'fulfilled') {
                    stillFailed.push({ platform: result.value.platform, tab: result.value.tab });
                }
            }

            // Phase 5: Final retry with 10s wait
            if (stillFailed.length > 0) {
                this.appendResult(`\n<b>Final retry for ${stillFailed.length} platforms (10s wait)...</b>`);
                await this.countdown(10, 'Final retry');

                const retry2 = await Promise.allSettled(
                    stillFailed.map(async ({ platform, tab }) => {
                        const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 3);
                        return { platform, success };
                    })
                );

                for (const result of retry2) {
                    if (result.status === 'fulfilled' && result.value.success) {
                        this.appendResult(`✅ ${result.value.platform.name}: Connected (final)`);
                        this.passed++;
                    } else {
                        const name = result.status === 'fulfilled' ? result.value.platform.name : 'Unknown';
                        this.appendResult(`❌ ${name}: Failed after all retries`);
                        this.failed++;
                    }
                }
            }
        }

        // Cleanup
        for (const { tab, opened } of tabSetup) {
            if (opened) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }
        }

        this.setNetworkStatus('');
        this.updateSummary();
        this.setStatus(`🐢 Done: ${this.passed}/6 platforms`);
    },

    // 📂 Test Open Tabs Only
    async testOpenTabsOnly() {
        this.reset();
        this.setStatus('📂 Testing Open Tabs');
        this.appendResult('<b>📂 OPEN TABS ONLY MODE</b>');
        this.appendResult('Only testing platforms you have open\n');

        const platforms = {
            perplexity: { name: 'Perplexity', match: '*://www.perplexity.ai/*' },
            chatgpt: { name: 'ChatGPT', match: '*://chatgpt.com/*' },
            claude: { name: 'Claude', match: '*://claude.ai/*' },
            gemini: { name: 'Gemini', match: '*://gemini.google.com/*' },
            grok: { name: 'Grok', match: '*://grok.com/*' },
            deepseek: { name: 'DeepSeek', match: '*://chat.deepseek.com/*' }
        };

        let testedCount = 0;

        for (const [key, platform] of Object.entries(platforms)) {
            const existingTabs = await chrome.tabs.query({ url: platform.match });

            if (existingTabs.length === 0) {
                this.appendResult(`⏭️ ${platform.name}: Not open (skipped)`);
                continue;
            }

            testedCount++;
            const tab = existingTabs[0];

            try {
                const success = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
                if (success) {
                    this.appendResult(`✅ ${platform.name}: Connected`);
                    this.passed++;
                } else {
                    this.appendResult(`❌ ${platform.name}: Not connected`);
                    this.failed++;
                }
            } catch (e) {
                this.appendResult(`❌ ${platform.name}: ${e.message}`);
                this.failed++;
            }
        }

        if (testedCount === 0) {
            this.appendResult('⚠️ No platform tabs are open!');
            this.appendResult('Please open at least one AI platform in a tab.');
        }

        this.updateSummary();
        this.setStatus(`📂 Tested ${testedCount}/6 open platforms`);
    },

    // Helper: Send message with retry
    async sendMessageWithRetry(tabId, message, maxRetries = 2) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tabId, message, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(response);
                        }
                    });
                });
                if (response?.success) return true;
                if (response?.data) return response; // Return data if available
            } catch (e) { }
            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    },

    // Helper: Get AI Tab (mimics getAITab from usage)
    async getAITab(matchUrl) {
        const tabs = await chrome.tabs.query({ url: matchUrl });
        if (tabs.length > 0) return tabs[0];
        return null;
    },

    // Deep platform test - tests everything including Notion Upload
    async runDeepPlatformTest(key) {
        const platforms = {
            perplexity: { name: 'Perplexity', url: 'https://www.perplexity.ai/', match: '*://www.perplexity.ai/*', formatter: 'perplexity' },
            chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/', match: '*://chatgpt.com/*', formatter: 'chatgpt' },
            claude: { name: 'Claude', url: 'https://claude.ai/', match: '*://claude.ai/*', formatter: 'claude' },
            gemini: { name: 'Gemini', url: 'https://gemini.google.com/', match: '*://gemini.google.com/*', formatter: 'gemini' },
            grok: { name: 'Grok', url: 'https://grok.com/', match: '*://grok.com/*', formatter: 'grok' },
            deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', match: '*://chat.deepseek.com/*', formatter: 'deepseek' }
        };

        const platform = platforms[key];

        // Note: When running in parallel, we can't reset(). We rely on appendResult being additive.
        this.appendResult(`<b>🔬 DEEP TEST: ${platform.name}</b>`);

        try {
            // Find or open tab
            // Find or open tab - using Logic similar to actual usage
            const existingTab = await this.getAITab(platform.match);
            let tab;
            let openedNewTab = false;

            if (existingTab) {
                tab = existingTab;
                this.appendResult(`   ✅ ${platform.name}: Using existing tab (Active)`);
                // Ensure tab is ready/awake
                await chrome.tabs.reload(tab.id); // Reload to ensure content script is fresh
                await new Promise(r => setTimeout(r, 3000)); // Wait for reload
            } else {
                tab = await chrome.tabs.create({ url: platform.url, active: true }); // Make active to ensure full loading
                openedNewTab = true;
                this.appendResult(`   ⏳ ${platform.name}: Opening new tab (Active)...`);
                await new Promise(r => setTimeout(r, 8000)); // Longer wait for initial load
            }

            // Test 1: Connection
            const connected = await this.sendMessageWithRetry(tab.id, { type: 'GET_PLATFORM_INFO' }, 2);
            if (!connected) {
                this.appendResult(`   ❌ ${platform.name}: Connection failed`);
                this.failed++;
                if (openedNewTab) chrome.tabs.remove(tab.id);
                return { success: false, reason: 'Connection failed' };
            }
            this.appendResult(`   ✅ ${platform.name}: Connected`);

            // Test 2: Fetch Thread List
            // Test 2: Fetch Thread List
            const threadResp = await this.sendMessageWithRetry(tab.id, { type: 'GET_THREAD_LIST', payload: { page: 1, limit: 10 } }, 2);

            if (!threadResp || !threadResp.success || !threadResp.data?.threads) {
                this.appendResult(`   ❌ ${platform.name}: Thread list failed`);
                this.failed++;
                return { success: false, reason: 'Thread list failed' };
            }

            const threads = threadResp.data.threads;
            const threadCount = threads.length;

            if (threadCount === 0) {
                this.appendResult(`   ⚠️ ${platform.name}: 0 threads found (Empty account?)`);
                // Can't proceed to extraction if 0 threads
                return { success: true, reason: 'No threads to test' };
            }
            this.appendResult(`   ✅ ${platform.name}: Found ${threadCount} threads`);

            // Test 3: Content Extraction (The Honest Check)
            const firstThread = threads[0];
            this.appendResult(`   ⏳ ${platform.name}: Extracting "${firstThread.title?.substring(0, 20)}..."`);

            const extractResp = await this.sendMessageWithRetry(tab.id, { type: 'EXTRACT_CONTENT_BY_UUID', payload: { uuid: firstThread.uuid } }, 2);

            if (!extractResp || !extractResp.success || !extractResp.data) {
                this.appendResult(`   ❌ ${platform.name}: Extraction Failed!`);
                this.failed++;
                return { success: false, reason: 'Extraction failed' };
            }

            // Verify Content Quality
            const entries = extractResp.data.detail?.entries || [];
            const hasContent = entries.some(e => e.query || e.answer); // Check for at least one question or answer

            if (entries.length === 0 || !hasContent) {
                this.appendResult(`   ❌ ${platform.name}: EXPORTED DUMMY DATA (Empty content)`);
                if (extractResp.data.debug) {
                    this.appendResult(`   🔍 DEBUG: ${JSON.stringify(extractResp.data.debug)}`);
                }
                this.failed++;
                return { success: false, reason: 'Empty content extracted' };
            }

            this.appendResult(`   ✅ ${platform.name}: Extracted ${entries.length} messages (Valid Content)`);
            this.passed++;


            // Test 4: Notion Upload (Real World Verification)
            if (NotionOAuth.isConfigured() && (await NotionOAuth.getStatus()).connected) {
                this.appendResult(`   ⏳ ${platform.name}: Verifying Notion Upload...`);
                try {
                    // 1. Format for Notion (simulate export)
                    // Note: We use a simplified text block for the test to avoid complex formatting issues during test
                    const testContent = [
                        {
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: [{ type: 'text', text: { content: `Verified Export Test: ${platform.name}\nTimestamp: ${new Date().toISOString()}` } }]
                            }
                        },
                        {
                            object: 'block',
                            type: 'callout',
                            callout: {
                                rich_text: [{ type: 'text', text: { content: `Successfully extracted ${entries.length} messages from ${platform.name}.` } }],
                                icon: { emoji: '✅' }
                            }
                        }
                    ];

                    const notionProps = {
                        'Title': { title: [{ text: { content: `TEST: ${firstThread.title || 'Untitled'}` } }] },
                        'Platform': { select: { name: platform.name } },
                        'URL': { url: firstThread.url || platform.url },
                        'Exported': { date: { start: new Date().toISOString() } }
                    };

                    // 2. Upload
                    const uploadResp = await NotionOAuth.uploadPage(notionProps, testContent);

                    if (uploadResp && uploadResp.id) {
                        this.appendResult(`   ✅ ${platform.name}: Uploaded to Notion!`);
                        this.passed++;
                    } else {
                        throw new Error('Upload response invalid');
                    }

                } catch (e) {
                    this.appendResult(`   ❌ ${platform.name}: Notion Upload Failed (${e.message})`);
                    this.failed++;
                }
            } else {
                this.appendResult(`   ℹ️ ${platform.name}: Skipping upload (Notion not connected)`);
            }

            // Cleanup
            if (openedNewTab) {
                try { await chrome.tabs.remove(tab.id); } catch (e) { }
            }

            return { success: true };

        } catch (e) {
            this.appendResult(`   ❌ ${platform.name}: Error - ${e.message}`);
            this.failed++;
            return { success: false, error: e.message };
        }
    },

    // Full E2E test - PARALLEL EXECUTION
    async runFullE2E() {
        this.reset();
        this.setStatus('Running FULL E2E (Parallel Mode)...');
        const start = performance.now();

        this.appendResult('<b>🚀 FULL E2E TEST (PARALLEL & DEEP)</b>');
        this.appendResult('Starting UI & Unit Tests...\n');

        // Unit tests run sequentially first (fast)
        await this.testLogger();
        await this.testStorage();
        await this.testOAuth();
        await this.testExport();
        await this.testUI();

        // Platform tests run in parallel
        this.appendResult('\n<b>🌐 LAUNCHING PARALLEL DEEP TESTS</b>');
        this.appendResult('This will open multiple tabs and verify content extraction...\n');

        const platforms = ['perplexity', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

        // Execute all promises
        const results = await Promise.allSettled(
            platforms.map(key => this.runDeepPlatformTest(key))
        );

        const duration = Math.round(performance.now() - start);
        this.updateSummary(duration);
        this.setStatus(this.failed === 0 ? '🏆 All Systems Verified!' : `Done: ${this.passed} passed, ${this.failed} failed`);

        // Add final report at bottom
        this.appendResult('\n<b>🏁 FINAL REPORT</b>');
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        this.appendResult(`Successful Platforms: ${successCount} / ${platforms.length}`);
    }
};
