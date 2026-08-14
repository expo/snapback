#!/usr/bin/env node

// @ref LLP 0041#acceptance — a public package claim requires independently
// provisioned clean-machine receipts for every runtime tuple the CLI promises.
// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax —
// promote the packaged-loop claim only after the registry and platform
// receipts agree on one immutable publication closure.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  aggregatePublicPackageProofs,
  ledgerNameGeneration,
  parseBoundedJsonBytes,
  readBoundedFileBytes,
} from './snapback-package-cold-install-lib.mjs';

const usage = `Usage:
  node scripts/snapback-package-proof-aggregate.mjs
    --ledger <publication-ledger.json>
    --platform-receipt <darwin-receipt.json>
    --platform-receipt <linux-receipt.json>
    [--receipt <aggregate-receipt.json>]
`;

function fail(message) {
  console.error(`snapback-package-proof-aggregate: ${message}`);
  process.exit(1);
}

function parseArguments(args) {
  const parsed = { ledger: null, platformReceipts: [], receipt: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(usage);
      process.exit(0);
    }
    if (argument === '--ledger' || argument === '--platform-receipt' || argument === '--receipt') {
      const value = args[index + 1];
      if (value == null || value.startsWith('-')) fail(`${argument} requires a path`);
      if (argument === '--platform-receipt') parsed.platformReceipts.push(resolve(value));
      else parsed[argument.slice(2)] = resolve(value);
      index += 1;
      continue;
    }
    fail(`unrecognized argument: ${argument}\n${usage}`);
  }
  if (!parsed.ledger) fail(`--ledger is required\n${usage}`);
  if (parsed.platformReceipts.length === 0) {
    fail(`at least one --platform-receipt is required\n${usage}`);
  }
  return parsed;
}

function readJsonRecord(path, label) {
  try {
    const bytes = readBoundedFileBytes(path, label);
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      receipt: parseBoundedJsonBytes(bytes, label),
    };
  } catch (error) {
    fail(`${label} is invalid: ${path}: ${error.message}`);
  }
}

const options = parseArguments(process.argv.slice(2));
const ledger = readJsonRecord(options.ledger, 'publication ledger').receipt;
const platformReceiptRecords = options.platformReceipts.map((path) => ({
  path,
  ...readJsonRecord(path, 'platform receipt'),
}));
// The aggregation follows the ledger's source-name generation: terminal
// @expo/snapback-* identity closures, or recorded legacy @snapback/* alias
// closures (decision-9 lineage).
const generation = ledgerNameGeneration(ledger.scopePreset);
const expectedSourceNames = [
  ...generation.platformRuntimes,
  generation.contract,
  generation.client,
  generation.codegen,
  generation.vite,
  generation.react,
  ...(generation.umbrella !== undefined
    && ledger.packages?.some((row) => row.sourceName === generation.umbrella)
    ? [generation.umbrella]
    : []),
  ...(generation.expo !== undefined
    && ledger.packages?.some((row) => row.sourceName === generation.expo)
    ? [generation.expo]
    : []),
  generation.appCli,
  generation.cli,
  ...(generation.createSnapbackApp !== undefined
    && ledger.packages?.some((row) => row.sourceName === generation.createSnapbackApp)
    ? [generation.createSnapbackApp]
    : []),
];
const expectedPlatforms = new Map([
  ['darwin-arm64', generation.platformRuntimes[0]],
  ['linux-x64', generation.platformRuntimes[1]],
]);

let receipt;
try {
  receipt = aggregatePublicPackageProofs({
    ledger,
    expectedSourceNames,
    expectedPlatforms,
    receipts: platformReceiptRecords,
  });
} catch (error) {
  fail(error.message);
}
const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
if (options.receipt) writeFileSync(options.receipt, rendered);
process.stdout.write(rendered);
