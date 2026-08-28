#!/usr/bin/env node
// Generates guide/guide-manifest.generated.json — the single interface every
// guide projection (MCP, admin console, CLI) consumes instead of re-parsing
// the tree. Never hand-edit the output.
// @ref LLP 0061#4-distribution-and-discovery — the guide manifest.
import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLAT_PATH,
  MANIFEST_PATH,
  buildFlatGuide,
  buildManifest,
  buildSectionFlatGuides,
  checkCapabilityIndex,
  checkPublishedClosure,
  checkSnippets,
  loadCorpus,
  listFlatSectionPaths,
  parseCapabilityIndex,
  repoRoot,
  rootJsInstallPrecondition,
} from './guide-lib.mjs';

const root = repoRoot();
const rootJsPrecondition = rootJsInstallPrecondition(root);
if (rootJsPrecondition) {
  console.error(`[guide-manifest] environment precondition: ${rootJsPrecondition}`);
  process.exit(1);
}
// @ref LLP 0193#program — diagnostics and their typed code vocabulary are one
// generated Guide resource, checked before the manifest binds their bytes.
execFileSync(process.execPath, [join(root, 'scripts/generate-diagnostics-registry.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
// @ref LLP 0194#design — registry and Markdown projection regenerate as one Guide pipeline.
execFileSync(process.execPath, [join(root, 'scripts/generate-symbol-registry.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
const { errors, pageInfo, pageBodies } = loadCorpus(root);
const snippetRecords = checkSnippets(root, pageBodies, errors);
const index = parseCapabilityIndex(root, errors);
const surfaces = checkCapabilityIndex(root, index, pageInfo, errors);
checkPublishedClosure(root, pageInfo, pageBodies, errors);
if (errors.length > 0) {
  for (const line of errors) console.error(`[guide-manifest] error: ${line}`);
  console.error('[guide-manifest] refusing to write a manifest over a failing corpus');
  process.exit(1);
}
const manifest = buildManifest(root, pageInfo, snippetRecords, index, surfaces);
const flat = buildFlatGuide(root, manifest, pageInfo);
const sectionFlats = buildSectionFlatGuides(root, manifest, pageInfo);
const expectedSectionPaths = new Set([...sectionFlats.values()].map(({ path }) => path));
for (const path of listFlatSectionPaths(root)) {
  if (!expectedSectionPaths.has(path)) unlinkSync(join(root, path));
}
writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(root, FLAT_PATH), flat);
for (const { path, content } of sectionFlats.values()) writeFileSync(join(root, path), content);
console.log(`[guide-manifest] wrote ${MANIFEST_PATH} (${Object.keys(manifest.pages).length} pages)`);
console.log(`[guide-manifest] wrote ${FLAT_PATH} (${Buffer.byteLength(flat)} bytes)`);
for (const [section, { path, content }] of sectionFlats) {
  console.log(`[guide-manifest] wrote ${path} (${section}; ${Buffer.byteLength(content)} bytes)`);
}
