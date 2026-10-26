#!/usr/bin/env node
// The SEC11 brief prohibits the full Rust/client pools selected by docs edges.
// Retain the original plan and disclose every omitted step; never call this a
// completed canonical selector receipt. Integration owns the remaining pool.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { planAffected, runPlan } = await import(pathToFileURL(resolve('snapback4/scripts/affected.mjs')));
const plan = planAffected({ base: 'origin/main', worktree: process.argv.includes('--worktree') });
const originalPath = process.argv[2];
if (!originalPath || originalPath.startsWith('--')) throw new Error('output prefix required');
writeFileSync(originalPath + '.original.json', JSON.stringify(plan, null, 2));
const allowed = new Set(['install-client','build-cli','build-wasm','build-client','rust:snapback4','rust:snapback4-lang',
  'diagnostics','docs-budget','generated','guide','inventories','packaged-docs','ref-check']);
const files = ['dx9-packed','sec10-packed','security-packed','write-authority','wave11-guide-types','lang4-guide']
  .map(name => `packages/snapback4/test/${name}.test.mjs`);
const steps = plan.steps.filter(step => allowed.has(step.id));
const client = plan.steps.find(step => step.id === 'client-tests');
if (client) steps.push({ ...client, argv: ['node','scripts/run-client-tests.mjs','3','files',...files] });
const scoped = { ...plan, steps, rustPackages: ['snapback4','snapback4-lang'], clientFiles: files.map(f => 'snapback4/' + f),
  sec11Override: { reason: 'Explicit workstream prohibition on the full five-crate suite and full client pool',
    canonicalComplete: false, omitted: plan.steps.filter(step => !allowed.has(step.id)).map(step => step.id),
    differentialRuns: 'Direct 2k run-lean and run receipts are recorded separately' } };
writeFileSync(originalPath + '.scoped.json', JSON.stringify(scoped, null, 2));
const { receipt } = await runPlan(scoped);
writeFileSync(originalPath + '.receipt.json', JSON.stringify(receipt, null, 2));
process.exitCode = receipt.ok ? 0 : 1;
