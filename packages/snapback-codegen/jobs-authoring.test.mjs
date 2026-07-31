// The generated jobs surface (LLP 0070 first slice): defineJobStatusQuery
// lowers to the Rust-owned JobStatusQuery HostPlan, requires the experimental
// jobs_one_off_v1 target capability, and the generated artifact acknowledges
// the experimental contract — the honest capability facts for a Draft-owned
// surface (no durable-background-work capability class is ever claimed).

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-jobs-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ events: defineTable({ name: v.string() }).sync() });
`);
  writeFileSync(join(dir, 'handlers.mjs'), `
globalThis.__snapbackHandlers = {
  async scheduleEvent(ctx, args) {
    return await ctx.jobs.enqueue('notify', { name: args.name }, { delayMs: 0 });
  },
  async applyEvent(ctx, args) {
    const id = await ctx.db.insert('events', { name: args.name });
    return { id };
  },
  async notify(ctx, args) {
    return await ctx.runMutation('applyEvent', { name: args.name });
  },
};
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineAction, defineJobStatusQuery, defineJsMutation, v } from '${defineUrl}';
export const scheduleEvent = defineJsMutation({
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'scheduleEvent',
  writes: ['events'],
});
export const applyEvent = defineJsMutation({
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'applyEvent',
  writes: ['events'],
});
export const notify = defineAction({
  args: { name: v.string() },
  js: { source: 'handlers.mjs', exportName: 'notify' },
  writes: ['events'],
});
export const jobStatus = defineJobStatusQuery({ auth: 'authenticated' });
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, `expected clean generation, got: ${JSON.stringify(result.diagnostics)}`);

  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const jobStatus = manifest.functions.find((fn) => fn.name === 'jobStatus');
  assert.ok(jobStatus, 'the declared job-status query must be emitted');
  assert.equal(jobStatus.kind, 'LiveQuery', 'the job-status query is live-capable');
  assert.deepEqual(
    jobStatus.runtime,
    { HostPlan: { JobStatusQuery: {} } },
    'the runtime is the Rust-owned JobStatusQuery plan, not an app table read',
  );
  assert.equal(jobStatus.authRequirement, 'authenticated');
  assert.ok(
    jobStatus.requiredCapabilities.includes('jobs_one_off_v1'),
    `job-status query must require jobs_one_off_v1: ${JSON.stringify(jobStatus.requiredCapabilities)}`,
  );
  assert.ok(
    jobStatus.requiredCapabilities.includes('live_subscriptions'),
    'the live declaration requires live delivery',
  );

  // The artifact-level experimental acknowledgment: LLP 0070 is Draft, so
  // binding to the jobs surface is a knowing bind to a not-yet-Accepted
  // contract (LLP 0058 capability maturity).
  assert.ok(
    (manifest.acknowledgedExperimentalCapabilities ?? []).includes('jobs_one_off_v1'),
    `generated manifest must acknowledge the experimental jobs contract: ${
      JSON.stringify(manifest.acknowledgedExperimentalCapabilities)}`,
  );

  // The embedded server-declared capability manifest carries the honest
  // facts: supported on the local target, maturity experimental — never a
  // stable or capability-class claim.
  const capability = JSON.parse(readFileSync(join(dir, 'generated', 'capability.manifest.json'), 'utf8'));
  assert.ok(
    capability.supportedCapabilities.includes('jobs_one_off_v1'),
    'local target capability manifest advertises the jobs surface',
  );
  assert.equal(
    capability.capabilityMaturity?.jobs_one_off_v1,
    'experimental',
    'the jobs surface stays experimental while LLP 0070 is Draft (claim boundary)',
  );

  // Mutations that merely enqueue need no extra declaration: the paved
  // default queue is zero-ceremony (LLP 0121 open question 1).
  const scheduler = manifest.functions.find((fn) => fn.name === 'scheduleEvent');
  assert.ok(scheduler, 'the enqueueing mutation is an ordinary JS mutation');
  assert.ok(
    !scheduler.requiredCapabilities.includes('jobs_one_off_v1'),
    'enqueue-side admission is runtime-enforced; the mutation declaration stays zero-ceremony in v1',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('jobs-authoring.test.mjs: all cases passed');
