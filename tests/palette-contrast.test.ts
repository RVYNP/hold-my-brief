import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, glowSchemes, glows, palettes, type Glow, type Rgb } from '../src/theme';

// Read from disk: Vitest replaces CSS imports (even ?raw) with empty modules.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const libraryCss = readFileSync(new URL('../src/library.css', import.meta.url), 'utf8');
const themeBoot = readFileSync(new URL('../public/theme-boot.js', import.meta.url), 'utf8');

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
    // Every px size in a font or font-size declaration, spaced or compact (`font:10px` included).
    const offenders = [css, libraryCss]
      .flatMap(sheet => sheet.split('\n'))
      .filter(line => [...line.matchAll(/font(?:-size)?\s*:[^;}]*?(?<![\d.])(\d+(?:\.\d+)?)px/g)].some(match => Number(match[1]) < 11));
    expect(offenders).toEqual([]);
  });
});

/**
 * The ten glow themes (Aurora … Moss, ported from Tracks). They are held to Tracks' method: every text and
 * status token reaches 4.5:1 on the page, the panel and the card with no glow, with the first glow at its
 * full stop and with the second at its full stop. Panel and card carry alpha, so each is composited over the
 * glowed page first (source-over in sRGB, then WCAG luminance), both exactly and rounded to 8 bits as a
 * browser stores it. The two glows are never added: their full stops are a window height apart.
 * Beyond Tracks: the library rail and drawer sit on the workspace, so the card over the panel is checked too.
 */
type Rgba = { r: number; g: number; b: number; a: number };
const rgbaOf = (value: string): Rgba => {
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (!match) throw new Error(`Not a hex colour: ${value}`);
  const n = parseInt(match[1], 16);
  return { r: n >> 16, g: n >> 8 & 255, b: n & 255, a: match[2] ? parseInt(match[2], 16) / 255 : 1 };
};
const asRgb = ({ r, g, b }: Rgba): Rgb => [r, g, b];
/** Source-over; `round` gives the 8-bit result a browser stores. */
function over(top: Rgba, bottom: Rgba, round: boolean): Rgba {
  const channel = (t: number, b: number) => { const value = t * top.a + b * (1 - top.a); return round ? Math.round(value) : value; };
  return { r: channel(top.r, bottom.r), g: channel(top.g, bottom.g), b: channel(top.b, bottom.b), a: 1 };
}

function glowBlock(name: Glow) {
  const block = new RegExp(`\\[data-palette='${name}'\\] \\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`No [data-palette='${name}'] block in style.css`);
  const raw: Record<string, string> = {};
  for (const [, token, value] of block[1].matchAll(/--([\w-]+): ([^;]+);/g)) raw[token] = value.trim();
  // Opaque colours, `var(--token)` and the one derived form, color-mix(in srgb, var(--a) N%, var(--b)).
  const resolve = (token: string): Rgba => {
    const value = raw[token];
    if (value === undefined) throw new Error(`${name} has no --${token}`);
    const alias = /^var\(--([\w-]+)\)$/.exec(value);
    if (alias) return resolve(alias[1]);
    const mix = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/.exec(value);
    if (mix) { const [a, b, weight] = [resolve(mix[1]), resolve(mix[3]), Number(mix[2]) / 100]; return { r: a.r * weight + b.r * (1 - weight), g: a.g * weight + b.g * (1 - weight), b: a.b * weight + b.b * (1 - weight), a: 1 }; }
    return rgbaOf(value);
  };
  return { raw, get: resolve, scheme: /color-scheme: (\w+);/.exec(block[1])?.[1] };
}

const glowCases = glows.map(name => ({ name, ...glowBlock(name) }));
const textTokens = ['fg', 'muted', 'accent-ink', 'accent', 'error', 'notice-ink'] as const;

describe.each(glowCases)('glow $name', ({ name, get, scheme }) => {
  it('is fixed to its own scheme', () => {
    expect(scheme).toBe(glowSchemes[name]);
  });
  it('reads every text and status token at 4.5:1 on page, panel and card, with no glow and with each glow alone', () => {
    const failures: string[] = [];
    const page = get('chrome'), panel = get('glass-surface'), card = get('glass-raise');
    for (const round of [false, true]) for (const [label, glow] of [['no glow', null], ['grad-a', get('grad-a')], ['grad-b', get('grad-b')]] as const) {
      const base = glow ? over(glow, page, round) : page;
      const backgrounds = { page: base, panel: over(panel, base, round), card: over(card, base, round), 'card over panel': over(card, over(panel, base, round), round) };
      for (const [where, background] of Object.entries(backgrounds)) for (const token of textTokens) {
        const ratio = contrast(asRgb(get(token)), asRgb(background));
        if (ratio < 4.5) failures.push(`${token} on ${where}, ${label}${round ? ' (8-bit)' : ''}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
  it('keeps the opaque surfaces readable too: text on the surface, card, raised bar and stage, ink on its paper', () => {
    for (const token of ['surface', 'card', 'raise', 'stage', 'chrome']) for (const text of ['fg', 'muted']) expect(contrast(asRgb(get(text)), asRgb(get(token))), `${text} on ${token}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(asRgb(get('fg')), asRgb(get('surface')))).toBeGreaterThanOrEqual(7);
    expect(contrast(asRgb(get('ink')), asRgb(get('paper')))).toBeGreaterThanOrEqual(7);
    for (const text of ['notice-ink']) expect(contrast(asRgb(get(text)), asRgb(get('notice')))).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps accent text legible on its tint, and labels on the primary and danger buttons', () => {
    expect(contrast(asRgb(get('accent-ink')), asRgb(get('accent-soft')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(asRgb(get('on-accent')), asRgb(get('accent-fill')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(asRgb(get('on-accent')), asRgb(get('danger')))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(asRgb(get('fg')), asRgb(get('search-hit')))).toBeGreaterThanOrEqual(4.5);
  });
  it('carries the opaque surface and card as the panel and card composited over the page', () => {
    const page = get('chrome');
    expect(asRgb(over(get('glass-surface'), page, true))).toEqual(asRgb(get('surface')));
    expect(asRgb(over(get('glass-raise'), page, true))).toEqual(asRgb(get('card')));
    expect(asRgb(get('paper'))).toEqual(asRgb(get('surface')));
  });
  it('has two translucent glow stops and translucent panel and card', () => {
    for (const token of ['grad-a', 'grad-b', 'glass-surface', 'glass-raise']) expect(get(token).a, token).toBeGreaterThan(0);
    for (const token of ['grad-a', 'grad-b', 'glass-surface', 'glass-raise']) expect(get(token).a, token).toBeLessThan(1);
  });
});

describe('the glow', () => {
  it('can fail the readability check: a stop strong enough to wash text out is caught', () => {
    const { get } = glowCases.find(entry => entry.name === 'aurora')!;
    const washed = over({ r: 255, g: 255, b: 255, a: 0.6 }, get('chrome'), false);
    expect(contrast(asRgb(get('fg')), asRgb(washed))).toBeLessThan(4.5);
  });
  it('is painted as the page colour under Tracks\' two radial glows, fixed to the window', () => {
    expect(css).toContain('--glow-image: radial-gradient(ellipse 70% 55% at 62% -8%, var(--grad-a), transparent), radial-gradient(ellipse 65% 60% at 95% 100%, var(--grad-b), transparent);');
    const root = /\r?\n  background-color: var\(--chrome\);\r?\n  background-image: var\(--glow-paint\);\r?\n  background-attachment: var\(--glow-attach\);/;
    expect(css).toMatch(root);
  });
  it('is fixed to the window in every glow family and in no other', () => {
    for (const { raw } of glowCases) { expect(raw['glow-attach']).toBe('fixed'); expect(raw['glow-paint']).toBe('var(--glow-image)'); }
    expect(/:root, \[data-palette\] \{[^}]*--glow-paint: none;\s*--glow-attach: scroll;/.test(css)).toBe(true);
  });
  it('is transparent in every other family, so they paint exactly their own chrome', () => {
    expect(/:root, \[data-palette\] \{\s*--grad-a: transparent;\s*--grad-b: transparent;/.test(css)).toBe(true);
    for (const name of palettes) expect(family(name), name).not.toHaveProperty('grad-a');
    for (const name of palettes) expect(new RegExp(`\\[data-palette='${name}'\\] \\{[^}]*--(grad|glass)-`).test(css), name).toBe(false);
  });
  it('is not drawn, and the panel and card are opaque, under reduced transparency, more contrast and forced colours', () => {
    const query = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\), \(forced-colors: active\) \{\s*:is\(([^)]*(?:\)[^)]*)*?)\) \{([^}]*)\}/.exec(css);
    expect(query, 'the accessibility block').not.toBeNull();
    for (const name of glows) expect(query![1]).toContain(`[data-palette='${name}']`);
    expect(query![2].replace(/\s+/g, ' ').trim()).toBe('--grad-a: transparent; --grad-b: transparent; --glass-chrome: var(--chrome); --glass-surface: var(--surface); --glass-host: var(--surface); --glass-stage: var(--stage); --glass-raise-base: var(--card); --glass-raise-paint: none; --glass-raise-attach: scroll;');
  });
  it('is applied before first paint from the same scheme table', () => {
    const table = /const glows = \{([^}]*)\};/.exec(themeBoot)![1];
    const boot = Object.fromEntries([...table.matchAll(/(\w+): '(light|dark)'/g)].map(([, name, scheme]) => [name, scheme]));
    expect(boot).toEqual(glowSchemes);
  });
});
