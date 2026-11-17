/**
 * Syntax colour for the Markdown reader's code blocks: highlight.js's core with sixteen languages, no auto-detection, and no stylesheet of
 * its own (the text adapter colours the `hljs-` classes from the theme's `--code-*` tokens). Only `adapters/text` imports this, so a PDF or an
 * EPUB never loads it. The returned markup is the source's text character for character, escaped, with token `span`s around parts of it.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { MAX_LINES } from './epub-code';

/** A block longer than this many bytes is left plain, as one of more than MAX_LINES lines is. */
const MAX_BYTES = 200 * 1024;

const languages = { bash, shell, javascript, typescript, json, python, css, xml, markdown, yaml, sql, rust, go, swift, diff, plaintext };
for (const [name, definition] of Object.entries(languages)) hljs.registerLanguage(name, definition);
// Registered last so they win over any alias a definition brings of its own (`shell` names `console` too).
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['html'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

function tooLong(code: string): boolean {
  if (code.length > MAX_BYTES) return true;
  // A UTF-8 character is at most three bytes per UTF-16 unit: only a block that could reach the cap is measured.
  if (code.length * 3 > MAX_BYTES && new TextEncoder().encode(code).length > MAX_BYTES) return true;
  // A fence's text ends with a line break, which does not start another line.
  let lines = code.endsWith('\n') ? 0 : 1;
  for (let at = code.indexOf('\n'); at >= 0; at = code.indexOf('\n', at + 1)) if (++lines > MAX_LINES) return true;
  return false;
}

/** The escaped markup of `code` with token spans, or null when the language is unknown or missing, or the block is over the caps: the caller then escapes it plain. */
export function highlightCode(code: string, language: string): string | null {
  if (!language || !hljs.getLanguage(language) || tooLong(code)) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
