import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '@expo/snapback-codegen';

// @ref LLP 0253#acceptance-for-this-spec — the React type proof consumes
// freshly generated dual-profile references and cannot depend on another
// package suite having populated ignored outputs first.
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const backends = [
  'tests/fixtures/familiar-todo',
  'tests/fixtures/familiar-todo-explicit',
  'demos/todo/snapback',
];

// These review records are committed fixture inputs. Codegen intentionally
// republishes them with the current graph, but a typecheck prerequisite must
// not dirty the checkout merely to materialize the ignored declarations.
const committedReviewRecords = [
  'tests/fixtures/familiar-todo/generated/artifacts.json',
  'tests/fixtures/familiar-todo/generated/normalized-definition.v1.json',
  'tests/fixtures/familiar-todo-explicit/generated/artifacts.json',
  'tests/fixtures/familiar-todo-explicit/generated/normalized-definition.v1.json',
  'demos/todo/snapback/generated/artifacts.json',
  'demos/todo/snapback/generated/functions.manifest.json',
  'demos/todo/snapback/generated/schema.manifest.json',
];
const preservedReviewRecords = await Promise.all(committedReviewRecords.map(async (path) => ({
  path: resolve(repoRoot, path),
  bytes: await readFile(resolve(repoRoot, path)),
})));

try {
  for (const backend of backends) {
    const result = await generate(resolve(repoRoot, backend));
    if (result.ok !== true) {
      throw new Error(`${backend} codegen failed: ${JSON.stringify(result.diagnostics)}`);
    }
  }
} finally {
  await Promise.all(preservedReviewRecords.map(({ path, bytes }) => writeFile(path, bytes)));
}

console.log('prepare-type-fixtures.mjs: familiar dual-profile and todo declarations generated');
