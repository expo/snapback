#!/usr/bin/env node
// @ref LLP 0063#product-choice-at-the-start-of-the-program — the cumulative
// manifest freezes Exact's Phase-5 agent-operability surface as a mandatory
// final claim instead of allowing a later trajectory label to waive it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');

function option(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
}

const validateOnly = process.argv.includes('--validate-only');
const exactRoot = resolve(repoRoot, option('exact-root', '../exact'));
const expectedExactRevision = option('exact-revision');
const output = resolve(
  repoRoot,
  option(
    'out',
    'demos/partiful-matrix/acceptance/results/final-exact-agent-operability.json',
  ),
);

assert.match(
  expectedExactRevision ?? '',
  /^[0-9a-f]{40}$/,
  '--exact-revision must be one full 40-character Git revision',
);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fileIdentity = (root, path) => ({
  path,
  sha256: sha256(readFileSync(resolve(root, path))),
});

function run(command, args, cwd, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
  );
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return capture
    ? {
        command: [command, ...args].join(' '),
        outputSha256: sha256(Buffer.from(combined)),
        outputBytes: Buffer.byteLength(combined),
      }
    : (result.stdout ?? '').trim();
}

const git = (root, ...args) => run('git', args, root);
const snapbackRevision = git(repoRoot, 'rev-parse', 'HEAD');
const exactRevision = git(exactRoot, 'rev-parse', 'HEAD');
assert.equal(
  exactRevision,
  expectedExactRevision,
  'Exact checkout is not at the explicitly admitted evidence revision',
);

const snapbackChanges = git(repoRoot, 'status', '--porcelain')
  .split('\n')
  .filter(Boolean);
const exactChanges = git(exactRoot, 'status', '--porcelain')
  .split('\n')
  .filter(Boolean);
if (!validateOnly) {
  assert.deepEqual(
    snapbackChanges,
    [],
    'Snapback must be clean before the agent-operability witness runs',
  );
}
assert.deepEqual(
  exactChanges,
  [],
  'Exact must be clean before the agent-operability witness runs',
);

const exactPlanPath = 'llp/0373-contract-and-exact-after-partitime.plan.md';
const exactPlan = readFileSync(resolve(exactRoot, exactPlanPath), 'utf8');
assert.match(
  exactPlan,
  /\*\*Phase 5 — complete \(Exact side\)\.\*\*/,
  'Exact LLP 0373 does not record Phase 5 complete on the Exact side',
);
assert.match(
  exactPlan,
  /Graduation parity \(§8\s+scorecard rerun\) awaits phase 4 exit by construction/,
  'Exact LLP 0373 no longer preserves the separate graduation-parity boundary',
);

const exactRegistryPath = 'exact-verify.json';
const exactRegistry = readJson(resolve(exactRoot, exactRegistryPath));
const registeredCheck = (id) => {
  const check = exactRegistry.checks.find((entry) => entry.id === id);
  assert.ok(check, `Exact verification registry is missing ${id}`);
  return check;
};
const devtoolsCheck = registeredCheck('devtools-tests');
const registryCheck = registeredCheck('agent-registry-completeness');
assert.match(
  devtoolsCheck.command ?? '',
  /bun test packages\/exact-devtools/,
  'Exact devtools gate no longer includes the Phase-5 operation tests',
);
assert.equal(
  registryCheck.command,
  'bun scripts/check-agent-registry.mjs',
  'Exact registry-parity command drifted',
);

const operations = [
  'exact_contract_bindings',
  'exact_contract_mutation_outcomes',
  'exact_contract_source_map',
  'exact_contract_verify_claims',
  'exact_causal_trace',
];
const operationSources = [
  'packages/exact-devtools/src/agent/operations/registry.ts',
  'packages/exact-devtools/src/agent/server.ts',
  'packages/exact-devtools/src/agent/mcp-server.ts',
];
for (const path of operationSources) {
  const source = readFileSync(resolve(exactRoot, path), 'utf8');
  for (const operation of operations) {
    assert.ok(
      source.includes(operation),
      `${path} is missing registered operation ${operation}`,
    );
  }
}

const validation = {
  schemaVersion: 'partitime.exact-agent-operability-validator.v1',
  ok: true,
  claimId: 'FINAL.EXACT_AGENT_OPERABILITY',
  snapbackRevision,
  exactRevision,
  operations,
  registeredChecks: [
    {
      id: devtoolsCheck.id,
      command: devtoolsCheck.command,
    },
    {
      id: registryCheck.id,
      command: registryCheck.command,
    },
  ],
  claimBoundary:
    'Validates Exact-side Phase-5 authority and registration only; it does not satisfy the executable failed-RSVP witness, graduation parity, STEP4.BUDGETS, any STEP6 vertical, or FINAL.IMMUTABLE_REVISION_SET.',
};

if (validateOnly) {
  console.log(JSON.stringify(validation));
  process.exit(0);
}

const executions = [
  run(
    'bun',
    [
      'test',
      'packages/exact-devtools/src/agent/contract-inspection.test.ts',
      'packages/exact-devtools/src/agent/causal-trace.test.ts',
      '--timeout',
      '30000',
    ],
    exactRoot,
    { capture: true },
  ),
  run('bun', ['scripts/check-agent-registry.mjs'], exactRoot, { capture: true }),
];

assert.deepEqual(
  git(exactRoot, 'status', '--porcelain').split('\n').filter(Boolean),
  [],
  'Exact became dirty while running the agent-operability witness',
);

const exactInputs = [
  exactPlanPath,
  exactRegistryPath,
  'packages/exact-devtools/src/agent/contract-inspection.test.ts',
  'packages/exact-devtools/src/agent/contract-inspection.ts',
  'packages/exact-devtools/src/agent/causal-trace.test.ts',
  'packages/exact-devtools/src/agent/causal-trace.ts',
  'packages/exact-devtools/src/agent/operations/registry.ts',
  'packages/exact-devtools/src/agent/server.ts',
  'packages/exact-devtools/src/agent/mcp-server.ts',
  'packages/exact-devtools/src/agent/client.ts',
  'scripts/check-agent-registry.mjs',
].map((path) => fileIdentity(exactRoot, path));

const receipt = {
  schemaVersion: 'partitime.exact-agent-operability.v1',
  claimId: 'FINAL.EXACT_AGENT_OPERABILITY',
  ok: true,
  authority: {
    snapback: 'LLP 0063#product-choice-at-the-start-of-the-program',
    exact: 'Exact LLP 0373#p1-agent-native-inspection-and-repair',
  },
  revisions: {
    snapback: snapbackRevision,
    exact: exactRevision,
  },
  evidence: {
    operations,
    failedRsvp:
      'The Exact contract-inspection suite identifies the owning action, mutation descriptor, typed receipt/error outcome, affected query cell, current render branch, source span, and structural fix-it anchor without browser logs or private runtime objects.',
    parity:
      'The registered Exact agent-registry check requires one matching HTTP route, MCP tool, and typed-client method for every operation and verifies the registry-owned schemas.',
    executions,
    exactInputs,
    snapbackInstrument: fileIdentity(
      repoRoot,
      relative(repoRoot, fileURLToPath(import.meta.url)),
    ),
  },
  nonclaims: [
    'Exact Phase-4 product-UI exit and the graduation-parity scorecard remain separate and open.',
    'STEP4.BUDGETS is not satisfied by this receipt.',
    'STEP6.CHAT, STEP6.DOCUMENTS, and STEP6.COMMERCE are not satisfied by this receipt.',
    'FINAL.IMMUTABLE_REVISION_SET remains pending until the complete cumulative matrix passes on one pinned two-repository revision set.',
  ],
  generatedAt: new Date().toISOString(),
};

mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
renameSync(temporary, output);
console.log(JSON.stringify(receipt));
