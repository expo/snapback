import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { __test, runCli, scaffoldApp, writeDevEnvironmentFile } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
);
const cli = join(packageRoot, 'cli.mjs');
const moduleUrl = pathToFileURL(join(packageRoot, 'index.mjs')).href;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-env-writer-')));
const first = {
  snapbackUrl: 'http://127.0.0.1:4287',
  androidEmulatorUrl: 'http://10.0.2.2:4287',
};
const second = {
  snapbackUrl: 'http://127.0.0.1:4387',
  androidEmulatorUrl: 'http://10.0.2.2:4387',
};

function assertConflict(contents, label) {
  const path = join(root, `${label}.env`);
  writeFileSync(path, contents);
  const before = readFileSync(path);
  assert.throws(
    () => writeDevEnvironmentFile(path, { ...first, projectRoot: root }),
    (error) => error?.code === 'SNAPBACK_DEV_ENV_WRITER_CONFLICT',
    label,
  );
  assert.deepEqual(readFileSync(path), before, `${label} refusal must not modify the file`);
}

try {
  const missingPath = join(root, 'missing.env');
  const missingInsert = writeDevEnvironmentFile(missingPath, { ...first, projectRoot: root });
  assert.equal(missingInsert.state, 'inserted');
  assert.equal(statSync(missingPath).mode & 0o777, 0o600);

  const path = join(root, '.env.local');
  writeFileSync(path, 'UNRELATED=preserved\r\n# keep this byte-for-byte\r\n');
  chmodSync(path, 0o640);
  const inserted = writeDevEnvironmentFile(path, { ...first, projectRoot: root });
  assert.equal(inserted.state, 'inserted');
  assert.equal(statSync(path).mode & 0o777, 0o640);
  let bytes = readFileSync(path, 'utf8');
  assert.ok(bytes.startsWith('UNRELATED=preserved\r\n# keep this byte-for-byte\r\n'));
  assert.match(bytes, /# >>> snapback dev >>>\r?$/mu);
  assert.match(bytes, /# <<< snapback dev <<<\r?$/mu);
  for (const key of ['EXPO_PUBLIC_SNAPBACK_URL', 'VITE_SNAPBACK_URL', 'SNAPBACK_URL']) {
    assert.match(bytes, new RegExp(`^${key}=${first.snapbackUrl.replaceAll('.', '\\.')}\\r?$`, 'mu'));
  }
  assert.match(bytes, /^# EXPO_PUBLIC_SNAPBACK_URL=http:\/\/10\.0\.2\.2:4287\r?$/mu);
  assert.doesNotMatch(bytes, /sbat_|sbs_|bearer|token/iu);
  const insertedCrLfBytes = readFileSync(path);
  const identicalCrLfInsert = writeDevEnvironmentFile(path, { ...first, projectRoot: root });
  assert.equal(identicalCrLfInsert.state, 'unchanged');
  assert.equal(identicalCrLfInsert.changed, false);
  assert.deepEqual(
    readFileSync(path),
    insertedCrLfBytes,
    'same-URL CRLF refresh preserves every byte and does not rewrite',
  );

  const rewritten = writeDevEnvironmentFile(path, { ...second, projectRoot: root });
  assert.equal(rewritten.state, 'rewritten');
  assert.equal(statSync(path).mode & 0o777, 0o640);
  bytes = readFileSync(path, 'utf8');
  assert.ok(bytes.startsWith('UNRELATED=preserved\r\n# keep this byte-for-byte\r\n'));
  for (const key of ['EXPO_PUBLIC_SNAPBACK_URL', 'VITE_SNAPBACK_URL', 'SNAPBACK_URL']) {
    assert.match(bytes, new RegExp(`^${key}=${second.snapbackUrl.replaceAll('.', '\\.')}\\r?$`, 'mu'));
  }
  const rewrittenCrLfBytes = readFileSync(path);
  assert.equal(writeDevEnvironmentFile(path, { ...second, projectRoot: root }).state, 'unchanged');
  assert.deepEqual(
    readFileSync(path),
    rewrittenCrLfBytes,
    'same-URL CRLF refresh stays exact after a URL-changing rewrite, too',
  );

  const port80Urls = __test.devBackendUrls('http://localhost:80');
  assert.deepEqual(port80Urls, {
    snapbackUrl: 'http://127.0.0.1',
    androidEmulatorUrl: 'http://10.0.2.2',
  });
  const port80Path = join(root, 'port-80.env');
  writeDevEnvironmentFile(port80Path, { ...port80Urls, projectRoot: root });
  const port80Bytes = readFileSync(port80Path, 'utf8');
  assert.match(port80Bytes, /^SNAPBACK_URL=http:\/\/127\.0\.0\.1$/mu);
  assert.doesNotMatch(port80Bytes, /:80(?:\r?$|\/)/mu);

  assertConflict([
    '# >>> snapback dev >>>',
    'SNAPBACK_URL=http://127.0.0.1:1',
    '# <<< snapback dev <<<',
    '# >>> snapback dev >>>',
    '# <<< snapback dev <<<',
    '',
  ].join('\n'), 'duplicate-blocks');
  assertConflict('# >>> snapback dev >>>\nSNAPBACK_URL=http://127.0.0.1:1\n', 'missing-end');
  assertConflict('# >> snapback dev >>\n', 'malformed-marker');
  assertConflict('  export SNAPBACK_URL=http://127.0.0.1:1\nUNRELATED=yes\n', 'managed-key-outside');
  assertConflict(bytes.replace(
    '# EXPO_PUBLIC_SNAPBACK_URL=http://10.0.2.2:4387',
    'EXPO_PUBLIC_SNAPBACK_URL=http://10.0.2.2:4387',
  ), 'uncommented-android');

  const atomicPath = join(root, 'atomic.env');
  writeDevEnvironmentFile(atomicPath, { ...first, projectRoot: root });
  const oldBytes = readFileSync(atomicPath);
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { writeDevEnvironmentFile } from ${JSON.stringify(moduleUrl)};
writeDevEnvironmentFile(${JSON.stringify(atomicPath)}, {
  snapbackUrl: ${JSON.stringify(second.snapbackUrl)},
  androidEmulatorUrl: ${JSON.stringify(second.androidEmulatorUrl)},
  projectRoot: ${JSON.stringify(root)},
  beforeRename() { process.kill(process.pid, 'SIGKILL'); },
});
`]);
  assert.equal(killed.signal, 'SIGKILL');
  assert.deepEqual(readFileSync(atomicPath), oldBytes, 'kill before rename leaves the complete old file');

  const projectRoot = join(root, 'printed-app');
  assert.equal(scaffoldApp(projectRoot).ok, true);
  const jsonRun = spawnSync(process.execPath, [
    cli, 'dev', 'snapback', '--no-watch', '--write-env', '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    timeout: 120_000,
  });
  assert.equal(jsonRun.status, 0, jsonRun.stderr);
  const event = jsonRun.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .find((candidate) => candidate.state === 'generated-and-loaded');
  assert.equal(typeof event?.snapbackUrl, 'string');
  assert.equal(typeof event?.androidEmulatorUrl, 'string');
  const written = readFileSync(join(projectRoot, '.env.local'), 'utf8');
  for (const key of ['EXPO_PUBLIC_SNAPBACK_URL', 'VITE_SNAPBACK_URL', 'SNAPBACK_URL']) {
    assert.match(written, new RegExp(`^${key}=${event.snapbackUrl.replaceAll('.', '\\.')}\r?$`, 'mu'));
  }
  assert.match(written, new RegExp(`^# EXPO_PUBLIC_SNAPBACK_URL=${event.androidEmulatorUrl.replaceAll('.', '\\.')}\r?$`, 'mu'));
  assert.match(jsonRun.stderr, /not gitignored/u);

  const humanRun = spawnSync(process.execPath, [cli, 'dev', 'snapback', '--no-watch'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    timeout: 120_000,
  });
  assert.equal(humanRun.status, 0, humanRun.stderr);
  assert.match(humanRun.stdout, /^SNAPBACK_URL=http:\/\/127\.0\.0\.1:\d+$/mu);
  assert.match(humanRun.stdout, /Android emulator URL: http:\/\/10\.0\.2\.2:\d+/u);
  assert.match(humanRun.stdout, /snapback auth dev-session/u);

  const captureSupervisedPrint = async (json) => {
    const stdout = [];
    const stderr = [];
    const originalLog = console.log;
    const originalError = console.error;
    const abort = new AbortController();
    abort.abort(new Error('test completion'));
    console.log = (...values) => stdout.push(values.join(' '));
    console.error = (...values) => stderr.push(values.join(' '));
    try {
      const code = await runCli([
        'dev', 'snapback', '--expo', '--expo-platform', 'web',
        ...(json ? ['--json'] : []),
      ], {
        env: {},
        signal: abort.signal,
        async runExpoDev(options) {
          options.onEvent({
            schemaVersion: 'snapback.expo-dev.v1',
            ok: true,
            state: 'ready',
            snapbackUrl: first.snapbackUrl,
            androidEmulatorUrl: first.androidEmulatorUrl,
          });
          return { ok: true, async close() {} };
        },
      });
      assert.equal(code, 0);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    return { stdout, stderr };
  };
  const supervisedHuman = await captureSupervisedPrint(false);
  assert.ok(supervisedHuman.stdout.includes(`SNAPBACK_URL=${first.snapbackUrl}`));
  assert.ok(supervisedHuman.stdout.includes(`Android emulator URL: ${first.androidEmulatorUrl}`));
  const supervisedJson = await captureSupervisedPrint(true);
  const supervisedEvent = JSON.parse(supervisedJson.stdout[0]);
  assert.equal(supervisedEvent.snapbackUrl, first.snapbackUrl);
  assert.equal(supervisedEvent.androidEmulatorUrl, first.androidEmulatorUrl);
  assert.equal(supervisedJson.stdout.some((line) => line.startsWith('SNAPBACK_URL=')), false);

  console.log('dev-env-writer.test.mjs: CRLF idempotence, marker/conflict/mode/atomicity, canonical port-80 URLs, warning, and plain/supervised print cases passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
