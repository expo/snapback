#!/usr/bin/env node

// @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
// — mint the receipt against the exact platform-installable staged closure.
// @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 — each
// public runtime package carries its own binary/carrier-bound store receipt.
// @ref LLP 0196#program — template qualification against this exact filtered
// candidate closure is a blocking peer of packaged-store qualification.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_PACKAGE_PREFIX = '@expo/snapback-runtime-';
const RECEIPT_FILE = 'packaged-store-qualification.receipt.json';
const RUNTIME_PACKAGE_BY_PLATFORM = Object.freeze({
  'darwin-arm64': '@expo/snapback-runtime-darwin-arm64',
  'linux-x64': '@expo/snapback-runtime-linux-x64',
});

function usage() {
  return `Usage: node scripts/qualified-staging-store-qualification.mjs [options]

Options:
  --staged-dir <dir>  Qualification closure containing publish-ledger.json and *.tgz
  --platform <id>     darwin-arm64 or linux-x64
  --out <path>        Destination for the minted receipt JSON
  --template-receipt <path>
                       Destination for the blocking template-portfolio receipt
  --keep              Keep the temporary filtered closure and extracted runtime
  -h, --help          Print this help
`;
}

function parseArguments(argv) {
  const parsed = {
    stagedDir: null,
    platform: null,
    out: null,
    templateReceipt: null,
    keep: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      if (seen.has('help')) throw new TypeError('duplicate --help');
      seen.add('help');
      parsed.help = true;
      continue;
    }
    if (argument === '--keep') {
      if (seen.has('keep')) throw new TypeError('duplicate --keep');
      seen.add('keep');
      parsed.keep = true;
      continue;
    }
    if (argument === '--staged-dir'
        || argument === '--platform'
        || argument === '--out'
        || argument === '--template-receipt') {
      if (seen.has(argument)) throw new TypeError(`duplicate ${argument}`);
      seen.add(argument);
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new TypeError(`${argument} requires a value`);
      }
      if (argument === '--staged-dir') parsed.stagedDir = value;
      else if (argument === '--platform') parsed.platform = value;
      else if (argument === '--out') parsed.out = value;
      else parsed.templateReceipt = value;
      continue;
    }
    throw new TypeError(`unrecognized argument: ${argument}`);
  }
  if (!parsed.help) {
    for (const [flag, value] of [
      ['--staged-dir', parsed.stagedDir],
      ['--platform', parsed.platform],
      ['--out', parsed.out],
    ]) {
      if (value === null) throw new TypeError(`${flag} is required`);
    }
    if (!Object.hasOwn(RUNTIME_PACKAGE_BY_PLATFORM, parsed.platform)) {
      throw new TypeError('--platform must be darwin-arm64 or linux-x64');
    }
  }
  return parsed;
}

function checkedTar(args, options, message) {
  const result = spawnSync('tar', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message;
    throw new Error(`${message}${detail ? `: ${String(detail).trim()}` : ''}`);
  }
  return result;
}

function readPackageName(tarball) {
  const manifest = checkedTar(
    ['-xzOf', tarball, 'package/package.json'],
    {},
    `could not read package identity from ${basename(tarball)}`,
  );
  try {
    const packageJson = JSON.parse(manifest.stdout);
    if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
      throw new TypeError('package name is absent');
    }
    return packageJson.name;
  } catch (error) {
    throw new Error(`invalid package identity in ${basename(tarball)}: ${error.message}`);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const stagedDir = resolve(args.stagedDir);
  const out = resolve(args.out);
  const templateReceipt = resolve(
    args.templateReceipt ?? join(dirname(out), `${args.platform}-templates.json`),
  );
  const stagedMetadata = lstatSync(stagedDir);
  if (!stagedMetadata.isDirectory() || stagedMetadata.isSymbolicLink()) {
    throw new TypeError(`--staged-dir must be a non-symlink directory: ${stagedDir}`);
  }
  const ledger = join(stagedDir, 'publish-ledger.json');
  const ledgerMetadata = lstatSync(ledger);
  if (!ledgerMetadata.isFile() || ledgerMetadata.isSymbolicLink()) {
    throw new TypeError(`qualification closure has no regular publish-ledger.json: ${stagedDir}`);
  }
  JSON.parse(readFileSync(ledger, 'utf8'));

  const temporary = mkdtempSync(join(tmpdir(), 'snapback-qualified-staging-store-'));
  const filtered = join(temporary, 'staged');
  const extracted = join(temporary, 'runtime');
  const publicationQualification = join(
    temporary,
    'publication-capability-qualification.receipt.json',
  );
  mkdirSync(filtered);
  mkdirSync(extracted);

  const requestedPackage = RUNTIME_PACKAGE_BY_PLATFORM[args.platform];
  const otherPackage = Object.entries(RUNTIME_PACKAGE_BY_PLATFORM)
    .find(([platform]) => platform !== args.platform)[1];
  let requestedTarball = null;
  let copiedTarballs = 0;
  try {
    copyFileSync(ledger, join(filtered, 'publish-ledger.json'));
    const tarballs = readdirSync(stagedDir)
      .filter((entry) => entry.endsWith('.tgz'))
      .sort();
    if (tarballs.length === 0) {
      throw new Error(`qualification closure contains no .tgz tarballs: ${stagedDir}`);
    }
    for (const filename of tarballs) {
      const source = join(stagedDir, filename);
      const packageName = readPackageName(source);
      if (packageName.startsWith(RUNTIME_PACKAGE_PREFIX)
          && !Object.values(RUNTIME_PACKAGE_BY_PLATFORM).includes(packageName)) {
        throw new Error(`unsupported runtime package in qualification closure: ${packageName}`);
      }
      if (packageName === requestedPackage) {
        if (requestedTarball !== null) {
          throw new Error(`qualification closure contains multiple tarballs for ${requestedPackage}`);
        }
        requestedTarball = source;
      }
      if (packageName === otherPackage) continue;
      copyFileSync(source, join(filtered, filename));
      copiedTarballs += 1;
    }
    if (requestedTarball === null) {
      throw new Error(`qualification closure is missing requested runtime package ${requestedPackage}`);
    }

    checkedTar(
      ['-xzf', requestedTarball, '-C', extracted],
      {},
      `could not extract ${requestedPackage}`,
    );
    const runtimeBinary = join(extracted, 'package', 'bin', 'snapback');
    if (!existsSync(runtimeBinary) || !lstatSync(runtimeBinary).isFile()) {
      throw new Error(`${requestedPackage} has no package/bin/snapback runtime binary`);
    }

    const qualification = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'packaged-store-qualification.mjs'),
      '--staged-dir', filtered,
      '--runtime-binary', runtimeBinary,
      '--qualification-out', publicationQualification,
      ...(args.keep ? ['--keep'] : []),
    ], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    if (qualification.error || qualification.status !== 0) {
      throw new Error(
        `packaged-store qualification failed for ${args.platform} (${qualification.signal ?? qualification.status ?? qualification.error?.message})`,
      );
    }

    const mintedReceipt = join(dirname(runtimeBinary), RECEIPT_FILE);
    if (!existsSync(mintedReceipt) || !lstatSync(mintedReceipt).isFile()) {
      throw new Error(`packaged-store qualification did not mint ${mintedReceipt}`);
    }
    if (!existsSync(publicationQualification)
        || !lstatSync(publicationQualification).isFile()) {
      throw new Error(
        `packaged-store qualification did not retain platform capability evidence at ${publicationQualification}`,
      );
    }

    const templateQualification = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'template-staged-qualification.mjs'),
      '--staged-dir', filtered,
      '--receipt', templateReceipt,
      ...(args.keep ? ['--keep'] : []),
    ], {
      cwd: ROOT,
      env: { ...process.env, CI: '1' },
      stdio: 'inherit',
    });
    if (templateQualification.error || templateQualification.status !== 0) {
      throw new Error(
        `template portfolio qualification failed for ${args.platform} (${templateQualification.signal ?? templateQualification.status ?? templateQualification.error?.message})`,
      );
    }
    if (!existsSync(templateReceipt) || !lstatSync(templateReceipt).isFile()) {
      throw new Error(`template portfolio qualification did not mint ${templateReceipt}`);
    }

    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(publicationQualification, out);
    console.log(JSON.stringify({
      schemaVersion: 'snapback.qualified-staging-store-qualification.v1',
      ok: true,
      platform: args.platform,
      runtimePackage: requestedPackage,
      stagedPackages: copiedTarballs,
      receipt: out,
      templateReceipt,
      temporary: args.keep ? temporary : null,
    }));
  } finally {
    if (!args.keep) rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
}
