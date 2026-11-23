/**
 * Zero-dependency, theme-aware visual blocks for Markdown briefs and documents:
 * - `chart`: declarative JSON spec (`bar`, `hbar`, `line`, `metrics`) -> crisp SVG / KPI cards
 * - `flow`: compact arrow syntax (`A[Label] -> B[Label]`) -> layered SVG flowchart
 * - `svg`: strictly sanitized inline SVG that inherits Hold My Brief's theme variables
 *
 * Everything emits static HTML/SVG with no script execution and uses theme custom properties
 * (`--accent`, `--fg`, `--muted`, `--card`, `--hairline`, `--border`) so visuals harmonize
 * automatically across all 17 light, dark, and glow themes.
 */

import { sanitizeSvg } from './svg-sanitize';

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);

const formatValue = (value: number, unit = ''): string => {
  const formatted = Number.isInteger(value) ? value.toLocaleString('en-US') : Number(value.toFixed(2)).toLocaleString('en-US');
  if (!unit) return formatted;
  // Word units ("lines", "MB", "ms") are separated from the number; symbol units (%, °, ×, x, $) attach.
  const attaches = !/^\p{L}/u.test(unit) || /^x$/i.test(unit);
  return attaches ? `${formatted}${unit}` : `${formatted} ${unit}`;
};

// ---------------------------------------------------------------- chart

type ChartDatum = { label: string; value: number; highlight?: boolean };
type MetricItem = { label: string; value: string; note?: string; tone?: 'accent' | 'positive' | 'warning' | 'muted' };

type ChartSpec = {
  type?: 'bar' | 'hbar' | 'line' | 'metrics';
  title?: string;
  subtitle?: string;
  unit?: string;
  data?: ChartDatum[];
  items?: MetricItem[];
};

const TONE_COLOR: Record<string, string> = {
  accent: 'var(--accent-ink)',
  positive: 'var(--code-string)',
  warning: 'var(--code-keyword)',
  muted: 'var(--muted)',
};

function renderMetrics(spec: ChartSpec): string | null {
  const items = Array.isArray(spec.items)
    ? spec.items.filter(item => item && typeof item === 'object').slice(0, 12)
    : [];
  if (!items.length) return null;
  const cards = items.map(item => {
    const label = esc(str(item.label, 'Metric'));
    const value = esc(str(item.value, '—'));
    const note = item.note ? `<span class="hmb-metric-note">${esc(str(item.note))}</span>` : '';
    const tone = item.tone && TONE_COLOR[item.tone] ? ` style="color:${TONE_COLOR[item.tone]}"` : '';
    return `<div class="hmb-metric-card"><span class="hmb-metric-label">${label}</span><strong class="hmb-metric-value"${tone}>${value}</strong>${note}</div>`;
  }).join('');
  return `<div class="hmb-metrics-grid">${cards}</div>`;
}

function renderHorizontalBars(spec: ChartSpec, data: ChartDatum[]): string {
  const unit = str(spec.unit);
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1e-9);
  const rowH = 34;
  const labelW = 148;
  const valueW = 78;
  const width = 560;
  const barArea = width - labelW - valueW - 24;
  const height = data.length * rowH + 16;

  const rows = data.map((d, i) => {
    const y = 8 + i * rowH;
    const barW = Math.max(4, Math.round((Math.max(0, d.value) / max) * barArea));
    const fill = d.highlight ? 'var(--accent)' : 'var(--accent-ink)';
    const fillOpacity = d.highlight ? '1' : '0.78';
    const label = d.label.length > 20 ? `${d.label.slice(0, 19)}…` : d.label;
    return [
      `<text x="${labelW - 10}" y="${y + 18}" text-anchor="end" font-size="12" fill="var(--fg)" font-family="var(--font-ui)">${esc(label)}</text>`,
      `<rect x="${labelW}" y="${y + 5}" width="${barArea}" height="18" rx="4" fill="var(--hover)" />`,
      `<rect x="${labelW}" y="${y + 5}" width="${barW}" height="18" rx="4" fill="${fill}" fill-opacity="${fillOpacity}" />`,
      `<text x="${labelW + barArea + 10}" y="${y + 18}" text-anchor="start" font-size="11.5" fill="var(--muted)" font-family="var(--font-mono)">${esc(formatValue(d.value, unit))}</text>`,
    ].join('');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(spec.title || 'Bar chart')}">${rows}</svg>`;
}

function renderVerticalBars(spec: ChartSpec, data: ChartDatum[]): string {
  const unit = str(spec.unit);
  const max = Math.max(...data.map(d => d.value), 1e-9);
  const width = 560;
  const height = 220;
  const padL = 44;
  const padR = 16;
  const padT = 22;
  const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const slot = chartW / data.length;
  const barW = Math.max(12, Math.min(48, slot * 0.62));

  const grid = [0, 0.5, 1].map(frac => {
    const y = Math.round(padT + chartH * (1 - frac));
    const val = formatValue(Math.round(max * frac * 10) / 10, '');
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--hairline)" stroke-width="1" />`
      + `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)" font-family="var(--font-mono)">${esc(val)}</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const cx = padL + slot * (i + 0.5);
    const barH = Math.max(3, Math.round((Math.max(0, d.value) / max) * chartH));
    const y = padT + chartH - barH;
    const fill = d.highlight ? 'var(--accent)' : 'var(--accent-ink)';
    const opacity = d.highlight ? '1' : '0.78';
    const label = d.label.length > 11 ? `${d.label.slice(0, 10)}…` : d.label;
    return [
      `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${barH}" rx="4" fill="${fill}" fill-opacity="${opacity}" />`,
      `<text x="${cx.toFixed(1)}" y="${Math.max(12, y - 5)}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="var(--font-mono)">${esc(formatValue(d.value, unit))}</text>`,
      `<text x="${cx.toFixed(1)}" y="${height - 12}" text-anchor="middle" font-size="11" fill="var(--fg)" font-family="var(--font-ui)">${esc(label)}</text>`,
    ].join('');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(spec.title || 'Column chart')}">${grid}${bars}</svg>`;
}

function renderLineChart(spec: ChartSpec, data: ChartDatum[]): string {
  const unit = str(spec.unit);
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 560;
  const height = 210;
  const padL = 48;
  const padR = 20;
  const padT = 20;
  const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const coords = data.map((d, i) => ({
    x: padL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: padT + chartH - ((d.value - min) / span) * chartH,
    d,
  }));

  const grid = [0, 0.5, 1].map(frac => {
    const y = Math.round(padT + chartH * (1 - frac));
    const v = min + span * frac;
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--hairline)" stroke-width="1" />`
      + `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)" font-family="var(--font-mono)">${esc(formatValue(Math.round(v * 10) / 10, unit))}</text>`;
  }).join('');

  const pointsAttr = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = coords.length > 1
    ? `M ${coords[0].x.toFixed(1)} ${padT + chartH} L ${coords.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} L ${coords[coords.length - 1].x.toFixed(1)} ${padT + chartH} Z`
    : '';
  const step = Math.max(1, Math.ceil(coords.length / 8));
  const dotsAndLabels = coords.map((p, i) => {
    const showLabel = i % step === 0 || i === coords.length - 1;
    const label = p.d.label.length > 10 ? `${p.d.label.slice(0, 9)}…` : p.d.label;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--card)" stroke="var(--accent-ink)" stroke-width="2" />`
      + (showLabel ? `<text x="${p.x.toFixed(1)}" y="${height - 12}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="var(--font-ui)">${esc(label)}</text>` : '');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(spec.title || 'Line chart')}">`
    + grid
    + (areaPath ? `<path d="${areaPath}" fill="var(--accent-soft)" fill-opacity="0.55" />` : '')
    + `<polyline points="${pointsAttr}" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`
    + dotsAndLabels
    + `</svg>`;
}

export function renderChartBlock(raw: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  // Agents write JSON by hand: a numeric title must render, not throw out of the Markdown renderer.
  const spec: ChartSpec = { ...(parsed as ChartSpec), title: str((parsed as ChartSpec).title), subtitle: str((parsed as ChartSpec).subtitle) };
  const type = spec.type ?? (Array.isArray(spec.items) ? 'metrics' : 'hbar');

  let body: string | null = null;
  if (type === 'metrics') {
    body = renderMetrics(spec);
  } else {
    const data = Array.isArray(spec.data)
      ? spec.data
        .filter((d): d is ChartDatum => Boolean(d && typeof d === 'object' && num((d as ChartDatum).value) !== undefined))
        .map(d => ({ label: str(d.label), value: d.value, highlight: Boolean(d.highlight) }))
        .slice(0, 24)
      : [];
    if (!data.length) return null;
    body = type === 'bar' ? renderVerticalBars(spec, data) : type === 'line' ? renderLineChart(spec, data) : renderHorizontalBars(spec, data);
  }
  if (!body) return null;

  const head = spec.title || spec.subtitle
    ? `<figcaption class="hmb-visual-head">${spec.title ? `<strong>${esc(spec.title)}</strong>` : ''}${spec.subtitle ? `<span>${esc(spec.subtitle)}</span>` : ''}</figcaption>`
    : '';
  return `<figure class="hmb-visual hmb-chart">${head}<div class="hmb-visual-body">${body}</div></figure>\n`;
}

// ---------------------------------------------------------------- flow

type FlowNode = { id: string; label: string; accent: boolean };
type FlowEdge = { from: string; to: string; label?: string };

const NODE_TOKEN = /^([A-Za-z0-9_.-]+)(?:\[([^\]]+)\]|(\([^)]+\)))?$/;

function parseNode(raw: string): FlowNode {
  const token = raw.trim();
  const match = NODE_TOKEN.exec(token);
  if (match) {
    const id = match[1];
    const label = (match[2] ?? match[3]?.slice(1, -1) ?? id).trim();
    const accent = Boolean(match[3]);
    return { id, label, accent };
  }
  return { id: token, label: token, accent: false };
}

let flowCounter = 0;

/**
 * Parses compact flow syntax into a layered DAG SVG:
 *   direction: LR   (optional, default LR; or TB)
 *   Client[hmb CLI] -> Socket[Unix Socket] --JSON-RPC--> App(Hold My Brief)
 */
export function renderFlowBlock(raw: string): string | null {
  let direction: 'LR' | 'TB' = 'LR';
  let title = '';
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  const ensureNode = (spec: FlowNode) => {
    const existing = nodes.get(spec.id);
    if (!existing) nodes.set(spec.id, spec);
    else if (spec.label !== spec.id && existing.label === existing.id) {
      existing.label = spec.label;
      existing.accent = existing.accent || spec.accent;
    }
  };

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const dirMatch = /^direction\s*:\s*(LR|TB)\s*$/i.exec(line);
    if (dirMatch) { direction = dirMatch[1].toUpperCase() as 'LR' | 'TB'; continue; }
    const titleMatch = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch) { title = titleMatch[1].trim(); continue; }

    // Split chains like: A -> B --label--> C
    const parts: { node: FlowNode; edgeLabel?: string }[] = [];
    const arrowRe = /--([^->\n]+?)-->|->/g;
    let cursor = 0;
    let pendingLabel: string | undefined;
    let m: RegExpExecArray | null;
    while ((m = arrowRe.exec(line)) !== null) {
      const seg = line.slice(cursor, m.index).trim();
      if (seg) parts.push({ node: parseNode(seg), edgeLabel: pendingLabel });
      pendingLabel = m[1]?.trim();
      cursor = m.index + m[0].length;
    }
    const tail = line.slice(cursor).trim();
    if (tail) parts.push({ node: parseNode(tail), edgeLabel: pendingLabel });

    if (!parts.length) continue;
    if (parts.length === 1) {
      ensureNode(parts[0].node);
      continue;
    }
    for (let i = 0; i < parts.length; i++) {
      ensureNode(parts[i].node);
      if (i > 0) edges.push({ from: parts[i - 1].node.id, to: parts[i].node.id, label: parts[i].edgeLabel });
    }
  }

  if (!nodes.size || nodes.size > 32) return null;

  // Assign layers with longest-path topological relaxation (bounded to handle cycles cleanly).
  const layer = new Map<string, number>();
  for (const id of nodes.keys()) layer.set(id, 0);
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false;
    for (const edge of edges) {
      const next = (layer.get(edge.from) ?? 0) + 1;
      if (next > (layer.get(edge.to) ?? 0) && next < nodes.size) {
        layer.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, FlowNode[]>();
  for (const node of nodes.values()) {
    const col = layer.get(node.id) ?? 0;
    const list = columns.get(col) ?? [];
    list.push(node);
    columns.set(col, list);
  }
  const layerKeys = [...columns.keys()].sort((a, b) => a - b);

  const hasEdgeLabels = edges.some(edge => Boolean(edge.label));
  const boxW = 136;
  const boxH = 42;
  const gapX = direction === 'LR' ? (hasEdgeLabels ? 78 : 54) : 28;
  const gapY = direction === 'LR' ? 24 : 52;
  const pad = 18;
  const maxPerLayer = Math.max(...layerKeys.map(k => columns.get(k)!.length));

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  let totalW = 0;
  let totalH = 0;

  if (direction === 'LR') {
    totalW = pad * 2 + layerKeys.length * boxW + Math.max(0, layerKeys.length - 1) * gapX;
    totalH = pad * 2 + maxPerLayer * boxH + Math.max(0, maxPerLayer - 1) * gapY;
    layerKeys.forEach((key, ci) => {
      const list = columns.get(key)!;
      const colH = list.length * boxH + (list.length - 1) * gapY;
      const startY = (totalH - colH) / 2;
      list.forEach((node, ri) => {
        pos.set(node.id, { x: pad + ci * (boxW + gapX), y: startY + ri * (boxH + gapY), w: boxW, h: boxH });
      });
    });
  } else {
    totalW = pad * 2 + maxPerLayer * boxW + Math.max(0, maxPerLayer - 1) * gapX;
    totalH = pad * 2 + layerKeys.length * boxH + Math.max(0, layerKeys.length - 1) * gapY;
    layerKeys.forEach((key, ri) => {
      const list = columns.get(key)!;
      const rowW = list.length * boxW + (list.length - 1) * gapX;
      const startX = (totalW - rowW) / 2;
      list.forEach((node, ci) => {
        pos.set(node.id, { x: startX + ci * (boxW + gapX), y: pad + ri * (boxH + gapY), w: boxW, h: boxH });
      });
    });
  }

  const markerId = `hmb-flow-arrow-${++flowCounter}`;
  const defs = `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" fill="var(--muted)" /></marker></defs>`;

  const edgeSvg = edges.map(edge => {
    const a = pos.get(edge.from), b = pos.get(edge.to);
    if (!a || !b) return '';
    let x1: number, y1: number, x2: number, y2: number, d: string;
    if (direction === 'LR') {
      x1 = a.x + a.w; y1 = a.y + a.h / 2;
      x2 = b.x; y2 = b.y + b.h / 2;
      const mx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    } else {
      x1 = a.x + a.w / 2; y1 = a.y + a.h;
      x2 = b.x + b.w / 2; y2 = b.y;
      const my = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    }
    const label = edge.label
      ? `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 - 6).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--font-mono)">${esc(edge.label.slice(0, 18))}</text>`
      : '';
    return `<path d="${d}" fill="none" stroke="var(--muted)" stroke-width="1.5" marker-end="url(#${markerId})" />${label}`;
  }).join('');

  const nodeSvg = [...nodes.values()].map(node => {
    const p = pos.get(node.id)!;
    const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label;
    const fill = node.accent ? 'var(--accent-soft)' : 'var(--card)';
    const stroke = node.accent ? 'var(--accent-ink)' : 'var(--border)';
    const ink = node.accent ? 'var(--accent-ink)' : 'var(--fg)';
    return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.25" />`
      + `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" text-anchor="middle" font-size="12" font-weight="${node.accent ? '600' : '500'}" fill="${ink}" font-family="var(--font-ui)">${esc(label)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" role="img" aria-label="${esc(title || 'Flow diagram')}">${defs}${edgeSvg}${nodeSvg}</svg>`;
  const head = title ? `<figcaption class="hmb-visual-head"><strong>${esc(title)}</strong></figcaption>` : '';
  return `<figure class="hmb-visual hmb-flow">${head}<div class="hmb-visual-body">${svg}</div></figure>\n`;
}

// ---------------------------------------------------------------- inline svg

export function renderSvgBlock(raw: string): string | null {
  const clean = sanitizeSvg(raw);
  if (!clean) return null;
  return `<figure class="hmb-visual hmb-svg"><div class="hmb-visual-body">${clean}</div></figure>\n`;
}

// ---------------------------------------------------------------- callouts

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export const CALLOUT_LABELS: Readonly<Record<CalloutKind, string>> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const CALLOUT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n]+))?(?:\n|$)/i;

/** Extracts a GitHub-style alert marker from the opening text of a blockquote, if present. */
export function parseCalloutMarker(text: string): { kind: CalloutKind; title: string; rest: string } | null {
  const match = CALLOUT_MARKER.exec(text);
  if (!match) return null;
  const kind = match[1].toLowerCase() as CalloutKind;
  const title = match[2]?.trim() || CALLOUT_LABELS[kind];
  return { kind, title, rest: text.slice(match[0].length) };
}
