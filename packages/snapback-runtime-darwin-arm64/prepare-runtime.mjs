#!/usr/bin/env node

// @ref LLP 0041#runtime-distribution — assemble the relocatable native
// package from a bootstrapped release binary; never compile Hermes on install.

import { cpSync, existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const sourceBinary = resolve(
  process.env.SNAPBACK_RUNTIME_SOURCE_BINARY
    ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
const sourceFramework = resolve(
  process.env.SNAPBACK_RUNTIME_HERMES_FRAMEWORK
    ?? join(repositoryRoot, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework'),
);

function fail(code, message) {
  console.error(`${code}: ${message}`);
  process.exit(1);
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail(
    'SNAPBACK_IBEX_HOST_UNSUPPORTED',
    `runtime-darwin-arm64 can only be prepared on darwin-arm64 (observed ${process.platform}-${process.arch})`,
  );
}
if (!existsSync(sourceBinary)) {
  fail(
    'SNAPBACK_RUNTIME_BINARY_MISSING',
    `release binary is missing at ${sourceBinary}; run scripts/bootstrap-ibex-runtime and cargo build --release`,
  );
}
if (!existsSync(join(sourceFramework, 'Versions'))) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Hermes framework is missing at ${sourceFramework}; run scripts/bootstrap-ibex-runtime`,
  );
}

const binDirectory = join(packageRoot, 'bin');
const frameworksDirectory = join(packageRoot, 'Frameworks');
rmSync(binDirectory, { recursive: true, force: true });
rmSync(frameworksDirectory, { recursive: true, force: true });
mkdirSync(binDirectory, { recursive: true });
mkdirSync(frameworksDirectory, { recursive: true });
cpSync(sourceBinary, join(binDirectory, 'snapback'));
chmodSync(join(binDirectory, 'snapback'), 0o755);
cpSync(sourceFramework, join(frameworksDirectory, 'hermesvm.framework'), {
  recursive: true,
  preserveTimestamps: true,
});
console.log(`prepared ${join(binDirectory, 'snapback')}`);
