/** The reading text size, in px, that every control stepping it shares: the Appearance sheet, Ctrl +/−, and the view controls' A− / A+. */
export const FONT_MIN = 12;
export const FONT_MAX = 40;
export const FONT_STEP = 2;

/** `size` one step larger (`direction` 1) or smaller (-1), held between FONT_MIN and FONT_MAX. */
export const steppedFontSize = (size: number, direction: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, size + direction * FONT_STEP));
