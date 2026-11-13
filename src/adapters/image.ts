import type { Format, Locator, Position, ReaderAdapter, ReaderContext, ReaderOptions, ReaderSource } from '../types';
import { PREVIEW_CLASS } from '../zoom-gesture';
import { clampZoom, DEFAULT_LIMITS, type ZoomLimits } from '../zoom';

/** The longest an image may be drawn along either side, in CSS px, short of the browsers' ~33 M px layout ceiling. */
const MAX_EXTENT = 24_000;

const mimeTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class ImageAdapter implements ReaderAdapter {
  readonly mode = 'fixed' as const;
  private host!: HTMLElement;
  private frame!: HTMLDivElement;
  private image!: HTMLImageElement;
  private context!: ReaderContext;
  private options!: ReaderOptions;
  private format!: Format;
  private url?: string;
  private observer?: ResizeObserver;
  private destroyed = false;
  private level?: number;
  private onScroll = () => this.context.onPosition(this.getPosition());

  async open(source: ReaderSource, host: HTMLElement, context: ReaderContext, options: ReaderOptions) {
    if (!Object.hasOwn(mimeTypes, source.format)) throw Error('Unsupported image type.');
    this.host = host; this.context = context; this.options = { ...options }; this.format = source.format;
    host.classList.add('image-reader');
    this.frame = document.createElement('div'); this.frame.className = 'image-frame';
    this.image = document.createElement('img'); this.image.alt = source.name; this.image.draggable = false;
    this.url = URL.createObjectURL(new Blob([source.bytes as Uint8Array<ArrayBuffer>], { type: mimeTypes[source.format] }));
    this.image.src = this.url;
    this.frame.append(this.image); host.replaceChildren(this.frame);
    try { await this.image.decode(); }
    catch { throw Error('This image could not be decoded. Check that the original file is complete and uses a supported format.'); }
    if (this.destroyed) return;
    this.layout();
    this.observer = new ResizeObserver(() => {
      if (this.destroyed || this.host.classList.contains(PREVIEW_CLASS)) return;
      const location = this.getPosition().locator;
      this.layout(); this.restoreScroll(location);
      this.context.onPosition(this.getPosition()); // A fit follows the panel, so the level it shows does too.
    });
    this.observer.observe(host);
    host.addEventListener('scroll', this.onScroll, { passive: true });
    context.onPosition(this.getPosition());
  }

  /** The image's box once rotated, in image pixels. */
  private bounds() {
    const radians = (((this.options.rotation % 360) + 360) % 360) * Math.PI / 180;
    const w = this.image.naturalWidth, h = this.image.naturalHeight;
    return { width: Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians)), height: Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians)) };
  }
  /** The scale a fit draws the image at, which is also the level it shows: 1 is one image pixel per CSS pixel. */
  private fitScale(fit: ReaderOptions['fit']) {
    const bounds = this.bounds(), width = Math.max(1, this.host.clientWidth - 32), height = Math.max(1, this.host.clientHeight - 76);
    return fit === 'width' ? width / bounds.width : Math.min(width / bounds.width, height / bounds.height);
  }
  private layout() {
    const width = Math.max(1, this.host.clientWidth - 32);
    const height = Math.max(1, this.host.clientHeight - 76);
    const rotation = ((this.options.rotation % 360) + 360) % 360;
    const w = this.image.naturalWidth, h = this.image.naturalHeight;
    const bounds = this.bounds();
    const scale = this.options.fitted ? this.fitScale(this.options.fit) : clampZoom(this.options.zoom, this.zoomLimits());
    this.level = scale;
    this.frame.style.width = `${Math.max(width, bounds.width * scale)}px`;
    this.frame.style.height = `${Math.max(height, bounds.height * scale)}px`;
    this.image.style.width = `${w * scale}px`; this.image.style.height = `${h * scale}px`;
    this.image.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
  }
  zoomLevel() { return this.level; }
  zoomLimits(): ZoomLimits {
    const bounds = this.bounds(), extent = Math.max(bounds.width, bounds.height);
    return extent > 0 ? { min: DEFAULT_LIMITS.min, max: Math.max(DEFAULT_LIMITS.min, Math.min(DEFAULT_LIMITS.max, MAX_EXTENT / extent)) } : DEFAULT_LIMITS;
  }
  legacyZoomBase(fit: ReaderOptions['fit']) { return this.image?.naturalWidth ? this.fitScale(fit) : undefined; }

  getPosition(): Position {
    return {
      label: `Image · ${this.image?.naturalWidth ?? 0} × ${this.image?.naturalHeight ?? 0}`,
      fraction: 1,
      scrub: { current: 1, total: 1, unit: 'page' },
      locator: {
        kind: this.format,
        x: clamp(this.host.scrollLeft / Math.max(1, this.host.scrollWidth - this.host.clientWidth)),
        y: clamp(this.host.scrollTop / Math.max(1, this.host.scrollHeight - this.host.clientHeight)),
      },
    };
  }

  private restoreScroll(locator: Locator) {
    this.host.scrollLeft = clamp(Number(locator.x)) * Math.max(0, this.host.scrollWidth - this.host.clientWidth);
    this.host.scrollTop = clamp(Number(locator.y)) * Math.max(0, this.host.scrollHeight - this.host.clientHeight);
  }
  async restore(locator: Locator) {
    if (locator.kind === this.format) this.restoreScroll(locator);
    this.context.onPosition(this.getPosition());
  }
  async navigate(action: Parameters<ReaderAdapter['navigate']>[0]) {
    if (action === 'start') this.host.scrollTo(0, 0);
    else if (action === 'end') this.host.scrollTo(this.host.scrollWidth, this.host.scrollHeight);
    else if (action !== 'back') this.host.scrollBy(0, (action === 'previous' || action === 'screen-previous' ? -1 : 1) * this.host.clientHeight * 0.9);
    this.context.onPosition(this.getPosition());
  }
  async goTo(target: string) {
    if (target.trim() !== '1') throw Error('This file contains one image. Use collection navigation to change images.');
    this.host.scrollTo(0, 0); this.context.onPosition(this.getPosition());
  }
  async setOptions(options: ReaderOptions) {
    const location = this.getPosition().locator;
    this.options = { ...options }; this.layout(); this.restoreScroll(location);
    this.context.onPosition(this.getPosition());
  }
  outline() { return []; }
  scroller() { return this.host; }
  destroy() {
    this.destroyed = true; this.observer?.disconnect();
    this.host?.removeEventListener('scroll', this.onScroll); this.host?.classList.remove('image-reader');
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined; this.image?.removeAttribute('src');
  }
}
