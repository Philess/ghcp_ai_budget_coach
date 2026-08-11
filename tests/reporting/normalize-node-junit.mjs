import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function normalizeNodeJunit(xml) {
    const testcases = xml.match(/<testcase\b[^>]*\/>|<testcase\b[^>]*>[\s\S]*?<\/testcase>/g) || [];
    if (testcases.length === 0) {
        throw new Error('Node JUnit report contains no test cases');
    }

    const failures = testcases.filter(testcase => /<failure\b/.test(testcase)).length;
    const errors = testcases.filter(testcase => /<error\b/.test(testcase)).length;
    const skipped = testcases.filter(testcase => /<skipped\b/.test(testcase)).length;
    const duration = testcases.reduce((total, testcase) => {
        const match = testcase.match(/\btime="([^"]+)"/);
        return total + (match ? Number.parseFloat(match[1]) || 0 : 0);
    }, 0);
    const attributes = `tests="${testcases.length}" failures="${failures}" skipped="${skipped}" errors="${errors}" time="${duration.toFixed(6)}"`;
    const body = testcases.map(testcase => `    ${testcase}`).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<testsuites ${attributes}>
  <testsuite name="Node unit tests" ${attributes}>
${body}
  </testsuite>
</testsuites>
`;
}

async function main() {
    const reportPath = process.argv[2];
    if (!reportPath) throw new Error('Usage: node normalize-node-junit.mjs <report-path>');
    const xml = await readFile(reportPath, 'utf8');
    await writeFile(reportPath, normalizeNodeJunit(xml), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
