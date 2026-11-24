// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { agentIcon, artFor, assignArt, createDriver, iconStates, ICON_MAX_BYTES, loadAssignedArt, markerRanges, toneOf, validateIconFile, withLayerClasses, type IconState, type Player, type Range, type Ranges } from '../src/agent-appearance';

const ranges: Ranges = { idle: [0, 30], listening: [30, 60], acting: [60, 90], arriving: [90, 120] };
const markers = (names: readonly string[] = iconStates) => names.map(name => ({ cm: name, tm: ranges[name as IconState][0], dr: 30 }));
/** A small Lottie animation: 96 × 96, the four markers and, unless `change` says otherwise, nothing external. */
function lottie(change: (icon: Record<string, any>) => void = () => undefined): string {
  const icon: Record<string, any> = { v: '5.7.0', fr: 30, ip: 0, op: 120, w: 96, h: 96, layers: [], assets: [], markers: markers() };
  change(icon);
  return JSON.stringify(icon);
}
const reasonsOf = (text: string) => { const check = validateIconFile(text); return check.ok ? [] : check.reasons; };

describe('markers', () => {
  it('read a frame range for each of the four states', () => {
    expect(markerRanges(JSON.parse(lottie()))).toEqual(ranges);
    expect(markerRanges({ markers: [{ cm: ' listening ', tm: 5, dr: 10 }, ...markers(['idle', 'acting', 'arriving'])] })?.listening).toEqual([5, 15]);
  });
  it('are all required, with a length', () => {
    expect(markerRanges({ markers: markers(['idle', 'listening', 'acting']) })).toBeUndefined();
    expect(markerRanges({ markers: [{ cm: 'idle', tm: 0, dr: 0 }, ...markers(['listening', 'acting', 'arriving'])] })).toBeUndefined();
    expect(markerRanges(null)).toBeUndefined();
  });
});

describe('icon files', () => {
  it('pass when they are Lottie with the four markers and only embedded images', () => {
    const png = lottie(icon => { icon.assets = [{ id: 'a', w: 4, h: 4, u: '', p: 'data:image/png;base64,iVBORw0KGgo=', e: 1 }, { id: 'b', u: '', p: 'data:image/webp;base64,UklGRg==', e: 1 }, { id: 'comp', layers: [] }]; });
    const check = validateIconFile(png);
    expect(check.ok && check.ranges).toEqual(ranges);
  });
  it('are refused when over 512 KB, with the size in the reason', () => {
    const big = lottie(icon => { icon.nm = 'x'.repeat(ICON_MAX_BYTES); });
    expect(reasonsOf(big)).toEqual([expect.stringMatching(/^The file is 513 KB; an icon may be at most 512 KB\.$/)]);
    expect(validateIconFile(lottie(icon => { icon.nm = 'x'.repeat(ICON_MAX_BYTES - 400); })).ok).toBe(true);
  });
  it('are refused when an image is not embedded PNG or WebP data', () => {
    const linked = (asset: Record<string, unknown>) => reasonsOf(lottie(icon => { icon.assets = [asset]; }));
    expect(linked({ id: 'face', u: 'images/', p: 'face.png', e: 0 })).toEqual(['Asset "face" refers to a file outside the animation. Images must be embedded as PNG or WebP data.']);
    expect(linked({ id: 'web', u: '', p: 'https://example.test/a.png', e: 1 })[0]).toContain('outside the animation');
    expect(linked({ id: 'unflagged', u: '', p: 'data:image/png;base64,AAAA' })[0]).toContain('outside the animation');
    expect(linked({ id: 'vector', u: '', p: 'data:image/svg+xml;base64,PHN2Zy8+', e: 1 })).toEqual(['Asset "vector" is embedded as image/svg+xml; only base64 PNG or WebP images are allowed.']);
    expect(linked({ id: 'plain', u: '', p: 'data:image/png,AAAA', e: 1 })[0]).toContain('only base64 PNG or WebP');
    expect(reasonsOf(lottie(icon => { icon.fonts = { list: [{ fName: 'Brand-Bold', fPath: 'https://example.test/brand.woff' }] }; }))).toEqual(['Font "Brand-Bold" loads from outside the animation.']);
  });
  it('are refused when a marker is missing, empty or repeated', () => {
    expect(reasonsOf(lottie(icon => { icon.markers = markers(['idle', 'listening']); }))).toEqual(['Missing markers: acting, arriving. An icon needs idle, listening, acting and arriving.']);
    expect(reasonsOf(lottie(icon => { icon.markers = markers(['idle', 'listening', 'acting']); }))).toEqual(['Missing marker: arriving. An icon needs idle, listening, acting and arriving.']);
    expect(reasonsOf(lottie(icon => { delete icon.markers; }))[0]).toContain('Missing markers: idle, listening, acting, arriving.');
    expect(reasonsOf(lottie(icon => { icon.markers[1].dr = 0; }))).toEqual(['Marker "listening" has no length (its duration must be at least one frame).']);
    expect(reasonsOf(lottie(icon => { icon.markers.push({ cm: 'idle', tm: 3, dr: 3 }); }))).toEqual(['Marker "idle" appears more than once.']);
  });
  it('are refused when they are not JSON or not Lottie, and every reason is given at once', () => {
    expect(reasonsOf('{ nope')).toEqual(['The file is not valid JSON.']);
    expect(reasonsOf('[1, 2]')).toEqual(['The file is not a Lottie animation (it needs layers, a size and a frame rate).']);
    expect(reasonsOf(lottie(icon => { delete icon.layers; }))).toHaveLength(1);
    const both = reasonsOf(lottie(icon => { icon.markers = markers(['idle']); icon.assets = [{ id: 'x', u: '', p: 'x.png', e: 0 }]; }));
    expect(both).toHaveLength(2);
    expect(both[0]).toContain('Asset "x"');
    expect(both[1]).toContain('Missing markers');
  });
});

describe('layer names', () => {
  const named = (nm: string, extra: Record<string, unknown> = {}) => ({ nm, ...extra });
  it('.tint and .fg become the classes lottie-web puts on a layer, in layers, precompositions and shape groups', () => {
    const source = { layers: [named('.tint body'), named('.fg'), named('.tinted'), named('body .tint'), named('.fgx'), named('plain', { shapes: [named('.tint-ring', { it: [named('.fg eyes')] })] })], assets: [{ id: 'p', layers: [named('.tint inner', { cl: 'keep' })] }] };
    const copy = withLayerClasses(source) as any;
    expect(copy.layers.map((layer: any) => layer.cl)).toEqual(['tint', 'fg', undefined, undefined, undefined, undefined]);
    expect(copy.layers[5].shapes[0].cl).toBeUndefined();
    expect(copy.assets[0].layers[0].cl).toBe('keep tint');
    expect(withLayerClasses({ layers: [named('plain', { shapes: [named('.tint', { it: [named('.fg')] })] })] })).toMatchObject({ layers: [{ shapes: [{ cl: 'tint', it: [{ cl: 'fg' }] }] }] });
    expect(source.layers[0]).toEqual({ nm: '.tint body' });
  });
});

/** A player that records what the driver asks of it; `finish` ends the one-shot that is playing. */
function fakePlayer() {
  const calls: string[] = [];
  let complete = () => {};
  const player: Player = {
    play: (range: Range, loop: boolean) => { calls.push(`${loop ? 'loop' : 'once'} ${range[0]}-${range[1]}`); },
    still: frame => { calls.push(`still ${frame}`); },
    onComplete: listener => { complete = listener; },
    destroy: () => { calls.push('destroy'); },
  };
  return { player, calls, finish: () => complete() };
}

describe('the state machine', () => {
  it('loops idle and listening, and plays acting and arriving once, then settles to listening and idle', () => {
    const { player, calls, finish } = fakePlayer(), seen: IconState[] = [];
    const driver = createDriver(ranges, player, { onState: state => seen.push(state) });
    expect(calls).toEqual(['loop 0-30']);
    driver.set('listening');
    driver.set('acting');
    expect(calls.slice(1)).toEqual(['loop 30-60', 'once 60-90']);
    finish();
    expect(driver.state()).toBe('listening');
    expect(calls.at(-1)).toBe('loop 30-60');
    driver.set('arriving');
    expect(calls.at(-1)).toBe('once 90-120');
    finish();
    expect(driver.state()).toBe('idle');
    expect(calls.at(-1)).toBe('loop 0-30');
    expect(seen).toEqual(['listening', 'acting', 'listening', 'arriving', 'idle']);
  });
  it('ignores an end of playback while a loop plays', () => {
    const { player, calls, finish } = fakePlayer();
    createDriver(ranges, player);
    finish();
    expect(calls).toEqual(['loop 0-30']);
  });
  it('with Reduce Motion shows the first frame of idle in every state and plays nothing', () => {
    const { player, calls, finish } = fakePlayer();
    const driver = createDriver(ranges, player, { reduced: true });
    expect(calls).toEqual(['still 0']);
    driver.set('listening');
    driver.set('acting');
    finish();
    expect(driver.state()).toBe('acting');
    expect(calls.every(call => call === 'still 0')).toBe(true);
    // Turning it off plays the state it is in; turning it on again goes back to the still.
    driver.reduce(false);
    expect(calls.at(-1)).toBe('once 60-90');
    driver.reduce(true);
    expect(calls.at(-1)).toBe('still 0');
    const before = calls.length;
    driver.reduce(true);
    expect(calls).toHaveLength(before);
    driver.destroy();
    expect(calls.at(-1)).toBe('destroy');
  });
});

describe('the component', () => {
  afterEach(() => loadAssignedArt({}));
  it('draws a squircle with the initial in the colour of its kind when it has no art', () => {
    const icon = agentIcon({ kind: 'claude', name: 'Claude Code' }, { size: 30, state: 'listening' });
    expect(icon.dataset).toMatchObject({ agent: 'claude', art: 'fallback', state: 'listening' });
    expect(icon.style.getPropertyValue('--size')).toBe('30px');
    expect(icon.getAttribute('aria-label')).toBe('Claude Code');
    expect(icon.querySelector('path')?.getAttribute('d')).toBe('M12 0C20.4 0 24 3.6 24 12S20.4 24 12 24S0 20.4 0 12S3.6 0 12 0Z');
    expect(icon.querySelector('text')?.textContent).toBe('C');
    icon.setState('acting');
    expect(icon.dataset.state).toBe('acting');
    expect(agentIcon({ kind: 'my-bot', name: '<b>x' }, { size: 18 }).dataset.agent).toBe('other');
    expect(agentIcon({ kind: 'omp', name: '<b>x' }, { size: 18 }).querySelector('text')?.textContent).toBe('<');
    expect(agentIcon({ kind: 'omp', name: '' }, { size: 18 }).querySelector('text')?.textContent).toBe('?');
    expect(toneOf('cursor')).toBe('cursor');
    expect(toneOf('unknown')).toBe('other');
  });
  it('keeps the file the user assigned to a kind, replaces it, and drops it when it is not an icon', () => {
    expect(assignArt('codex', lottie())).toMatchObject({ ok: true });
    expect(artFor('codex')?.ranges).toEqual(ranges);
    expect(artFor('claude')).toBeUndefined();
    expect(assignArt('codex', lottie(icon => { icon.markers = []; }))).toMatchObject({ ok: false });
    expect(artFor('codex')).toBeUndefined();
    loadAssignedArt({ cursor: lottie(), omp: 'garbage' });
    expect([artFor('cursor') !== undefined, artFor('omp')]).toEqual([true, undefined]);
    assignArt('cursor', null);
    expect(artFor('cursor')).toBeUndefined();
  });
});
