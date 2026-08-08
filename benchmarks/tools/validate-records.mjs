#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatFailure } from './lib/failure.mjs';
import { loadCommittedRecordInventory } from './lib/record-loader.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

try {
  const inventory = loadCommittedRecordInventory({ root: ROOT });
  for (const item of inventory.records) {
    process.stdout.write(`[MACHINE VALID] ${item.file}\n`);
  }
  for (const item of inventory.historical) {
    process.stdout.write(`[HISTORICAL] ${item.file}; missing: ${item.missingFields.join(', ')}\n`);
  }
  process.stdout.write(`[SUMMARY] ${inventory.records.length} committed machine record(s); ${inventory.historical.length} historical record(s)\n`);
} catch (error) {
  process.stderr.write(`${formatFailure(error)}\n`);
  process.exitCode = 1;
}
