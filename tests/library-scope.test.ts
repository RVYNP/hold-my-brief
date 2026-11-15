import { describe, expect, it } from 'vitest';
import { parseScope, scopeKey, scopeTitle, type Scope } from '../src/library-scope';

const library = {
  collections: [{ id: 'c1', name: '2-creative-apps', parentId: null }],
  roots: [{ id: 'root:1', name: 'refs', path: null, managed: false }],
};

describe('the saved form of a scope', () => {
  const scopes: Scope[] = [
    { kind: 'all' }, { kind: 'favorites' }, { kind: 'reading' }, { kind: 'unfiled' },
    { kind: 'collection', id: 'c1' }, { kind: 'source', id: 'Some: source' },
    { kind: 'folder', id: 'root:1', path: '' }, { kind: 'folder', id: 'root:1', path: '03_wwe_mag/issue: 2' },
  ];
  it('reads back what was written, whatever the names contain', () => {
    for (const scope of scopes) expect(parseScope(scopeKey(scope))).toEqual(scope);
  });
  it('refuses what it did not write', () => {
    for (const key of [undefined, null, 4, '', 'nope', 'collection:', 'source:', 'folder:', 'folder::x', 'folder:%E0%A4%A:x', 'all:x']) expect(parseScope(key)).toBeUndefined();
  });
});

describe('the Library tab title', () => {
  it('names a plain scope', () => {
    expect(scopeTitle({ kind: 'all' }, library)).toBe('All documents');
    expect(scopeTitle({ kind: 'favorites' }, library)).toBe('Favorites');
    expect(scopeTitle({ kind: 'reading' }, library)).toBe('Continue reading');
    expect(scopeTitle({ kind: 'unfiled' }, library)).toBe('Unfiled');
  });
  it('names a collection as it is shown, and a collection that is gone plainly', () => {
    expect(scopeTitle({ kind: 'collection', id: 'c1' }, library)).toBe('Creative apps');
    expect(scopeTitle({ kind: 'collection', id: 'gone' }, library)).toBe('Collection');
  });
  it('names a folder by its source and its last folder', () => {
    expect(scopeTitle({ kind: 'folder', id: 'root:1', path: '03_wwe_mag' }, library)).toBe('refs › 03_wwe_mag');
    expect(scopeTitle({ kind: 'folder', id: 'root:1', path: 'a/b/03_wwe_mag' }, library)).toBe('refs › 03_wwe_mag');
    expect(scopeTitle({ kind: 'folder', id: 'root:1', path: '' }, library)).toBe('refs');
  });
  it('names a source as it was indexed', () => {
    expect(scopeTitle({ kind: 'source', id: 'Field Guides' }, library)).toBe('Field Guides');
  });
});
