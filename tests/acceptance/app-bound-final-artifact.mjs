import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const executable = process.env.SNAPBACK_APP_BOUND_EXECUTABLE;
const bearerFile = process.env.SNAPBACK_APP_BOUND_SESSION_BEARER_FILE;
const receiptDir = process.env.SNAPBACK_APP_BOUND_RECEIPT_DIR;
if (!executable || !bearerFile || !receiptDir) throw new Error('app-bound acceptance environment is incomplete');

const scratch = await mkdtemp(`${process.env.RUNNER_TEMP ?? '/tmp'}/snapback-app-bound-cases-`);
const writeCase = async (name, source) => {
  const path = join(scratch, name);
  await writeFile(path, source);
  return path;
};

const run = async (args, { input, signalAfterMs, timeoutMs = 30_000 } = {}) => {
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  if (input === undefined) child.stdin.end(); else child.stdin.end(input);
  const signalTimer = signalAfterMs === undefined ? null : setTimeout(() => child.kill('SIGTERM'), signalAfterMs);
  const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const status = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  if (signalTimer !== null) clearTimeout(signalTimer);
  return {
    ...status,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
};

const session = ['--principal', 'session', '--session-bearer-file', bearerFile];
const outcomes = {};
const expectExit = (name, result, code) => {
  outcomes[name] = result.code;
  assert.equal(result.code, code, `${name}: ${result.stderr}`);
  assert.equal(result.signal, null, name);
};

const introspect = await run(['introspect']);
expectExit('introspect', introspect, 0);
const introspection = JSON.parse(introspect.stdout);
assert.equal(
  introspection.sections.static.items.find((item) => item.kind === 'artifact-identity')?.value?.appId,
  'app',
);

const mutation = await run([
  ...session,
  '--args-json',
  '{"title":"llp0062-linux","body":"llp0062-linux-planted-value"}',
  'call',
  'createNote',
]);
expectExit('mutation', mutation, 0);

// The final executable's network backend is statically linked. Exercise its
// WebSocket path on the release artifact itself, not only HTTP query/mutation
// calls or the Node-hosted coordinator tests.
const liveQuery = await run([
  ...session,
  '--args-json',
  '{}',
  'call',
  'watchNotes',
]);
expectExit('live-query-websocket', liveQuery, 0);
assert.match(liveQuery.stdout, /llp0062-linux/u);

const language = await writeCase('language.ts', `
type Count = number;
const rows = await api.listNotes({});
const count: Count = rows.length;
export default { count, fetchType: typeof fetch, processType: typeof process };
`);
const languageResult = await run([...session, 'run', language]);
expectExit('language', languageResult, 0);
const languageValue = JSON.parse(languageResult.stdout);
assert.equal(typeof languageValue.count, 'number');
assert.equal(languageValue.fetchType, 'undefined');
assert.equal(languageValue.processType, 'undefined');

const leakage = await writeCase('leakage.ts', `
const rows = await api.listNotes({});
signal.addEventListener('abort', async () => {
  try { await api.listNotes({ planted: 'grace-call-must-not-cross' }); }
  catch { console.log('cleanup-observed'); }
});
export default { count: rows.length };
`);
const leakageResult = await run([...session, 'run', leakage]);
expectExit('broker-value-nondisclosure', leakageResult, 0);
assert.equal(`${leakageResult.stdout}${leakageResult.stderr}`.includes('llp0062-linux-planted-value'), false);

const intermediate = await writeCase('intermediate.ts', `
const rows = Array.from({ length: 500 }, (_, index) => ({
  plantedSecret: \`sentinel-\${index}-must-not-leak\`,
  nested: { token: \`token-\${index}\` },
}));
console.log('intermediate-created');
export default { count: rows.length };
`);
const intermediateResult = await run(['run', intermediate]);
expectExit('intermediate-value-nondisclosure', intermediateResult, 0);
assert.equal(`${intermediateResult.stdout}${intermediateResult.stderr}`.includes('sentinel-'), false);
assert.equal(`${intermediateResult.stdout}${intermediateResult.stderr}`.includes('token-'), false);

const orphan = await writeCase('orphan-timer.ts', `
setTimeout(() => console.log('must-not-fire'), 1800000);
export default { done: true };
`);
expectExit('orphan-timer', await run(['run', orphan]), 0);

const noDefault = await writeCase('no-default.ts', 'const internal: number = 42; void internal;\n');
const noDefaultResult = await run(['run', noDefault]);
expectExit('no-default', noDefaultResult, 0);
assert.equal(noDefaultResult.stdout, '');

for (const [name, source] of [
  ['static-import', "import value from './forbidden.js'; export default value;"],
  ['dynamic-import', "export default await import('./forbidden.js');"],
  ['enum', 'enum Color { Red, Blue } export default Color.Red;'],
  ['namespace', 'namespace Internal { export const value = 1; } export default Internal.value;'],
  ['parameter-property', 'class Example { constructor(public value: number) {} } export default new Example(1).value;'],
]) {
  const path = await writeCase(`${name}.ts`, `${source}\n`);
  expectExit(name, await run(['run', path]), 2);
}

const strict = await writeCase('strict.ts', 'export default -0;\n');
expectExit('strict-result', await run(['run', strict]), 10);

const overflow = await writeCase('overflow.ts', "export default 'x'.repeat(2048);\n");
expectExit('output-ceiling', await run(['run', overflow, '--max-output-bytes', '1024']), 11);

const maxCalls = await writeCase('max-calls.ts', `
await api.listNotes({});
await api.listNotes({});
export default true;
`);
expectExit('call-ceiling', await run([...session, 'run', maxCalls, '--max-calls', '1']), 11);

const timeoutCase = await writeCase('timeout.ts', `
setTimeout(() => console.log('existing-timer-fired'), 40);
signal.addEventListener('abort', async () => {
  try { await api.listNotes({ planted: 'grace-call-must-not-cross' }); }
  catch { console.log('timeout-cleanup-observed'); }
  try { setTimeout(() => {}, 1); }
  catch { console.log('new-timer-refused'); }
});
await new Promise(() => {});
export default 1;
`);
const timeoutResult = await run(['run', timeoutCase, '--timeout-ms', '80', '--grace-ms', '200']);
expectExit('timeout', timeoutResult, 9);
for (const marker of ['existing-timer-fired', 'timeout-cleanup-observed', 'new-timer-refused']) {
  assert.match(timeoutResult.stderr, new RegExp(marker, 'u'));
}

const signalResult = await run([...session, 'run', timeoutCase, '--timeout-ms', '30000', '--grace-ms', '250'], {
  signalAfterMs: 1000,
});
expectExit('sigterm', signalResult, 143);
for (const marker of ['existing-timer-fired', 'timeout-cleanup-observed', 'new-timer-refused']) {
  assert.match(signalResult.stderr, new RegExp(marker, 'u'));
}

const stdinResult = await run(['run', '-'], { input: 'export default {stdin:true};\n' });
expectExit('stdin', stdinResult, 0);
assert.deepEqual(JSON.parse(stdinResult.stdout), { stdin: true });

const info = await run(['--ibex-info']);
expectExit('ibex-info', info, 0);
assert.equal(JSON.parse(info.stdout).appBound.availability, 'enabled-and-advertised');

const relocated = join(scratch, 'relocated');
await mkdir(relocated);
const relocatedExecutable = join(relocated, basename(executable));
await copyFile(executable, relocatedExecutable);
await chmod(relocatedExecutable, 0o755);
const offlineChild = spawn(relocatedExecutable, ['--offline', 'introspect'], {
  cwd: relocated,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
const offlineStdout = [];
const offlineStderr = [];
offlineChild.stdout.on('data', (chunk) => offlineStdout.push(chunk));
offlineChild.stderr.on('data', (chunk) => offlineStderr.push(chunk));
const offlineCode = await new Promise((resolve, reject) => {
  offlineChild.on('error', reject);
  offlineChild.on('close', resolve);
});
assert.equal(offlineCode, 0, Buffer.concat(offlineStderr).toString('utf8'));
const offlineInspection = JSON.parse(Buffer.concat(offlineStdout).toString('utf8'));
assert.equal(
  offlineInspection.sections.static.items.find((item) => item.kind === 'artifact-identity')?.value?.appId,
  'app',
);
outcomes['offline-relocation'] = offlineCode;

await mkdir(receiptDir, { recursive: true });
await writeFile(join(receiptDir, 'final-artifact-outcomes.json'), `${JSON.stringify({
  schema: 'snapback/app-bound-final-artifact-outcomes/1',
  result: 'pass',
  outcomes,
}, null, 2)}\n`);
console.log(`app-bound final-artifact acceptance passed (${Object.keys(outcomes).length} cases)`);
