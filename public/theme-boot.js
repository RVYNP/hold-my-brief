// Applies the saved appearance before first paint, so a dark or custom theme never flashes.
// src/theme.ts owns this record's format and re-applies it (with validation) once the app loads.
(() => {
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hold-my-brief:appearance') || '{}') || {}; } catch { /* Defaults apply. */ }
  // A glow theme has one scheme (src/theme.ts glowSchemes, which this table repeats; tests/theme.test.ts keeps them equal).
  const glows = { aurora: 'dark', dusk: 'dark', nebula: 'dark', solar: 'dark', ember: 'dark', orchid: 'dark', glacier: 'light', peach: 'light', lagoon: 'light', moss: 'light' };
  const glow = typeof saved.palette === 'string' && Object.prototype.hasOwnProperty.call(glows, saved.palette) ? glows[saved.palette] : null;
  const mode = glow || (saved.mode === 'light' || saved.mode === 'dark' ? saved.mode : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.theme = mode;
  if (typeof saved.palette === 'string') root.dataset.palette = saved.palette;
  if (typeof saved.page === 'string' && saved.page !== 'theme') root.dataset.page = saved.page;
  for (const [name, value] of Object.entries(saved.vars || {})) if (name.startsWith('--accent')) root.style.setProperty(name, String(value));
})();
