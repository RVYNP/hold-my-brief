// Reference prototype for docs/design/agent-indicator/spec.md (AG2). Not app code; port it into src/ and delete this folder.
// Pure parts (look, palette, channels) have no DOM; `paint` needs a 2D context. Imports the app's own dither + cover code (vendor/).
import { bayer8, bayer4, blue, coverDensity, coverFamilies, familyFor, mulberry32, seedFrom, smoothstep, type CoverFamily, type DitherMethod } from '../../../../src/procedural-cover' /* plus ./cover-density.ts */;

export type Rgb = [number, number, number];
export type Scheme = 'light' | 'dark';
export type State = 'idle' | 'listening' | 'acting' | 'arriving';
export const states: State[] = ['idle', 'listening', 'acting', 'arriving'];
export const squircle = 'M12 0C20.4 0 24 3.6 24 12S20.4 24 12 24S0 20.4 0 12S3.6 0 12 0Z';

// ---- colour (ported from theme.ts: toOklch / fromOklch / reach / contrast; the app imports them) ----------------------------------------
const lin = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const delin = (c: number) => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
const lum = ([r, g, b]: Rgb) => .2126 * lin(r / 255) + .7152 * lin(g / 255) + .0722 * lin(b / 255);
export const contrast = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
export const hexToRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const rgbToHex = (c: Rgb) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function toOklch([r8, g8, b8]: Rgb): Rgb {
  const [r, g, b] = [r8, g8, b8].map(c => lin(c / 255));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)];
}
function linearFromOklch([L, C, H]: Rgb): Rgb {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
}
export function fromOklch([L, C, H]: Rgb): Rgb {
  const lightness = Math.max(0, Math.min(1, L));
  const fits = (chroma: number) => linearFromOklch([lightness, chroma, H]).every(c => c >= -1e-4 && c <= 1 + 1e-4);
  let low = 0, high = C;
  if (!fits(C)) for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; } else low = C;
  return linearFromOklch([lightness, low, H]).map(c => Math.round(delin(Math.max(0, Math.min(1, c))) * 255)) as Rgb;
}
export function reach(color: Rgb, background: Rgb, target: number, step: number): Rgb {
  const [L, C, H] = toOklch(color);
  let next = color;
  for (let l = L; contrast(next, background) < target && l >= 0 && l <= 1; l += step) next = fromOklch([l, C, H]);
  return next;
}

/**
 * The worst backgrounds an indicator sits on, across the seven families: light = the darkest light rail wash (Peony: --chrome 92 % + --fg 8 %,
 * style.css:201,206,380 → #e2d0d9; darker than every light --hover Home card), dark = the lightest dark Home card (Birch --hover #2d2a24, lighter than every dark rail wash).
 * Glow themes are not covered: their rail wash is glass over a glow and has no single colour.
 */
export const lightWorst: Rgb = [0xe2, 0xd0, 0xd9];
export const darkWorst: Rgb = [0x2d, 0x2a, 0x24];

/** The user's one colour -> a light and a dark mark, each >= 3:1 (WCAG 1.4.11, a filled graphic) on the worst background above; dark keeps L >= .74 and chroma <= .15 so it stays quiet at night. */
export function markPair(hex: string): { light: Rgb; dark: Rgb } {
  const base = hexToRgb(hex), [L, C, H] = toOklch(base);
  const light = reach(base, lightWorst, 3, -.01);
  const dark = reach(fromOklch([Math.max(L, .74), Math.min(C, .15), H]), darkWorst, 3, .01);
  return { light, dark };
}

/** Defaults per agent kind. omp and Claude Code are the owner-approved pairs; the rest are the app's accent presets (appearance.ts:12) run through `markPair`. */
export const defaultMarks: Record<string, { light: Rgb; dark: Rgb }> = {
  omp: { light: hexToRgb('#17876f'), dark: hexToRgb('#62d3b6') },
  claude: { light: hexToRgb('#4e62cc'), dark: hexToRgb('#a3b0ff') },
  codex: markPair('#c27a1a'),
  cursor: markPair('#5f8a3a'),
  other: markPair('#c2456b'),
  unknown: markPair('#6a6c74'),
};

/** Tones of an agent's squircle: [base, ink 1, ink 2]. Ink moves AWAY from the ground (lighter on dark, darker on light), like coverPalette's tones, in OKLCH lightness steps of .07 (flipped when there is no headroom). */
export function agentPalette(mark: Rgb, scheme: Scheme): Rgb[] {
  const [L, C, H] = toOklch(mark);
  let sign = scheme === 'dark' ? 1 : -1;
  if (L + sign * .14 > .97 || L + sign * .14 < .05) sign = -sign; // no headroom (near-white on dark, near-black on light): the ink goes the other way so the steps survive
  return [mark, fromOklch([L + sign * .07, C, H]), fromOklch([L + sign * .14, C, H])];
}

/** Glyph colour: white or near-black, whichever reads on the weakest tone, 3:1 minimum for a graphic (4.5:1 if an initial is ever drawn at >= 30 px). */
export function glyphColour(palette: Rgb[], min = 3): { colour: Rgb; ratio: number } {
  const candidates: Rgb[] = [[255, 255, 255], [0x14, 0x12, 0x0f]];
  let best = candidates[0], bestRatio = 0;
  for (const c of candidates) { const r = Math.min(...palette.map(p => contrast(c, p))); if (r > bestRatio) { bestRatio = r; best = c; } }
  if (bestRatio < min) { const [L, C, H] = toOklch(palette[0]); best = reach(best, palette[0], min, best[0] > 128 ? .01 : -.01); bestRatio = Math.min(...palette.map(p => contrast(best, p))); }
  return { colour: best, ratio: bestRatio };
}

// ---- the look: what a seed decides ------------------------------------------------------------------------------------------------------
export interface Look {
  kind: string;
  /** Texture seed: kind (+ terminal), so two agents of one kind in different terminals are siblings, not twins. */
  seed: number;
  /** Family and method are the kind's (the species); composition follows the seed above. */
  family: CoverFamily;
  method: Exclude<DitherMethod, 'atkinson'>;
  /** Share of cells carrying ink at rest. */
  ink: number;
  tones: 2 | 3;
  /** Loop period multiplier (0.9 to 1.12) and where in its loop the agent starts (0 to 1). */
  tempo: number;
  phase: number;
  /** Bookmark tab: which side of centre (-1 / +1) and how far from centre in squircle widths. */
  tabSide: 1 | -1;
  tabOffset: number;
  /** Direction the texture crawls while listening (cells per step). */
  crawl: [number, number];
}

/** Salt of every agent seed. Changing it re-rolls the hashed parameters (ink, tones, tempo, tab, crawl, texture) of every agent: freeze at release. */
export const seedSalt = 'hmb-agent/3';
const methods = ['bayer4', 'bayer8', 'blue'] as const;
const crawls: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1]];
/**
 * Family and method of the known kinds, by table (like shelf.ts gives siblings their family by slot, not by hash), so they never collide by
 * accident: no two kinds share both, and omp / Claude Code / Codex differ in each. Five families for six kinds: cursor repeats omp's family.
 * Any other key (`other:<name>`) takes both from its hash.
 */
export const kindSlots: Record<string, { family: CoverFamily; method: typeof methods[number] }> = {
  omp: { family: 'stripes', method: 'blue' },
  claude: { family: 'flow', method: 'bayer8' },
  codex: { family: 'contours', method: 'bayer4' },
  cursor: { family: 'stripes', method: 'bayer8' },
  other: { family: 'truchet', method: 'bayer8' },
  unknown: { family: 'arcs', method: 'bayer4' },
};

/**
 * `kind` is the registry kind, or `other:<name>` for a named `other` client. `terminal` (e.g. "Ghostty") makes two agents of one kind in different
 * terminals siblings; `pid` (new every launch) only moves where in its loop an agent starts. Nothing visible depends on the pid.
 */
export function lookFor(kind: string, terminal = '', pid = 0): Look {
  const kindSeed = seedFrom(`${seedSalt}\n${kind}`), seed = terminal ? seedFrom(`${seedSalt}\n${kind}\n${terminal}`) : kindSeed;
  const k = mulberry32(kindSeed), i = mulberry32(seedFrom(`${seedSalt}\n${kind}\n${terminal}\n${pid}`));
  const drawnMethod = methods[Math.floor(k() * methods.length)]; // always drawn first, so the rest of the stream is the same for table and hashed kinds
  const slot = kindSlots[kind], family = slot?.family ?? coverFamilies[(kindSeed >>> 24) % coverFamilies.length], method = slot?.method ?? drawnMethod;
  const ink = .2 + .1 * k(), tones: 2 | 3 = k() < .5 ? 2 : 3, tempo = .9 + .22 * k();
  const tabSide: 1 | -1 = k() < .5 ? -1 : 1, tabOffset = .14 + .08 * k();
  const crawl = crawls[Math.floor(k() * crawls.length)];
  return { kind, seed, family, method, ink, tones, tempo, phase: i(), tabSide, tabOffset, crawl };
}

// ---- easing (Fluent 2 tokens, research.md 4.3) ------------------------------------------------------------------------------------------
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let n = 0; n < 8; n++) { const e = ((ax * t + bx) * t + cx) * t - x, d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(e) < 1e-5) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}
export const ease = { out: bezier(.1, .9, .2, 1), in: bezier(.9, .1, 1, .2), io: bezier(.33, 0, .67, 1), soft: bezier(.45, 0, .55, 1) };
const seg = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- state channels: what moves, per state ----------------------------------------------------------------------------------------------
export interface Channels {
  /** Added to the ink density before the threshold: the whole mark takes more (+) or less (-) ink. */
  bias: number;
  /** Ink band centre in 0..1 of height from the bottom (acting); band < 0 = none. */
  band: number; bandGain: number;
  /** Texture crawl in cells, along the look's direction. */
  crawl: number;
  /** Bookmark tab length above the squircle, in squircle widths (0 = hidden). `tabDither`: the growing row dithers in (acting); otherwise whole cells only. */
  tab: number; tabDither: boolean;
  /** Ink ring: radius in squircle widths, density 0..1 (ordered-dither dissolve). */
  ring: number; ringLevel: number;
  /** Dithered spotlight around the mark: 0..1. */
  glow: number;
  /** arriving only: host travel progress 0..1 (the host moves the element; snapped to whole cells). */
  travel: number;
}
const none = (): Channels => ({ bias: 0, band: -1, bandGain: 0, crawl: 0, tab: 0, tabDither: false, ring: 0, ringLevel: 0, glow: 0, travel: 0 });
/** Durations in seconds; loops are multiplied by the look's tempo, one-shots are fixed. */
export const duration: Record<State, number> = { idle: 7, listening: 2, acting: .9, arriving: 1 };
export const loops: Record<State, boolean> = { idle: true, listening: true, acting: false, arriving: false };

/** The channels of a state at time t (seconds since the state began; loops wrap). `reduced`: Reduce Motion, same cues as steps with no tween. */
export function channels(state: State, t: number, look: Look, reduced = false): Channels {
  const c = none();
  if (loops[state]) { const period = duration[state] * look.tempo; t = ((t % period) + period) % period; const w = Math.sin(2 * Math.PI * t / period), s = .5 - .5 * Math.cos(2 * Math.PI * t / period);
    if (state === 'idle') c.bias = reduced ? 0 : .045 * w;
    else { c.tab = .075 + (reduced ? 0 : .03 * s); c.bias = reduced ? 0 : .05 * s; c.crawl = reduced ? 0 : 1.5 * s; }
    return c; }
  if (state === 'acting') {
    if (reduced) { if (t < .9) { c.bias = .3; c.tab = .11; c.bandGain = 0; } return c; }
    const p = ease.out(seg(t, 0, .55));
    c.band = lerp(-.3, 1.3, p); c.bandGain = .6;
    c.tabDither = true; c.tab = .13 * ease.out(seg(t, 0, .2)) * (1 - ease.io(seg(t, .5, .9)));
    c.bias = .12 * ease.out(seg(t, 0, .2)) * (1 - ease.io(seg(t, .5, .9)));
    return c;
  }
  // arriving
  if (reduced) { if (t < .9) { c.bias = .3; c.ring = .1; c.ringLevel = .4; } return c; }
  c.travel = ease.io(seg(t, .1, .5));
  const lift = ease.out(seg(t, 0, .12)), land = seg(t, .5, 1), fall = 1 - ease.io(seg(t, .58, 1));
  c.bias = t < .5 ? .3 * lift : lerp(.3, .5, ease.out(seg(t, .5, .58))) * fall;
  c.ring = .02 + .13 * ease.out(seg(t, .5, .9));
  c.ringLevel = t < .5 ? 0 : .36 * (1 - ease.io(seg(t, .6, 1)));
  c.glow = t < .5 ? 0 : .5 * (1 - ease.io(seg(t, .55, 1)));
  return c;
}

// ---- the renderer -----------------------------------------------------------------------------------------------------------------------
export interface Options {
  size: number;           // css px of the squircle
  cell?: number;          // css px per dither cell; default 1 up to 20 px, else 2 (the covers' and banner's pixel is 2)
  look: Look;
  mark: Rgb;              // the colour for this scheme
  scheme: Scheme;
  ground: Rgb;            // surface the mark sits on
  effects?: boolean;      // false: solid squircle + glyph, nothing else
  reduced?: boolean;
  glowStrength?: number;  // 0..1, derived from the app's background strength
  spotlight?: boolean;    // gutter placement: the glow layer is drawn
}

export class Indicator {
  readonly cell: number; readonly n: number; readonly pad: number; readonly g: number;
  readonly palette: Rgb[]; readonly glyph: { colour: Rgb; ratio: number };
  private density: Float32Array; private dw: number; private thr: Float32Array;
  private sdf: Float32Array; private inside: Uint8Array; private glyphDist: Float32Array;
  private img: ImageData; private buffer: HTMLCanvasElement; private bctx: CanvasRenderingContext2D;
  constructor(readonly o: Options) {
    const { size, look } = o, cell = this.cell = o.cell ?? (size <= 20 ? 1 : 2), n = this.n = Math.round(size / cell);
    this.pad = Math.ceil(n * .3); const g = this.g = n + 2 * this.pad;
    this.palette = agentPalette(o.mark, o.scheme); this.glyph = glyphColour(this.palette);
    const dw = this.dw = n + 4;
    this.density = coverDensity({ seed: look.seed, width: dw, height: dw, family: look.family, dither: look.method, target: look.ink }).density;
    // threshold map over the whole buffer (screen-fixed: only the field moves under it)
    this.thr = new Float32Array(g * g);
    const bt = blue();
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) this.thr[y * g + x] = look.method === 'blue' ? bt[(y % 32) * 32 + x % 32] : look.method === 'bayer4' ? (bayer4[(y & 3) * 4 + (x & 3)] + .5) / 16 : bayer8(x, y);
    // signed distance (cells, + outside) to the squircle, approximated by a rounded box of radius .404 n (matches the path's 45-degree point to 0.2 unit)
    this.sdf = new Float32Array(g * g); this.inside = new Uint8Array(g * g); this.glyphDist = new Float32Array(g * g);
    const half = n / 2, r = .404 * n, dots = this.dots();
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
      const px = Math.abs(x + .5 - g / 2), py = Math.abs(y + .5 - g / 2), qx = px - (half - r), qy = py - (half - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      this.sdf[y * g + x] = d; this.inside[y * g + x] = d < -.5 ? 1 : 0;
      this.glyphDist[y * g + x] = Math.min(...dots.map(([dx, dy, dr]) => Math.hypot(x + .5 - g / 2 - dx, y + .5 - g / 2 - dy) - dr));
    }
    this.buffer = document.createElement('canvas'); this.buffer.width = g; this.buffer.height = g;
    this.bctx = this.buffer.getContext('2d')!; this.img = this.bctx.createImageData(g, g);
  }
  /** Two-dot glyph (the rail's agents mark): centre offsets and radius in cells. */
  dots(): [number, number, number][] { const u = this.n / 24; return [[-2.9 * u, 0, 1.75 * u], [2.9 * u, 0, 1.75 * u]]; }
  /** css px of the full canvas (the squircle plus the room the tab, ring and spotlight need). */
  get cssSize() { return this.g * this.cell; }

  /** One frame into `ctx` (already sized g*cell*dpr, scaled so 1 unit = 1 css px). Returns ms spent computing cells. */
  paint(ctx: CanvasRenderingContext2D, state: State, t: number, dpr = 1): number {
    const { o, g, n, pad, palette } = this, started = performance.now();
    const css = this.cssSize, px = css * dpr;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px); ctx.imageSmoothingEnabled = false;
    const k = px / g; // device px per cell
    const sq = new Path2D(squircle), sx = n * this.cell * dpr / 24, off = pad * this.cell * dpr;
    const effects = o.effects !== false, ch = effects ? channels(state, t, o.look, o.reduced) : none();
    // 1 outside layer: tab, ring, spotlight (cells, drawn first so the vector squircle covers their roots: "from behind")
    if (effects) {
      const data = this.img.data; data.fill(0);
      const set = (i: number, c: Rgb) => { data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255; };
      // Bookmark tab: a thumb-index tab that rises out from BEHIND the squircle's top edge (research.md A, turned upside down: a tab on the bottom read as a speech bubble's tail),
      // in the strongest ink tone so it is a separate object, off-centre (side and offset come from the look). Its growing row dithers in: ink rising, not a shape sliding.
      const tabLen = ch.tabDither ? ch.tab * n : Math.round(ch.tab * n), tw = Math.max(4, Math.round(n * .36)), cx = g / 2 + o.look.tabSide * (o.look.tabOffset + .04) * n, x0 = Math.round(cx - tw / 2), yt = pad; // yt: the squircle's top row
      if (tabLen > .05) for (let y = yt - Math.ceil(tabLen); y < yt + 4; y++) for (let x = x0; x < x0 + tw; x++) {
        const row = yt - y; // 1-based rows above the squircle's top edge
        const full = row <= Math.floor(tabLen), part = row === Math.ceil(tabLen) && tabLen - Math.floor(tabLen) > this.thr[y * g + x];
        const taper = tw >= 5 && row === Math.ceil(tabLen) && row > 2 && (x === x0 || x === x0 + tw - 1); // last row one cell narrower each side: a tab, not a stub
        if ((row <= 0 || full || part) && !taper) set(y * g + x, palette[2]);
      }
      if (ch.ringLevel > 0 || ch.glow > 0) {
        const R = ch.ring * n, spot = o.spotlight ? (o.glowStrength ?? .5) : 0;
        for (let i = 0; i < g * g; i++) {
          const d = this.sdf[i]; if (d <= 0) continue;
          let level = 0;
          if (ch.ringLevel > 0) level = Math.max(level, ch.ringLevel * Math.max(0, 1 - Math.abs(d - R) / 1.6));
          if (ch.glow > 0 && spot > 0) { const reach = n * .55, f = Math.max(0, 1 - d / reach); level = Math.max(level, ch.glow * spot * f * f); }
          if (level > this.thr[i]) set(i, palette[1]);
        }
      }
      this.bctx.putImageData(this.img, 0, 0); ctx.drawImage(this.buffer, 0, 0, px, px);
    }
    // 2 vector squircle in the base tone (the silhouette is always a solid vector: crisp at any DPR)
    ctx.save(); ctx.translate(off, off); ctx.scale(sx, sx); ctx.fillStyle = rgb(palette[0]); ctx.fill(sq); ctx.restore();
    // 3 inside texture
    if (effects) {
      const data = this.img.data; data.fill(0); const dw = this.dw, top = o.look.tones - 1;
      const ox = 2 + Math.round(ch.crawl) * o.look.crawl[0], oy = 2 + Math.round(ch.crawl) * o.look.crawl[1];
      for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
        const i = y * g + x; if (!this.inside[i]) continue;
        const fx = Math.min(dw - 1, Math.max(0, x - pad + ox)), fy = Math.min(dw - 1, Math.max(0, y - pad + oy));
        const yn = 1 - (y - pad + .5) / n;
        let v = this.density[fy * dw + fx] + ch.bias;
        if (ch.band >= 0) { const e = (yn - ch.band) / .3; v += ch.bandGain * Math.exp(-e * e); }
        // keep a clear zone round the glyph so dither never fights it
        const gd = this.glyphDist[i]; if (gd < 2.2) v *= smoothstep(.6, 2.2, gd);
        v = Math.min(1, Math.max(0, v));
        const target = v * top, base = Math.min(top - 1, Math.floor(target)), tone = base + (target - base > this.thr[i] ? 1 : 0);
        if (!tone) continue;
        const c = palette[o.look.tones === 3 ? tone : 2]; data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
      }
      this.bctx.putImageData(this.img, 0, 0);
      ctx.save(); ctx.setTransform(sx, 0, 0, sx, off, off); ctx.clip(sq); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.buffer, 0, 0, px, px); ctx.restore();
    }
    // 4 glyph (vector, above everything)
    ctx.save(); ctx.fillStyle = rgb(this.glyph.colour);
    for (const [dx, dy, dr] of this.dots()) { ctx.beginPath(); ctx.arc((g / 2 + dx) * k, (g / 2 + dy) * k, dr * k, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore(); ctx.restore();
    return performance.now() - started;
  }
}
const rgb = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
