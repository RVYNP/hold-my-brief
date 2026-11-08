import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type * as PdfjsModule from 'pdfjs-dist';
import { canvasThumbnail, encodeCanvas, imageFormats, libraryThumbnailRatios, putLibraryThumbnail, readLibraryRange, readLibraryThumbnail, type LibraryThumbnail } from './bridge';

export type Thumbnail = { url: string; ratio: number };
type Pdfjs = typeof PdfjsModule;

/** Longest edge of a thumbnail the webview renders itself (PDF first pages, AVIF). */
const maxEdge = 480;
// Bytes asked for up front, then per request while pdf.js walks a file's xref and page 1. Larger
// requests mean fewer round trips to a slow volume; both stay far below the file sizes involved.
const firstChunk = 64 * 1024, rangeChunk = 256 * 1024, rangeLimit = 8 * 1024 * 1024;
const avifLimit = 20 * 1024 * 1024;
const jobTimeout = 120_000;
// pdf.js drops any image above `maxImageSize` pixels, which leaves a blank page: a 148 MB scan holds a
// 10729 x 13808 JPEG (148 Mpx). The cap therefore admits scans that large, and files over `heavyBytes`
// are rendered one at a time because each such decode needs several hundred MB.
const maxImagePixels = 200_000_000, heavyBytes = 32 * 1024 * 1024;
/** Pictures kept as object URLs; the least recently shown beyond this go, unless a tile still shows them. */
const keepReady = 600;
const concurrency = { pdf: 4, image: 3 } as const;

/** Formats that can have a thumbnail: every raster image, and PDF (its first page). */
export function canThumbnail(format: string): boolean {
  const lower = format.toLowerCase();
  return lower === 'pdf' || Object.hasOwn(imageFormats, lower);
}

let pdfjs: Promise<Pdfjs> | undefined;
function loadPdfjs() {
  // Loaded on first use so the library costs nothing until a PDF tile asks for its page.
  return pdfjs ??= import('pdfjs-dist').then(lib => { lib.GlobalWorkerOptions.workerSrc = workerURL; return lib; });
}
// Decoding a scan's page-sized JPEG is the slow part and runs inside the pdf.js worker, so each
// concurrent render gets a worker of its own; one shared worker would run them one after another.
const idleWorkers: InstanceType<Pdfjs['PDFWorker']>[] = [];
function takeWorker(lib: Pdfjs) { return idleWorkers.pop() ?? new lib.PDFWorker(); }

/** Bytes `[begin, end)` of a library original, in as many native reads as the per-read limit needs. */
async function readSpan(path: string, begin: number, end: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = []; let at = begin;
  while (at < end) {
    const { bytes } = await readLibraryRange(path, at, Math.min(rangeLimit, end - at));
    if (!bytes.length) break;
    parts.push(bytes); at += bytes.length;
  }
  if (parts.length === 1) return parts[0];
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return joined;
}

/** Runs `work` after every earlier exclusive job has finished. */
let exclusiveTail: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = exclusiveTail.then(work, work); exclusiveTail = run.catch(() => undefined); return run;
}

/**
 * Page 1 of a PDF scaled to `maxEdge`, rendered by the bundled pdf.js. pdf.js asks for the ranges it
 * needs (the cross-reference table, page 1 and its images) through a range transport backed by
 * `read_library_range`, so a multi-page 100 MB catalogue costs its xref plus page 1. A single-page scan
 * (img2pdf) is all page 1, so it is read whole whatever the transport does.
 */
async function renderPdfThumbnail(path: string): Promise<LibraryThumbnail> {
  const lib = await loadPdfjs();
  const first = await readLibraryRange(path, 0, firstChunk);
  return first.total > heavyBytes ? exclusive(() => renderFirstPage(lib, path, first)) : renderFirstPage(lib, path, first);
}
async function renderFirstPage(lib: Pdfjs, path: string, first: { total: number; bytes: Uint8Array }): Promise<LibraryThumbnail> {
  const worker = takeWorker(lib);
  const root = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
  const options = {
    cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, wasmUrl: `${root}wasm/`,
    enableXfa: false, maxImageSize: maxImagePixels, worker, disableAutoFetch: true, disableStream: true, rangeChunkSize: rangeChunk,
  };
  // A read that fails would leave pdf.js waiting for it forever; this settles the whole render instead.
  let fail: (error: unknown) => void = () => undefined;
  const failure = new Promise<never>((_, reject) => { fail = reject; }); failure.catch(() => undefined);
  let task;
  if (first.bytes.length >= first.total) task = lib.getDocument({ ...options, data: first.bytes });
  else {
    const transport = new lib.PDFDataRangeTransport(first.total, first.bytes);
    transport.requestDataRange = (begin, end) => { readSpan(path, begin, Math.min(end, first.total)).then(bytes => transport.onDataRange(begin, bytes), fail); };
    task = lib.getDocument({ ...options, range: transport });
  }
  try {
    const doc = await Promise.race([task.promise, failure]);
    const page = await Promise.race([doc.getPage(1), failure]);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxEdge / Math.max(natural.width, natural.height) });
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
    await Promise.race([page.render({ canvas, viewport }).promise, failure]);
    page.cleanup();
    return await encodeCanvas(canvas);
  } finally { void task.destroy().then(() => idleWorkers.push(worker), () => worker.destroy()); }
}

/** AVIF is decoded by the webview (the native side has no decoder), then scaled like the rest. */
async function renderAvifThumbnail(path: string): Promise<LibraryThumbnail> {
  const first = await readLibraryRange(path, 0, rangeLimit);
  if (first.total > avifLimit) throw Error('This image is too large for a thumbnail.');
  const bytes = first.bytes.length >= first.total ? first.bytes : await readSpan(path, 0, first.total);
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/avif' }));
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    return await canvasThumbnail(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  } finally { bitmap.close(); }
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('The thumbnail took too long.')), jobTimeout);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type Job = { path: string; format: string; wants: (() => boolean)[]; settle: (thumbnail: Thumbnail | undefined) => void };

/**
 * Thumbnails for the library: made on demand, kept as object URLs for the session, and shared by every
 * render, so typing in the search box or switching view never fetches a picture twice. The native side
 * keeps the long-term disk cache; this is only the webview's view of it.
 */
export function createThumbnailStore() {
  const ready = new Map<string, Thumbnail>(); // Insertion order doubles as least-recently-shown order.
  const jobs = new Map<string, Promise<Thumbnail | undefined>>();
  const failed = new Set<string>();
  const hints = new Map<string, number>(); // Proportions known from the disk cache before any picture loaded.
  const asked = new Set<string>();
  let queue: Job[] = []; const active = { pdf: 0, image: 0 };

  const kind = (format: string) => format.toLowerCase() === 'pdf' ? 'pdf' : 'image';
  function remember(path: string, made: LibraryThumbnail): Thumbnail {
    const thumbnail = { url: URL.createObjectURL(made.blob), ratio: made.width / made.height };
    const old = ready.get(path); if (old) URL.revokeObjectURL(old.url);
    ready.set(path, thumbnail); return thumbnail;
  }
  async function make(path: string, format: string): Promise<Thumbnail> {
    let made = await readLibraryThumbnail(path);
    if (!made) {
      const lower = format.toLowerCase();
      if (lower === 'pdf') made = await renderPdfThumbnail(path);
      else if (lower === 'avif') made = await renderAvifThumbnail(path);
      else throw Error('This format has no thumbnail.');
      // The disk cache only saves the next launch the work; a failed save must not hide a good picture.
      void putLibraryThumbnail(path, made).catch(() => undefined);
    }
    return remember(path, made);
  }
  function pump() {
    for (let index = 0; index < queue.length;) {
      const job = queue[index], group = kind(job.format);
      if (!job.wants.some(wants => wants())) { queue.splice(index, 1); jobs.delete(job.path); job.settle(undefined); continue; }
      if (active[group] >= concurrency[group]) { index++; continue; }
      queue.splice(index, 1); active[group]++;
      withTimeout(make(job.path, job.format)).then(thumbnail => job.settle(thumbnail), () => { failed.add(job.path); job.settle(undefined); })
        .finally(() => { active[group]--; jobs.delete(job.path); pump(); });
    }
  }

  return {
    /** The finished thumbnail, if there is one; also marks it as recently shown. */
    peek(path: string): Thumbnail | undefined {
      const thumbnail = ready.get(path); if (thumbnail) { ready.delete(path); ready.set(path, thumbnail); }
      return thumbnail;
    },
    /** Best known width / height: the picture's, else the disk cache's, else nothing. */
    ratio(path: string): number | undefined { return ready.get(path)?.ratio ?? hints.get(path); },
    failed(path: string): boolean { return failed.has(path); },
    /**
     * Makes (or fetches) a thumbnail. `wants` says whether anyone still needs it when its turn comes, so
     * tiles that scrolled away or were re-rendered cost nothing. Resolves undefined when it was skipped or failed.
     */
    request(path: string, format: string, wants: () => boolean): Promise<Thumbnail | undefined> {
      const hit = ready.get(path); if (hit) return Promise.resolve(hit);
      if (failed.has(path)) return Promise.resolve(undefined);
      const running = jobs.get(path);
      if (running) { queue.find(job => job.path === path)?.wants.push(wants); return running; }
      const promise = new Promise<Thumbnail | undefined>(settle => queue.push({ path, format, wants: [wants], settle }));
      jobs.set(path, promise); pump();
      return promise;
    },
    /** Asks the disk cache for the proportions of `paths` not yet known. Resolves to how many it learned. */
    async primeRatios(paths: string[]): Promise<number> {
      const wanted = paths.filter(path => !ready.has(path) && !asked.has(path));
      for (const path of wanted) asked.add(path);
      if (!wanted.length) return 0;
      let learned = 0;
      try { for (const [path, [width, height]] of Object.entries(await libraryThumbnailRatios(wanted))) if (width > 0 && height > 0) { hints.set(path, width / height); learned++; } }
      catch { for (const path of wanted) asked.delete(path); }
      return learned;
    },
    /** Forgets thumbnails of entries that left the library. */
    reconcile(paths: Set<string>) {
      for (const [path, thumbnail] of ready) if (!paths.has(path)) { URL.revokeObjectURL(thumbnail.url); ready.delete(path); }
      for (const path of hints.keys()) if (!paths.has(path)) hints.delete(path);
      for (const known of [asked, failed]) for (const path of known) if (!paths.has(path)) known.delete(path);
    },
    /** Lets thumbnails that failed (an unmounted volume, say) try again. */
    retryFailed() { failed.clear(); },
    /** Drops everything known about one entry whose original was replaced. */
    forget(path: string) {
      const old = ready.get(path); if (old) URL.revokeObjectURL(old.url);
      ready.delete(path); hints.delete(path); asked.delete(path); failed.delete(path);
    },
    /** Caps memory: drops the least recently shown pictures that no tile is showing. */
    trim(showing: Set<string>) {
      if (ready.size <= keepReady) return;
      for (const [path, thumbnail] of ready) {
        if (ready.size <= keepReady) break;
        if (!showing.has(path)) { URL.revokeObjectURL(thumbnail.url); ready.delete(path); }
      }
    },
    dispose() {
      queue = [];
      for (const thumbnail of ready.values()) URL.revokeObjectURL(thumbnail.url);
      ready.clear(); hints.clear(); asked.clear(); failed.clear();
    },
  };
}
