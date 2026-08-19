#!/usr/bin/env node
// @ref LLP 0040#whole-codebase-review-hardening-2026-07-12-eng-24341eng-24369--eng-24387eng-24388 —
// persistent state identity follows the bytes and compatibility inputs that
// actually build the deployed Workers.
// Generate the identities persisted beside Cloudflare Durable Object state.
// esbuild's metafile discovers the exact transitive JS/JSON inputs compiled
// into gateway and handler Workers; normalized Wrangler configs add aliases,
// bindings, and compatibility settings. The generated identity files are
// intentionally excluded from their own input graph (the sole fixed-point
// exception).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const scriptPath = fileURLToPath(import.meta.url);
const cloudflareRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(cloudflareRoot, '..');

const apps = {
  notes: {
    bundle: 'cloudflare/app/notes.app.js',
    output: 'cloudflare/generated/deployment-identity.notes.json',
    schemaInputs: ['cloudflare/app/notes.app.js'],
    deployConfigs: ['cloudflare/wrangler.jsonc', 'cloudflare/wrangler.handler.jsonc'],
  },
  'all-aboard': {
    bundle: 'cloudflare/app/all-aboard.app.js',
    output: 'cloudflare/generated/deployment-identity.all-aboard.json',
    schemaInputs: [
      'cloudflare/app/all-aboard.app.js',
      'demos/all-aboard/snapback/generated/schema.manifest.json',
    ],
    deployConfigs: [
      'cloudflare/wrangler.all-aboard.jsonc',
      'cloudflare/wrangler.all-aboard.handler.jsonc',
      'cloudflare/wrangler.all-aboard.action-handler.jsonc',
    ],
  },
};

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function relativeInput(input) {
  return path.relative(repoRoot, path.resolve(repoRoot, input)).split(path.sep).join('/');
}

async function discoverBundleInputs(app) {
  const result = await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: ['cloudflare/src/gateway.js', 'cloudflare/src/handler-worker.js'],
    bundle: true,
    format: 'esm',
    write: false,
    outdir: 'out',
    metafile: true,
    loader: { '.json': 'json' },
    platform: 'neutral',
    target: 'esnext',
    alias: { 'snapback-app': path.join(repoRoot, app.bundle) },
  });
  return uniqueSorted(
    Object.keys(result.metafile.inputs)
      .map(relativeInput)
      .filter((input) => !/^cloudflare\/generated\/deployment-identity\..+\.json$/.test(input))
  );
}

function readBytes(relative, overrides) {
  if (overrides.has(relative)) return Buffer.from(overrides.get(relative));
  return fs.readFileSync(path.join(repoRoot, relative));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function normalizedConfigBytes(relative, overrides) {
  const raw = readBytes(relative, overrides).toString('utf8').replace(/^\s*\/\/.*$/gm, '');
  return Buffer.from(`${JSON.stringify(canonicalJson(JSON.parse(raw)))}\n`);
}

function digest(label, entries) {
  const hash = crypto.createHash('sha256');
  hash.update(`snapback-cloudflare-deployment-identity-v2\0${label}\0`);
  for (const [identity, bytes] of entries.slice().sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(identity);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function computeDeploymentIdentities({ overrides = new Map() } = {}) {
  const identities = {};
  for (const [name, app] of Object.entries(apps)) {
    const bundleInputs = await discoverBundleInputs(app);
    const schemaEntries = uniqueSorted(app.schemaInputs).map((input) => [input, readBytes(input, overrides)]);
    const bundleEntries = bundleInputs.map((input) => [input, readBytes(input, overrides)]);
    const configEntries = uniqueSorted([...app.deployConfigs, 'packages/snapback-harness/compat.json']).map((input) => [
      `normalized:${input}`,
      normalizedConfigBytes(input, overrides),
    ]);
    identities[name] = {
      format: 2,
      app: name,
      schemaHash: digest(`${name}:schema`, schemaEntries),
      bundleHash: digest(`${name}:bundle`, bundleEntries),
      inputsHash: digest(`${name}:inputs`, [...bundleEntries, ...configEntries]),
      inputs: uniqueSorted([...bundleInputs, ...configEntries.map(([input]) => input)]),
    };
  }
  return identities;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const identities = await computeDeploymentIdentities();
  let drift = false;
  for (const [name, identity] of Object.entries(identities)) {
    const app = apps[name];
    const outputPath = path.join(repoRoot, app.output);
    const next = `${JSON.stringify(identity, null, 2)}\n`;
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
    if (current === next) continue;
    if (checkOnly) {
      console.error(`STALE: ${app.output}; run node cloudflare/scripts/generate-deployment-identity.mjs and commit`);
      drift = true;
    } else {
      fs.writeFileSync(outputPath, next);
      console.log(`generated ${app.output}`);
    }
  }
  if (drift) process.exit(1);
  if (checkOnly) console.log('deployment identities match bundled sources and normalized deploy configs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
