// Regenerates e2e/timings.json from Playwright JSON reports (one per CI shard):
//   node scripts/e2e-timings.mjs shard-1/e2e-report.json shard-2/e2e-report.json shard-3/e2e-report.json
// A file's time is the sum of its tests' durations, in seconds. Reports come from
// `npx playwright test --reporter=json` with PLAYWRIGHT_JSON_OUTPUT_NAME set.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const output = new URL('../e2e/timings.json', import.meta.url);

/** Adds the durations of every test result under `suite` to `seconds[file]` (milliseconds in, seconds out). */
function collect(suite, seconds, inherited) {
  const file = suite.file ? `e2e/${suite.file.replace(/\\/g, '/').replace(/^e2e\//, '')}` : inherited;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) seconds[file] = (seconds[file] ?? 0) + result.duration / 1000;
    }
  }
  for (const child of suite.suites ?? []) collect(child, seconds, file);
}

export function timingsFromReports(reports) {
  const seconds = {};
  for (const report of reports) for (const suite of report.suites ?? []) collect(suite, seconds, undefined);
  return Object.fromEntries(
    Object.keys(seconds)
      .sort()
      .map((file) => [file, Math.round(seconds[file] * 10) / 10]),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: node scripts/e2e-timings.mjs <report.json>...');
    process.exit(2);
  }
  const timings = timingsFromReports(paths.map((path) => JSON.parse(readFileSync(path, 'utf8'))));
  writeFileSync(output, `${JSON.stringify(timings, null, 2)}\n`);
  const total = Object.values(timings).reduce((sum, value) => sum + value, 0);
  console.log(`e2e/timings.json: ${Object.keys(timings).length} files, ${total.toFixed(0)} s`);
}
