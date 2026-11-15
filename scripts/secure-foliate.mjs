import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Windows WebView2 does not need Foliate's WebKit allow-scripts workaround.
// Patch before bundling: changing a frame after navigation is too late.
for (const filename of ['paginator.js', 'fixed-layout.js']) {
  const path = resolve('node_modules/foliate-js', filename);
  const original = await readFile(path, 'utf8');
  const hardened = original.replaceAll("'allow-same-origin allow-scripts'", "'allow-same-origin'");
  if (!hardened.includes("setAttribute('sandbox', 'allow-same-origin')") || hardened.includes('allow-same-origin allow-scripts'))
    throw new Error(`Foliate sandbox patch needs review: ${filename}`);
  await writeFile(path, hardened);
}
// Foliate's setStyles repaints the background a frame later without checking that the section view still exists:
// a link followed or a book closed in that frame throws "reading 'docBackground'" on null. Its media-query listener already guards this.
{
  const path = resolve('node_modules/foliate-js', 'paginator.js');
  const original = await readFile(path, 'utf8');
  const unguarded = `requestAnimationFrame(() => {
            this.#replaceBackground(this.#view.docBackground, this.columnCount)
        })`;
  const guarded = `requestAnimationFrame(() => {
            if (this.#view) this.#replaceBackground(this.#view.docBackground, this.columnCount)
        })`;
  const patched = original.includes(guarded) ? original : original.replace(unguarded, guarded);
  if (!patched.includes(guarded) || patched.includes(unguarded)) throw new Error('Foliate setStyles patch needs review: paginator.js');
  await writeFile(path, patched);
}
// Foliate lays the section on show out again whenever flow, margin, gap or size change (Paginator.render), and its content observer and font
// callbacks resize it (View.expand). Both take the frame's documentElement unchecked, so a call that lands while that frame has no root (between
// two navigations, or as it is torn down) throws "Cannot destructure property 'style' of 'el' as it is null" from setStylesImportant, and the scroll
// that follows would read the same missing root. A frame without a root has nothing to lay out, and its load handler lays it out when it has one.
{
  const path = resolve('node_modules/foliate-js', 'paginator.js');
  const original = await readFile(path, 'utf8');
  const edits = [
    ['    render() {\n        if (!this.#view) return\n', '    render() {\n        if (!this.#view?.document?.documentElement) return\n'],
    ['    expand() {\n        const { documentElement } = this.document\n', '    expand() {\n        const documentElement = this.document?.documentElement\n        if (!documentElement) return\n'],
  ];
  let patched = original;
  for (const [unguarded, guarded] of edits) {
    if (!patched.includes(guarded)) patched = patched.replace(unguarded, guarded);
    if (!patched.includes(guarded) || patched.includes(unguarded)) throw new Error(`Foliate rootless-frame patch needs review: ${unguarded.trim()}`);
  }
  await writeFile(path, patched);
}
await mkdir('public/pdfjs', { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(resolve('node_modules/pdfjs-dist', directory), resolve('public/pdfjs', directory), { recursive: true });
}
console.log('EPUB frames prohibit scripts, a closed section view is not repainted, a frame without a root is not laid out; PDF auxiliary assets copied for offline use.');
