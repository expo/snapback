import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEMO_CWD,
  MAX_LOG_BYTES,
  RECEIPT_SCHEMA_VERSION,
  REQUIRED_COMMANDS,
  canonicalJson,
  defaultSchemaPath,
  executeRequiredCommand,
  sanitizeLog,
  sha256,
  summarize,
  validateReceiptEnvelope,
  verifyReceipt,
} from './bakeoff-runner-lib.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

function evidence(path, schemaVersion) {
  return {
    required: true,
    available: true,
    valid: true,
    sourcePath: path,
    sourceSha256: digest,
    path: `${DEMO_CWD}/acceptance/evidence/${'d'.repeat(64)}.json`,
    sha256: digest,
    schemaVersion,
    verdict: 'passed',
    passed: 1,
    total: 1,
    diagnostic: null,
  };
}

function commandResult(command, index, status = 'passed') {
  const started = 1_785_300_000_000 + index * 10;
  const finished = started + 5;
  return {
    id: command.id,
    required: true,
    argv: [...command.argv],
    cwd: DEMO_CWD,
    timeoutMs: command.timeoutMs,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: 5,
    exitCode: status === 'passed' ? 0 : 1,
    signal: null,
    status,
    stdout: {
      path: `${DEMO_CWD}/acceptance/logs/${'b'.repeat(64)}.log`,
      sha256: `sha256:${'b'.repeat(64)}`,
      sourceBytes: 0,
      storedBytes: 0,
      truncated: false,
    },
    stderr: {
      path: `${DEMO_CWD}/acceptance/logs/${'c'.repeat(64)}.log`,
      sha256: `sha256:${'c'.repeat(64)}`,
      sourceBytes: 0,
      storedBytes: 0,
      truncated: false,
    },
  };
}

function sampleContent() {
  const commands = REQUIRED_COMMANDS.map((command, index) => commandResult(command, index));
  const evidenceSet = {
    comparator: evidence(
      `${DEMO_CWD}/.snapback/comparator-receipt.json`,
      'snapback.comparator-receipt.v1',
    ),
    reactPresence: evidence(
      `${DEMO_CWD}/acceptance/results/react-presence.v1.json`,
      'snapback.react-presence-receipt.v1',
    ),
    reactQueryGroup: evidence(
      `${DEMO_CWD}/acceptance/results/react-query-group.v1.json`,
      'snapback.real-adapter-query-group-receipt.v1',
    ),
  };
  const source = {
    revision: '1'.repeat(40),
    tree: '2'.repeat(40),
    cleanAtStart: true,
    trackedInputs: {
      algorithm: 'sha256-git-index-path-mode-object.v1',
      fileCount: 10,
      sha256: digest,
    },
    unchangedAfterCommands: true,
    unexpectedPaths: [],
  };
  return {
    runKind: 'required-three-backend-local-matrix',
    source,
    runner: {
      package: 'snapback-backend-bakeoff',
      path: `${DEMO_CWD}/scripts/bakeoff-runner-lib.mjs`,
      sha256: digest,
      commandSetSha256: digest,
      schemaPath: `${DEMO_CWD}/acceptance/backend-bakeoff-run.schema.json`,
      schemaSha256: digest,
    },
    environment: {
      node: 'v24.18.0',
      bun: '1.3.12',
      platform: 'darwin',
      architecture: 'arm64',
    },
    startedAt: '2026-07-28T00:00:00.000Z',
    finishedAt: '2026-07-28T00:00:01.000Z',
    durationMs: 1000,
    commands,
    evidence: evidenceSet,
    identities: {
      target: { available: false, profileId: null },
      artifact: {
        available: false,
        appId: null,
        schemaHash: null,
        bundleHash: null,
        inputsHash: null,
      },
      runtime: {
        available: false,
        sha256: null,
        crateVersion: null,
        gitCommit: null,
        gitDirty: null,
        buildProfile: null,
      },
      packages: {
        comparator: { cli: null, client: null },
        react: { client: null, react: null, contract: null, codegen: null },
      },
      generatedQueryGroup: {
        available: false,
        id: null,
        definitionHash: null,
        adapterSourceSha256: null,
        compiledBundleSha256: null,
      },
    },
    summary: summarize(commands, evidenceSet, source),
    nonclaims: ['functional evidence only'],
  };
}

function envelope(content = sampleContent()) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    contentSha256: sha256(canonicalJson(content)),
    content,
  };
}

test('the closed command inventory names every required backend and build lane', () => {
  assert.deepEqual(
    REQUIRED_COMMANDS.map(({ id }) => id),
    [
      'contract',
      'snapback-comparator',
      'snapback-extras',
      'react',
      'convex',
      'supabase',
      'typecheck',
      'build',
    ],
  );
  assert(REQUIRED_COMMANDS.every(({ argv }) => argv[0] === 'bun' && argv[1] === 'run'));
});

test('the aggregate schema and semantic validator accept a closed green receipt', () => {
  const receipt = envelope();
  assert.equal(
    validateReceiptEnvelope(receipt, { schemaPath: defaultSchemaPath }),
    receipt,
  );
});

test('a missing backend prerequisite cannot produce a green summary', () => {
  const content = sampleContent();
  content.commands[4] = commandResult(REQUIRED_COMMANDS[4], 4, 'failed');
  content.summary = summarize(content.commands, content.evidence, content.source);
  assert.deepEqual(content.summary, {
    status: 'failed',
    required: 8,
    passed: 7,
    failed: 1,
    timedOut: 0,
    evidenceValid: true,
  });
  validateReceiptEnvelope(envelope(content), { schemaPath: defaultSchemaPath });
});

test('missing or invalid child evidence cannot produce a green summary', () => {
  const content = sampleContent();
  content.evidence.reactPresence = {
    required: true,
    available: false,
    valid: false,
    sourcePath: null,
    sourceSha256: null,
    path: null,
    sha256: null,
    schemaVersion: null,
    verdict: 'missing',
    passed: null,
    total: null,
    diagnostic: 'receipt file is missing',
  };
  content.summary = summarize(content.commands, content.evidence, content.source);
  assert.equal(content.summary.status, 'failed');
  assert.equal(content.summary.evidenceValid, false);
  validateReceiptEnvelope(envelope(content), { schemaPath: defaultSchemaPath });
});

test('the semantic validator refuses an argv substitution inside valid JSON', () => {
  const content = sampleContent();
  content.commands[0].argv = ['bun', 'run', 'test:supabase'];
  assert.throws(
    () => validateReceiptEnvelope(envelope(content), { schemaPath: defaultSchemaPath }),
    /SNAPBACK_BAKEOFF_RECEIPT_COMMAND_INVALID/,
  );
});

test('logs redact credentials and absolute workspace/temp paths before hashing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-bakeoff-runner-test-'));
  try {
    const secret = 'super-secret-value-123456';
    const raw = Buffer.from(
      `${root}/file.mjs\n/private/tmp/private-file\nBearer ${secret}\n${secret}\n`
        + 'x'.repeat(MAX_LOG_BYTES + 100),
    );
    let clock = 1_785_300_000_000;
    const result = await executeRequiredCommand(REQUIRED_COMMANDS[0], {
      repoRoot: root,
      demoRoot: join(root, DEMO_CWD),
      env: { SUPABASE_SECRET_KEY: secret },
      now: () => {
        const value = clock;
        clock += 10;
        return value;
      },
      processRunner: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        spawnError: null,
        stdout: raw.subarray(0, MAX_LOG_BYTES),
        stderr: Buffer.alloc(0),
        stdoutSourceBytes: raw.byteLength,
        stderrSourceBytes: 0,
        stdoutTruncated: true,
        stderrTruncated: false,
      }),
      secrets: [secret],
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.stdout.truncated, true);
    assert(result.stdout.storedBytes <= MAX_LOG_BYTES);
    const stored = readFileSync(join(root, result.stdout.path), 'utf8');
    assert(!stored.includes(secret));
    assert(!stored.includes(root));
    assert(!stored.includes('/private/tmp/'));
    assert(stored.includes('<workspace>') || stored.includes('<temp>'));
    assert.equal(result.stdout.sha256, sha256(Buffer.from(stored)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('standalone sanitizer covers credential carriers', () => {
  const value = sanitizeLog(
    'Bearer abcdefghijklmnop npm_abcdefghijklmnop '
      + 'https://user:password@example.test/path '
      + 'eyJabcdefgh.ijklmnop.qrstuvwx',
    { repoRoot: '/repo', secrets: [] },
  );
  assert(!value.includes('abcdefghijklmnop'));
  assert(!value.includes('user:password'));
  assert(value.includes('<redacted>'));
});

test('the standalone verifier reopens content-addressed logs and child projections', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-bakeoff-verify-test-'));
  try {
    const acceptance = join(root, DEMO_CWD, 'acceptance');
    const logs = join(acceptance, 'logs');
    const childEvidence = join(acceptance, 'evidence');
    const results = join(acceptance, 'results');
    mkdirSync(logs, { recursive: true });
    mkdirSync(childEvidence, { recursive: true });
    mkdirSync(results, { recursive: true });
    const schemaPath = join(acceptance, 'backend-bakeoff-run.schema.json');
    copyFileSync(defaultSchemaPath, schemaPath);

    const logBytes = Buffer.from('sanitized log\n');
    const logDigest = sha256(logBytes);
    const logPath = `${DEMO_CWD}/acceptance/logs/${logDigest.slice(7)}.log`;
    writeFileSync(join(root, logPath), logBytes);

    const content = sampleContent();
    for (const command of content.commands) {
      command.stdout = {
        path: logPath,
        sha256: logDigest,
        sourceBytes: logBytes.byteLength,
        storedBytes: logBytes.byteLength,
        truncated: false,
      };
      command.stderr = structuredClone(command.stdout);
    }
    for (const item of Object.values(content.evidence)) {
      const projection = {
        schemaVersion: 'snapback.backend-bakeoff-child-evidence.v1',
        sourcePath: item.sourcePath,
        sourceSchemaVersion: item.schemaVersion,
        sourceSha256: item.sourceSha256,
        receipt: { schemaVersion: item.schemaVersion },
      };
      const bytes = Buffer.from(`${canonicalJson(projection)}\n`);
      item.sha256 = sha256(bytes);
      item.path = `${DEMO_CWD}/acceptance/evidence/${item.sha256.slice(7)}.json`;
      writeFileSync(join(root, item.path), bytes);
    }
    const receipt = envelope(content);
    const receiptPath = join(
      results,
      `backend-bakeoff-run.${receipt.contentSha256.slice(7)}.v2.json`,
    );
    writeFileSync(receiptPath, `${canonicalJson(receipt)}\n`);

    assert.deepEqual(
      verifyReceipt(receiptPath, { repoRoot: root, schemaPath }),
      receipt,
    );
    writeFileSync(join(root, logPath), 'tampered\n');
    assert.throws(
      () => verifyReceipt(receiptPath, { repoRoot: root, schemaPath }),
      /SNAPBACK_BAKEOFF_LOG_DIGEST_MISMATCH/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
