import { posix } from "node:path";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — the checked graph must retain authored bytes; library custody and host lookup share TypeScript's lexical path identity.
export function sourcePath(name: string): string {
  return posix.normalize(name.replace(/\\/g, "/"));
}

export function sourceFiles(
  entries: Iterable<readonly [string, string]>,
  canonical: (name: string) => string,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, text] of entries) {
    const path = canonical(name);
    if (files.has(path) && files.get(path) !== text) {
      throw new Error(`conflicting authored sources resolve to ${path}: ${name}`);
    }
    files.set(path, text);
  }
  return files;
}
