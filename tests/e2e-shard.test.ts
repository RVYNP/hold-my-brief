import { describe, expect, it } from 'vitest';
import { assign, listSpecs, median, readTimings } from '../scripts/e2e-shard.mjs';
import { timingsFromReports } from '../scripts/e2e-timings.mjs';

const TOTAL = 3;
const synthetic: Record<string, number> = {
  'e2e/a.spec.ts': 100, 'e2e/b.spec.ts': 80, 'e2e/c.spec.ts': 60, 'e2e/d.spec.ts': 50,
  'e2e/e.spec.ts': 40, 'e2e/f.spec.ts': 30, 'e2e/g.spec.ts': 20, 'e2e/h.spec.ts': 10,
};

describe('e2e shards', () => {
  it('puts every spec file on disk in exactly one shard', () => {
    const specs = listSpecs();
    expect(specs.length).toBeGreaterThan(TOTAL);
    const placed = assign(specs, readTimings(), TOTAL).flatMap((shard: { files: string[] }) => shard.files);
    expect([...placed].sort()).toEqual([...specs].sort());
  });

  it('balances the recorded times to within the largest file', () => {
    const files = Object.keys(synthetic);
    const seconds = assign(files, synthetic, TOTAL).map((shard: { seconds: number }) => shard.seconds);
    expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThanOrEqual(Math.max(...Object.values(synthetic)));
    expect(seconds.reduce((sum: number, value: number) => sum + value, 0)).toBe(390);
  });

  it('balances the committed timings the same way', () => {
    const timings = readTimings();
    const specs = listSpecs();
    const largest = Math.max(...specs.map((file: string) => timings[file] ?? median(Object.values(timings))));
    const seconds = assign(specs, timings, TOTAL).map((shard: { seconds: number }) => shard.seconds);
    expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThanOrEqual(largest);
  });

  it('counts a file without recorded time as the median', () => {
    const files = [...Object.keys(synthetic), 'e2e/new.spec.ts'];
    const shards = assign(files, synthetic, TOTAL);
    expect(median(Object.values(synthetic))).toBe(45);
    expect(shards.flatMap((shard: { files: string[] }) => shard.files).sort()).toEqual([...files].sort());
    expect(shards.reduce((sum: number, shard: { seconds: number }) => sum + shard.seconds, 0)).toBe(390 + 45);
  });

  it('ignores timings of files that no longer exist, and copes with no timings at all', () => {
    const shards = assign(['e2e/a.spec.ts', 'e2e/b.spec.ts'], { 'e2e/gone.spec.ts': 999, 'e2e/a.spec.ts': 5 }, TOTAL);
    expect(shards.flatMap((shard: { files: string[] }) => shard.files).sort()).toEqual(['e2e/a.spec.ts', 'e2e/b.spec.ts']);
    expect(shards.reduce((sum: number, shard: { seconds: number }) => sum + shard.seconds, 0)).toBe(10);
    const none = assign(['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts'], {}, TOTAL);
    expect(none.map((shard: { files: string[] }) => shard.files.length)).toEqual([1, 1, 1]);
  });

  it('is deterministic whatever order the files arrive in', () => {
    const files = Object.keys(synthetic);
    const forward = assign(files, synthetic, TOTAL);
    expect(assign([...files].reverse(), synthetic, TOTAL)).toEqual(forward);
    expect(assign(files, { ...synthetic }, TOTAL)).toEqual(forward);
  });

  it('breaks ties by name', () => {
    const shards = assign(['e2e/b.spec.ts', 'e2e/a.spec.ts', 'e2e/c.spec.ts', 'e2e/d.spec.ts'], {}, 2);
    expect(shards.map((shard: { files: string[] }) => shard.files)).toEqual([['e2e/a.spec.ts', 'e2e/c.spec.ts'], ['e2e/b.spec.ts', 'e2e/d.spec.ts']]);
  });

  it('rejects a shard count that is not a positive integer', () => {
    expect(() => assign(['e2e/a.spec.ts'], {}, 0)).toThrow();
  });
});

describe('e2e timings', () => {
  it('sums test durations per spec file across reports and nested suites', () => {
    const result = (duration: number) => ({ results: [{ duration }] });
    const one = { suites: [{ file: 'a.spec.ts', specs: [{ tests: [result(1500)] }], suites: [{ file: 'a.spec.ts', specs: [{ tests: [result(500)] }] }] }] };
    const two = { suites: [{ file: 'b.spec.ts', specs: [{ tests: [result(250), result(250)] }] }] };
    expect(timingsFromReports([one, two])).toEqual({ 'e2e/a.spec.ts': 2, 'e2e/b.spec.ts': 0.5 });
  });
});
