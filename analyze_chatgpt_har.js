const fs = require('fs');
const path = require('path');

const harPath = path.join(__dirname, '{.txt');
const outputPath = path.join(__dirname, 'har_analysis_output.txt');
let output = '';

function log(msg) {
    console.log(msg);
    output += msg + '\n';
}

log(`Reading HAR file: ${harPath}`);

try {
    const raw = fs.readFileSync(harPath, 'utf8');
    const har = JSON.parse(raw);

    log(`HAR Version: ${har.log.version}`);
    log(`Total Entries: ${har.log.entries.length}`);

    log('\n--- FINDING "conversation" URLs and HEADERS ---');
    har.log.entries.forEach(entry => {
        const url = entry.request.url;
        if (url.includes('conversation')) {
            log(`${entry.request.method} ${url} -> ${entry.response.status}`);
            if (url.includes('conversations?offset')) {
                log('HEADERS:');
                entry.request.headers.forEach(h => log(`  ${h.name}: ${h.value}`));
            }
        }
    });

    log('\n--- FINDING "backend-api" URLs ---');
    har.log.entries.forEach(entry => {
        const url = entry.request.url;
        if (url.includes('backend-api') && !url.includes('conversation')) {
            log(`${entry.request.method} ${url} -> ${entry.response.status}`);
        }
    });

    fs.writeFileSync(outputPath, output);
    console.log(`Output written to ${outputPath}`);

} catch (e) {
    console.error('Error parsing HAR:', e.message);
}
