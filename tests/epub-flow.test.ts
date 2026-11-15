import { describe, expect, it } from 'vitest';
import { BLOCK_SHARE, PRE_SECTIONS, SAMPLE_SECTIONS, codeHeavy, type SectionMix } from '../src/epub-flow';
import { formatPageShort } from '../src/epub-position';

const prose: SectionMix = { pre: 0, blockChars: 0, chars: 5000 };
const code: SectionMix = { pre: 2, blockChars: 400, chars: 5000 };

describe('codeHeavy', () => {
  it('is false for a novel: prose chapters, with the odd table at most', () => {
    expect(codeHeavy(Array.from({ length: 12 }, () => prose))).toBe(false);
    expect(codeHeavy([...Array.from({ length: 9 }, () => prose), { pre: 0, blockChars: 300, chars: 5000 }])).toBe(false);
    expect(codeHeavy([])).toBe(false);
  });

  it('is true when <pre> shows up in at least three of the first ten spine items', () => {
    const book = (withCode: number) => Array.from({ length: 12 }, (_, index) => (index < withCode ? code : prose));
    expect(PRE_SECTIONS).toBe(3);
    expect(codeHeavy(book(PRE_SECTIONS))).toBe(true);
    expect(codeHeavy(book(PRE_SECTIONS - 1))).toBe(false);
  });

  it('looks no further than the first ten spine items', () => {
    const late = [...Array.from({ length: SAMPLE_SECTIONS }, () => prose), code, code, code, code];
    expect(codeHeavy(late)).toBe(false);
  });

  it('is true when <pre> and <table> hold a fifth of the text even if few sections have <pre>', () => {
    const tables: SectionMix = { pre: 0, blockChars: 2500, chars: 5000 };
    expect(BLOCK_SHARE).toBe(0.2);
    expect(codeHeavy([tables, prose, prose])).toBe(false); // 2500 of 15000 is a sixth: under the share
    expect(codeHeavy([tables, tables, prose])).toBe(true); // 5000 of 15000 is a third
  });

  it('is false just under the share and true at it', () => {
    expect(codeHeavy([{ pre: 0, blockChars: 1999, chars: 10000 }])).toBe(false);
    expect(codeHeavy([{ pre: 0, blockChars: 2000, chars: 10000 }])).toBe(true);
  });
});

describe('formatPageShort', () => {
  it('marks an estimated page and not a printed one', () => {
    expect(formatPageShort({ page: '34', estimated: true })).toBe('p. ~34');
    expect(formatPageShort({ page: 'xii', estimated: false })).toBe('p. xii');
  });
});
