// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseCalloutMarker, renderChartBlock, renderFlowBlock, renderSvgBlock } from '../src/visual-blocks';

describe('visual blocks', () => {
  it('renders horizontal bar, vertical bar, line and metric charts', () => {
    const hbar = renderChartBlock(JSON.stringify({
      type: 'hbar',
      title: 'Latency',
      unit: 'ms',
      data: [{ label: 'Warm IPC', value: 14, highlight: true }, { label: 'Cold launch', value: 240 }],
    }));
    expect(hbar).toContain('hmb-chart');
    expect(hbar).toContain('Latency');
    expect(hbar).toContain('14ms');

    const bar = renderChartBlock(JSON.stringify({ type: 'bar', data: [{ label: 'A', value: 5 }, { label: 'B', value: 10 }] }));
    expect(bar).toContain('<rect');

    const line = renderChartBlock(JSON.stringify({ type: 'line', data: [{ label: 'v1', value: 2 }, { label: 'v2', value: 8 }] }));
    expect(line).toContain('<polyline');

    const metrics = renderChartBlock(JSON.stringify({
      type: 'metrics',
      items: [{ label: 'Tests', value: '1,143', note: 'all green', tone: 'positive' }],
    }));
    expect(metrics).toContain('hmb-metrics-grid');
    expect(metrics).toContain('1,143');
  });

  it('returns null for invalid chart JSON so Markdown falls back to a normal code block', () => {
    expect(renderChartBlock('not json')).toBeNull();
    expect(renderChartBlock('{}')).toBeNull();
  });

  it('renders layered flow diagrams with labeled edges and accents', () => {
    const flow = renderFlowBlock([
      'title: Control Flow',
      'direction: LR',
      'CLI[hmb] --NDJSON--> IPC(Local Socket) -> UI[Reader]',
    ].join('\n'));
    expect(flow).not.toBeNull();
    expect(flow).toContain('Control Flow');
    expect(flow).toContain('NDJSON');
    expect(flow).toContain('Local Socket');
    expect(flow).toContain('var(--accent-soft)');
  });

  it('sanitizes inline svg blocks', () => {
    const html = renderSvgBlock('<svg viewBox="0 0 20 20"><script>bad()</script><circle cx="10" cy="10" r="8" /></svg>');
    expect(html).not.toBeNull();
    expect(html).not.toContain('script');
    expect(html).toContain('<circle');
  });

  it('parses GitHub-style callout markers', () => {
    expect(parseCalloutMarker('[!WARNING]\nWatch out')).toEqual({ kind: 'warning', title: 'Warning', rest: 'Watch out' });
    expect(parseCalloutMarker('[!TIP] Custom heading\nBody')).toEqual({ kind: 'tip', title: 'Custom heading', rest: 'Body' });
    expect(parseCalloutMarker('Regular quote')).toBeNull();
  });
});
