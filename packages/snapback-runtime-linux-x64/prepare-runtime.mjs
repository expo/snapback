#!/usr/bin/env node

// @ref LLP 0041#runtime-distribution — assemble one relocatable Linux native
// package from a bootstrapped release binary and its Hermes shared library;
// never compile Hermes during npm installation.

import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const explicitBinary = process.env.SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY;
const explicitHermes = process.env.SNAPBACK_RUNTIME_LINUX_X64_HERMES_LIBRARY;
const sourceBinary = resolve(
  explicitBinary ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
const sourceHermes = resolve(
  explicitHermes ?? join(repositoryRoot, 'vendor', 'ibex', 'linux', 'lib', 'libhermesvm.so'),
);

function fail(code, message) {
  console.error(`${code}: ${message}`);
  process.exit(1);
}

function elfMachine(path) {
  const descriptor = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length
        || header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
      return null;
    }
    const littleEndian = header[5] === 1;
    return littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18);
  } finally {
    closeSync(descriptor);
  }
}

// Native preparation is the default on Linux. A release job may assemble the
// package on another host only when it supplies both explicit CI artifacts;
// their ELF headers remain the authority, not the packaging host.
if ((process.platform !== 'linux' || process.arch !== 'x64')
    && !(explicitBinary && explicitHermes)) {
  fail(
    'SNAPBACK_IBEX_HOST_UNSUPPORTED',
    `runtime-linux-x64 requires a linux-x64 host or explicit Linux artifacts (observed ${process.platform}-${process.arch})`,
  );
}
if (!existsSync(sourceBinary)) {
  fail(
    'SNAPBACK_RUNTIME_BINARY_MISSING',
    `Linux release binary is missing at ${sourceBinary}; build snapback --release on linux-x64`,
  );
}
if (!existsSync(sourceHermes)) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Linux Hermes shared library is missing at ${sourceHermes}; run scripts/bootstrap-ibex-runtime on linux-x64`,
  );
}
// EM_X86_64 is 62. Reject a wrong-architecture artifact before it can be
// published under an npm cpu selector that promises x64.
if (elfMachine(sourceBinary) !== 62 || elfMachine(sourceHermes) !== 62) {
  fail(
    'SNAPBACK_RUNTIME_ARTIFACT_PLATFORM_MISMATCH',
    'runtime-linux-x64 inputs must both be x86-64 ELF artifacts',
  );
}

const sourceTestStaging = process.argv.includes('--source-test-staging');
const identityResult = spawnSync(sourceBinary, ['build-identity'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    LD_LIBRARY_PATH: [
      dirname(sourceHermes),
      process.env.LD_LIBRARY_PATH,
    ].filter(Boolean).join(':'),
  },
  timeout: 15_000,
});
if (identityResult.status !== 0) {
  fail(
    'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    `could not inspect the runtime build distribution: ${identityResult.stderr.trim()}`,
  );
}
try {
  const identity = JSON.parse(identityResult.stdout);
  if (!sourceTestStaging) assertPublicPackageBuildIdentity(identity);
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    error?.message ?? 'runtime build identity was malformed',
  );
}

const binDirectory = join(packageRoot, 'bin');
const libDirectory = join(packageRoot, 'lib');
rmSync(binDirectory, { recursive: true, force: true });
rmSync(libDirectory, { recursive: true, force: true });
mkdirSync(binDirectory, { recursive: true });
mkdirSync(libDirectory, { recursive: true });
cpSync(sourceBinary, join(binDirectory, 'snapback'));
chmodSync(join(binDirectory, 'snapback'), 0o755);
cpSync(sourceHermes, join(libDirectory, 'libhermesvm.so'));
chmodSync(join(libDirectory, 'libhermesvm.so'), 0o755);
console.log(`prepared ${join(binDirectory, 'snapback')}`);
