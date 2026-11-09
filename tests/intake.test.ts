import { describe, expect, it } from 'vitest';
import { coverCacheSize, rememberRecent } from '../src/covers';
import { intakeGroups, intakeLimit, intakeSource, intakeTitle, movedCollectionIds, moveTargets, newArrivals } from '../src/intake';

const collections = [
  { id: 'ref', name: 'reference', parentId: null }, { id: 'lang', name: '1-languages', parentId: 'ref' }, { id: 'apps', name: '2-creative-apps', parentId: 'ref' },
  { id: 'misc', name: '10-misc', parentId: 'ref' }, { id: 'src', name: 'guides', parentId: null, sourceId: 'folder' }, { id: 'mine', name: 'mine', parentId: null },
];
const doc = (path: string, ...collectionIds: string[]) => ({ path, collectionIds });

describe('what arrived', () => {
  it('is the documents whose path was not there before, in order', () => {
    const after = [doc('a'), doc('b'), doc('c'), doc('d')];
    expect(newArrivals(new Set(['a', 'c']), after).map(item => item.path)).toEqual(['b', 'd']);
    expect(newArrivals(new Set(['a', 'b', 'c', 'd']), after)).toEqual([]);
    expect(newArrivals(new Set(), after)).toHaveLength(4);
  });
  it('is titled by its count', () => {
    expect(intakeTitle(1)).toBe('1 new reference');
    expect(intakeTitle(8)).toBe('8 new references');
  });
  it('names its source: the folder, up to two, else the fallback', () => {
    const from = (...names: (string | undefined)[]) => names.map(name => (name ? { source: { repository: name } } : {}));
    expect(intakeSource(from(undefined, undefined))).toBe('Added files');
    expect(intakeSource([], 'Indexed folder')).toBe('Indexed folder');
    expect(intakeSource(from('reference-docs', 'reference-docs', undefined))).toBe('reference-docs');
    expect(intakeSource(from('a', 'b'))).toBe('a, b');
    expect(intakeSource(from('a', 'b', 'c', 'd'))).toBe('a, b +2');
  });
});

describe('intake groups', () => {
  it('group arrivals by their first known collection, in collection name order (numbers by value), Unfiled last', () => {
    const groups = intakeGroups([doc('loose'), doc('misc1', 'misc'), doc('lang1', 'lang'), doc('apps1', 'apps'), doc('lang2', 'gone', 'lang'), doc('misc2', 'misc', 'lang')], collections);
    expect(groups.map(group => group.name)).toEqual(['Languages', 'Creative apps', 'Misc', 'Unfiled']);
    expect(groups.map(group => group.id)).toEqual(['lang', 'apps', 'misc', undefined]);
    expect(groups[0].items.map(item => item.path)).toEqual(['lang1', 'lang2']);
    expect(groups[2].items.map(item => item.path)).toEqual(['misc1', 'misc2']);
  });
  it('shows the first 60 of a shelf and counts the rest', () => {
    const many = Array.from({ length: 75 }, (_, index) => doc(`p${index}`, 'lang'));
    const [group] = intakeGroups(many, collections);
    expect(intakeLimit).toBe(60);
    expect(group.shown).toHaveLength(60); expect(group.shown[59].path).toBe('p59'); expect(group.more).toBe(15); expect(group.items).toHaveLength(75);
    expect(intakeGroups(many.slice(0, 60), collections)[0].more).toBe(0);
    expect(intakeGroups(many, collections, 10)[0].shown).toHaveLength(10);
  });
  it('has no groups for no arrivals', () => { expect(intakeGroups([], collections)).toEqual([]); });
});

describe('moving a group to another shelf', () => {
  const full = collections as Parameters<typeof moveTargets>[0];
  it('offers every personal collection but the current one, labelled by path, then Unfiled when the group can leave its collection', () => {
    expect(moveTargets(full, 'lang').map(target => target.label)).toEqual(['Mine', 'Reference', 'Reference › Creative apps', 'Reference › Misc', 'Unfiled']);
    expect(moveTargets(full, 'lang').at(-1)).toEqual({ id: null, label: 'Unfiled' });
    expect(moveTargets(full, undefined).map(target => target.label)).not.toContain('Unfiled');
  });
  it('never offers a collection owned by an indexed folder, and nothing to leave one for Unfiled', () => {
    expect(moveTargets(full, 'src').map(target => target.id)).not.toContain('src');
    expect(moveTargets(full, 'src').map(target => target.label)).not.toContain('Unfiled');
    expect(moveTargets(full.filter(collection => collection.sourceId), 'src')).toEqual([]);
  });
  it('puts the target first and leaves the old personal shelf, but keeps what an indexed folder owns', () => {
    expect(movedCollectionIds(['lang', 'x'], full, 'lang', 'apps')).toEqual(['apps', 'x']);
    expect(movedCollectionIds(['lang'], full, 'lang', null)).toEqual([]);
    expect(movedCollectionIds([], full, undefined, 'apps')).toEqual(['apps']);
    expect(movedCollectionIds(['src', 'x'], full, 'src', 'mine')).toEqual(['mine', 'src', 'x']);
    expect(movedCollectionIds(['src'], full, 'src', null)).toEqual(['src']);
    expect(movedCollectionIds(['apps', 'lang'], full, 'lang', 'apps')).toEqual(['apps']);
  });
});

describe('the cover cache', () => {
  it('keeps the most recently used entries, dropping the oldest beyond its cap', () => {
    const cache = new Map<number, string>();
    for (let key = 0; key < 5; key++) rememberRecent(cache, key, `v${key}`, 3);
    expect([...cache.keys()]).toEqual([2, 3, 4]);
    rememberRecent(cache, 2, 'again', 3); rememberRecent(cache, 5, 'v5', 3);
    expect([...cache.keys()]).toEqual([4, 2, 5]); expect(cache.get(2)).toBe('again');
    expect(coverCacheSize).toBe(400);
  });
});
