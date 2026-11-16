import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pane } from '../src/pane';
import type { Position } from '../src/types';
import type { Opened } from '../src/bridge';

const doc = { id: 'abc', path: 'abc/book.txt', name: 'book.txt', format: 'txt' } as Opened;
const place = (line: number, locator = { type: 'line', line }) => ({ label: `Line ${line} of 100`, fraction: line / 100, locator, scrub: { unit: 'line', current: line, total: 100 } }) as unknown as Position;

function pane() {
  const persist = vi.fn(async () => {}), notify = vi.fn();
  const target = new Pane<object>({ persist, notify });
  target.active = doc; target.position = place(10);
  return { target, persist, notify };
}

afterEach(() => vi.useRealTimers());

describe('a pane\'s load requests', () => {
  it('drops the result of a load that a newer one replaced', () => {
    const { target } = pane();
    const first = target.beginLoad();
    const second = target.beginLoad();
    expect(target.isCurrent(first)).toBe(false);
    expect(target.endLoad(first)).toBe(false);
    expect(target.isCurrent(second)).toBe(true);
    expect(target.endLoad(second)).toBe(true);
  });

  it('undoes the load in flight when another begins, and leaves the new one\'s state alone when a stale one ends', () => {
    const { target } = pane();
    const undone = vi.fn(), tab = {};
    const first = target.beginLoad(tab);
    target.cancelPending = undone;
    expect(target.loadingTarget).toBe(tab);
    const second = target.beginLoad();
    expect(undone).toHaveBeenCalledTimes(1);
    const later = vi.fn(); target.cancelPending = later;
    target.endLoad(first);
    expect(target.cancelPending).toBe(later);
    target.endLoad(second);
    expect(target.cancelPending).toBeUndefined();
    expect(target.loadingTarget).toBeUndefined();
  });

  it('cancelling gives up the load in flight', () => {
    const { target } = pane();
    const undone = vi.fn(), token = target.beginLoad({});
    target.cancelPending = undone;
    target.cancelLoad();
    expect(undone).toHaveBeenCalledTimes(1);
    expect(target.isCurrent(token)).toBe(false);
    expect(target.loadingTarget).toBeUndefined();
  });
});

describe('a pane\'s saving', () => {
  it('writes once while the position is dirty, and not again until it changes', async () => {
    const { target, persist } = pane();
    await target.flush();
    expect(persist).not.toHaveBeenCalled();
    target.markDirty();
    clearTimeout(target.saveTimer);
    await Promise.all([target.flush(), target.flush()]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(doc, { type: 'line', line: 10 }, target.options, expect.objectContaining({ fraction: .1 }));
    target.position = place(20); target.markDirty(); clearTimeout(target.saveTimer);
    await target.flush();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('writes a copy: moving on while the write is queued does not change what is written', async () => {
    const { target, persist } = pane(), locator = { type: 'line', line: 10 };
    target.position = place(10, locator);
    target.markDirty(); clearTimeout(target.saveTimer);
    const written = target.flush();
    target.options.fontSize = 99; locator.line = 77;
    await written;
    const [, sent, options] = persist.mock.calls[0] as unknown as [Opened, { line: number }, { fontSize: number }];
    expect(sent.line).toBe(10);
    expect(options.fontSize).not.toBe(99);
  });

  it('saves on its own 650 ms after the last change', async () => {
    vi.useFakeTimers();
    const { target, persist } = pane();
    target.markDirty(); await vi.advanceTimersByTimeAsync(400);
    target.markDirty(); await vi.advanceTimersByTimeAsync(400);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed write dirty and says so, so the next flush tries again', async () => {
    const { target, persist, notify } = pane();
    persist.mockRejectedValueOnce(new Error('disk full'));
    target.markDirty(); clearTimeout(target.saveTimer);
    await target.flush();
    expect(target.dirty).toBe(true);
    expect(notify).toHaveBeenCalledWith('Progress could not be saved. Reading is still available.', true);
    await target.flush();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(target.dirty).toBe(false);
  });

  it('does not re-arm a failed write for a document that is no longer shown', async () => {
    const { target, persist } = pane();
    persist.mockRejectedValueOnce(new Error('disk full'));
    target.markDirty(); clearTimeout(target.saveTimer);
    const written = target.flush();
    target.show(undefined);
    await written;
    expect(target.dirty).toBe(false);
  });
});
