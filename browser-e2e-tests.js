/**
 * OmniExporter AI - Browser E2E Test Suite
 * Real browser automation tests for all 6 platforms
 * 
 * This file provides test functions that can be run with browser automation
 * or manually in the browser console when on each platform.
 */

const BrowserE2ETests = {
    // Platform URLs
    platforms: {
        perplexity: 'https://www.perplexity.ai/',
        chatgpt: 'https://chatgpt.com/',
        claude: 'https://claude.ai/',
        gemini: 'https://gemini.google.com/',
        grok: 'https://grok.com/',
        deepseek: 'https://chat.deepseek.com/'
    },

    results: [],

    // ============================================
    // TEST UTILITIES
    // ============================================
    log(msg, type = 'info') {
        const prefix = type === 'pass' ? '✅' : type === 'fail' ? '❌' : 'ℹ️';
        console.log(`${prefix} ${msg}`);
        this.results.push({ message: msg, type });
    },

    async waitForElement(selector, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await new Promise(r => setTimeout(r, 100));
        }
        return null;
    },

    async waitForLoad(ms = 3000) {
        await new Promise(r => setTimeout(r, ms));
    },

    // ============================================
    // PLATFORM DETECTION TESTS
    // ============================================
    async testPlatformDetection() {
        const hostname = window.location.hostname;

        const platformMap = {
            'perplexity.ai': 'Perplexity',
            'www.perplexity.ai': 'Perplexity',
            'chatgpt.com': 'ChatGPT',
            'claude.ai': 'Claude',
            'gemini.google.com': 'Gemini',
            'grok.com': 'Grok',
            'x.com': 'Grok',
            'chat.deepseek.com': 'DeepSeek'
        };

        const expectedPlatform = platformMap[hostname];

        if (expectedPlatform) {
            this.log(`Platform detected: ${expectedPlatform}`, 'pass');
            return expectedPlatform;
        } else {
            this.log(`Unknown platform: ${hostname}`, 'fail');
            return null;
        }
    },

    // ============================================
    // CONTENT SCRIPT TESTS
    // ============================================
    async testContentScriptLoaded() {
        // Check if content script is loaded by looking for OmniExporter markers
        const contentScriptActive =
            typeof getPlatformAdapter === 'function' ||
            typeof ContentScriptManager !== 'undefined' ||
            document.querySelector('[data-omniexporter]');

        if (contentScriptActive) {
            this.log('Content script loaded', 'pass');
            return true;
        }

        // Try sending a message to check
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
                    if (chrome.runtime.lastError) {
                        this.log('Content script not responding', 'fail');
                        resolve(false);
                    } else {
                        this.log('Content script responding', 'pass');
                        resolve(true);
                    }
                });
            } else {
                this.log('Chrome runtime not available', 'fail');
                resolve(false);
            }
        });
    },

    // ============================================
    // ADAPTER TESTS
    // ============================================
    async testAdapterExists() {
        const hostname = window.location.hostname;

        const adapterNames = {
            'perplexity.ai': 'PerplexityAdapter',
            'www.perplexity.ai': 'PerplexityAdapter',
            'chatgpt.com': 'ChatGPTAdapter',
            'claude.ai': 'ClaudeAdapter',
            'gemini.google.com': 'GeminiAdapter',
            'grok.com': 'GrokAdapter',
            'chat.deepseek.com': 'DeepSeekAdapter'
        };

        const expectedAdapter = adapterNames[hostname];

        // Check if adapter is available
        try {
            const adapter = typeof getPlatformAdapter === 'function' ? getPlatformAdapter() : null;
            if (adapter && adapter.name) {
                this.log(`Adapter found: ${adapter.name}`, 'pass');
                return adapter;
            }
        } catch (e) {
            this.log(`Adapter check error: ${e.message}`, 'fail');
        }

        return null;
    },

    async testAdapterMethods(adapter) {
        if (!adapter) {
            this.log('No adapter to test', 'fail');
            return false;
        }

        const requiredMethods = ['extractUuid', 'getThreads', 'getThreadDetail'];
        let allPassed = true;

        for (const method of requiredMethods) {
            if (typeof adapter[method] === 'function') {
                this.log(`${adapter.name}.${method} exists`, 'pass');
            } else {
                this.log(`${adapter.name}.${method} missing`, 'fail');
                allPassed = false;
            }
        }

        return allPassed;
    },

    async testExtractUuid(adapter) {
        if (!adapter || typeof adapter.extractUuid !== 'function') {
            this.log('extractUuid not available', 'fail');
            return null;
        }

        const url = window.location.href;
        try {
            const uuid = adapter.extractUuid(url);
            if (uuid) {
                this.log(`UUID extracted: ${uuid.substring(0, 20)}...`, 'pass');
                return uuid;
            } else {
                this.log('No UUID in current URL (navigate to a conversation)', 'info');
                return null;
            }
        } catch (e) {
            this.log(`extractUuid error: ${e.message}`, 'fail');
            return null;
        }
    },

    async testGetThreads(adapter) {
        if (!adapter || typeof adapter.getThreads !== 'function') {
            this.log('getThreads not available', 'fail');
            return null;
        }

        try {
            this.log('Fetching thread list...');
            const result = await adapter.getThreads(1, 10);

            if (result && result.threads && Array.isArray(result.threads)) {
                this.log(`Thread list fetched: ${result.threads.length} threads`, 'pass');
                return result;
            } else if (result && Array.isArray(result)) {
                this.log(`Thread list fetched: ${result.length} threads`, 'pass');
                return { threads: result };
            } else {
                this.log('getThreads returned unexpected format', 'fail');
                return null;
            }
        } catch (e) {
            this.log(`getThreads error: ${e.message}`, 'fail');
            return null;
        }
    },

    async testGetThreadDetail(adapter, uuid) {
        if (!adapter || typeof adapter.getThreadDetail !== 'function') {
            this.log('getThreadDetail not available', 'fail');
            return null;
        }

        if (!uuid) {
            this.log('No UUID for getThreadDetail test', 'info');
            return null;
        }

        try {
            this.log(`Fetching thread detail for ${uuid.substring(0, 20)}...`);
            const detail = await adapter.getThreadDetail(uuid);

            if (detail) {
                const entries = detail.entries || detail.detail?.entries || [];
                this.log(`Thread detail fetched: ${entries.length} entries`, 'pass');
                return detail;
            } else {
                this.log('getThreadDetail returned null', 'fail');
                return null;
            }
        } catch (e) {
            this.log(`getThreadDetail error: ${e.message}`, 'fail');
            return null;
        }
    },

    // ============================================
    // EXPORT TESTS
    // ============================================
    async testExportManager() {
        if (typeof ExportManager === 'undefined') {
            this.log('ExportManager not available in this context', 'info');
            return false;
        }

        const testData = {
            title: 'Test',
            uuid: 'test-123',
            detail: { entries: [{ query: 'Test?', answer: 'Yes' }] }
        };

        try {
            const md = ExportManager.toMarkdown(testData, 'Test');
            this.log('ExportManager.toMarkdown works', md ? 'pass' : 'fail');

            const json = ExportManager.toJSON(testData, 'Test');
            this.log('ExportManager.toJSON works', json ? 'pass' : 'fail');

            return true;
        } catch (e) {
            this.log(`ExportManager error: ${e.message}`, 'fail');
            return false;
        }
    },

    // ============================================
    // MESSAGE PASSING TESTS
    // ============================================
    async testMessagePassing() {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.runtime) {
                this.log('Chrome runtime not available', 'fail');
                resolve(false);
                return;
            }

            const timeout = setTimeout(() => {
                this.log('Message passing timeout', 'fail');
                resolve(false);
            }, 5000);

            chrome.runtime.sendMessage({ type: 'GET_PLATFORM_INFO' }, (response) => {
                clearTimeout(timeout);

                if (chrome.runtime.lastError) {
                    this.log(`Message error: ${chrome.runtime.lastError.message}`, 'fail');
                    resolve(false);
                } else if (response && response.success) {
                    this.log(`Message passing works: ${response.platform}`, 'pass');
                    resolve(true);
                } else {
                    this.log('Message returned but unsuccessful', 'fail');
                    resolve(false);
                }
            });
        });
    },

    // ============================================
    // LOGGER TESTS (on platform pages)
    // ============================================
    async testLoggerOnPlatform() {
        if (typeof Logger === 'undefined') {
            this.log('Logger not available', 'fail');
            return false;
        }

        try {
            await Logger.init();
            this.log('Logger.init() works', 'pass');

            Logger.info('E2E', 'Browser test log entry');
            this.log('Logger.info() works', 'pass');

            return true;
        } catch (e) {
            this.log(`Logger error: ${e.message}`, 'fail');
            return false;
        }
    },

    // ============================================
    // RUN ALL TESTS FOR CURRENT PLATFORM
    // ============================================
    async runCurrentPlatformTests() {
        console.clear();
        console.log('╔═══════════════════════════════════════════════════════╗');
        console.log('║  🧪 OmniExporter - Platform E2E Tests                 ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

        this.results = [];
        const startTime = performance.now();

        // 1. Platform Detection
        console.log('\n📍 PLATFORM DETECTION');
        const platform = await this.testPlatformDetection();

        // 2. Content Script
        console.log('\n📜 CONTENT SCRIPT');
        await this.testContentScriptLoaded();

        // 3. Adapter Tests
        console.log('\n🔌 ADAPTER TESTS');
        const adapter = await this.testAdapterExists();
        await this.testAdapterMethods(adapter);

        // 4. UUID Extraction
        console.log('\n🔑 UUID EXTRACTION');
        const uuid = await this.testExtractUuid(adapter);

        // 5. Thread List
        console.log('\n📋 THREAD LIST');
        const threads = await this.testGetThreads(adapter);

        // 6. Thread Detail
        console.log('\n📄 THREAD DETAIL');
        const testUuid = uuid || (threads?.threads?.[0]?.uuid);
        await this.testGetThreadDetail(adapter, testUuid);

        // 7. Message Passing
        console.log('\n📨 MESSAGE PASSING');
        await this.testMessagePassing();

        // 8. Logger
        console.log('\n📝 LOGGER');
        await this.testLoggerOnPlatform();

        // Summary
        const duration = Math.round(performance.now() - startTime);
        const passed = this.results.filter(r => r.type === 'pass').length;
        const failed = this.results.filter(r => r.type === 'fail').length;

        console.log('\n' + '═'.repeat(55));
        console.log(`📊 Results: ${passed} passed, ${failed} failed (${duration}ms)`);
        console.log('═'.repeat(55));

        return { platform, passed, failed, duration, results: this.results };
    },

    // ============================================
    // OPEN AND TEST ALL PLATFORMS (from Options page)
    // ============================================
    async openAndTestAllPlatforms() {
        console.log('Opening all platforms for testing...');
        console.log('Note: You must be logged into each platform for tests to work.\n');

        const results = {};

        for (const [name, url] of Object.entries(this.platforms)) {
            console.log(`\n🌐 Opening ${name}...`);

            // Open tab
            const tab = await chrome.tabs.create({ url, active: false });

            // Wait for load
            await new Promise(r => setTimeout(r, 5000));

            // Send test command
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'RUN_E2E_TESTS'
                });
                results[name] = response;
                console.log(`${name}: ${response?.passed || 0} passed, ${response?.failed || 0} failed`);
            } catch (e) {
                results[name] = { error: e.message };
                console.log(`${name}: Error - ${e.message}`);
            }

            // Close tab after testing
            await chrome.tabs.remove(tab.id);
        }

        console.log('\n📊 All Platform Results:');
        console.table(results);

        return results;
    }
};

// Quick access for running on platform pages
const runPlatformTests = () => BrowserE2ETests.runCurrentPlatformTests();
const testAllPlatforms = () => BrowserE2ETests.openAndTestAllPlatforms();

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  🌐 OmniExporter Browser E2E Tests Loaded                 ║');
console.log('╠═══════════════════════════════════════════════════════════╣');
console.log('║  On Platform Pages (Perplexity, ChatGPT, etc.):           ║');
console.log('║    runPlatformTests() - Test current platform             ║');
console.log('║                                                           ║');
console.log('║  On Options Page (with extension permissions):            ║');
console.log('║    testAllPlatforms() - Open & test all 6 platforms       ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
