import { desktop } from './bridge';

/**
 * Appearance: light/dark mode, theme family, optional custom accent and a page tone.
 *
 * A glow theme (aurora … moss, see style.css) is a family with ONE scheme: while it is applied
 * `data-theme` is its scheme whatever `mode` says, and `mode` is left untouched so that choosing a
 * normal family again restores the earlier light/dark/system choice.
 *
 * Every UI color is a token in style.css written as `light-dark(light, dark)`;
 * `data-theme` on the root element selects the column through `color-scheme`,
 * `data-palette` selects a token family and `data-page` a page tone for text documents.
 * A custom accent is expanded here into the same `--accent-*` tokens, so any color stays
 * legible in both modes.
 *
 * public/theme-boot.js applies the saved record before first paint; this module owns
 * the record's format (`mode`, `palette`, `accent`, `page`, and the derived `vars`).
 */
export type AppearanceMode = 'system' | 'light' | 'dark';
export type Family = 'brief' | 'lilac' | 'birch' | 'graphite' | 'arctic' | 'blossom' | 'peony';
export type Glow = 'aurora' | 'dusk' | 'nebula' | 'solar' | 'ember' | 'orchid' | 'glacier' | 'peach' | 'lagoon' | 'moss';
export type Palette = Family | Glow;
export type PageTone = 'theme' | 'white' | 'sepia' | 'dim';
export type Scheme = 'light' | 'dark';
export type Appearance = { mode: AppearanceMode; palette: Palette; accent: string | null; page: PageTone };
export type Rgb = [number, number, number];

export const appearanceKey = 'hold-my-brief:appearance';
/** The families that follow the light/dark/system mode. */
export const palettes: readonly Family[] = ['brief', 'lilac', 'birch', 'graphite', 'arctic', 'blossom', 'peony'];
/** The glow themes in the order the sheet shows them, each with its one scheme. public/theme-boot.js repeats this table. */
export const glowSchemes: Readonly<Record<Glow, Scheme>> = { aurora: 'dark', dusk: 'dark', nebula: 'dark', solar: 'dark', ember: 'dark', orchid: 'dark', glacier: 'light', peach: 'light', lagoon: 'light', moss: 'light' };
export const glows = Object.keys(glowSchemes) as readonly Glow[];
export const allPalettes: readonly Palette[] = [...palettes, ...glows];
export const isGlow = (palette: Palette): palette is Glow => palette in glowSchemes;
export const pageTones: readonly PageTone[] = ['theme', 'white', 'sepia', 'dim'];
export const defaultAppearance: Appearance = { mode: 'system', palette: 'brief', accent: null, page: 'theme' };
const accentTokens = ['--accent', '--accent-ink', '--accent-fill', '--accent-fill-hover', '--accent-soft', '--accent-soft-hover', '--accent-border'] as const;
const hexColor = /^#[0-9a-f]{6}$/i;

let current: Appearance = defaultAppearance;
let probe: HTMLElement | undefined;
const listeners = new Set<(appearance: Appearance) => void>();

// --- Color math (OKLCH for perceptual steps, WCAG 2 relative luminance for contrast) ---

const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
function hexToRgb(hex: string): Rgb { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export const rgbToHex = (rgb: Rgb) => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
function luminance([r, g, b]: Rgb) { return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255); }
export function contrast(a: Rgb, b: Rgb) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

function toOklch([r8, g8, b8]: Rgb): Rgb {
  const [r, g, b] = [r8, g8, b8].map(c => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)];
}
function linearFromOklch([L, C, H]: Rgb): Rgb {
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
/** Maps an OKLCH color into sRGB, reducing chroma (never lightness or hue) until it fits. */
function fromOklch([L, C, H]: Rgb): Rgb {
  const lightness = Math.max(0, Math.min(1, L));
  const fits = (chroma: number) => linearFromOklch([lightness, chroma, H]).every(c => c >= -1e-4 && c <= 1 + 1e-4);
  let low = 0, high = C;
  if (!fits(C)) for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
  else low = C;
  return linearFromOklch([lightness, low, H]).map(c => Math.round(fromLinear(Math.max(0, Math.min(1, c))) * 255)) as Rgb;
}
/** Moves lightness in `step` increments until `target` contrast against `background` is met. */
function reach(color: Rgb, background: Rgb, target: number, step: number): Rgb {
  const [L, C, H] = toOklch(color);
  let next = color;
  for (let l = L; contrast(next, background) < target && l >= 0 && l <= 1; l += step) next = fromOklch([l, C, H]);
  return next;
}
const shift = (color: Rgb, delta: number) => { const [L, C, H] = toOklch(color); return fromOklch([L + delta, C, H]); };

/**
 * Publication text color for a page it is illegible on (below 4.5:1), or null when it already reads.
 * Neutral grays become the theme's reading `ink`; colored text keeps its hue and reaches 7:1.
 */
export function liftInk(color: Rgb, background: Rgb, ink: Rgb): Rgb | null {
  if (contrast(color, background) >= 4.5) return null;
  return toOklch(color)[1] < 0.03 ? ink : reach(color, background, 7, isDark(background) ? 0.02 : -0.02);
}
/** Whether text on this background needs light ink (WCAG relative luminance below mid-gray). */
export const isDark = (color: Rgb) => luminance(color) < 0.18;

const white: Rgb = [255, 255, 255];
/** Reference dark reading surface for dark-mode accent contrast (the darkest palette surface would only raise it). */
const darkSurface: Rgb = [0x22, 0x21, 0x27];

/**
 * Expands one accent into the token set for both modes. Marks need 3.5:1, text 5.5:1 on
 * light and 4.5–7:1 on dark, and fills carry white text at 4.5:1; soft tints mix with the
 * active palette's own surfaces so they follow palette changes without recomputation.
 */
export function accentVars(hex: string): Record<(typeof accentTokens)[number], string> {
  const base = hexToRgb(hex);
  const fill = reach(base, white, 4.5, -0.01);
  const markLight = reach(base, white, 3.5, -0.01);
  const inkLight = reach(shift(base, -0.06), white, 5.5, -0.01);
  const [L, C, H] = toOklch(base);
  // Dark surfaces make saturated light tints glow; cap chroma so the accent stays quiet at night.
  const markDark = reach(fromOklch([Math.max(L, 0.68), Math.min(C, 0.15), H]), darkSurface, 4.5, 0.01);
  const inkDark = reach(fromOklch([Math.max(L, 0.8), Math.min(C, 0.11), H]), darkSurface, 7, 0.01);
  const pair = (light: string, dark: string) => `light-dark(${light}, ${dark})`;
  const [lightMark, darkMark] = [rgbToHex(markLight), rgbToHex(markDark)];
  return {
    '--accent': pair(lightMark, darkMark),
    '--accent-ink': pair(rgbToHex(inkLight), rgbToHex(inkDark)),
    '--accent-fill': pair(rgbToHex(fill), rgbToHex(fill)),
    '--accent-fill-hover': pair(rgbToHex(shift(fill, -0.06)), rgbToHex(shift(fill, 0.05))),
    '--accent-soft': pair(`color-mix(in srgb, ${lightMark} 11%, var(--card))`, `color-mix(in srgb, ${darkMark} 15%, var(--surface))`),
    '--accent-soft-hover': pair(`color-mix(in srgb, ${lightMark} 19%, var(--card))`, `color-mix(in srgb, ${darkMark} 22%, var(--surface))`),
    '--accent-border': pair(`color-mix(in srgb, ${lightMark} 38%, var(--card))`, `color-mix(in srgb, ${darkMark} 40%, var(--surface))`),
  };
}

// --- Preferences ---

function parse(raw: string | null): Appearance {
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<Appearance> | null;
    if (!saved || typeof saved !== 'object') return defaultAppearance;
    return {
      mode: saved.mode === 'light' || saved.mode === 'dark' ? saved.mode : 'system',
      palette: allPalettes.includes(saved.palette as Palette) ? saved.palette as Palette : defaultAppearance.palette,
      accent: typeof saved.accent === 'string' && hexColor.test(saved.accent) ? saved.accent.toLowerCase() : null,
      page: pageTones.includes(saved.page as PageTone) ? saved.page as PageTone : defaultAppearance.page,
    };
  } catch { return defaultAppearance; }
}
let systemDark: MediaQueryList | undefined;
export const appearance = () => current;
export const scheme = (): Scheme => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
/** The scheme an appearance shows: a glow theme's own, otherwise the mode (system follows the OS). */
export function schemeOf(next: Appearance): Scheme {
  if (isGlow(next.palette)) return glowSchemes[next.palette];
  return next.mode === 'system' ? (systemDark?.matches ? 'dark' : 'light') : next.mode;
}

/** Applies an appearance without saving it (previews); `saveAppearance` keeps it. */
export function applyAppearance(next: Appearance) {
  current = next;
  const root = document.documentElement;
  root.dataset.theme = schemeOf(next);
  root.dataset.palette = next.palette;
  if (next.page === 'theme') delete root.dataset.page; else root.dataset.page = next.page;
  const vars = next.accent ? accentVars(next.accent) : undefined;
  for (const name of accentTokens) if (vars) root.style.setProperty(name, vars[name]); else root.style.removeProperty(name);
  for (const listener of listeners) listener(next);
  void syncWindow(isGlow(next.palette) ? glowSchemes[next.palette] : next.mode);
}
export function saveAppearance(next: Appearance) {
  try { localStorage.setItem(appearanceKey, JSON.stringify({ ...next, vars: next.accent ? accentVars(next.accent) : {} })); } catch { /* Optional preference. */ }
  applyAppearance(next);
}
/** Re-applies the saved appearance and follows the OS while in system mode. Call once at startup. */
export function initAppearance() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(appearanceKey); } catch { /* Storage may be unavailable. */ }
  systemDark = matchMedia('(prefers-color-scheme: dark)');
  systemDark.addEventListener('change', () => { if (current.mode === 'system' && !isGlow(current.palette)) applyAppearance(current); });
  applyAppearance(parse(saved));
  window.addEventListener('storage', event => { if (event.key === appearanceKey) applyAppearance(parse(event.newValue)); });
}
/** Notifies on every applied appearance (including previews); returns an unsubscribe function. */
export function onAppearanceChange(listener: (appearance: Appearance) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

// --- Resolved colors for surfaces outside the document's cascade (EPUB frames, the native window) ---

/** Parses an opaque computed `rgb()`/`rgba()` color; translucent or non-sRGB syntaxes return null. */
export function parseRgb(value: string): Rgb | null {
  const match = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)$/.exec(value);
  return match && (match[4] === undefined || Number(match[4]) >= 0.5) ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function resolve(token: string): Rgb {
  if (!probe) { probe = document.createElement('span'); probe.hidden = true; probe.setAttribute('aria-hidden', 'true'); document.body.append(probe); }
  probe.style.color = `var(${token})`;
  return parseRgb(getComputedStyle(probe).color) ?? [0, 0, 0];
}
export type ReadingColors = { scheme: Scheme; ink: Rgb; paper: Rgb; accent: Rgb };
/** The page's resolved colors, for content that cannot read CSS custom properties (EPUB frames). */
export function readingColors(): ReadingColors {
  return { scheme: scheme(), ink: resolve('--ink'), paper: resolve('--paper'), accent: resolve('--accent') };
}

async function syncWindow(mode: AppearanceMode | Scheme) {
  if (!desktop) return;
  const chrome = resolve('--chrome');
  try {
    // Desktop-only, loaded lazily like main.ts's window/event APIs so the browser preview bundle stays lean.
    const view = (await import('@tauri-apps/api/webviewWindow')).getCurrentWebviewWindow();
    await view.setTheme(mode === 'system' ? null : mode);
    await view.setBackgroundColor([...chrome, 255]);
  } catch (error) { console.warn('Could not theme the native window.', error); }
}
