/**
 * Strict allow-list sanitizer for SVG visuals (inline ```svg blocks in Markdown and standalone .svg
 * documents). Strips scripts, event handlers, foreignObject, animations, stylesheets and any
 * external URLs so untrusted or agent-generated SVG can never execute code or trigger network loads.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop',
  'marker', 'clipPath', 'mask', 'pattern',
]);

const ALLOWED_ATTRS = new Set([
  'id', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'xmlns',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'dx', 'dy', 'd', 'points', 'pathLength',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'color', 'visibility', 'display',
  'transform', 'transform-origin',
  'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'text-decoration',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'fx', 'fy',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
  'marker-start', 'marker-mid', 'marker-end',
  'clip-path', 'clip-rule', 'clipPathUnits', 'mask', 'maskUnits',
  'patternUnits', 'patternContentUnits', 'patternTransform',
  'href', 'role', 'aria-label', 'aria-hidden', 'aria-labelledby',
]);

/** Attributes whose value may reference a local `#id` via `url(#id)`. */
const URL_REF_ATTRS = new Set([
  'fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end',
]);

/** Theme CSS custom properties an inline SVG may reference inside `var(--...)`. */
const ALLOWED_VARS = new Set([
  '--bg', '--fg', '--ink', '--muted', '--accent', '--accent-ink', '--accent-soft',
  '--card', '--paper', '--surface', '--border', '--rule', '--hairline', '--hover',
  '--code', '--code-keyword', '--code-string', '--code-name', '--code-number', '--code-comment',
  '--font-ui', '--font-read', '--font-mono', '--sheen',
]);

const SAFE_FRAGMENT = /^#[A-Za-z_][\w.-]*$/;
const SAFE_LOCAL_URL = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/;
const VAR_EXPR = /^var\(\s*(--[a-z0-9-]+)(?:\s*,\s*([^()]+))?\s*\)$/i;

/** Returns true when an attribute value cannot trigger scripts or remote fetches. */
function isSafeValue(name: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8192) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:') || lower.includes('expression(') || lower.includes('@import')) {
    return false;
  }
  if (name === 'href') return SAFE_FRAGMENT.test(trimmed);
  if (lower.includes('url(')) {
    return URL_REF_ATTRS.has(name) && SAFE_LOCAL_URL.test(trimmed);
  }
  if (lower.includes('var(')) {
    const match = VAR_EXPR.exec(trimmed);
    if (!match) return false;
    if (!ALLOWED_VARS.has(match[1].toLowerCase())) return false;
    if (match[2] && !isSafeValue(name, match[2])) return false;
  }
  return true;
}

/**
 * Sanitizes raw SVG XML into a clean, safe `<svg>` markup string.
 * Returns `null` if the input is not valid XML or does not have an `<svg>` root.
 * Optional `resolveVar` substitutes `var(--token)` values (useful when rendering inside `<img>`,
 * where document CSS custom properties are not inherited).
 */
export function sanitizeSvg(raw: string, resolveVar?: (name: string) => string | undefined): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2 * 1024 * 1024) return null;
  const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') return null;

  const outDoc = document.implementation.createDocument(SVG_NS, 'svg', null);
  const cleanRoot = outDoc.documentElement;

  const copyAttrs = (src: Element, dst: Element) => {
    for (const attr of Array.from(src.attributes)) {
      const local = attr.localName;
      // Map legacy xlink:href -> href so only local `#id` fragments pass.
      const targetName = local === 'href' ? 'href' : local;
      if (targetName.toLowerCase().startsWith('on')) continue;
      if (!ALLOWED_ATTRS.has(targetName)) continue;
      let val = attr.value.trim();
      if (!isSafeValue(targetName, val)) continue;
      if (resolveVar && val.toLowerCase().startsWith('var(')) {
        const match = VAR_EXPR.exec(val);
        if (match) {
          const resolved = resolveVar(match[1].toLowerCase())?.trim();
          val = resolved && isSafeValue(targetName, resolved) ? resolved : (match[2]?.trim() ?? 'currentColor');
        }
      }
      dst.setAttribute(targetName, val);
    }
  };

  const walk = (src: Element, dst: Element, depth: number) => {
    if (depth > 32) return;
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent ?? '';
        if (content) dst.appendChild(outDoc.createTextNode(content));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      const tag = el.localName;
      if (!ALLOWED_TAGS.has(tag) || tag === 'svg') continue;
      const copy = outDoc.createElementNS(SVG_NS, tag);
      copyAttrs(el, copy);
      walk(el, copy, depth + 1);
      dst.appendChild(copy);
    }
  };

  copyAttrs(root, cleanRoot);
  cleanRoot.setAttribute('xmlns', SVG_NS);
  // Ensure an explicit aspect/size so embedded SVGs scale cleanly in responsive containers.
  if (!cleanRoot.getAttribute('viewBox')) {
    const w = parseFloat(cleanRoot.getAttribute('width') ?? '');
    const h = parseFloat(cleanRoot.getAttribute('height') ?? '');
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      cleanRoot.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }
  walk(root, cleanRoot, 0);
  return new XMLSerializer().serializeToString(cleanRoot);
}

/** Reads a theme CSS variable from the live document root when available. */
export function documentThemeVar(name: string): string | undefined {
  if (typeof document === 'undefined' || !document.documentElement) return undefined;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || undefined;
}
