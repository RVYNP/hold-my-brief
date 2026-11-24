import './agent-appearance.css';
import type { AnimationItem } from 'lottie-web';

/**
 * How an agent looks wherever the reader draws one: a colour per kind (CSS tokens in agent-appearance.css, carried by `--a` on every element
 * that has `data-agent`) and `agentIcon`, the one component every agent surface uses. The icon is a Lottie animation when the agent's kind has
 * art (one the user assigned in Settings, else a bundled one in src/assets/agents/), and a squircle with the agent's initial otherwise.
 * docs/agent-icons.md is the contract the art is made to.
 */

/** The kinds `hmb` recognises (docs/agent-control.md), in the order Settings lists them. Any other kind is drawn with `other`'s colour. */
export const knownKinds = ['omp', 'claude', 'codex', 'cursor', 'other'] as const;
export type KnownKind = typeof knownKinds[number];
export const kindLabels: Record<KnownKind, string> = { omp: 'omp', claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', other: 'Other agents' };
/** The colour family of a kind: itself when known, `other` for anything else. */
export const toneOf = (kind: string): KnownKind => (knownKinds as readonly string[]).includes(kind) ? kind as KnownKind : 'other';

/** The four states of an icon: `idle` and `listening` loop; `acting` and `arriving` play once and settle (see `settlesTo`). */
export const iconStates = ['idle', 'listening', 'acting', 'arriving'] as const;
export type IconState = typeof iconStates[number];
export type IconSize = 18 | 20 | 30 | 34;
export const looping: Readonly<Record<IconState, boolean>> = { idle: true, listening: true, acting: false, arriving: false };
/** Where a state goes when it has played to its end: the loops stay, `acting` returns to `listening` and `arriving` to `idle`. */
export const settlesTo: Readonly<Record<IconState, IconState>> = { idle: 'idle', listening: 'listening', acting: 'listening', arriving: 'idle' };

/** The most a Lottie file may weigh (also enforced by the native side, which writes it). */
export const ICON_MAX_BYTES = 512 * 1024;

/** Frames `[from, to]` of one marker. */
export type Range = readonly [from: number, to: number];
export type Ranges = Readonly<Record<IconState, Range>>;
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads the four state markers of a Lottie file (`markers[].cm` is the name, `tm` the first frame, `dr` the length), or `undefined` unless all four are there. */
export function markerRanges(data: unknown): Ranges | undefined {
  const found = markerTable(data).ranges;
  return iconStates.every(state => found[state]) ? found as Ranges : undefined;
}

function markerTable(data: unknown) {
  const ranges: Partial<Record<IconState, Range>> = {}, repeated: IconState[] = [], empty: IconState[] = [];
  const markers = isObject(data) && Array.isArray(data.markers) ? data.markers : [];
  for (const marker of markers) {
    if (!isObject(marker) || typeof marker.cm !== 'string' || !finite(marker.tm)) continue;
    const name = marker.cm.trim() as IconState;
    if (!iconStates.includes(name)) continue;
    const length = finite(marker.dr) ? marker.dr : 0;
    if (ranges[name]) { if (!repeated.includes(name)) repeated.push(name); continue; }
    if (length <= 0) { if (!empty.includes(name)) empty.push(name); continue; }
    ranges[name] = [marker.tm, marker.tm + length];
  }
  return { ranges, repeated, empty };
}

export type IconCheck = { ok: true; data: Json; ranges: Ranges } | { ok: false; reasons: string[] };

/**
 * Checks the text of a Lottie file chosen as an agent's icon: at most 512 KB, valid JSON of a Lottie animation, images only as embedded PNG or WebP
 * data (nothing external: no linked image, audio or font file), and all four state markers. A refusal carries every reason it found, each a sentence
 * for the user.
 */
export function validateIconFile(text: string): IconCheck {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > ICON_MAX_BYTES) return { ok: false, reasons: [`The file is ${Math.ceil(bytes / 1024)} KB; an icon may be at most ${ICON_MAX_BYTES / 1024} KB.`] };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, reasons: ['The file is not valid JSON.'] }; }
  if (!isObject(data) || !Array.isArray(data.layers) || !finite(data.w) || !finite(data.h) || !finite(data.fr) || !finite(data.op)) {
    return { ok: false, reasons: ['The file is not a Lottie animation (it needs layers, a size and a frame rate).'] };
  }
  const reasons: string[] = [];
  for (const asset of Array.isArray(data.assets) ? data.assets : []) {
    if (!isObject(asset) || (asset.p === undefined && asset.u === undefined)) continue;
    const name = typeof asset.id === 'string' || typeof asset.id === 'number' ? `"${asset.id}"` : 'An asset';
    const uri = typeof asset.p === 'string' ? /^data:([^;,]*)(;base64)?,/i.exec(asset.p) : null;
    if (!uri || asset.e !== 1) reasons.push(`Asset ${name} refers to a file outside the animation. Images must be embedded as PNG or WebP data.`);
    else if (!/^image\/(png|webp)$/i.test(uri[1]!) || !uri[2]) reasons.push(`Asset ${name} is embedded as ${uri[1] || 'unknown data'}; only base64 PNG or WebP images are allowed.`);
  }
  const fonts = isObject(data.fonts) && Array.isArray(data.fonts.list) ? data.fonts.list : [];
  for (const font of fonts) {
    if (isObject(font) && typeof font.fPath === 'string' && font.fPath) reasons.push(`Font "${String(font.fName ?? font.fFamily ?? '')}" loads from outside the animation.`);
  }
  const { ranges, repeated, empty } = markerTable(data);
  const missing = iconStates.filter(state => !ranges[state] && !empty.includes(state));
  if (missing.length) reasons.push(`Missing marker${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. An icon needs idle, listening, acting and arriving.`);
  for (const state of empty) reasons.push(`Marker "${state}" has no length (its duration must be at least one frame).`);
  for (const state of repeated) reasons.push(`Marker "${state}" appears more than once.`);
  return reasons.length ? { ok: false, reasons } : { ok: true, data, ranges: ranges as Ranges };
}

/** A name starting `.tint` or `.fg` (followed by nothing or a separator) marks a layer or shape group, as the file contract says. */
const markedName = /^\.(tint|fg)(?![A-Za-z0-9_-])/;

/**
 * A copy of `data` that lottie-web can colour. lottie-web puts a layer's `cl` field on the layer's `<g>` as its class and never exposes `nm`
 * (the layer's name), so the names the contract uses are copied into `cl` here: `.tint…` becomes class `tint`, `.fg…` class `fg`. A file
 * whose exporter already wrote `cl` keeps it. Layers of precompositions and shape groups are included.
 */
export function withLayerClasses(data: unknown): Json {
  const copy = structuredClone(data) as Json;
  const mark = (item: unknown) => {
    if (!isObject(item)) return;
    const found = typeof item.nm === 'string' ? markedName.exec(item.nm) : null;
    if (found) {
      const classes = typeof item.cl === 'string' ? item.cl.split(/\s+/).filter(Boolean) : [];
      if (!classes.includes(found[1]!)) item.cl = [...classes, found[1]].join(' ');
    }
    if (Array.isArray(item.shapes)) item.shapes.forEach(mark);
    if (Array.isArray(item.it)) item.it.forEach(mark);
  };
  if (Array.isArray(copy.layers)) copy.layers.forEach(mark);
  for (const asset of Array.isArray(copy.assets) ? copy.assets : []) if (isObject(asset) && Array.isArray(asset.layers)) asset.layers.forEach(mark);
  return copy;
}

/** What a driver needs of a player: play a frame range (looping or once), show one frame, report the end of a one-shot, and let go. */
export type Player = { play(range: Range, loop: boolean): void; still(frame: number): void; onComplete(listener: () => void): void; destroy(): void };

/** What `createDriver` returns: the state it is in, a way to change it, Reduce Motion on or off, and letting go of the player. */
export type IconDriver = { state(): IconState; set(state: IconState): void; reduce(on: boolean): void; destroy(): void };
/**
 * The icon's state machine, apart from lottie-web: `set` plays that state's marker range (the loops until told otherwise, `acting` and `arriving`
 * once, then the state they settle to). With Reduce Motion (`reduce(true)`) it shows the first frame of `idle` and plays nothing, whatever the state.
 * `onState` hears every state the driver is in, including the one a one-shot settles to.
 */
export function createDriver(ranges: Ranges, player: Player, { reduced = false, onState }: { reduced?: boolean; onState?: (state: IconState) => void } = {}): IconDriver {
  let current: IconState = 'idle', still = reduced;
  const show = () => { if (still) player.still(ranges.idle[0]); else player.play(ranges[current], looping[current]); };
  player.onComplete(() => {
    if (still || looping[current]) return;
    current = settlesTo[current];
    onState?.(current);
    show();
  });
  show();
  return {
    state: () => current,
    set(state: IconState) { current = state; onState?.(state); show(); },
    reduce(on: boolean) { if (on !== still) { still = on; show(); } },
    destroy() { player.destroy(); },
  };
}

// ------------------------------------------------------------------ art

/** Bundled art by kind: every `src/assets/agents/<kind>.json`. */
const bundled = import.meta.glob('./assets/agents/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
type Art = { data: Json; ranges: Ranges };
const arts = new Map<string, Art>(), assigned = new Map<string, Art>();
for (const [path, data] of Object.entries(bundled)) {
  const kind = /([^/]+)\.json$/.exec(path)?.[1], ranges = markerRanges(data);
  if (kind && ranges && isObject(data)) arts.set(kind, { data: withLayerClasses(data), ranges });
}

/** Sets the art the user assigned to `kind` (the text of a Lottie file), or clears it with `null`. Returns the check, so a caller can show why a file does not do. */
export function assignArt(kind: string, text: string | null): IconCheck | undefined {
  if (text === null) { assigned.delete(kind); return undefined; }
  const check = validateIconFile(text);
  if (check.ok) assigned.set(kind, { data: withLayerClasses(check.data), ranges: check.ranges }); else assigned.delete(kind);
  return check;
}
/** Replaces every assignment with `texts` (kind to file text), as the native side lists them at start-up. */
export function loadAssignedArt(texts: Readonly<Record<string, string>>) {
  assigned.clear();
  for (const [kind, text] of Object.entries(texts)) assignArt(kind, text);
}
export const artFor = (kind: string): Art | undefined => assigned.get(kind) ?? arts.get(kind);
/** Whether the user assigned a file to `kind`, and whether the app bundles art for it. */
export const hasAssignedArt = (kind: string) => assigned.has(kind);
export const hasBundledArt = (kind: string) => arts.has(kind);

// ------------------------------------------------------------------ the component

/** The squircle of the canvas mocks, 24 units wide. */
export const squirclePath = 'M12 0C20.4 0 24 3.6 24 12S20.4 24 12 24S0 20.4 0 12S3.6 0 12 0Z';
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();
const fallbackSvg = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="agent-icon-shape" d="${squirclePath}"/><text class="agent-icon-initial" x="12" y="16.6" text-anchor="middle">${initialOf(name).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)}</text></svg>`;

export type AgentIconElement = HTMLSpanElement & { setState(state: IconState): void; destroy(): void };
type LottieModule = { loadAnimation(params: Record<string, unknown>): AnimationItem };
let lottie: Promise<LottieModule> | undefined;
/** lottie-web's light SVG player: no expression engine is in it, and nothing here installs one, so an expression in a file is never evaluated. Loaded when the first Lottie icon is drawn. */
const loadPlayer = () => lottie ??= import('lottie-web/build/player/lottie_light').then(module => module.default as unknown as LottieModule);

function lottiePlayer(animation: AnimationItem): Player {
  return {
    play(range, loop) { animation.loop = loop; animation.playSegments([range[0], range[1]], true); },
    // A frame given to goToAndStop counts from the start of the segment last played, so the whole timeline comes back first.
    still(frame) { animation.resetSegments(true); animation.goToAndStop(frame, true); },
    onComplete(listener) { animation.addEventListener('complete', listener); },
    destroy() { animation.destroy(); },
  };
}

/**
 * The icon of an agent: an element `size` px wide in `state`. `agent.kind` picks the colour (`--a`, from the `data-agent` it carries) and the art,
 * `agent.name` the fallback's initial. `setState` changes the state; call `destroy` when the surface drops the icon (it stops the animation and
 * the Reduce Motion listener). `data-art` says what was drawn (`lottie` or `fallback`) and `data-state` the state it is in.
 */
export function agentIcon(agent: { kind: string; name: string }, { size, state = 'idle' }: { size: IconSize; state?: IconState }): AgentIconElement {
  const element = document.createElement('span') as AgentIconElement;
  element.className = 'agent-icon';
  element.dataset.agent = toneOf(agent.kind);
  element.dataset.state = state;
  element.style.setProperty('--size', `${size}px`);
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', agent.name);
  let driver: IconDriver | undefined, destroyed = false, wanted = state, release = () => {};
  const art = artFor(agent.kind);
  element.setState = next => { wanted = next; element.dataset.state = next; driver?.set(next); };
  element.destroy = () => { destroyed = true; release(); driver?.destroy(); driver = undefined; };
  if (!art) {
    element.dataset.art = 'fallback';
    element.innerHTML = fallbackSvg(agent.name);
    return element;
  }
  element.dataset.art = 'lottie';
  void loadPlayer().then(({ loadAnimation }) => {
    if (destroyed) return;
    const animation = loadAnimation({ container: element, renderer: 'svg', loop: false, autoplay: false, animationData: structuredClone(art.data), rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
    const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
    const start = () => {
      if (destroyed) { animation.destroy(); return; }
      driver = createDriver(art.ranges, lottiePlayer(animation), { reduced: query?.matches ?? false, onState: next => { element.dataset.state = next; } });
      const follow = () => driver?.reduce(query!.matches);
      query?.addEventListener('change', follow);
      release = () => query?.removeEventListener('change', follow);
      if (wanted !== 'idle') driver.set(wanted);
    };
    if (animation.isLoaded) start(); else animation.addEventListener('DOMLoaded', start);
  });
  return element;
}
