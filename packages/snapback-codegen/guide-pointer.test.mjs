import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '..', '..');
const manifestPath = join(repoRoot, 'guide', 'guide-manifest.generated.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'runtime-artifacts') {
        files.push(...sourceFiles(path));
      }
    } else if (entry.isFile() && extname(entry.name) === '.mjs') {
      files.push(path);
    }
  }
  return files;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}

function propertyValue(object, name) {
  const property = object.properties.find((candidate) => (
    candidate.type === 'Property'
    && candidate.computed === false
    && ((candidate.key.type === 'Identifier' && candidate.key.name === name)
      || (candidate.key.type === 'Literal' && candidate.key.value === name))
  ));
  return property?.value;
}

function literalString(object, name, sourcePath) {
  const value = propertyValue(object, name);
  assert.equal(
    value?.type,
    'Literal',
    `${sourcePath}: guidePointer.${name} must be a manifest-checkable string literal`,
  );
  assert.equal(
    typeof value.value,
    'string',
    `${sourcePath}: guidePointer.${name} must be a string literal`,
  );
  return value.value;
}

function markdownHeadingAnchors(markdown) {
  return new Set(markdown.split(/\r?\n/u).flatMap((line) => {
    const heading = /^(?:#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) return [];
    const anchor = heading[1]
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/<[^>]+>/gu, '')
      .replace(/[`*_~]/gu, '')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .trim()
      .replace(/\s+/gu, '-');
    return anchor ? [anchor] : [];
  }));
}

const pointers = [];
for (const root of [
  join(repoRoot, 'packages', 'snapback-codegen'),
  join(repoRoot, 'packages', 'snapback-contract'),
]) {
  for (const sourcePath of sourceFiles(root)) {
    const source = readFileSync(sourcePath, 'utf8');
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
    walk(ast, (node) => {
      if (node.type !== 'ObjectExpression') return;
      const kind = propertyValue(node, 'kind');
      if (kind?.type !== 'Literal' || kind.value !== 'guidePointer') return;
      pointers.push({
        sourcePath,
        line: node.loc.start.line,
        pageId: literalString(node, 'pageId', sourcePath),
        path: literalString(node, 'path', sourcePath),
        anchor: literalString(node, 'anchor', sourcePath),
        reason: literalString(node, 'reason', sourcePath),
      });
    });
  }
}

assert(pointers.length > 0, 'expected at least one codegen remediation guidePointer');
for (const pointer of pointers) {
  const locus = `${pointer.sourcePath}:${pointer.line}`;
  const page = manifest.pages[pointer.pageId];
  assert(page, `${locus}: guidePointer page id ${pointer.pageId} is absent from ${manifestPath}`);
  assert.equal(
    pointer.path,
    page.path,
    `${locus}: guidePointer path must match manifest page ${pointer.pageId}`,
  );
  assert.equal(pointer.reason.includes('\n'), false, `${locus}: guidePointer reason must be one line`);
  assert(pointer.reason.trim().length > 0, `${locus}: guidePointer reason must not be empty`);
  const headings = markdownHeadingAnchors(readFileSync(join(repoRoot, page.path), 'utf8'));
  assert(
    headings.has(pointer.anchor),
    `${locus}: guidePointer anchor #${pointer.anchor} is absent from ${page.path}`,
  );
}

assert.deepEqual(
  pointers.map(({ pageId }) => pageId).sort(),
  [
    'auth.protecting-data',
    'auth.sessions-and-principals',
    'backend.mutations',
    'backend.queries',
    'backend.relational-queries',
  ],
  'guidePointer coverage includes both policy diagnostics and the proved plain-join advisory',
);
