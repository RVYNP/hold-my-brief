// The Node APIs the tests use (reading a stylesheet, listing e2e specs); the project ships no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readdirSync(path: URL): string[];
}
