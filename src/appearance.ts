import { appearance, applyAppearance, glows, glowSchemes, isGlow, palettes, readingColors, rgbToHex, saveAppearance, schemeOf, type Appearance, type AppearanceMode, type PageTone, type Palette } from './theme';

const icon = (size: number, body: string) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const paletteIcon = icon(14, '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>');
const names: Record<Palette, string> = { brief: 'Brief', lilac: 'Lilac', birch: 'Birch', graphite: 'Graphite', arctic: 'Arctic', blossom: 'Blossom', peony: 'Peony', aurora: 'Aurora', dusk: 'Dusk', nebula: 'Nebula', solar: 'Solar', ember: 'Ember', orchid: 'Orchid', glacier: 'Glacier', peach: 'Peach', lagoon: 'Lagoon', moss: 'Moss' };
const modes: [AppearanceMode, string, string][] = [
  ['system', 'System', icon(13, '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8m-4-4v4"/>')],
  ['light', 'Light', icon(13, '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>')],
  ['dark', 'Dark', icon(13, '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>')],
];
/** Accent presets offered beside the theme's own accent; any other color is a custom accent. */
const presets: [string, string][] = [['Acid', '#e13a3a'], ['Iris', '#a86af4'], ['Blue', '#3d6fff'], ['Teal', '#2b8a84'], ['Rose', '#c2456b'], ['Moss', '#5f8a3a'], ['Amber', '#c27a1a']];
const tones: [PageTone, string][] = [['theme', 'Match theme'], ['white', 'White'], ['sepia', 'Sepia'], ['dim', 'Dim']];
const spacings: [number, string][] = [[1.4, 'Tight'], [1.65, 'Normal'], [1.9, 'Relaxed'], [2.2, 'Loose']];
const margins: [number, string][] = [[12, 'Narrow'], [24, 'Medium'], [40, 'Wide']];
const restingHint = 'Hover to preview, click to keep.';

/** The reading settings the sheet edits for reflowable text (Markdown, TXT, reflowable EPUB). */
export type TextSettings = { fontSize: number; lineHeight: number; margin: number; wrap: boolean };
/** Supplied by the reader: the open document's settings (undefined when it is page-based or nothing is open) and how to change them. */
export type TextControls = {
  current: () => (TextSettings & { wraps: boolean }) | undefined;
  change: (next: Partial<TextSettings>) => Promise<void>;
};

/** Menu label for the kept appearance, e.g. "Brief · System"; a glow theme has one scheme, so it reads "Aurora · Dark". */
export function appearanceSummary() {
  const kept = appearance();
  const mode = isGlow(kept.palette) ? glowSchemes[kept.palette] : kept.mode;
  return `${names[kept.palette]} · ${modes.find(([id]) => id === mode)![1]}`;
}
const card = (palette: Palette) => `<button class="theme-card" role="radio" data-choice="${palette}"><span class="theme-tile" data-palette="${palette}"><span class="theme-sample">Aa</span><span class="theme-dots" aria-hidden="true"><span></span><span></span><span></span></span></span><span class="theme-name">${names[palette]}</span></button>`;

/** Radio group with a roving tab stop: arrows move focus, and `selectOnFocus` groups also choose. */
function radioGroup(group: HTMLElement, selectOnFocus: boolean) {
  group.addEventListener('keydown', event => {
    const items = Array.from(group.querySelectorAll<HTMLButtonElement>('[role=radio]'));
    const index = items.indexOf(event.target as HTMLButtonElement), step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (index < 0 || !step) return;
    event.preventDefault();
    const next = items[(index + step + items.length) % items.length];
    next.focus(); if (selectOnFocus) next.click();
  });
}
function check(group: HTMLElement, chosen: (item: HTMLElement) => boolean) {
  const items = Array.from(group.querySelectorAll<HTMLElement>('[role=radio]'));
  const selected = items.find(chosen);
  for (const item of items) { item.setAttribute('aria-checked', String(item === selected)); item.tabIndex = item === (selected ?? items[0]) ? 0 : -1; }
}

/**
 * Fills the Appearance bottom sheet. Hovering or focusing a theme previews it on the whole
 * window; click or Enter keeps it; leaving the cards, blur or Escape restores the kept theme.
 * Below the colours, a Text section edits size, spacing, margins and wrapping of the open text
 * document, live, so the change is judged on the page above the sheet.
 */
export function createAppearanceSheet(dialog: HTMLDialogElement, text: TextControls) {
  dialog.setAttribute('aria-labelledby', 'appearance-title');
  dialog.innerHTML = `
    <div class="sheet-head"><h2 id="appearance-title">Appearance</h2><div class="sheet-tabs" role="tablist" aria-label="Appearance sections"><button role="tab" id="appearance-tab-colour" data-tab="colour" aria-controls="appearance-colour">Colour</button><button role="tab" id="appearance-tab-text" data-tab="text" aria-controls="appearance-text">Text</button></div><button class="sheet-close" data-close aria-label="Close appearance">${icon(15, '<path d="M18 6 6 18M6 6l12 12"/>')}</button></div>
    <div class="sheet-panel" id="appearance-colour" role="tabpanel" aria-labelledby="appearance-tab-colour">
    <div class="appearance-row"><span class="sheet-label" id="appearance-mode-label">MODE</span>
      <div class="theme-group"><div class="choices appearance-modes" role="radiogroup" aria-labelledby="appearance-mode-label">${modes.map(([mode, label, glyph]) => `<button role="radio" data-mode="${mode}">${glyph}${label}</button>`).join('')}</div>
      <p class="appearance-mode-note" hidden>Glow themes have one mode.</p></div></div>
    <div class="appearance-row appearance-row-top"><span class="sheet-label" id="appearance-theme-label">THEME</span>
      <div class="theme-group"><div class="theme-row" role="radiogroup" aria-labelledby="appearance-theme-label">${palettes.map(card).join('')}</div></div></div>
    <div class="appearance-row appearance-row-top"><span class="sheet-label" id="appearance-glow-label">GLOW</span>
      <div class="theme-group"><div class="theme-row theme-row-glow" role="radiogroup" aria-labelledby="appearance-glow-label">${glows.map(card).join('')}</div>
      <p class="appearance-hint" aria-live="polite">${restingHint}</p></div></div>
    <div class="appearance-row"><span class="sheet-label" id="appearance-accent-label">ACCENT</span>
      <div class="swatches" role="radiogroup" aria-labelledby="appearance-accent-label">
        <button class="swatch swatch-theme" role="radio" data-accent="" aria-label="Theme accent"><span></span></button>
        ${presets.map(([name, color]) => `<button class="swatch" role="radio" data-accent="${color}" aria-label="${name}" style="--swatch: ${color}"><span></span></button>`).join('')}
        <button class="swatch swatch-custom" role="radio" aria-label="Custom accent color…"><span></span>${icon(12, '<path d="M5 12h14M12 5v14"/>')}</button>
        <input class="swatch-input" type="color" tabindex="-1" aria-hidden="true">
      </div></div>
    <div class="appearance-row"><span class="sheet-label" id="appearance-page-label">PAGE</span>
      <div class="choices" role="radiogroup" aria-labelledby="appearance-page-label">${tones.map(([tone, label]) => `<button role="radio" data-tone="${tone}">${label}</button>`).join('')}</div></div>
    <p class="appearance-note">PDF pages and images keep their original colors.</p>
    </div>
    <div class="sheet-panel" id="appearance-text" role="tabpanel" aria-labelledby="appearance-tab-text" hidden>
    <div class="appearance-text">
      <div class="appearance-row"><span class="sheet-label" id="appearance-size-label">SIZE</span>
        <div class="stepper" role="group" aria-labelledby="appearance-size-label"><button data-step="-2" aria-label="Smaller text">${icon(13, '<path d="M5 12h14"/>')}</button><output class="stepper-value" aria-live="polite"></output><button data-step="2" aria-label="Larger text">${icon(13, '<path d="M5 12h14M12 5v14"/>')}</button></div></div>
      <div class="appearance-row"><span class="sheet-label" id="appearance-spacing-label">SPACING</span>
        <div class="choices" role="radiogroup" aria-labelledby="appearance-spacing-label">${spacings.map(([value, label]) => `<button role="radio" data-spacing="${value}">${label}</button>`).join('')}</div></div>
      <div class="appearance-row"><span class="sheet-label" id="appearance-margin-label">MARGINS</span>
        <div class="choices" role="radiogroup" aria-labelledby="appearance-margin-label">${margins.map(([value, label]) => `<button role="radio" data-margin="${value}">${label}</button>`).join('')}</div></div>
      <div class="appearance-row appearance-wrap"><span class="sheet-label" id="appearance-wrap-label">LINES</span>
        <div class="choices" role="radiogroup" aria-labelledby="appearance-wrap-label"><button role="radio" data-wrap="true">Wrap</button><button role="radio" data-wrap="false">Keep as written</button></div></div>
    </div>
    <p class="appearance-note appearance-text-note">Text settings apply to Markdown, plain text and reflowable books. PDF pages, fixed-layout books and images zoom instead (Ctrl + and Ctrl −).</p>
    </div>`;
  const hint = dialog.querySelector<HTMLElement>('.appearance-hint')!;
  const modeGroup = dialog.querySelector<HTMLElement>('.appearance-modes')!, modeNote = dialog.querySelector<HTMLElement>('.appearance-mode-note')!;
  const themeRows = Array.from(dialog.querySelectorAll<HTMLElement>('.theme-row'));
  const swatches = dialog.querySelector<HTMLElement>('.swatches')!, themeSwatch = dialog.querySelector<HTMLElement>('.swatch-theme')!;
  const custom = dialog.querySelector<HTMLButtonElement>('.swatch-custom')!, picker = dialog.querySelector<HTMLInputElement>('.swatch-input')!;
  const toneGroup = dialog.querySelector<HTMLElement>('[aria-labelledby=appearance-page-label]')!;
  const textSection = dialog.querySelector<HTMLElement>('.appearance-text')!, textNote = dialog.querySelector<HTMLElement>('.appearance-text-note')!;
  const sizeValue = dialog.querySelector<HTMLOutputElement>('.stepper-value')!;
  const spacingGroup = dialog.querySelector<HTMLElement>('[aria-labelledby=appearance-spacing-label]')!, marginGroup = dialog.querySelector<HTMLElement>('[aria-labelledby=appearance-margin-label]')!;
  const wrapRow = dialog.querySelector<HTMLElement>('.appearance-wrap')!, wrapGroup = wrapRow.querySelector<HTMLElement>('.choices')!;
  const tabs = dialog.querySelectorAll<HTMLButtonElement>('[role=tab]');
  let tab: 'colour' | 'text' = 'colour';
  function showTab(next: 'colour' | 'text') {
    tab = next;
    for (const button of tabs) { const selected = button.dataset.tab === next; button.setAttribute('aria-selected', String(selected)); button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1; }
    for (const panel of dialog.querySelectorAll<HTMLElement>('[role=tabpanel]')) panel.hidden = panel.id !== `appearance-${next}`;
  }
  for (const button of tabs) button.addEventListener('click', () => showTab(button.dataset.tab as 'colour' | 'text'));
  dialog.querySelector<HTMLElement>('.sheet-tabs')!.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); showTab(tab === 'colour' ? 'text' : 'colour'); dialog.querySelector<HTMLElement>('[role=tab][aria-selected=true]')!.focus();
  });
  let kept: Appearance = appearance();

  function render() {
    const shown = appearance(), previewing = shown.palette !== kept.palette, fixed = isGlow(shown.palette);
    // A glow theme fixes the scheme: the control shows it, disabled; `mode` itself is untouched, so a normal family restores it.
    check(modeGroup, item => item.dataset.mode === (fixed ? schemeOf(shown) : kept.mode));
    for (const item of modeGroup.querySelectorAll<HTMLButtonElement>('[data-mode]')) item.disabled = fixed;
    modeNote.hidden = !fixed;
    for (const row of themeRows) check(row, item => item.dataset.choice === kept.palette);
    for (const card of dialog.querySelectorAll<HTMLElement>('.theme-card')) card.toggleAttribute('data-previewing', previewing && card.dataset.choice === shown.palette);
    const preset = kept.accent === null || presets.some(([, color]) => color === kept.accent);
    check(swatches, item => item === custom ? !preset : item.dataset.accent === (kept.accent ?? ''));
    themeSwatch.dataset.palette = shown.palette;
    custom.style.setProperty('--swatch', kept.accent ?? 'transparent');
    custom.setAttribute('aria-label', preset ? 'Custom accent color…' : `Custom accent ${kept.accent}`);
    check(toneGroup, item => item.dataset.tone === kept.page);
    hint.toggleAttribute('data-previewing', previewing);
    hint.textContent = previewing ? `Previewing ${names[shown.palette]}. Click to keep it, or move away to return to ${names[kept.palette]}.` : restingHint;
    renderText();
  }
  function renderText() {
    const settings = text.current();
    textSection.hidden = !settings; textNote.hidden = !!settings;
    if (!settings) return;
    sizeValue.value = `${settings.fontSize} px`;
    const steppers = Array.from(textSection.querySelectorAll<HTMLButtonElement>('[data-step]'));
    for (const button of steppers) button.disabled = Number(button.dataset.step) < 0 ? settings.fontSize <= 12 : settings.fontSize >= 40;
    // Reaching 12 or 40 px disables the button that was pressed; keep keyboard focus on the other one.
    if (steppers.some(button => button.disabled && button === document.activeElement)) steppers.find(button => !button.disabled)?.focus();
    // Spacing and margins snap to the nearest preset, so a value saved by an older build still shows a choice.
    const nearest = (options: [number, string][], value: number) => options.reduce((best, option) => Math.abs(option[0] - value) < Math.abs(best[0] - value) ? option : best)[0];
    check(spacingGroup, item => Number(item.dataset.spacing) === nearest(spacings, settings.lineHeight));
    check(marginGroup, item => Number(item.dataset.margin) === nearest(margins, settings.margin));
    wrapRow.hidden = !settings.wraps;
    check(wrapGroup, item => item.dataset.wrap === String(settings.wrap));
  }
  const editText = (next: Partial<TextSettings>) => void text.change(next).then(renderText);
  function keep(change: Partial<Appearance>) { kept = { ...kept, ...change }; saveAppearance(kept); render(); }
  function preview(palette: Palette) {
    if (palette === kept.palette) restore();
    else if (appearance().palette !== palette) { applyAppearance({ ...kept, palette }); render(); }
  }
  function restore() { if (appearance() !== kept) { applyAppearance(kept); render(); } }

  for (const group of [modeGroup, swatches, toneGroup, spacingGroup, marginGroup, wrapGroup]) radioGroup(group, true);
  for (const row of themeRows) radioGroup(row, false);
  modeGroup.addEventListener('click', event => { const mode = (event.target as Element).closest<HTMLElement>('[data-mode]')?.dataset.mode as AppearanceMode | undefined; if (mode) keep({ mode }); });
  toneGroup.addEventListener('click', event => { const page = (event.target as Element).closest<HTMLElement>('[data-tone]')?.dataset.tone as PageTone | undefined; if (page) keep({ page }); });
  spacingGroup.addEventListener('click', event => { const value = (event.target as Element).closest<HTMLElement>('[data-spacing]')?.dataset.spacing; if (value) editText({ lineHeight: Number(value) }); });
  marginGroup.addEventListener('click', event => { const value = (event.target as Element).closest<HTMLElement>('[data-margin]')?.dataset.margin; if (value) editText({ margin: Number(value) }); });
  wrapGroup.addEventListener('click', event => { const value = (event.target as Element).closest<HTMLElement>('[data-wrap]')?.dataset.wrap; if (value) editText({ wrap: value === 'true' }); });
  textSection.addEventListener('click', event => {
    const step = Number((event.target as Element).closest<HTMLElement>('[data-step]')?.dataset.step);
    const settings = text.current();
    if (step && settings) editText({ fontSize: Math.max(12, Math.min(40, settings.fontSize + step)) });
  });
  for (const row of themeRows) {
    row.addEventListener('click', event => { const palette = (event.target as Element).closest<HTMLElement>('[data-choice]')?.dataset.choice as Palette | undefined; if (palette) keep({ palette }); });
    for (const card of row.querySelectorAll<HTMLElement>('.theme-card')) {
      const palette = card.dataset.choice as Palette;
      card.addEventListener('pointerenter', () => preview(palette));
      card.addEventListener('focus', () => preview(palette));
    }
    row.addEventListener('pointerleave', restore);
    row.addEventListener('focusout', event => { if (!themeRows.some(other => other.contains(event.relatedTarget as Node | null))) restore(); });
  }
  swatches.addEventListener('click', event => {
    const swatch = (event.target as Element).closest<HTMLElement>('[role=radio]');
    if (!swatch) return;
    if (swatch !== custom) { keep({ accent: swatch.dataset.accent || null }); return; }
    picker.value = kept.accent ?? rgbToHex(readingColors().accent);
    try { picker.showPicker(); } catch { picker.click(); }
  });
  picker.addEventListener('change', () => keep({ accent: picker.value.toLowerCase() }));
  dialog.addEventListener('keydown', event => {
    // The first Escape only ends a preview; the next one closes the sheet.
    if (event.key === 'Escape' && appearance() !== kept) { event.preventDefault(); event.stopPropagation(); restore(); }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientY < box.top || event.clientX < box.left || event.clientX > box.right) dialog.close();
  });
  dialog.addEventListener('close', restore);

  return {
    /** Opens the sheet on its Colour tab, or on its Text tab (the palette's "Text size & spacing"). */
    open(section: 'colour' | 'text' = 'colour') {
      kept = appearance(); showTab(section); render(); dialog.showModal();
      const target = section === 'text' ? (!textSection.hidden && textSection.querySelector<HTMLElement>('[data-step]:not(:disabled)')) || dialog.querySelector<HTMLElement>('#appearance-tab-text') : modeGroup.querySelector<HTMLElement>('[aria-checked=true]');
      target?.focus();
    },
  };
}
