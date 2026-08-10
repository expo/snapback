import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { parseCapabilityIndex } from './guide-lib.mjs';

export const DEMO_CATALOG_PATH = 'demos/catalog.v1.json';
const DEMO_README_PATH = 'demos/README.md';
const MATURITIES = new Set(['reference', 'integration', 'proof-witness', 'benchmark']);
const TARGETS = new Set(['local', 'cloudflare', 'web-client']);
const BOUNDARY_STATUSES = new Set(['current-demo-scope', 'current-platform', 'frozen']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function push(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

export function discoverDemoManifests(root) {
  const manifests = new Map();
  const demosDir = join(root, 'demos');
  for (const directory of readdirSync(demosDir).sort()) {
    const path = join(demosDir, directory, 'demo.snapback.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof manifest.id !== 'string') throw new Error(`${relative(root, path)}: missing string id`);
    if (manifests.has(manifest.id)) throw new Error(`duplicate demo id '${manifest.id}'`);
    manifests.set(manifest.id, {
      directory: `demos/${directory}`,
      path: relative(root, path),
      manifest,
    });
  }
  return manifests;
}

function readHumanCatalogIds(root, errors) {
  const path = join(root, DEMO_README_PATH);
  if (!existsSync(path)) {
    push(errors, DEMO_README_PATH, 'missing human-readable catalog');
    return new Set();
  }
  const ids = new Set();
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    const match = /^\| `([^`]+)` \|.*\| (yes|no) \|$/.exec(line);
    if (!match) continue;
    if (ids.has(match[1])) push(errors, DEMO_README_PATH, `duplicate row '${match[1]}' at line ${index + 1}`);
    ids.add(match[1]);
    if (match[2] !== 'yes') push(errors, DEMO_README_PATH, `'${match[1]}' is catalogued without a README`);
  }
  return ids;
}

function validateBoundary(record, manifest, capabilities, errors) {
  const gaps = manifest.capabilityGaps ?? [];
  const boundary = manifest.capabilityGapsBoundary;
  if (gaps.length === 0) {
    if (boundary !== undefined) push(errors, record.path, 'capabilityGapsBoundary is present without capabilityGaps');
    return;
  }
  if (!boundary || typeof boundary !== 'object') {
    push(errors, record.path, 'capabilityGaps requires a dated capabilityGapsBoundary');
    return;
  }
  if (!BOUNDARY_STATUSES.has(boundary.status)) {
    push(errors, record.path, `capabilityGapsBoundary.status must be ${[...BOUNDARY_STATUSES].join('|')}`);
  }
  if (!DATE.test(boundary.asOf ?? '')) push(errors, record.path, 'capabilityGapsBoundary.asOf must be YYYY-MM-DD');
  if (boundary.authority !== 'guide/capabilities.md') {
    push(errors, record.path, "capabilityGapsBoundary.authority must be 'guide/capabilities.md'");
  }
  if (typeof boundary.reason !== 'string' || boundary.reason.trim().length < 12) {
    push(errors, record.path, 'capabilityGapsBoundary.reason must explain the scope/status boundary');
  }
  if (boundary.status !== 'current-platform') return;
  for (const id of gaps) {
    const capability = capabilities.get(id);
    if (!capability) {
      push(errors, record.path, `current-platform capability gap '${id}' is absent from guide/capabilities.md`);
    } else if (!capability.page.startsWith('GAP')) {
      push(errors, record.path, `current-platform capability gap '${id}' contradicts non-GAP capability row`);
    }
  }
}

function validateEntry(root, entry, record, errors) {
  const path = `${DEMO_CATALOG_PATH}#${entry?.id ?? '?'}`;
  if (entry.directory !== record.directory) push(errors, path, `directory must be '${record.directory}'`);
  if (entry.teaches !== record.manifest.description) push(errors, path, 'teaches must exactly project manifest.description');
  for (const field of ['clients', 'targets', 'evidence']) {
    if (!Array.isArray(entry[field]) || entry[field].length === 0 || entry[field].some((value) => typeof value !== 'string' || value.length === 0)) {
      push(errors, path, `${field} must be a non-empty string array`);
    }
  }
  for (const target of entry.targets ?? []) {
    if (!TARGETS.has(target)) push(errors, path, `unknown target '${target}'`);
  }
  if (!MATURITIES.has(entry.maturity)) push(errors, path, `maturity must be ${[...MATURITIES].join('|')}`);
  for (const field of ['run', 'proof', 'expectedEvidence']) {
    if (typeof entry[field] !== 'string' || entry[field].trim().length < 4) push(errors, path, `${field} must be a concrete non-empty string`);
  }
  if (!Array.isArray(record.manifest.notClaiming) || record.manifest.notClaiming.length === 0) {
    push(errors, record.path, 'notClaiming must be a non-empty honest-boundary list');
  }
  for (const evidence of entry.evidence ?? []) {
    if (!existsSync(join(root, evidence))) push(errors, path, `evidence path does not exist: ${evidence}`);
  }
  const readme = join(record.directory, 'README.md');
  if (entry.documentation?.path !== readme) push(errors, path, `documentation.path must be '${readme}'`);
  const status = entry.documentation?.status;
  if (status === 'waived') {
    if (!DATE.test(entry.documentation.asOf ?? '')) push(errors, path, 'waived documentation requires asOf YYYY-MM-DD');
    if (typeof entry.documentation.reason !== 'string' || entry.documentation.reason.trim().length < 12) {
      push(errors, path, 'waived documentation requires a substantive reason');
    }
  } else if (status === 'contract') {
    const readmePath = join(root, readme);
    if (existsSync(readmePath)) {
      const body = readFileSync(readmePath, 'utf8');
      for (const field of ['run', 'proof']) {
        if (!body.includes(entry[field])) push(errors, path, `README contract does not contain ${field} command: ${entry[field]}`);
      }
      if (!/(?:not claim|not claiming|does not claim|outside|boundary|limitation|capability gap)/iu.test(body)) {
        push(errors, path, 'README contract lacks an explicit nonclaim/boundary statement');
      }
    } else push(errors, record.path, `missing ${record.directory}/README.md`);
  } else {
    push(errors, path, 'documentation.status must be contract|waived');
  }
}

export function auditDemoCatalog({ root, catalog = null, capabilities = null } = {}) {
  const errors = [];
  const manifests = discoverDemoManifests(root);
  const parsedCatalog = catalog ?? JSON.parse(readFileSync(join(root, DEMO_CATALOG_PATH), 'utf8'));
  if (parsedCatalog.schemaVersion !== 'snapback.demo-catalog.v1') {
    push(errors, DEMO_CATALOG_PATH, "schemaVersion must be 'snapback.demo-catalog.v1'");
  }
  if (!Array.isArray(parsedCatalog.entries)) push(errors, DEMO_CATALOG_PATH, 'entries must be an array');
  const entries = new Map();
  for (const entry of parsedCatalog.entries ?? []) {
    if (typeof entry?.id !== 'string') {
      push(errors, DEMO_CATALOG_PATH, 'every entry needs a string id');
      continue;
    }
    if (entries.has(entry.id)) push(errors, DEMO_CATALOG_PATH, `duplicate entry '${entry.id}'`);
    entries.set(entry.id, entry);
  }

  const humanIds = readHumanCatalogIds(root, errors);
  const capabilityMap = capabilities ?? parseCapabilityIndex(root, errors).capabilities;
  for (const [id, record] of manifests) {
    const entry = entries.get(id);
    if (!entry) push(errors, DEMO_CATALOG_PATH, `metadata-declared demo '${id}' is undocumented`);
    else validateEntry(root, entry, record, errors);
    if (!humanIds.has(id)) push(errors, DEMO_README_PATH, `metadata-declared demo '${id}' is absent from the table`);
    validateBoundary(record, record.manifest, capabilityMap, errors);
  }
  for (const id of entries.keys()) {
    if (!manifests.has(id)) push(errors, DEMO_CATALOG_PATH, `entry '${id}' has no metadata-declared demo`);
  }
  for (const id of humanIds) {
    if (!manifests.has(id)) push(errors, DEMO_README_PATH, `table row '${id}' has no metadata-declared demo`);
  }

  return { errors, demoCount: manifests.size, catalogCount: entries.size };
}
