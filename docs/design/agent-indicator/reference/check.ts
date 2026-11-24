// Acceptance checks the spec asks AG2 to port as vitest tests. Run: ./build.sh && node dist/check.mjs
import { renderCover, coverDensity, coverFamilies, bayer8, bayer4, blue, type DitherMethod } from '../../../../src/procedural-cover' /* plus ./cover-density.ts */;
import { agentPalette, contrast, defaultMarks, glyphColour, lookFor, markPair, hexToRgb, darkWorst, lightWorst, kindSlots, channels, states, type Scheme } from './indicator';

let failed = 0;
const ok = (name: string, pass: boolean, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!pass) failed++; };

// 1 identity: thresholding coverDensity (no target given, so renderCover's own) at bias 0 reproduces renderCover (2 tones) pixel for pixel
for (const method of ['bayer4', 'bayer8', 'blue'] as const) for (const family of coverFamilies) for (const seed of [1, 4049022802, 0xdeadbeef]) {
  const w = 17, h = 17, cover = renderCover({ seed, hue: 0, scheme: 'dark', width: w, height: h, family, dither: method as DitherMethod, tones: 2 });
  const { density } = coverDensity({ seed, width: w, height: h, family, dither: method }), t = blue();
  let diff = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const thr = method === 'blue' ? t[(y % 32) * 32 + x % 32] : method === 'bayer4' ? (bayer4[(y & 3) * 4 + (x & 3)] + .5) / 16 : bayer8(x, y); if ((density[y * w + x] > thr ? 1 : 0) !== (cover.pixels[y * w + x] ? 1 : 0)) diff++; }
  ok(`identity ${family}/${method}/${seed}`, diff === 0, diff ? `${diff} px differ` : '');
}

// 2 determinism
ok('lookFor deterministic', JSON.stringify(lookFor('omp', 'Ghostty', 42)) === JSON.stringify(lookFor('omp', 'Ghostty', 42)));
ok('pid only moves phase', (() => { const a = lookFor('omp', 'Ghostty', 1), b = lookFor('omp', 'Ghostty', 2); return a.seed === b.seed && a.family === b.family && a.method === b.method && a.phase !== b.phase; })());
ok('terminal makes siblings', (() => { const a = lookFor('omp', 'Ghostty'), b = lookFor('omp', 'Tern'); return a.family === b.family && a.method === b.method && a.seed !== b.seed; })());

// 3 built-in kinds distinct in (family, method); the first three also distinct in each
const kinds = ['omp', 'claude', 'codex', 'cursor', 'other', 'unknown'], looks = kinds.map(k => lookFor(k));
ok('no two built-in kinds share (family, method)', new Set(looks.map(l => l.family + l.method)).size === 6, looks.map(l => `${l.kind}:${l.family}/${l.method}`).join(' '));
ok('omp/claude/codex differ in family and in method', new Set(looks.slice(0, 3).map(l => l.family)).size === 3 && new Set(looks.slice(0, 3).map(l => l.method)).size === 3);

// 4 colour: marks, tones, glyph
const page: Record<Scheme, [number, number, number]> = { light: [0xfb, 0xfa, 0xfc], dark: [0x1e, 0x1d, 0x24] };
const customs = ['#e13a3a', '#a86af4', '#3d6fff', '#2b8a84', '#c2456b', '#5f8a3a', '#c27a1a', '#f0f0f0', '#101010', '#ffee00', '#808080', '#00ff00'];
for (const hex of customs) { const m = markPair(hex); for (const s of ['light', 'dark'] as const) {
  const mark = m[s], bg = s === 'light' ? lightWorst : darkWorst, p = agentPalette(mark, s), g = glyphColour(p);
  ok(`${hex} ${s}: mark >= 3:1 on worst rail/card`, contrast(mark, bg) >= 3, contrast(mark, bg).toFixed(2));
  ok(`${hex} ${s}: glyph >= 3:1 on weakest tone`, g.ratio >= 3, g.ratio.toFixed(2));
  const steps = [contrast(p[0], p[1]), contrast(p[1], p[2])];
  ok(`${hex} ${s}: ink steps 1.10-1.45`, steps.every(v => v >= 1.1 && v <= 1.45), steps.map(v => v.toFixed(2)).join(' '));
} }
for (const [k, m] of Object.entries(defaultMarks)) for (const s of ['light', 'dark'] as const) { const bg = s === 'light' ? lightWorst : darkWorst; ok(`default ${k} ${s}: mark >= 3:1 on worst rail/card`, contrast(m[s], bg) >= 3, contrast(m[s], bg).toFixed(2)); }
ok('table kinds ignore the hash for family/method', Object.entries(kindSlots).every(([k, v]) => { const l = lookFor(k); return l.family === v.family && l.method === v.method; }));
ok('named other clients hash their own family/method', (() => { const a = lookFor('other:alpha'), b = lookFor('other:bravo'); return typeof a.family === 'string' && a.seed !== b.seed; })());

// 5 state channels: reduced motion = no tween, loops wrap, one-shots end at rest
for (const s of states) { const l = lookFor('omp'); const a = channels(s, 0, l), b = channels(s, 99, l); ok(`${s}: frame 0 finite`, Object.values(a).every(v => typeof v !== 'number' || Number.isFinite(v)));
  if (s === 'acting' || s === 'arriving') ok(`${s}: ends at rest`, b.bias === 0 && b.tab === 0 && b.ringLevel === 0 && b.glow === 0, JSON.stringify(b)); }
ok('idle reduced = frame 0 constant', (() => { const l = lookFor('omp'); return [0, 1, 3.3, 6].every(t => channels('idle', t, l, true).bias === 0); })());
ok('listening reduced = constant', (() => { const l = lookFor('omp'); const a = channels('listening', 0, l, true), b = channels('listening', 1, l, true); return a.tab === b.tab && a.crawl === b.crawl && a.bias === b.bias; })());
console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
