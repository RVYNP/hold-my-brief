// ---- APPENDED for the agent-indicator prototype (this is the refactor spec-for-AG2.md asks for; nothing above this line is edited) ----
export { mulberry32, hash2, smoothstep, between, bayer4, blue };

/**
 * `renderCover` up to the bisect, but returning the *ink density* of the best knob instead of the dithered pixels, so a caller can run its own
 * (animated) threshold over it. With `bias = 0` and the same method, thresholding this array reproduces `renderCover`'s pixels exactly (2 tones).
 */
export function coverDensity(spec: { seed: number; width: number; height: number; family?: string; dither?: DitherMethod; target?: number }): { density: Float32Array; family: CoverFamily } {
  const { seed, width, height } = spec, method = spec.dither ?? 'blue';
  const family = (coverFamilies as readonly string[]).includes(spec.family ?? '') ? spec.family as CoverFamily : familyFor(seed);
  const salt = coverFamilies.indexOf(family) * 0x9e3779b1;
  const rng = mulberry32((seed ^ salt) >>> 0), aspect = width / height;
  const field = makers[family](rng, (seed ^ salt) | 0, aspect);
  const drawn = between(rng, inkCoverage.low + .01, inkCoverage.high - .01); // renderCover's own target; drawn either way so the stream (and the field) match
  const target = spec.target ?? drawn;
  const linear = new Float32Array(width * height);
  let low = Infinity, high = -Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = field((x + .5) / width * aspect, (y + .5) / height); linear[y * width + x] = v;
    if (v < low) low = v; if (v > high) high = v;
  }
  const range = high - low > 1e-6 ? high - low : 1;
  const curved = new Float32Array(linear.length);
  for (let index = 0; index < linear.length; index++) { const unit = (linear[index] - low) / range; linear[index] = Math.min(1, Math.max(0, unit)); curved[index] = smoothstep(.08, .92, unit); }
  const shaped = new Float32Array(linear.length), shape = (values: Float32Array, q: number) => {
    const power = q < 1 / 3 ? Math.exp(Math.log(.12) * (1 - q * 3)) : 1, cut = .85 * Math.min(1, Math.max(0, q * 3 - 1)), scale = 1 - .75 * Math.max(0, q * 3 - 2);
    for (let index = 0; index < values.length; index++) shaped[index] = scale * (Math.max(0, values[index] - cut) / (1 - cut)) ** power;
    return dither(shaped, width, height, 2, method);
  };
  const probe = shape(curved, 0), values = coverage(probe) > target + .03 ? curved : linear;
  let lo = 0, hi = 1, best = 0, miss = Infinity;
  for (let step = 0; step < 10 && miss > .005; step++) {
    const q = (lo + hi) / 2, ink = coverage(shape(values, q));
    if (Math.abs(ink - target) < miss) { miss = Math.abs(ink - target); best = q; }
    if (ink > target) lo = q; else hi = q;
  }
  shape(values, best);
  return { density: Float32Array.from(shaped), family };
}
