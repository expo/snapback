// @ref LLP 3000.037.000#17-one-day-two-release-recipe-dx17 — run authored proofs once in one ordered check, with private complete evidence.
import { readFileSync, rmSync, mkdtempSync, mkdirSync, lstatSync, chmodSync, openSync, writeFileSync, closeSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { command } from '../dist/proof.js';
import { serveCheck } from '../dist/proof-serve-check.js';
import { synopsis } from './cli-usage.js';

// serveCheck.ready is a boolean, not its private readiness payload. Keep the
// persisted receipt explicit so future additions cannot publish that payload.
const safeReceipt = r => ({ ok: r.ok, script: r.script, failures: r.failures,
  ready: r.ready === true, upMs: r.upMs, lockReleased: r.lockReleased,
  ...(r.commandCode === undefined ? {} : { commandCode: r.commandCode }) });

export async function day2Check(args) {
  if (args.includes('--help')) { console.log(`usage: ${synopsis('day2-check')}`); return 0; }
  const options = { deployment: './deploy', timeoutMs: 1_800_000, upMs: 30_000 };
  const presentation = new Set(['--explain', '--verbose', '--json']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (presentation.has(arg)) continue;
    const key = { '--deployment': 'deployment', '--timeout-ms': 'timeoutMs', '--up-ms': 'upMs' }[arg];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`unknown/missing day2-check option: ${arg}; see --help`);
    options[key] = key === 'deployment' ? args[++i] : Number(args[++i]);
  }
  for (const key of ['timeoutMs', 'upMs']) if (!Number.isFinite(options[key]) || options[key] < 1) throw Error(`${key} must be positive and finite`);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const required = ['check', 'acceptance', 'frontend:proof', 'day2:proof', 'day2:rollback', 'day2:forward', 'prod:serve', 'probe:serve', 'client:calls'];
  const missing = required.filter(name => typeof pkg.scripts?.[name] !== 'string' || !pkg.scripts[name].trim());
  if (missing.length) throw Error(`missing npm scripts: ${missing.join(', ')}; follow snapback4 guide day2`);
  const frozen = JSON.parse(readFileSync('v1/package.json', 'utf8'));
  if (!frozen.scripts?.['client:calls']) throw Error('missing frozen v1 client:calls; capture day one before editing');
  if (frozen.scripts['client:calls'].includes('frozen-run.mjs') && !frozen.scripts['client:calls:frozen']) throw Error('v1 capture has no day-one business client; restore the historical caller before a release drill');
  const directory = '.snapback4/last';
  for (const dir of ['.snapback4', directory]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error('day2-check details require a real directory');
    chmodSync(dir, 0o700);
  }
  const report = { ok: false, phases: [], failed: null, note: 'Authored business assertions decide coverage; this check is not a publication or full-row compatibility certificate.' };
  const started = Date.now();
  const runLogs = join(directory, `day2-check-${randomUUID()}`);
  let commandNumber = 0;
  let code = 0, failureOutput = '';
  async function runCommand(binary, args, settings) {
    const logsDirectory = join(runLogs, String(++commandNumber));
    try { return await command(binary, args, { ...settings, logsDir: logsDirectory }); }
    catch (error) { throw Object.assign(error, { logsDirectory, message: `${error.message}; logs: ${logsDirectory}` }); }
  }
  async function phase(name, work) {
    const began = Date.now();
    let result;
    try { result = await work(); }
    catch (error) { result = { code: error.code ?? 1, stderr: [String(error), ...(error.report?.failures ?? []).map(f => `${f.code}: ${f.message}`)].join('\n'), ...(error.report ? { receipt: safeReceipt(error.report) } : {}), ...(error.logs ? { logs: error.logs } : {}), ...(error.logsDirectory ? { logsDirectory: error.logsDirectory } : {}) }; }
    // A signalled npm child has code:null. It must stop the loop too.
    result = { ...result, code: Number.isInteger(result.code) && result.code >= 0 ? result.code : 1 };
    report.phases.push({ name, ...result, elapsedMs: Date.now() - began });
    if (result.code !== 0) {
      report.failed = name; code = result.code;
      failureOutput = [result.stderr, result.stdout].filter(Boolean).join('\n');
      return false;
    }
    return true;
  }
  const npm = (name, prefix) => runCommand('npm', [...(prefix ? ['--prefix', prefix] : []), 'run', '--silent', name], {
    timeoutMs: options.timeoutMs, processGroup: true,
  });
  async function serve(script, currentClient) {
    let active;
    try {
    const receipt = await serveCheck({ deployment: options.deployment, script, upMs: script === 'probe:serve' ? options.upMs : 1,
      // Each client gets its own deadline plus the helper's bounded cleanup.
      timeoutMs: options.timeoutMs, thenTimeoutMs: options.timeoutMs * (currentClient ? 3 : 1) + 45_000,
      then: (ready, signal) => active = (async () => {
        const users = ready.users ?? ready.accounts ?? ready.sessions;
        if (typeof ready.backendUrl !== 'string' || !users || typeof users !== 'object' || Array.isArray(users)
          || !Object.keys(users).length || Object.values(users).some(accounts => !Array.isArray(accounts) || accounts.length < 2
            || accounts.some(account => !account || typeof account !== 'object' || Array.isArray(account)))) throw Error('readiness needs backendUrl and at least two real account objects per role');
        // Legacy clients take a file; credentials never enter this report.
        const temporary = mkdtempSync(join(tmpdir(), 'snapback4-day2-users-'));
        try {
        const path = join(temporary, 'users.json');
        writeFileSync(path, JSON.stringify(users), { mode: 0o600, flag: 'wx' });
        const env = { ...process.env, BACKEND_URL: ready.backendUrl, CALLS_USERS: path };
        // Match the harness: two v2 callers after the first forward, before
        // the second rollback measures their rows through the frozen client.
        for (const prefix of currentClient ? ['v1', null, null] : ['v1']) {
          signal.throwIfAborted();
          const result = await runCommand('npm', [...(prefix ? ['--prefix', prefix] : []), 'run', '--silent', 'client:calls'], {
            env, timeoutMs: options.timeoutMs, processGroup: true, secret: true,
          });
          if (result.code !== 0) throw Object.assign(Error(`${prefix ?? 'v2'} client:calls failed (exit ${result.code}); stderr: ${result.logs.stderr}; inspect authored call assertions`), { code: result.code ?? 1, logs: result.logs });
        } } finally { rmSync(temporary, { recursive: true, force: true }); }
      })(),
    });
    return { code: receipt.ok ? 0 : receipt.commandCode || 1, receipt: safeReceipt(receipt), stderr: receipt.failures.map(f => `${f.code}: ${f.message}`).join('\n') };
    } finally {
      // serveCheck aborts a timed-out callback; independently owned client groups
      // must finish their bounded cleanup before we report or admit another phase.
      await active?.catch(() => {});
    }
  }
  // These are the harness's repeat requirements, not a cache of earlier greens.
  const steps = [['check', 1], ['acceptance', 2], ['frontend:proof', 2], ['day2:proof', 2]];
  outer: for (const [name, count] of steps) for (let run = 1; run <= count; run++) {
    if (name === 'frontend:proof') rmSync('dist', { recursive: true, force: true });
    if (name === 'day2:proof') rmSync('day2-proof.json', { force: true });
    if (!await phase(`${name} ${run}/${count}`, async () => {
      const result = await npm(name);
      if (name === 'day2:proof' && result.code === 0) {
        try {
          const proof = JSON.parse(readFileSync('day2-proof.json', 'utf8'));
          if (proof.ok !== true) throw Error('ok is not true');
        } catch {
          return { ...result, code: 1, stderr: result.stderr + '\nError: day2:proof must persist day2-proof.json with {ok:true} after its production assertions; see snapback4 guide day2. The temporary scaffold does not satisfy this contract.' };
        }
      }
      return result;
    })) break outer;
  }
  if (!code) for (let cycle = 1; cycle <= 2; cycle++) {
    for (const direction of ['rollback', 'forward']) {
      if (!await phase(`day2:${direction} ${cycle}/2`, () => npm(`day2:${direction}`))) break;
      const currentClient = direction === 'forward' && cycle === 1;
      if (!await phase(`prod:serve + ${currentClient ? 'v1/v2' : 'v1'} calls ${cycle}/2`, () => serve('prod:serve', currentClient))) break;
    }
    if (code) break;
  }
  if (!code) await phase('probe:serve + frozen v1 calls', () => serve('probe:serve', false));
  report.ok = code === 0; report.elapsedMs = Date.now() - started;
  const path = join(directory, 'day2-check.json'), temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); } finally { closeSync(fd); }
    renameSync(temp, path);
  } catch (error) {
    console.log(JSON.stringify(report));
    console.error(`day2-check: details unavailable: ${error.message}; complete report shown`);
    return code;
  }
  if (args.includes('--json')) console.log(JSON.stringify(report));
  else if (args.includes('--explain') || args.includes('--verbose')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`day2-check: ${report.ok ? 'passed' : `FAIL ${report.failed}; exit ${code}`}; ${report.phases.filter(p => p.code === 0).length}/16 phases; ${report.elapsedMs}ms`);
    if (code) console.log(failureOutput.split('\n').filter(line => /Error|E_[A-Z_]+|error TS\d|proof refusal|likely fix:|failed/i.test(line)).slice(0, 6).map(line => line.slice(0, 500)).join('\n') || 'Inspect the failed phase in the private report.');
    console.log(`details: ${path} (read without rerunning); --explain/--json rerun checks with full output`);
  }
  return code;
}
