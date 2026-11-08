import { describe, expect, it } from 'vitest';
import { Abandoned, createExclusive } from '../src/exclusive';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('exclusive queue', () => {
  it('runs one job at a time, in order', async () => {
    const run = createExclusive(); const log: string[] = []; let running = 0, peak = 0;
    const job = (name: string) => run(() => true, async () => { peak = Math.max(peak, ++running); log.push(`start ${name}`); await tick(); log.push(`end ${name}`); running--; return name; });
    expect(await Promise.all([job('a'), job('b'), job('c')])).toEqual(['a', 'b', 'c']);
    expect(peak).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('never starts a job that is no longer wanted by the time its turn comes, and the line moves on', async () => {
    const run = createExclusive(); let wanted = true; const started: string[] = [];
    const first = run(() => true, async () => { started.push('first'); await tick(); wanted = false; });
    const abandoned = run(() => wanted, async () => { started.push('abandoned'); });
    const last = run(() => true, async () => { started.push('last'); return 'done'; });
    await first;
    await expect(abandoned).rejects.toBeInstanceOf(Abandoned);
    expect(await last).toBe('done');
    expect(started).toEqual(['first', 'last']);
  });

  it('is not blocked or poisoned by a job that fails', async () => {
    const run = createExclusive();
    const broken = run(() => true, async () => { throw Error('render failed'); });
    const next = run(() => true, async () => 'ok');
    await expect(broken).rejects.toThrow('render failed');
    expect(await next).toBe('ok');
  });

  it('checks wanted() when the turn comes, not when the job was queued', async () => {
    const run = createExclusive(); let asked = 0;
    const blocker = run(() => true, () => new Promise<void>(resolve => setTimeout(resolve, 5)));
    const job = run(() => { asked++; return true; }, async () => 'ran');
    expect(asked).toBe(0);
    await blocker; expect(await job).toBe('ran'); expect(asked).toBe(1);
  });
});
