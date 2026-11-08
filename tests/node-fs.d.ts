// The one Node API the tests use (reading a stylesheet); the project ships no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
