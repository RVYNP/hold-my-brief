/** A small Lottie animation made for the tests: 96 × 96 at 30 fps for 120 frames, the four state markers in 30-frame ranges, one `.tint` layer (a rectangle that turns a full circle over the whole timeline) and one `.fg` layer. */
export function testIcon(change: (icon: Record<string, any>) => void = () => undefined): string {
  const still = (value: unknown) => ({ a: 0, k: value });
  const transform = (rotation: unknown) => ({ o: still(100), r: rotation, p: still([48, 48, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) });
  const layer = (index: number, name: string, shape: Record<string, unknown>, rotation: unknown) => ({
    ddd: 0, ind: index, ty: 4, nm: name, sr: 1, ks: transform(rotation), ao: 0, ip: 0, op: 120, st: 0, bm: 0,
    shapes: [{ ty: 'gr', nm: 'group', it: [shape, { ty: 'fl', nm: 'fill', c: still([0, 0, 1, 1]), o: still(100), r: 1 }, { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) }] }],
  });
  const turn = { a: 1, k: [{ t: 0, s: [0], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } }, { t: 120, s: [360] }] };
  const icon = {
    v: '5.7.0', fr: 30, ip: 0, op: 120, w: 96, h: 96, nm: 'test icon', ddd: 0, assets: [],
    layers: [
      layer(1, '.tint body', { ty: 'rc', nm: 'rect', p: still([0, 0]), s: still([60, 36]), r: still(8) }, turn),
      layer(2, '.fg dot', { ty: 'el', nm: 'dot', p: still([0, 0]), s: still([12, 12]) }, still(0)),
    ],
    markers: ['idle', 'listening', 'acting', 'arriving'].map((cm, index) => ({ cm, tm: index * 30, dr: 30 })),
  };
  change(icon);
  return JSON.stringify(icon);
}
