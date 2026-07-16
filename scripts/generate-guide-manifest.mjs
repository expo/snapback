#!/usr/bin/env node
// Generates guide/guide-manifest.generated.json — the single interface every
// guide projection (MCP, admin console, CLI) consumes instead of re-parsing
// the tree. Never hand-edit the output.
// @ref LLP 0061#4-distribution-and-discovery — the guide manifest.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLAT_PATH,
  MANIFEST_PATH,
  buildFlatGuide,
  buildManifest,
  checkCapabilityIndex,
  checkSnippets,
  loadCorpus,
  parseCapabilityIndex,
  repoRoot,
} from './guide-lib.mjs';

const root = repoRoot();
const { errors, pageInfo, pageBodies } = loadCorpus(root);
const snippetRecords = checkSnippets(root, pageBodies, errors);
const index = parseCapabilityIndex(root, errors);
const surfaces = checkCapabilityIndex(root, index, pageInfo, errors);
if (errors.length > 0) {
  for (const line of errors) console.error(`[guide-manifest] error: ${line}`);
  console.error('[guide-manifest] refusing to write a manifest over a failing corpus');
  process.exit(1);
}
const manifest = buildManifest(root, pageInfo, snippetRecords, index, surfaces);
const flat = buildFlatGuide(root, manifest, pageInfo);
writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(root, FLAT_PATH), flat);
console.log(`[guide-manifest] wrote ${MANIFEST_PATH} (${Object.keys(manifest.pages).length} pages)`);
console.log(`[guide-manifest] wrote ${FLAT_PATH} (${Buffer.byteLength(flat)} bytes)`);
