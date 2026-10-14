// @ref LLP 3000.007#20.1 — published discovery text must describe the product.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ownership = /\b(?:DX\d*|HAND\d*|NARR\d*|PROOF\d*|QDIAG\d*|PAGE\d*|EX\d+)\s+owns\b|\bin (?:its|the) workstream\b/gi;
export function docLeaks(text) {
  return Array.from(text.matchAll(ownership), match => ({
    line: text.slice(0, match.index).split('\n').length, text: match[0],
  }));
}
export function lintPackagedDocs(root) {
  const files = [];
  function walk(dir, nested) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && nested) walk(path, true);
      else if (entry.isFile() && /\.(?:md|rs)$/.test(entry.name)) files.push(path);
    }
  }
  walk(join(root, 'packages/snapback4'), false);
  walk(join(root, 'crates/snapback4-lang/src/guide'), true);
  files.push(join(root, 'crates/snapback4-lang/src/guide.rs'));
  const leaks = files.flatMap(path => docLeaks(readFileSync(path, 'utf8')).map(hit => `${path}:${hit.line}: ${hit.text}`));
  if (leaks.length) throw new Error(`packaged docs contain workstream ownership text:\n${leaks.join('\n')}`);
}
