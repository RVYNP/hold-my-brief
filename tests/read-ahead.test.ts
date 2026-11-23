import { describe, expect, it } from 'vitest';
import { RECENT_LIMIT, readAheadPaths } from '../src/read-ahead';

const tab = (path: string, loaded = false, extra: { ephemeral?: boolean; problem?: boolean } = {}) => ({ path, loaded, ...extra });

describe('read-ahead', () => {
  it('lists the restored tabs, then Continue reading, then the five most recent documents', () => {
    const list = readAheadPaths({
      tabs: [tab('a', true), tab('b'), tab('c')],
      reading: ['d', 'e'],
      recents: ['a', 'f', 'g', 'h', 'i', 'j', 'k'],
    });
    expect(list).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(RECENT_LIMIT).toBe(5);
  });

  it('never repeats a path and never lists a document that is open and loaded', () => {
    const list = readAheadPaths({
      tabs: [tab('open', true), tab('b'), tab('b')],
      reading: ['b', 'open', 'c', 'c'],
      recents: ['c', 'open', 'b', 'd'],
    });
    expect(list).toEqual(['b', 'c', 'd']);
  });

  it('leaves out the Library page, agent briefs and tabs whose open failed', () => {
    const list = readAheadPaths({
      tabs: [tab('hold-my-brief:library'), tab('hold-my-brief:brief/1', false, { ephemeral: true }), tab('broken', false, { problem: true }), tab('b')],
      reading: [],
      recents: [],
      skip: path => path === 'hold-my-brief:library',
    });
    expect(list).toEqual(['b']);
  });

  it('is empty when there is nothing to warm', () => {
    expect(readAheadPaths({ tabs: [tab('a', true)], reading: [], recents: ['a'] })).toEqual([]);
  });
});
