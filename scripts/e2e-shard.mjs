// Prints the Playwright spec files of one CI shard, one per line, e.g.
//   npx playwright test $(node scripts/e2e-shard.mjs 2 3)
//
// The specs are listed from e2e/*.spec.ts on disk. Each file's cost is its recorded
// seconds in e2e/timings.json (regenerate with scripts/e2e-timings.mjs); a file the
// timings do not know costs the median of the known ones. Files are assigned greedily,
// longest first, to the least-loaded shard, so the same input always gives the same
// shards and every spec lands in exactly one of them.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

/** Spec files on disk, as repo-relative posix paths, sorted. */
export function listSpecs(dir = new URL('e2e/', root)) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => `e2e/${name}`);
}

/** The committed timings: `{ "e2e/<file>.spec.ts": seconds }`. A missing file means no timings. */
export function readTimings(file = new URL('e2e/timings.json', root)) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

export function median(values) {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Seconds per file: recorded time, or the median of the recorded times of the files given. */
export function costs(files, timings) {
  const known = files.map((file) => timings[file]).filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  const fallback = median(known);
  return new Map(files.map((file) => [file, Number.isFinite(timings[file]) && timings[file] >= 0 ? timings[file] : fallback]));
}

/** Splits `files` into `total` shards; returns an array of `{ files, seconds }`, index 0 = shard 1. */
export function assign(files, timings, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard total must be a positive integer, got ${total}`);
  const cost = costs(files, timings);
  const shards = Array.from({ length: total }, () => ({ files: [], seconds: 0 }));
  const order = [...files].sort((a, b) => cost.get(b) - cost.get(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const file of order) {
    let lightest = shards[0];
    for (const shard of shards) if (shard.seconds < lightest.seconds) lightest = shard;
    lightest.files.push(file);
    lightest.seconds += cost.get(file);
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = Number(process.argv[2]);
  const total = Number(process.argv[3]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
    console.error(`usage: node ${fileURLToPath(import.meta.url).split(/[\\/]/).slice(-2).join('/')} <index 1..total> <total>`);
    process.exit(2);
  }
  const shard = assign(listSpecs(), readTimings(), total)[index - 1];
  process.stdout.write(shard.files.map((file) => `${file}\n`).join(''));
}
