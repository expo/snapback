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
export default defineSchema({
  events: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
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
  // Regression pin (0137 A6 f1): the read-set summary and effect ceiling name
  // the reserved `_snapback_jobs` projection — the exact logical stream the
  // runtime's summary builder and live matcher pin. The runtime's
  // schema-reference preflight admits precisely this shape (read-only, on the
  // job-status plan); renaming either side makes every declaring app
  // unbootable at load.
  assert.deepEqual(
    jobStatus.readSetSummary,
    {
      authScopeField: null,
      mode: 'singleTable',
      primaryTable: '_snapback_jobs',
      tables: ['_snapback_jobs'],
    },
    'the job-status read summary names the reserved projection',
  );
  assert.deepEqual(
    jobStatus.writeSetSummary,
    { mode: 'none', primaryTable: null, tables: [] },
    'the job-status query never declares writes',
  );
  assert.deepEqual(
    jobStatus.effectCeiling.reads,
    [{ access: 'point', table: '_snapback_jobs' }],
    'the effect ceiling carries the same reserved point read',
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

  // The platform owns the job-status projection completely
  // (JobStatusRow::to_row_value in src/jobs.rs), and defineJobStatusQuery
  // refuses authored result contracts — so the generated contract must be
  // the precise platform shape, never `unknown`, and generation must not
  // advise the author to declare a result the surface refuses
  // (issues/closed/20260801-0137-reverify-jobstatus-declaration-degraded-advisory.md:
  // the guide says "Declaring it is the whole authoring step").
  assert.equal(
    jobStatus.resultContract.kind,
    'records',
    'the declared job-status query carries the complete platform-owned projection',
  );
  assert.deepEqual(
    jobStatus.resultContract.record.fields.map(({ name }) => name),
    [
      '_id', 'jobId', 'queue', 'action', 'state', 'availableAtMs',
      'enqueuedAtMs', 'attemptCount', 'maxAttempts', 'stateVersion',
      'terminalAtMs', 'lastErrorCode', 'producerMutationId',
      'producerSnapshotVersion', 'producerFunction',
    ],
    'the contract fields mirror JobStatusRow::to_row_value exactly',
  );
  assert.deepEqual(
    jobStatus.resultContract.record.fields
      .find(({ name }) => name === 'state').value.variants
      .map(({ value }) => value),
    ['pending', 'claimed', 'succeeded', 'dead', 'cancelled'],
    'the state union mirrors JobState exactly',
  );
  assert.ok(
    !result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED'
      && (diagnostic.details?.function ?? diagnostic.function) === 'jobStatus'
    )),
    'declaring the job-status query draws no degraded-result advisory',
  );
  assert.match(
    readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8'),
    /"pending" \| "claimed" \| "succeeded" \| "dead" \| "cancelled"/u,
    'the generated types carry the precise lifecycle states, not unknown rows',
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
