import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, palettes, type Rgb } from '../src/theme';

// Read from disk: Vitest replaces CSS imports (even ?raw) with empty modules.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const libraryCss = readFileSync(new URL('../src/library.css', import.meta.url), 'utf8');

/**
 * Every theme family, in both modes, must keep its text legible (WCAG 2 AA, 4.5:1 for text and
 * 7:1 for the reading page). The tokens are read from the stylesheet itself, so a family edited
 * by hand cannot quietly drop below the line.
 */
const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, weight: number): Rgb => a.map((channel, i) => Math.round(channel * weight + b[i] * (1 - weight))) as Rgb;

function family(name: string): Record<string, [Rgb, Rgb]> {
  const block = new RegExp(`\\[data-palette='${name}'\\] \\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`No [data-palette='${name}'] block in style.css`);
  const tokens: Record<string, [Rgb, Rgb]> = {};
  for (const [, token, light, dark] of block[1].matchAll(/--([\w-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/gi)) tokens[token] = [hex(light), hex(dark)];
  return tokens;
}

const white: Rgb = [255, 255, 255];
const cases = palettes.flatMap(name => (['light', 'dark'] as const).map((mode, column) => {
  const tokens = family(name), get = (token: string) => tokens[token][column];
  // --raise is derived in :root as 75% surface, 25% chrome (the find bar, the library panel).
  return { name: `${name} ${mode}`, get, raise: mix(get('surface'), get('chrome'), 0.75) };
}));

describe.each(cases)('$name', ({ get, raise }) => {
  it('reads body text and the page comfortably', () => {
    expect(contrast(get('fg'), get('surface'))).toBeGreaterThanOrEqual(7);
    expect(contrast(get('ink'), get('paper'))).toBeGreaterThanOrEqual(7);
  });
  it('keeps secondary text legible on every surface it sits on, the toolbar included', () => {
    for (const background of [get('surface'), get('card'), get('chrome'), raise]) expect(contrast(get('muted'), background)).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps accent text legible, also on its tinted selection', () => {
    expect(contrast(get('accent-ink'), get('surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get('accent-ink'), get('accent-soft'))).toBeGreaterThanOrEqual(4.5);
  });
  it('carries white labels on the primary button', () => {
    expect(contrast(white, get('accent-fill'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('text set in the faint tone', () => {
  // --faint is for marks that are not read (scrollbars, disabled rows, step arrows). It measures
  // about 2:1, so text that has to be read (headings, hints, placeholders, key labels) uses --muted.
  const sheets = [css, libraryCss];
  it('is only used where the text is decorative or disabled', () => {
    const allowed = /aria-disabled|::before|scrollbar/;
    const offenders = sheets.flatMap(sheet => sheet.split('\n')).filter(line => /(^|[;{ ])color: [^;]*var\(--faint\)/.test(line) && !allowed.test(line));
    expect(offenders).toEqual([]);
  });
});

describe('minimum text size', () => {
  it('sets no text below 11px', () => {
    const offenders = [css, libraryCss]
      .flatMap(sheet => sheet.split('\n'))
      .filter(line => /(^|[;{ ])font(-size)?:[^;}]*(^|[^\d.])([0-9]|10)(\.\d+)?px/.test(line));
    expect(offenders).toEqual([]);
  });
});
