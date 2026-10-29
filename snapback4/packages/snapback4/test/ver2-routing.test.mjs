// @ref LLP 3000.037.000#18-one-proof-path-and-session-reuse-ver2 — wave34r4 direct proofs then verify, and one polled command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
async function waitFor(predicate) { const end = Date.now() + 10000; while (!predicate()) { if (Date.now() >= end) throw Error('fixture did not reach phase'); await new Promise(r => setTimeout(r, 10)); } }
const templates = resolve(import.meta.dirname, '../../../crates/snapback4/src/verbs/init');
// Represents the persistent builder above its successive exec shells, as in
// the archived lanes. Every child still has its own genuine npm invocation.
process.title = 'muse-bin-1.4.14-R7309.1';
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ver2 space-'));
  const evidence = mkdtempSync(join(tmpdir(), 'ver2-counts-'));
  t.after(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(evidence, { recursive: true, force: true }); });
  mkdirSync(join(cwd, 'scripts')); mkdirSync(join(cwd, 'src'));
  for (const name of ['verify.mjs', 'verify-parent.mjs', 'verify-cache.mjs']) copyFileSync(join(templates, name), join(cwd, 'scripts', name));
  writeFileSync(join(cwd, 'src/App.tsx'), 'original app');
  writeFileSync(join(cwd, 'scripts/phase.mjs'), `import{appendFileSync,existsSync}from'node:fs';const phase=process.argv[2];appendFileSync(process.env.VER2_COUNTS,phase+'\\n');if(process.env.VER2_SLOW)await new Promise(r=>setTimeout(r,Number(process.env.VER2_SLOW)));if(existsSync(process.env.VER2_FAIL)&&phase==='acceptance'){console.log('proof refusal: operation approve; E_INPUT');console.log('likely fix: supply reason');process.exit(17);}`);
  const scripts = Object.fromEntries(['check', 'acceptance', 'frontend:proof', 'probe:check'].map(phase => [phase, `node scripts/phase.mjs ${phase}`]));
  scripts.verify = 'node scripts/verify.mjs';
  for (const phase of ['acceptance', 'frontend:proof']) for (const [prefix, mode] of [['pre', 'before'], ['post', 'after']]) scripts[prefix + phase] = `node scripts/verify-cache.mjs ${mode} ${phase}`;
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ private: true, scripts }));
  const env = { ...process.env, VER2_COUNTS: join(evidence, 'counts'), VER2_FAIL: join(evidence, 'fail') };
  const run = (phase, more = {}) => new Promise((done, reject) => {
    const child = spawn('npm', ['run', '--silent', phase], { cwd, env: { ...env, ...more }, stdio: 'pipe' });
    let out = ''; const chunks = []; const start = Date.now();
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { out += b; chunks.push({ ms: Date.now() - start, text: String(b) }); });
    child.once('error', reject); child.once('close', code => done({ code, out, chunks, ms: Date.now() - start }));
  });
  const counts = () => readFileSync(env.VER2_COUNTS, 'utf8').trim().split('\n');
  return { cwd, env, run, counts };
}
test('Muse lane: direct authored acceptance/frontend then verify executes each proof once', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  for (const phase of ['acceptance', 'frontend:proof', 'verify']) { const r = await f.run(phase); assert.equal(r.code, 0, r.out); if (phase === 'verify') { assert.match(r.out, /acceptance \(reused\), frontend:proof \(reused\)/); assert.equal(r.out.trim().split('\n').length, 3); } }
  assert.deepEqual(f.counts(), ['acceptance', 'frontend:proof', 'check', 'probe:check']);
  // An authored edit, including a file that was never in git, invalidates both.
  writeFileSync(join(f.cwd, 'src/new.ts'), 'changed');
  const r = await f.run('verify'); assert.equal(r.code, 0, r.out); assert.doesNotMatch(r.out, /reused/);
  assert.deepEqual(f.counts().slice(4), ['check', 'acceptance', 'frontend:proof', 'probe:check']);
});
test('failed direct run cannot reuse an earlier passing phase; first red keeps refusal and rerun command', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t); assert.equal((await f.run('acceptance')).code, 0);
  writeFileSync(f.env.VER2_FAIL, 'fail'); assert.equal((await f.run('acceptance')).code, 17);
  const r = await f.run('verify'); assert.equal(r.code, 17, r.out);
  assert.ok(r.out.startsWith('proof refusal:'), r.out); assert.match(r.out, /likely fix:/); assert.match(r.out, /rerun: npm run acceptance/);
  assert.ok(r.out.trim().split('\n').length <= 9); assert.deepEqual(f.counts(), ['acceptance', 'acceptance', 'check', 'acceptance']);
});
test('source mutation during proof, changed environment, corrupt receipt and symlink all miss conservatively', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  const command = f.run('acceptance', { VER2_SLOW: '400' });
  await waitFor(() => { try { return f.counts().includes('acceptance'); } catch { return false; } });
  writeFileSync(join(f.cwd, 'src/App.tsx'), 'edited during proof');
  writeFileSync(join(f.cwd, 'src/App.tsx'), 'original app'); // restored bytes still invalidate
  await command;
  assert.equal((await f.run('verify', { VER2_SLOW: '400' })).code, 0);
  assert.equal(f.counts().filter(p => p === 'acceptance').length, 2);
  const changed = await f.run('verify', { BUSINESS_MODE: 'changed' }); assert.doesNotMatch(changed.out, /reused/);
  writeFileSync(join(f.cwd, '.snapback4/verify-cache/acceptance.json'), '{bad');
  const corrupt = await f.run('verify', { BUSINESS_MODE: 'changed' }); assert.match(corrupt.out, /frontend:proof \(reused\)/); assert.doesNotMatch(corrupt.out, /acceptance \(reused\)/);
  symlinkSync('App.tsx', join(f.cwd, 'src/link.ts'));
  assert.doesNotMatch((await f.run('verify', { BUSINESS_MODE: 'changed' })).out, /reused/);
});
test('Codex lane: one verify command supplies progress to 1s exec plus 5s completion polls', { timeout: 60000 }, async t => {
  const f = fixture(t); const r = await f.run('verify', { VER2_SLOW: '2600' });
  assert.equal(r.code, 0, r.out);
  // Fast phases require no heartbeat; the terminal summary is still bounded.
  assert.equal(r.out.trim().split('\n').length, 3);
  const slow = await f.run('verify', { VER2_SLOW: '5300' }); assert.equal(slow.code, 0, slow.out);
  assert.equal(slow.chunks.filter(c => c.text.includes('verify: running')).length, 4);
  const progress = slow.chunks.filter(c => c.text.includes('verify: running')).map(c => c.ms);
  assert.ok(progress[0] < 6500, JSON.stringify(progress));
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] - progress[i - 1] < 6500, JSON.stringify(progress));
  assert.equal(slow.out.trim().split('\n').slice(-3).length, 3);
  t.diagnostic(JSON.stringify({ lane: 'codex', issuingCalls: 1, completionPollsAt1Then5Seconds: Math.ceil((slow.ms - 1000) / 5000), elapsedMs: slow.ms, progressMs: progress }));
});
test('reuse is bound to the live builder incarnation and dependency edits', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  // This separate builder exits after its direct proof. The parent builder
  // must not inherit the receipt, even though the app bytes are identical.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `process.title='codex';const{spawnSync}=await import('node:child_process');process.exitCode=spawnSync('npm',['run','--silent','acceptance'],{stdio:'inherit'}).status;`], { cwd: f.cwd, env: f.env, stdio: 'ignore' });
  assert.equal(await new Promise(r => child.once('exit', r)), 0);
  assert.doesNotMatch((await f.run('verify')).out, /reused/);
  mkdirSync(join(f.cwd, 'node_modules')); writeFileSync(join(f.cwd, 'node_modules/dependency.js'), 'version 1');
  assert.equal((await f.run('acceptance')).code, 0);
  writeFileSync(join(f.cwd, 'node_modules/dependency.js'), 'version 2');
  assert.doesNotMatch((await f.run('verify')).out, /reused/);
});
test('extra direct arguments do not certify the ordinary phase', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);
  const child = spawn('npm', ['run', '--silent', 'acceptance', '--', 'different-scenario'], { cwd: f.cwd, env: f.env, stdio: 'ignore' });
  assert.equal(await new Promise(r => child.once('exit', r)), 0);
  assert.doesNotMatch((await f.run('verify')).out, /reused/);
});
test('parent death during cache hashing cannot admit the next phase', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const f = fixture(t);
  const outer = join(f.cwd, 'outer.mjs'), patch = join(f.cwd, 'scan-patch.mjs');
  writeFileSync(patch, `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const read=fs.readFileSync;fs.readFileSync=(p,...args)=>{const value=read(p,...args);if(p==='src/App.tsx')process.kill(Number(process.env.VER2_OUTER),'SIGKILL');return value;};syncBuiltinESMExports();`);
  writeFileSync(outer, `import{spawn}from'node:child_process';spawn(process.execPath,['--import',${JSON.stringify(patch)},'scripts/verify.mjs'],{env:{...process.env,VER2_OUTER:String(process.pid)},stdio:'ignore'});`);
  const child = spawn(process.execPath, [outer], { cwd: f.cwd, env: f.env, stdio: 'ignore' });
  assert.equal(await new Promise(r => child.once('exit', (_code, signal) => r(signal))), 'SIGKILL');
  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(f.counts(), ['check']);
});
