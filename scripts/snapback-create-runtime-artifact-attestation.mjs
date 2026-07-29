#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createLinuxRuntimeArtifactAttestation,
  readLinuxRuntimeBuildIdentity,
} from '../packages/snapback-runtime-linux-x64/artifact-attestation.mjs';

function fail(message) {
  console.error(`snapback-create-runtime-artifact-attestation: ${message}`);
  process.exit(1);
}

const options = {};
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index += 2) {
  const argument = argumentsList[index];
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
  const key = {
    '--binary': 'binary',
    '--hermes': 'hermes',
    '--identity': 'identity',
    '--source-revision': 'sourceRevision',
    '--out': 'out',
  }[argument];
  if (!key || Object.hasOwn(options, key)) fail(`unknown or duplicate option ${argument}`);
  options[key] = key === 'sourceRevision' ? value : resolve(value);
}
for (const key of ['binary', 'hermes', 'identity', 'sourceRevision', 'out']) {
  if (!options[key]) fail(`missing required option ${key}`);
}

let buildIdentity;
try {
  buildIdentity = readLinuxRuntimeBuildIdentity(
    options.identity,
    options.sourceRevision,
  );
} catch (error) {
  fail(`build identity could not be read: ${error.message}`);
}
let attestation;
try {
  attestation = createLinuxRuntimeArtifactAttestation({
    binaryPath: options.binary,
    hermesPath: options.hermes,
    buildIdentity,
    sourceRevision: options.sourceRevision,
  });
} catch (error) {
  fail(error.message);
}
writeFileSync(options.out, `${JSON.stringify(attestation, null, 2)}\n`, {
  mode: 0o600,
  flag: 'wx',
});
console.log(`wrote ${options.out}`);
