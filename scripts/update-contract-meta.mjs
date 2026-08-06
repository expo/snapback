#!/usr/bin/env node

// Mechanically refresh the parameter arrays that the contract-meta gate
// compares with their exported TypeScript functions. Missing/removed exports
// remain a deliberate manual decision and are still refused by the checker.
// @ref LLP 0175#same-change-frozen-record-coupling — every registered frozen
// record check names a concrete reconciliation command.

import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  discoverContractMetaPairs,
  refreshContractMetaPair,
} from './check-contract-meta.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let changed = 0;
for (const { sourcePath, metaPath } of discoverContractMetaPairs(ROOT)) {
  const refreshed = refreshContractMetaPair(sourcePath, metaPath);
  if (!refreshed.changed) continue;
  writeFileSync(metaPath, refreshed.source);
  changed += 1;
  console.log(`[contract-meta] refreshed ${relative(ROOT, metaPath)}`);
}
console.log(`[contract-meta] refreshed ${changed} sidecar(s)`);
