#!/usr/bin/env node
// Generate the identities persisted beside Cloudflare Durable Object state.
// These hashes cover the checked-in bytes that actually build each deployed
// app and the shared runtime/harness inputs. A source edit therefore cannot
// keep serving old state merely because somebody forgot to bump a label.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const cloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cloudflareRoot, '..');
const checkOnly = process.argv.includes('--check');

const sharedBundleInputs = [
  'cloudflare/src/coordinator.js',
  'cloudflare/src/cron-utils.js',
  'cloudflare/src/gateway.js',
  'cloudflare/src/handler-worker.js',
  'cloudflare/src/host-ops.js',
  'cloudflare/src/platform-errors.js',
  'packages/snapback-harness/allowlist.json',
  'packages/snapback-harness/compat.json',
  'packages/snapback-harness/ctx-bootstrap.js',
  'packages/snapback-harness/envelope.mjs',
  'packages/snapback-harness/workerd/handler-server.mjs',
  'packages/snapback-harness/workerd/rejection-ledger.mjs',
  'packages/snapback-harness/workerd/strip.mjs',
];

const apps = {
  notes: {
    output: 'cloudflare/generated/deployment-identity.notes.json',
    schemaInputs: ['cloudflare/app/notes.app.js'],
    appInputs: [
      'cloudflare/app/notes.app.js',
      'cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json',
    ],
  },
  'all-aboard': {
    output: 'cloudflare/generated/deployment-identity.all-aboard.json',
    schemaInputs: [
      'cloudflare/app/all-aboard.app.js',
      'demos/all-aboard/snapback/generated/schema.manifest.json',
    ],
    appInputs: [
      'cloudflare/app/all-aboard.app.js',
      'cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json',
      'demos/all-aboard/snapback/generated/functions.manifest.json',
      'demos/all-aboard/snapback/generated/schema.manifest.json',
      'demos/all-aboard/snapback/seed.json',
    ],
  },
};

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function digest(label, files) {
  const hash = crypto.createHash('sha256');
  hash.update(`snapback-cloudflare-deployment-identity-v1\0${label}\0`);
  for (const relative of uniqueSorted(files)) {
    const bytes = fs.readFileSync(path.join(repoRoot, relative));
    hash.update(relative);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

let drift = false;
for (const [name, app] of Object.entries(apps)) {
  const bundleInputs = uniqueSorted([...app.appInputs, ...sharedBundleInputs]);
  const allInputs = uniqueSorted([...app.schemaInputs, ...bundleInputs]);
  const identity = {
    format: 1,
    app: name,
    schemaHash: digest(`${name}:schema`, app.schemaInputs),
    bundleHash: digest(`${name}:bundle`, bundleInputs),
    inputsHash: digest(`${name}:inputs`, allInputs),
    inputs: allInputs,
  };
  const outputPath = path.join(repoRoot, app.output);
  const next = `${JSON.stringify(identity, null, 2)}\n`;
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (current === next) continue;
  if (checkOnly) {
    console.error(`STALE: ${app.output}; run node cloudflare/scripts/generate-deployment-identity.mjs`);
    drift = true;
  } else {
    fs.writeFileSync(outputPath, next);
    console.log(`generated ${app.output}`);
  }
}

if (drift) process.exit(1);
if (checkOnly) console.log('deployment identities match their source inputs');
