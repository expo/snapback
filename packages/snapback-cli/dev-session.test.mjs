import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDev, scaffoldApp } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
);
const cli = join(packageRoot, 'cli.mjs');
assert.equal(existsSync(runtimeBinary), true, `missing runtime binary ${runtimeBinary}`);

function enableSessions(projectRoot) {
  const schemaPath = join(projectRoot, 'snapback', 'schema.mjs');
  const source = readFileSync(schemaPath, 'utf8');
  const sessions = /auth:\s*\{\s*mode:\s*['"]sessions['"]/u.test(source)
    ? source
    : source.replace(
      /\n\}\);\s*$/u,
      "\n}, { auth: { mode: 'sessions' } });\n",
    );
  assert.match(sessions, /auth:\s*\{\s*mode:\s*['"]sessions['"]/u);
  writeFileSync(schemaPath, sessions);
}

function fileInventory(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path));
    }
  };
  visit(root);
  return files.sort();
}

function runSession(projectRoot, args = []) {
  return spawnSync(process.execPath, [cli, 'auth', 'dev-session', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    timeout: 60_000,
  });
}

function diagnosticCode(result) {
  const envelope = JSON.parse(result.stderr);
  return envelope.diagnostics?.[0]?.code ?? null;
}

const root = mkdtempSync(join(tmpdir(), 'snapback-dev-session-'));
let sessionsDev = null;
let devModeDev = null;
try {
  const sessionsProject = join(root, 'sessions-app');
  assert.equal(scaffoldApp(sessionsProject, { template: 'react' }).ok, true);
  enableSessions(sessionsProject);
  sessionsDev = await runDev({
    backendDirectory: join(sessionsProject, 'snapback'),
    projectRoot: sessionsProject,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(sessionsDev.ok, true);

  const beforeMintFiles = fileInventory(sessionsProject);
  const defaultMint = runSession(sessionsProject, ['--json']);
  assert.equal(defaultMint.status, 0, defaultMint.stderr);
  assert.equal(defaultMint.stderr, '', 'successful JSON mint writes stdout only');
  const session = JSON.parse(defaultMint.stdout);
  assert.deepEqual(Object.keys(session), ['formatVersion', 'email', 'bearer', 'expiresAt']);
  assert.equal(session.formatVersion, 'snapback.dev-session.v1');
  assert.equal(session.email, 'snapback-dev@localhost.invalid');
  assert.equal(typeof session.bearer, 'string');
  assert.ok(session.bearer.length > 20);
  assert.equal(Number.isSafeInteger(session.expiresAt), true);
  assert.ok(session.expiresAt > Date.now());
  assert.deepEqual(
    fileInventory(sessionsProject),
    beforeMintFiles,
    'minting creates no new on-disk credential carrier',
  );
  for (const path of beforeMintFiles.filter((candidate) => (
    /(?:\.json|\.mjs|\.env(?:\.|$)|token|credential)/u.test(candidate)
    && !/(?:sqlite3|\.wal|\.shm)$/u.test(candidate)
  ))) {
    const absolute = join(sessionsProject, path);
    if (statSync(absolute).size > 1_000_000) continue;
    assert.doesNotMatch(
      readFileSync(absolute, 'utf8'),
      new RegExp(session.bearer.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `${path} must not contain the minted bearer`,
    );
  }

  // An explicit ready file wins even while the conventional candidate is
  // malformed. Restore the live owner's descriptor before lifecycle cleanup.
  const conventionalReady = join(sessionsProject, '.snapback', 'dev.ready.json');
  const explicitReady = join(sessionsProject, '.snapback', 'selected.ready.json');
  const conventionalBytes = readFileSync(conventionalReady);
  const conventionalDescriptor = JSON.parse(conventionalBytes);
  const missingAdminArtifact = { ...conventionalDescriptor };
  delete missingAdminArtifact.adminTokenFile;
  writeFileSync(conventionalReady, `${JSON.stringify(missingAdminArtifact)}\n`, { mode: 0o600 });
  const missingAdmin = runSession(sessionsProject, ['--json']);
  writeFileSync(conventionalReady, conventionalBytes, { mode: 0o600 });
  assert.equal(missingAdmin.status, 1);
  assert.equal(diagnosticCode(missingAdmin), 'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID');

  const explicitImpersonation = join(
    dirname(conventionalDescriptor.impersonationCapabilityFile),
    'selected.ready.json.impersonation',
  );
  cpSync(conventionalDescriptor.impersonationCapabilityFile, explicitImpersonation);
  chmodSync(explicitImpersonation, 0o600);
  writeFileSync(explicitReady, `${JSON.stringify({
    ...conventionalDescriptor,
    impersonationCapabilityFile: explicitImpersonation,
  })}\n`, { mode: 0o600 });
  writeFileSync(conventionalReady, '{"not":"a ready descriptor"}\n');
  const explicitMint = runSession(sessionsProject, [
    '--ready-file', explicitReady,
    '--email', 'lane-b@example.test',
  ]);
  writeFileSync(conventionalReady, conventionalBytes, { mode: 0o600 });
  rmSync(explicitReady);
  rmSync(explicitImpersonation);
  assert.equal(explicitMint.status, 0, explicitMint.stderr);
  assert.equal(explicitMint.stderr, '', 'successful human mint writes stdout only');
  assert.match(explicitMint.stdout, /^bearer=\S+$/mu);
  assert.match(explicitMint.stdout, /^expiresAt=\d+$/mu);

  const staleReady = join(root, 'stale.ready.json');
  cpSync(conventionalReady, staleReady);
  await sessionsDev.close();
  sessionsDev = null;
  const stale = runSession(sessionsProject, ['--ready-file', staleReady, '--json']);
  assert.equal(stale.status, 1);
  assert.equal(stale.stdout, '');
  assert.equal(diagnosticCode(stale), 'SNAPBACK_DEV_SESSION_TARGET_MISSING');

  const missingProject = join(root, 'missing-app');
  mkdirSync(missingProject);
  const missing = runSession(missingProject, ['--json']);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  const missingEnvelope = JSON.parse(missing.stderr);
  assert.equal(missingEnvelope.diagnostics[0].code, 'SNAPBACK_DEV_SESSION_TARGET_MISSING');
  assert.deepEqual(
    missingEnvelope.diagnostics[0].details.triedPaths,
    [join(realpathSync.native(missingProject), '.snapback', 'dev.ready.json')],
  );

  const devModeProject = join(root, 'dev-mode-app');
  assert.equal(scaffoldApp(devModeProject, { template: 'react' }).ok, true);
  devModeDev = await runDev({
    backendDirectory: join(devModeProject, 'snapback'),
    projectRoot: devModeProject,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  const unavailable = runSession(devModeProject, ['--email', 'not-an-email', '--json']);
  assert.equal(unavailable.status, 1);
  assert.equal(unavailable.stdout, '');
  assert.equal(
    diagnosticCode(unavailable),
    'SNAPBACK_AUTH_REQUEST_INVALID',
    'the existing supervised-mint refusal code is preserved verbatim',
  );

  console.log('dev-session.test.mjs: live default/explicit mints, stdout schemas, disk sweep, and 4 refusal cases passed');
} finally {
  await sessionsDev?.close?.();
  await devModeDev?.close?.();
  rmSync(root, { recursive: true, force: true });
}
