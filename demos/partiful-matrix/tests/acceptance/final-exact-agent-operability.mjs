#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  acceptanceRoot,
  exactArtifactIdentity,
  exactRoot,
  finalizeReport,
  identity,
  readExactText,
  readJson,
  requirement,
  sha256,
  writeStep4Report,
} from './step4-closure-helpers.mjs';

// @ref LLP 0063#sequence — consume Exact LLP 0373 phase 5 as the cumulative
// FINAL.EXACT_AGENT_OPERABILITY gate instead of leaving implemented
// registry/HTTP/MCP/typed-client and failed-RSVP evidence unjoined.

const output = `${acceptanceRoot}/results/final-exact-agent-operability.json`;
const registryCheckId = 'agent-registry-completeness';
const requiredOperations = [
  'exact_contract_bindings',
  'exact_contract_mutation_outcomes',
  'exact_contract_source_map',
  'exact_contract_verify_claims',
];

function runExact(args) {
  const child = spawnSync('bun', args, {
    cwd: exactRoot,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    command: ['bun', ...args],
    status: child.status,
    signal: child.signal,
    stdoutSha256: sha256(child.stdout ?? ''),
    stderrSha256: sha256(child.stderr ?? ''),
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
  };
}

const exactVerify = JSON.parse(readExactText('exact-verify.json'));
const registered = exactVerify.checks.find(({ id }) => id === registryCheckId);
assert(registered, `Exact registry is missing ${registryCheckId}`);
assert.equal(registered.command, 'bun scripts/check-agent-registry.mjs');

const parityRun = runExact(['scripts/check-agent-registry.mjs', '--json']);
assert.equal(parityRun.status, 0, parityRun.stderr || parityRun.stdout);
const parity = JSON.parse(parityRun.stdout);
assert.equal(parity.ok, true);
assert.deepEqual(parity.errors, []);
for (const operation of requiredOperations) {
  assert(parity.operations.includes(operation), `Exact registry omitted ${operation}`);
}

const rsvpRun = runExact([
  'test',
  'packages/exact-devtools/src/agent/contract-inspection.test.ts',
]);
const rsvpOutput = `${rsvpRun.stdout}\n${rsvpRun.stderr}`;
assert.equal(rsvpRun.status, 0, rsvpOutput);
assert.match(rsvpOutput, /8 pass/);
assert.match(rsvpOutput, /0 fail/);

const contractTraceOperations = parity.operations.filter((id) =>
  /^exact_contract_.*trace/.test(id),
);
assert.deepEqual(contractTraceOperations, []);
assert(parity.operations.includes('exact_causal_trace'));

const partitimeAgentPath = 'demos/partiful-matrix/acceptance/results/step4-agent-session.json';
const partitimeAgent = readJson(partitimeAgentPath);
assert.equal(partitimeAgent.ok, true);
assert.match(partitimeAgent.answer.reason, /disconnected/i);
assert(partitimeAgent.bindings.subscriptions.length > 0);

const parityReceipt = {
  command: parityRun.command.join(' '),
  status: parityRun.status,
  stdoutSha256: parityRun.stdoutSha256,
  stderrSha256: parityRun.stderrSha256,
  operationCount: parity.operations.length,
  requiredOperations,
  errors: parity.errors,
};
const rsvpReceipt = {
  command: rsvpRun.command.join(' '),
  status: rsvpRun.status,
  stdoutSha256: rsvpRun.stdoutSha256,
  stderrSha256: rsvpRun.stderrSha256,
  passed: 8,
  failed: 0,
  fixture: 'synthetic failing RSVP provider',
};
const requirements = [
  requirement('exact-registry-check-registered', 'pass', 'FINAL_AGENT_REGISTRY_CHECK_REGISTERED', {
    registry: exactArtifactIdentity('exact-verify.json'),
    checkId: registryCheckId,
    command: registered.command,
  }),
  requirement('registry-http-mcp-typed-client-parity', 'pass', 'FINAL_AGENT_TRANSPORT_PARITY_PASSED', {
    run: parityReceipt,
    registry: exactArtifactIdentity('packages/exact-devtools/src/agent/operations/registry.ts'),
    http: exactArtifactIdentity('packages/exact-devtools/src/agent/server.ts'),
    mcp: exactArtifactIdentity('packages/exact-devtools/src/agent/mcp-server.ts'),
    typedClient: exactArtifactIdentity('packages/exact-devtools/src/agent/client.ts'),
  }),
  requirement('failed-rsvp-end-to-end', 'pass', 'FINAL_AGENT_FAILED_RSVP_PASSED', {
    run: rsvpReceipt,
    implementation: exactArtifactIdentity('packages/exact-devtools/src/agent/contract-inspection.ts'),
    acceptance: exactArtifactIdentity('packages/exact-devtools/src/agent/contract-inspection.test.ts'),
    facts: [
      'owning-action',
      'mutation-descriptor',
      'provider-receipt-and-error-class',
      'affected-query-cell',
      'current-render-branch',
      'source-spans',
    ],
  }),
  requirement('one-causal-trace-surface', 'pass', 'FINAL_AGENT_ONE_TRACE_SURFACE_PASSED', {
    sharedOperation: 'exact_causal_trace',
    parallelContractTraceOperations: contractTraceOperations,
    operationInventorySha256: sha256(JSON.stringify(parity.operations)),
  }),
  requirement('partitime-list-explanation', 'pass', 'FINAL_AGENT_PARTITIME_EXPLANATION_PASSED', {
    receipt: identity(partitimeAgentPath),
    question: partitimeAgent.question,
    reason: partitimeAgent.answer.reason,
    activeSubscriptions: partitimeAgent.bindings.subscriptions.length,
  }),
];

const report = finalizeReport({
  schemaVersion: 'partitime.final-exact-agent-operability.v1',
  claimId: 'FINAL.EXACT_AGENT_OPERABILITY',
  requirements,
  inputs: {
    exactPlan: exactArtifactIdentity('llp/0373-contract-and-exact-after-partitime.plan.md'),
    exactRegistryCheck: exactArtifactIdentity('scripts/check-agent-registry.mjs'),
    exactInspectionAcceptance: exactArtifactIdentity(
      'packages/exact-devtools/src/agent/contract-inspection.test.ts',
    ),
    partitimeAgentSession: identity(partitimeAgentPath),
  },
  details: {
    conclusion:
      'Exact LLP 0373 phase-5 operations pass the failed-RSVP fixture and registry/HTTP/MCP/typed-client parity; Partitime retains an app-specific list explanation.',
  },
});

writeStep4Report(output, report);
