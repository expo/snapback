import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import { cleanup, withCleanup } from './helpers/cleanup.mjs';
import { identity, live } from '../../../scripts/test-processes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
const { runWorker } = await import(process.env.SNAPBACK4_TEST_WORKER ?? '../dist/worker.js');
const { WorkerLedger } = await import(process.env.SNAPBACK4_TEST_WORKER_LEDGER ?? '../dist/worker-ledger.js');

const binary = process.env.SNAPBACK4_BIN ?? fileURLToPath(new URL('../../../target/debug/snapback4', import.meta.url));
const workerModule = new URL('../dist/worker.js', import.meta.url).href;
const fixtureDiagnostics = new AsyncLocalStorage();
async function until(fn) { return awaitState(fn, fn.toString(), { diagnostics: () => fixtureDiagnostics.getStore()?.() ?? 'no worker fixture' }); }
async function lockWriter(db) {
  // A worker marker or HTTP reply does not release another SQLite writer.
  // Establish the fixture's lock before testing the host's refusal/recovery.
  await until(() => {
    try { db.exec('BEGIN IMMEDIATE'); return true; }
    catch (error) { if (error.errcode === 5) return false; throw error; }
  });
}
async function fixtureDdl(db, sql) {
  // Status writes and credential retirement can still own SQLite after HTTP
  // replies. Acquire our fixture's writer before installing/removing its fault.
  await lockWriter(db);
  try { db.exec(sql); db.exec('COMMIT'); }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
function rows(path) { try { return readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } }
function alive(pid) {
  try {
    process.kill(pid, 0);
    // Orphans can remain zombies until the container's init reaps them.
    if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch { return false; }
}
function fixture(t, source, cleanupChildren) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-worker-regression-'));
  mkdirSync(join(dir, 'snapback/workers'), { recursive: true });
  writeFileSync(join(dir, 'snapback/schema.q'), "use personas alice\neffect notify\nmutation send():\n  emit notify { message: 'hello' }\n  return true\n");
  if (source) writeFileSync(join(dir, 'snapback/workers/push.mjs'), source);
  const servers = [];
  const diagnostics = () => {
    const report = servers.map(s => {
      let statuses;
      try {
        const db = new DatabaseSync(s.mode === 'serve' ? join(dir, 'release/store.sqlite') : join(s.workdir, '.snapback4/store.sqlite'), { readOnly: true });
        try { statuses = db.prepare("SELECT key, value FROM _meta WHERE key LIKE 'worker:status%'").all(); }
        finally { db.close(); }
      } catch (error) { statuses = String(error); }
      return { pid: s.child.pid, exitCode: s.child.exitCode, signalCode: s.child.signalCode, url: s.url,
        statuses, starts: rows(join(s.workdir, 'starts')).map(({ pid, helper, name }) => ({ pid, helper, name, alive: alive(pid) })),
        log: s.log.slice(-32768) };
    });
    return `WORKER_FIXTURE ${JSON.stringify({ dir, badNode: existsSync(join(dir, 'bad-node')), servers: report })}`;
  };
  fixtureDiagnostics.enterWith(diagnostics);
  const onAbort = () => t.diagnostic(diagnostics());
  t.signal.addEventListener('abort', onAbort, { once: true });
  t.after(async () => {
    t.signal.removeEventListener('abort', onAbort);
    try {
      for (const s of servers) {
        const timer = setTimeout(() => { if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGKILL'); }, 5000);
        try {
          if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGTERM');
          await cleanup(() => s.done, `worker server ${s.child.pid}`, diagnostics, [s.child]);
        } finally { clearTimeout(timer); }
      }
      if (cleanupChildren) await cleanupChildren();
      else for (const workdir of new Set([dir, ...servers.map(s => s.workdir)]))
        for (const row of rows(join(workdir, 'starts'))) for (const pid of [row.pid, row.helper]) if (pid && alive(pid)) {
          // The owned descendant can exit between the liveness check and signal.
          try { process.kill(pid, 'SIGKILL'); }
          catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
    } finally {
      // A failed join must still release every owned host and its watchdog pipe.
      for (const { child } of servers) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return { dir, get listening() { return servers.at(-1)?.url; }, async start(extra = [], env = {}, watch = false, mode = "dev", project = dir) {
    const release = join(dir, 'release');
    if (mode === 'serve' && !existsSync(release)) { const deploy = spawnSync(binary, ['deploy', release], {cwd:dir,encoding:'utf8'}); assert.equal(deploy.status, 0, deploy.stderr); }
    const child = spawn(binary, mode === 'serve' ? ['serve', release, '--port', '0', ...extra] : ['dev', '--port', '0', ...(watch ? [] : ['--no-watch']), ...extra], { cwd: project, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { child, done: once(child, 'exit'), log: '', url: '', events: [], mode, diagnostics, workdir: mode === 'serve' ? join(release, 'releases/1') : project };
    servers.push(s);
    child.stderr.on('data', b => { s.log += b; s.events.push({ at: performance.now(), text: String(b) }); });
    let output = '';
    child.stdout.on('data', b => { output += b; s.url ||= output.match(/http:\/\/127\.0\.0\.1:\d+\r?\n/)?.[0].trim() ?? ''; });
    await until(() => { assert.equal(child.exitCode, null, diagnostics()); return s.url; });
    // @ref LLP 3000#publication-suite-under-contention — serving HTTP is the
    // startup barrier. The URL precedes initial named-worker admission. An edit
    // made there can enter startup admission and terminate the host instead of
    // exercising Supervisor's pending-declaration retry. Serving HTTP proves
    // Supervisor::start has returned and the intended edit path owns the test.
    try {
      const response = await fetch(s.url + '/auth/config', { signal: AbortSignal.any([t.signal, AbortSignal.timeout(hangBudget())]) });
      assert.equal(response.status, 200); await response.json();
    } catch (error) { throw new Error(`WORKER_FIXTURE_READY: ${error.message}\n${diagnostics()}`, { cause: error }); }
    return s;
  } };
}
const idle = `import { appendFileSync } from 'node:fs';
appendFileSync('starts', JSON.stringify({pid:process.pid,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:process.env.SNAPBACK_WORKER_LEDGER})+'\\n');
setInterval(()=>{},1000);`;
async function claim(s, token) {
  return fetch(s.url + '/effects/claim', { method: 'POST', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: '{"wait":0}' });
}

for (const mode of ['dev', 'serve']) test(`${mode} immediate host restart waits for the previous worker group and excludes ownership from Node`, async t => {
  const f = fixture(t, `import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {appendFileSync,readFileSync,readdirSync,readlinkSync} from 'node:fs';
${alive.toString()}
process.on('SIGTERM',()=>{});
const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
await once(helper.stdout,'data');
let previous=[];try {previous=readFileSync('starts','utf8').trim().split('\\n').map(JSON.parse);}catch{}
const overlap=previous.flatMap(row=>[row.pid,row.helper]).filter(alive);
const ownerDescriptors=process.platform==='linux' ? readdirSync('/proc/self/fd').filter(fd=>{try{return readlinkSync('/proc/self/fd/'+fd).endsWith('store.sqlite-owner');}catch{return false;}}) : [];
appendFileSync('starts',JSON.stringify({pid:process.pid,helper:helper.pid,token:process.env.SNAPBACK_SERVICE_TOKEN,overlap,ownerDescriptors})+'\\n');
setInterval(()=>{},1000);`);
  const first = await f.start([], {}, false, mode);
  const starts = join(first.workdir, 'starts');
  await until(() => rows(starts).length === 1);
  const old = rows(starts)[0];
  first.child.kill('SIGKILL'); await first.done;
  const next = await f.start([], {}, false, mode);
  await until(() => rows(starts).length === 2);
  const replacement = rows(starts)[1];
  assert.deepEqual(replacement.overlap, [], 'replacement must not start during the previous group cleanup');
  assert.equal(alive(old.pid), false); assert.equal(alive(old.helper), false);
  for (const row of [old, replacement]) assert.deepEqual(row.ownerDescriptors, [], 'only the watchdog may inherit store ownership');
  assert.equal((await claim(next, old.token)).status, 401, 'startup still retires the original credential');
  assert.equal((await claim(next, replacement.token)).status, 200);
});

for (const [mode, entry] of [['dev','workers/push.mjs'], ['serve','workers/push.mjs'], ['dev','worker.mjs']]) test(`${mode} ${entry} snapshot does not add the temporary directory to package lookup`, async t => {
  const f = fixture(t);
  const temporary = join(f.dir, 'unrelated-temporary');
  const packageDir = join(temporary, 'node_modules/wk-parent-only');
  mkdirSync(packageDir, {recursive:true});
  writeFileSync(join(packageDir, 'package.json'), '{"name":"wk-parent-only","type":"module","exports":"./index.js"}');
  writeFileSync(join(packageDir, 'index.js'), 'export default "from-temporary-parent";');
  writeFileSync(join(f.dir, 'snapback', entry), `import {writeFileSync,renameSync} from 'node:fs';
const result=await import('wk-parent-only').then(m=>m.default,error=>error.code);
// Publish only complete bytes to the parent's existence barrier.
writeFileSync('package-lookup.tmp',JSON.stringify(result));renameSync('package-lookup.tmp','package-lookup');setInterval(()=>{},1000);`);
  const s = await f.start([], {TMPDIR:temporary}, false, mode);
  await until(() => existsSync(join(s.workdir,'package-lookup')));
  assert.equal(JSON.parse(readFileSync(join(s.workdir,'package-lookup'),'utf8')), 'ERR_MODULE_NOT_FOUND');
});

for (const scope of ['snapback', 'project', 'ancestor']) test(`named snapshot refuses a symlinked ${scope} package manifest`, async t => {
  const f = fixture(t, idle);
  const outside = join(f.dir,'outside-package.json');
  writeFileSync(outside, '{"type":"module","imports":{"#helper":"./outside.mjs"}}');
  let project = f.dir, manifest = join(f.dir,scope==='snapback'?'snapback':'','package.json');
  if (scope === 'ancestor') {
    project=join(f.dir,'nested'); mkdirSync(join(project,'snapback/workers'),{recursive:true});
    writeFileSync(join(project,'snapback/schema.q'),'query who():\n  return viewer\n');
    writeFileSync(join(project,'snapback/workers/push.mjs'),idle);
  }
  symlinkSync(outside,manifest);
  const server = await f.start([], {}, false, 'dev', project);
  const refusal = /workers:.*(symbolic|symlink|regular|loop)/i;
  await until(() => { assert.equal(server.child.exitCode, null, server.log); return refusal.test(server.log); });
  assert.match(server.log, refusal);
  assert.equal(existsSync(join(project,'starts')),false);
  server.child.kill('SIGTERM');
  await cleanup(() => server.done, 'refused worker host', server.diagnostics, [server.child]);
  assert.equal(existsSync(join(project,'starts')),false, 'refused source never starts, including during shutdown');
});

for (const mode of ['dev','serve']) test(`${mode} startup clears a removed worker's stale running status after host death`, async t => {
  const f = fixture(t,idle), first = await f.start([],{},false,mode);
  await until(()=>rows(join(first.workdir,'starts')).length===1);
  const doctor = () => spawnSync(binary,['doctor',...(mode==='serve'?['--release',join(f.dir,'release')]:[])],{cwd:f.dir,encoding:'utf8'});
  await until(()=>doctor().stdout.includes('"state":"running"'));
  first.child.kill('SIGKILL'); await first.done;
  rmSync(join(first.workdir,'snapback/workers/push.mjs'));
  await f.start([],{},false,mode);
  const report=doctor(); assert.equal(report.status,0,report.stderr);
  assert.doesNotMatch(report.stdout,/worker\s+last report:/);
});

for (const entry of ['workers/push.mjs', 'worker.mjs']) test(`supervised ${entry} refuses refresh without logging a bearer across split writes`, async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'snapback', entry), `import {writeFileSync} from 'node:fs';
const token = process.env.SNAPBACK_SERVICE_TOKEN;
const response = await fetch(process.env.SNAPBACK_URL+'/auth/refresh', {method:'POST',headers:{authorization:'Bearer '+token},body:'{}'});
const text = await response.text();
console.log('refresh-whole:'+text);
const split = text.includes('"token":"') ? text.indexOf('"token":"')+18 : Math.floor(text.length/2);
process.stderr.write('refresh-split:'+text.slice(0,split));
await new Promise(resolve=>setTimeout(resolve,50));
process.stderr.write(text.slice(split)+'\\n');
writeFileSync('refresh-result',JSON.stringify({token,status:response.status,reply:JSON.parse(text)}));
console.error('refresh-logged');setInterval(()=>{},1000);`);
  const s = await f.start();
  await until(() => existsSync(join(f.dir, 'refresh-result')) && s.log.includes('refresh-logged'));
  const {token, status, reply} = JSON.parse(readFileSync(join(f.dir, 'refresh-result'), 'utf8'));
  // stdout and stderr have independent readers; stderr's marker cannot
  // acknowledge the earlier stdout record, including its secrecy checks.
  await until(() => ['refresh-whole:', 'refresh-split:'].every(prefix =>
    s.log.split('\n').slice(0, -1).some(line => line.includes(prefix))));
  assert.equal(s.log.includes(token), false, 'initial bearer is absent from logs');
  if (reply.session) assert.equal(s.log.includes(reply.session.token), false, 'refresh must not leak a successor bearer');
  assert.equal(status, 403);
  assert.equal(reply.denied.code, 'E_WORKER_REFRESH');
  assert.equal(reply.denied.guide, 'effects');
  assert.equal(reply.session, undefined);
  for (const prefix of ['refresh-whole:', 'refresh-split:']) assert.ok(s.log.includes(prefix+JSON.stringify(reply)), s.log);
  assert.equal((await claim(s, token)).status, 200, 'refusal leaves the supervisor-owned bearer live');
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'), {readOnly:true});
  try { assert.equal(db.prepare("SELECT count(*) n FROM _sessions WHERE kind='service'").get().n, 1); }
  finally { db.close(); }
  const minted = spawnSync(binary, ['token', '--service', entry.startsWith('workers/') ? 'push' : 'worker'], {cwd:f.dir,encoding:'utf8'});
  assert.equal(minted.status, 0, minted.stderr);
  const manual = minted.stdout.trim();
  const refreshed = await fetch(s.url+'/auth/refresh', {method:'POST',headers:{authorization:'Bearer '+manual},body:'{}'});
  const successor = await refreshed.json();
  assert.equal(refreshed.status, 200);
  assert.ok(successor.session?.token, JSON.stringify(successor));
  assert.equal((await claim(s, manual)).status, 401);
  assert.equal((await claim(s, successor.session.token)).status, 200);
});

for (const mode of ['dev', 'serve']) for (const shadowed of [false, true]) test(`${mode} private worker snapshot resolves schema-local packages${shadowed ? ' before project packages' : ''}`, async t => {
  const f = fixture(t, `import local from 'schema-package';import {helper} from './helpers/value.mjs';
import {writeFileSync,renameSync} from 'node:fs';
const values={local,helper};
if(process.env.SNAPBACK_SERVICE_TOKEN){writeFileSync('package-result.tmp',JSON.stringify(values));renameSync('package-result.tmp','package-result');setInterval(()=>{},1000);}
else console.log(JSON.stringify(values));`);
  mkdirSync(join(f.dir, 'snapback/workers/helpers'));
  writeFileSync(join(f.dir, 'snapback/workers/helpers/value.mjs'), "import value from 'schema-package';export const helper=value;");
  for (const [scope, value] of [['snapback', 'schema'], ...(shadowed ? [['', 'project']] : [])]) {
    const dir = join(f.dir, scope, 'node_modules/schema-package');
    mkdirSync(dir, {recursive:true});
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name:'schema-package',type:'module',exports:'./index.js'}));
    writeFileSync(join(dir, 'index.js'), `export default ${JSON.stringify(value)};`);
  }
  const direct = spawnSync(process.execPath, ['snapback/workers/push.mjs'], {cwd:f.dir,encoding:'utf8'});
  assert.equal(direct.status, 0, direct.stderr);
  const expected = JSON.parse(direct.stdout);
  assert.deepEqual(expected, {local:'schema',helper:'schema'});
  const s = await f.start([], {}, false, mode);
  await until(() => existsSync(join(s.workdir, 'package-result')) || s.log.includes('ERR_MODULE_NOT_FOUND'));
  assert.equal(s.log.includes('ERR_MODULE_NOT_FOUND'), false, s.log);
  assert.deepEqual(JSON.parse(readFileSync(join(s.workdir, 'package-result'), 'utf8')), expected);
});

for (const [mode, kind] of [['dev','named'], ['serve','named'], ['dev','conventional']]) for (const scope of ['', 'snapback', 'snapback/workers', 'snapback/workers/helpers'])
test(`${mode} ${kind} snapshot uses symlinked dependencies at ${scope || 'project root'}`, async t => {
  const f = fixture(t, `import value from './helpers/value.mjs';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
mkdirSync('data',{recursive:true});
writeFileSync('data/package-result.tmp',JSON.stringify({value,cwd:process.cwd(),module:import.meta.url}));
renameSync('data/package-result.tmp','data/package-result');
setInterval(()=>{},1000);`);
  if (kind === 'conventional') {
    const named = join(f.dir,'snapback/workers/push.mjs');
    writeFileSync(join(f.dir,'snapback/worker.mjs'), readFileSync(named,'utf8').replace('./helpers/value.mjs','./workers/helpers/value.mjs'));
    rmSync(named);
  }
  mkdirSync(join(f.dir, 'snapback/workers/helpers'));
  writeFileSync(join(f.dir, 'snapback/workers/helpers/value.mjs'), "import value from 'dg-package';export default value;");
  // Both the dependency directory and the installed package use relative links,
  // as in a replay checkout borrowing an existing workspace installation.
  const packages = join(f.dir, 'installed/node_modules'), actual = join(f.dir, 'installed/actual');
  mkdirSync(packages, {recursive:true}); mkdirSync(actual);
  writeFileSync(join(actual, 'package.json'), JSON.stringify({name:'dg-package',type:'module',exports:'./index.js'}));
  writeFileSync(join(actual, 'index.js'), "export default 'host dependency';");
  symlinkSync('../actual', join(packages, 'dg-package'));
  symlinkSync(relative(join(f.dir, scope), packages), join(f.dir, scope, 'node_modules'));
  if (mode === 'serve') {
    const deployed = spawnSync(binary, ['deploy', join(f.dir, 'release')], {cwd:f.dir,encoding:'utf8'});
    assert.equal(deployed.status, 0, deployed.stderr);
    const installed = join(f.dir, 'release/releases/1', scope, 'node_modules');
    assert.equal(existsSync(installed), false, 'deploy ships source, never host dependencies');
    symlinkSync(relative(join(installed, '..'), packages), installed);
  }
  const s = await f.start([], {}, false, mode);
  await until(() => existsSync(join(s.workdir, 'data/package-result')) || /ERR_MODULE_NOT_FOUND|workers:/.test(s.log));
  assert.equal(/ERR_MODULE_NOT_FOUND|workers:/.test(s.log), false, s.log);
  const result = JSON.parse(readFileSync(join(s.workdir, 'data/package-result'), 'utf8'));
  assert.equal(result.value, 'host dependency');
  assert.equal(result.cwd, realpathSync(s.workdir));
  assert.ok(fileURLToPath(result.module).startsWith(join(realpathSync(s.workdir), '.snapback4/worker-')));
});

test('standalone worker reports errors containing its bearer with automatic redaction', async () => {
  const stop = new AbortController(), errors = [], token = 'standalone-private-bearer';
  const {done} = runWorker({url:'http://standalone.test',token,signal:stop.signal,effects:{notify:()=>{}},
    fetch:async()=>{throw Error(`request failed for Bearer ${token}; again ${token}`);},
    onError:error=>{errors.push(String(error));stop.abort();},
  });
  await done;
  assert.deepEqual(errors, ['Error: request failed for Bearer [REDACTED]; again [REDACTED]']);
});

test('automatic worker.mjs refuses a symlink before issuing a service token', async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'outside.mjs'), idle);
  symlinkSync(join(f.dir, 'outside.mjs'), join(f.dir, 'snapback/worker.mjs'));
  const s = await f.start();
  await until(() => s.log.split('\n').slice(0, -1).some(line => line.includes('snapback4 worker:') && /workers:|source-blocked/.test(line)));
  assert.equal(rows(join(f.dir, 'starts')).length, 0, 'linked entry must never execute');
  assert.match(s.log, /workers:|source-blocked/);
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'), {readOnly:true});
  try { assert.equal(db.prepare("SELECT count(*) n FROM _sessions WHERE kind='service'").get().n, 0); }
  finally { db.close(); }
});

test('automatic worker restart rejects an entry replaced with a symlink', async t => {
  const f = fixture(t);
  const entry = join(f.dir, 'snapback/worker.mjs');
  writeFileSync(entry, idle);
  const s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  writeFileSync(join(f.dir, 'outside.mjs'), idle);
  rmSync(entry); symlinkSync(join(f.dir, 'outside.mjs'), entry);
  process.kill(first.pid, 'SIGKILL');
  await until(() => s.log.includes('workers:') || rows(join(f.dir, 'starts')).length > 1);
  assert.equal(rows(join(f.dir, 'starts')).length, 1);
  assert.equal((await claim(s, first.token)).status, 401);
});

test('automatic worker executes validated entry and relative helper after source replacement', async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'snapback/worker.mjs'), `import {value} from './helpers/value.mjs';\n${idle}\nimport {copyFileSync,renameSync} from 'node:fs';\nappendFileSync('values-written',value);copyFileSync('values-written','values.tmp');renameSync('values.tmp','values');`);
  mkdirSync(join(f.dir, 'snapback/helpers'));
  writeFileSync(join(f.dir, 'snapback/helpers/value.mjs'), "export const value='validated';");
  const wrapper = join(f.dir, 'node-wrapper');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = --version ]; then exec '${process.execPath}' "$@"; fi\ntouch launch-ready\nwhile [ ! -f launch-go ]; do sleep 0.02; done\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper, 0o700);
  await f.start([], {SNAPBACK_NODE:wrapper});
  await until(() => existsSync(join(f.dir, 'launch-ready')));
  writeFileSync(join(f.dir, 'outside.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('values','escaped');setInterval(()=>{},1000);");
  rmSync(join(f.dir, 'snapback/worker.mjs'));
  symlinkSync(join(f.dir, 'outside.mjs'), join(f.dir, 'snapback/worker.mjs'));
  writeFileSync(join(f.dir, 'snapback/helpers/value.mjs'), "export const value='changed';");
  writeFileSync(join(f.dir, 'launch-go'), '');
  await until(() => existsSync(join(f.dir, 'values')));
  assert.equal(readFileSync(join(f.dir, 'values'), 'utf8'), 'validated');
});

for (const check of ['query fence', 'retirement custody']) test(`removed worker retains ${check} while deletion is locked`, { timeout: hangBudget(10) }, async t => {
  const f = fixture(t, idle + `\nprocess.on('SIGTERM',()=>{appendFileSync('terms','stopping');});`);
  writeFileSync(join(f.dir, 'snapback/schema.q'), 'query who():\n  return viewer\nmutation send():\n  return true\n');
  const s = await f.start([], {}, true);
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  const query = () => fetch(s.url+'/q/who', {method:'POST',headers:{authorization:'Bearer '+first.token,'content-type':'application/json'},body:'{"args":{}}'});
  assert.equal((await query()).status, 200);
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  t.after(() => db.close());
  rmSync(join(f.dir, 'snapback/workers/push.mjs'));
  await until(() => existsSync(join(f.dir, 'terms')));
  await lockWriter(db);
  let fenced;
  try {
    await until(() => s.log.includes("cannot close the child's session"));
    assert.equal(db.prepare("SELECT count(*) n FROM _meta WHERE key LIKE 'worker:family:%'").get().n, 1);
    if (check === 'query fence') {
      fenced = (await query()).status;
      if (fenced === 401) for (const path of ['/m/send', '/auth/refresh']) {
        const response = await fetch(s.url+path, {method:'POST',headers:{authorization:'Bearer '+first.token,'content-type':'application/json'},body:'{"args":{}}'});
        assert.equal(response.status, 401, `${path} must refuse the retired family while deletion is locked`);
      }
    }
  } finally { db.exec('ROLLBACK'); }
  if (check === 'query fence') assert.equal(fenced, 401, 'a pending retired family is refused even before deletion commits');
  else {
    await until(() => db.prepare("SELECT count(*) n FROM _meta WHERE key LIKE 'worker:family:%'").get().n === 0);
    assert.equal(db.prepare("SELECT count(*) n FROM _sessions WHERE principal = 'service:push'").get().n, 0);
    await until(() => JSON.parse(db.prepare("SELECT value FROM _meta WHERE key = 'worker:status:push'").get().value).state === 'stopped');
    assert.equal((await query()).status, 401);
  }
  assert.equal(rows(join(f.dir, 'starts')).length, 1);
  assert.equal(alive(first.pid), false);
});

test('restart refuses an entry symlink already rejected by discovery', {timeout: hangBudget(6)}, async t => {
  const f = fixture(t, idle), s = await f.start([], {}, true);
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  const outside = join(f.dir, 'outside.mjs');
  writeFileSync(outside, "import {writeFileSync} from 'node:fs';writeFileSync('escaped','executed');setInterval(()=>{},1000);");
  const entry = join(f.dir, 'snapback/workers/push.mjs');
  rmSync(entry); symlinkSync(outside, entry);
  await until(() => s.log.includes('serving the previous generation'));
  process.kill(first.pid, 'SIGKILL');
  await until(() => s.log.includes('restarting in'));
  await sleep(1600);
  assert.equal(existsSync(join(f.dir, 'escaped')), false, 'rejected source must never execute');
  assert.equal(rows(join(f.dir, 'starts')).length, 1);
  rmSync(entry); writeFileSync(entry, idle);
  await until(() => rows(join(f.dir, 'starts')).length === 2);
});

test('launch executes validated entry and helper bytes after source paths are replaced', {timeout: hangBudget(3)}, async t => {
  const f = fixture(t, `import { value } from './helpers/value.mjs';\n${idle}\nimport {copyFileSync,renameSync} from 'node:fs';\nappendFileSync('values-written',value);copyFileSync('values-written','values.tmp');renameSync('values.tmp','values');`);
  mkdirSync(join(f.dir, 'snapback/workers/helpers'));
  writeFileSync(join(f.dir, 'snapback/workers/helpers/value.mjs'), "export const value='validated';");
  const wrapper = join(f.dir, 'node-wrapper');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = --version ]; then exec '${process.execPath}' "$@"; fi\ntouch launch-ready\nwhile [ ! -f launch-go ]; do sleep 0.02; done\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper, 0o700);
  await f.start([], {SNAPBACK_NODE:wrapper});
  await until(() => existsSync(join(f.dir, 'launch-ready')));
  const outside = join(f.dir, 'outside.mjs');
  writeFileSync(outside, "import {writeFileSync} from 'node:fs';writeFileSync('values','escaped');setInterval(()=>{},1000);");
  rmSync(join(f.dir, 'snapback/workers/push.mjs'));
  symlinkSync(outside, join(f.dir, 'snapback/workers/push.mjs'));
  writeFileSync(join(f.dir, 'snapback/workers/helpers/value.mjs'), "export const value='changed';");
  writeFileSync(join(f.dir, 'launch-go'), '');
  await until(() => existsSync(join(f.dir, 'values')));
  assert.equal(readFileSync(join(f.dir, 'values'), 'utf8'), 'validated');
});

test('watchdog SIGKILL terminates its Node group before replacement', {timeout: hangBudget(3)}, async t => {
  const f = fixture(t, `import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
appendFileSync('starts',JSON.stringify({pid:process.pid,watchdog:process.ppid,helper:helper.pid})+'\\n');setInterval(()=>{},1000);`);
  await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  process.kill(first.watchdog, 'SIGKILL');
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  assert.equal(alive(first.pid), false, 'old Node must be dead when replacement starts');
  assert.equal(alive(first.helper), false, 'old descendant must also be dead');
});

test('ledger commits with FULL synchronization and durable journaling', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-durability-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  const settings = [], original = DatabaseSync.prototype.exec;
  const configured = new WeakSet();
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    // Start each real connection with a non-FULL default so omitting the
    // setup pragma is observable, not masked by this Node build's default.
    if (!configured.has(this)) { original.call(this, 'PRAGMA synchronous = OFF'); configured.add(this); }
    if (sql === 'COMMIT') settings.push({
      synchronous:this.prepare('PRAGMA synchronous').get().synchronous,
      journal:this.prepare('PRAGMA journal_mode').get().journal_mode,
      busy:this.prepare('PRAGMA busy_timeout').get().timeout,
    });
    return original.call(this, sql);
  });
  const ledger = await WorkerLedger.open(join(dir, 'ledger.sqlite'), new AbortController().signal);
  try { await ledger.run('one', async () => 'receipt', new AbortController().signal); }
  finally { ledger.close(); }
  assert.equal(settings.length, 2, 'observe initialization and completion commits on the real connection');
  for (const setting of settings) {
    assert.equal(setting.synchronous, 2, 'FULL must hold at each durable commit');
    assert.ok(['delete','truncate','persist','wal'].includes(setting.journal));
    assert.equal(setting.busy, 0, 'writer contention must wait asynchronously');
  }
});

test('worker fixture waits for initial admission after the listening URL', async t => {
  const f = fixture(t, idle), wrapper = join(f.dir, 'node-wrapper');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = --version ]; then touch '${f.dir}/probe-ready'; while [ ! -f '${f.dir}/probe-go' ]; do sleep 0.02; done; fi\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper, 0o700);
  let ready = false;
  const starting = f.start([], { SNAPBACK_NODE: wrapper }).then(s => { ready = true; return s; });
  // Release the deliberately blocked admission even if the assertion fails.
  await withCleanup(async () => {
    await until(() => f.listening && existsSync(join(f.dir, 'probe-ready')));
    await sleep(50);
    assert.equal(ready, false, 'a printed URL is not completed worker admission');
  }, async () => {
    writeFileSync(join(f.dir, 'probe-go'), '');
    await cleanup(() => starting, 'worker admission release', () => fixtureDiagnostics.getStore()?.());
  });
  await until(() => rows(join(f.dir, 'starts')).length === 1);
});

test('new declarations retry failed admission after Node is repaired without another source edit', {timeout:hangBudget(3)}, async t => {
  const f = fixture(t), wrapper = join(f.dir, 'node-wrapper');
  writeFileSync(join(f.dir, 'bad-node'), '');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = --version ] && [ -f '${f.dir}/bad-node' ]; then printf 'v23.0.0\\n'; exit 0; fi\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper, 0o700);
  const s = await f.start([], {SNAPBACK_NODE:wrapper}, true);
  writeFileSync(join(f.dir, 'snapback/workers/push.mjs'), idle);
  // Worker discovery uses the physical project root; SNAPBACK_NODE keeps its supplied spelling.
  const expectedWorker = join(realpathSync(f.dir), 'snapback/workers/push.mjs');
  await until(() => s.log.split('\n').slice(0, -1).some(line => line.includes(`worker ${expectedWorker} needs Node 24`) && line.includes(`${wrapper} reports v23.0.0`) && line.includes('declaration will retry')));
  assert.match(s.log, /declaration will retry/, 'the edit must reach pending admission on a serving host');
  const adoptions = s.log.match(/schema adopted as generation/g)?.length ?? 0;
  rmSync(join(f.dir, 'bad-node'));
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  assert.equal(s.log.match(/schema adopted as generation/g)?.length ?? 0, adoptions);
});

for (const signal of ['SIGTERM','SIGINT','SIGHUP']) test(`watchdog ${signal} completes group cleanup without a live supervisor`, {timeout:hangBudget(5)}, async t => {
  let watchdog, done;
  const f = fixture(t, `import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';import {once} from 'node:events';
process.on('SIGTERM',()=>{});
const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
await once(helper.stdout,'data');
appendFileSync('starts',JSON.stringify({pid:process.pid,helper:helper.pid})+'\\n');setInterval(()=>{},1000);`, async () => {
    // The live watchdog owns its group. EOF requests cleanup even on failure;
    // never signal a descendant by a stale PID from the starts file.
    watchdog?.stdin.end();
    if (done) await cleanup(() => done, `watchdog ${signal}`, () => JSON.stringify({
      pid: watchdog.pid, exitCode: watchdog.exitCode, signalCode: watchdog.signalCode,
      starts: rows(join(f.dir, 'starts')),
    }), [watchdog]);
  });
  watchdog=spawn(binary,['--internal-worker-watchdog',process.execPath,join(f.dir,'snapback/workers/push.mjs'),'-1'],{cwd:f.dir,stdio:['pipe','pipe','pipe']});
  done=once(watchdog,'exit');watchdog.stdout.resume();watchdog.stderr.resume();
  await until(()=>rows(join(f.dir,'starts')).length===1);
  const first=rows(join(f.dir,'starts'))[0];
  const worker=await identity(first.pid), helper=await identity(first.helper);
  assert.ok(worker?.alive && helper?.alive, 'capture both live process identities before signaling');
  watchdog.kill(signal);await done;
  assert.equal(await live(worker),false);
  // The watchdog reaps Node, but cannot waitpid Node's child. SIGKILL delivery
  // to that descendant can finish after the watchdog's exit event is observed.
  // PID reuse must not resurrect either process. Inspection errors and until's
  // TEST_HANG guard still throw; zombies count as exited on both platforms.
  await until(async () => !(await live(helper)));
  assert.equal(await live(helper),false);
});

test('ledger open waits for a busy writer before becoming ready', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-ledger-open-busy-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'ledger.sqlite'), holder=new DatabaseSync(path);
  t.after(()=>holder.close());holder.exec('BEGIN IMMEDIATE');
  let ready=false;
  const opening=WorkerLedger.open(path,new AbortController().signal).then(ledger=>{ready=true;return ledger;});
  void opening.catch(()=>{});
  await sleep(100);assert.equal(ready,false);holder.exec('ROLLBACK');
  const ledger=await opening;ledger.close();assert.equal(ready,true);
});

test('failed revocation blocks restart until the retired bearer is refused', { timeout: hangBudget(7) }, async t => {
  const f = fixture(t, idle), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  assert.equal((await claim(s, first.token)).status, 200);
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  t.after(() => db.close());
  await lockWriter(db);
  try {
    process.kill(first.pid, 'SIGKILL');
    await until(() => s.log.includes("cannot close the child's session"));
    assert.equal(rows(join(f.dir, 'starts')).length, 1);
    assert.equal(alive(first.pid), false);
  } finally { db.exec('ROLLBACK'); }
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  assert.equal((await claim(s, first.token)).status, 401, 'retired bearer must not authenticate');
  assert.equal((await claim(s, rows(join(f.dir, 'starts'))[1].token)).status, 200);
  assert.equal(s.log.includes(first.token), false);
});

test('rotation retires the old bearer even while its stored expiry still stands', { timeout: hangBudget(6) }, async t => {
  const f = fixture(t, idle), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  const db = new DatabaseSync(join(f.dir, '.snapback4/store.sqlite'));
  // Separate revocation from ordinary expiry: the supervisor retains its
  // original one-day deadline, while this bearer remains valid in storage.
  db.exec("UPDATE _sessions SET expires_at = expires_at + 86400000 WHERE kind = 'service'"); db.close();
  assert.equal((await claim(s, first.token)).status, 200);
  const response = await fetch(s.url + '/dev/clock/advance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"duration":"1d"}' });
  assert.equal(response.status, 200);
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  assert.equal((await claim(s, first.token)).status, 401);
  assert.equal(alive(first.pid), false);
});

for (const where of ['schema', 'root', 'entry', 'helper', 'fifo']) test(`worker snapshot refuses ${where} escapes or non-regular files`, t => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'sb4-external-workers-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'push.mjs'), idle);
  writeFileSync(join(outside, '.env.test'), 'not project source');
  const workers = join(f.dir, 'snapback/workers');
  if (where === 'schema') {
    mkdirSync(join(outside, 'workers'));
    writeFileSync(join(outside, 'schema.q'), 'query hello():\n  return true\n');
    writeFileSync(join(outside, 'workers/push.mjs'), idle);
    rmSync(join(f.dir, 'snapback'), { recursive: true }); symlinkSync(outside, join(f.dir, 'snapback'));
  } else if (where === 'root') { rmSync(workers, { recursive: true }); symlinkSync(outside, workers); }
  else if (where === 'entry') symlinkSync(join(outside, 'push.mjs'), join(workers, 'push.mjs'));
  else if (where === 'helper') symlinkSync(outside, join(workers, 'helpers'));
  else assert.equal(spawnSync('mkfifo', [join(workers, 'pipe')]).status, 0);
  const result = spawnSync(binary, ['deploy', join(f.dir, 'release')], { cwd: f.dir, encoding: 'utf8', timeout: hangBudget() });
  assert.notEqual(result.status, 0, 'unsafe source must not deploy');
  assert.match(result.stderr, /worker|symlink|regular/i);
  assert.equal(existsSync(join(f.dir, 'release/releases/1/snapback/workers/.env.test')), false);
});

test('worker snapshot retains regular nested helper bytes and permissions', t => {
  const f = fixture(t, idle);
  mkdirSync(join(f.dir, 'snapback/workers/helpers'));
  const helper = join(f.dir, 'snapback/workers/helpers/send.sh');
  const text = '#!/bin/sh\nprintf helper\n';
  writeFileSync(helper, text); chmodSync(helper, 0o750);
  const result = spawnSync(binary, ['deploy', join(f.dir, 'release')], { cwd: f.dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const copy = join(f.dir, 'release/releases/1/snapback/workers/helpers/send.sh');
  assert.equal(readFileSync(copy, 'utf8'), text);
  assert.equal(statSync(copy).mode & 0o777, 0o750);
});

test('fresh stores and replacement stores cannot replay another store completion', { timeout: hangBudget(6) }, async t => {
  const source = `import { appendFileSync } from 'node:fs';
import { runWorker } from ${JSON.stringify(workerModule)};
appendFileSync('starts',JSON.stringify({pid:process.pid,ledger:process.env.SNAPBACK_WORKER_LEDGER})+'\\n');
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:true,wait:0,
effects:{notify:(_payload,meta)=>{appendFileSync('actions',JSON.stringify({id:meta.id})+'\\n');return 'sent';}}}).done;`;
  const f = fixture(t, source);
  const paths = [], ids = [];
  for (const extra of [['--fresh'], ['--fresh'], [], []]) {
    const s = await f.start(extra);
    await until(() => rows(join(f.dir, 'starts')).length > paths.length);
    paths.push(rows(join(f.dir, 'starts')).at(-1).ledger);
    const response = await fetch(s.url + '/m/send', { method: 'POST', headers: { 'x-snapback-persona': 'alice', 'content-type': 'application/json' }, body: '{"args":{}}' });
    assert.equal((await response.json()).state, 'sent');
    await until(() => rows(join(f.dir, 'actions')).length === paths.length);
    ids.push(rows(join(f.dir, 'actions')).at(-1).id);
    s.child.kill('SIGTERM'); await s.done;
    if (paths.length === 3) for (const suffix of ['', '-wal', '-shm']) rmSync(join(f.dir, '.snapback4/store.sqlite'+suffix), { force: true });
  }
  assert.equal(new Set(ids).size, 1, 'control: distinct stores reused the same effect id');
  assert.equal(new Set(paths).size, 4, 'ledger namespace belongs to actual store identity');
  assert.ok(paths.slice(0, 2).every(p => !p.startsWith(join(realpathSync(f.dir), '.snapback4'))));
});

for (const death of ['worker', 'SIGTERM', 'SIGKILL']) test(`${death} stops worker descendants`, { timeout: hangBudget(6) }, async t => {
  const source = `import { spawn } from 'node:child_process'; import { appendFileSync } from 'node:fs';
const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
appendFileSync('starts',JSON.stringify({pid:process.pid,helper:helper.pid})+'\\n');setInterval(()=>{},1000);`;
  const f = fixture(t, source), s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  const first = rows(join(f.dir, 'starts'))[0];
  await sleep(150);
  if (death === 'worker') process.kill(first.pid, 'SIGKILL');
  else { s.child.kill(death); await s.done; }
  await until(() => !alive(first.pid) && !alive(first.helper));
  if (death === 'worker') await until(() => rows(join(f.dir, 'starts')).length === 2);
});

for (const bad of ['corrupt', 'schema', 'receipt', 'parent-file']) test(`ledger ${bad} initialization reports once without claiming or settling`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let path = join(dir, 'ledger.sqlite');
  if (bad === 'corrupt') writeFileSync(path, 'not sqlite');
  else if (bad === 'schema') { const db = new DatabaseSync(path); db.exec('CREATE TABLE completions(wrong TEXT)'); db.close(); }
  else if (bad === 'receipt') { const db = new DatabaseSync(path); db.exec("CREATE TABLE completions(key TEXT PRIMARY KEY, result TEXT NOT NULL) WITHOUT ROWID; INSERT INTO completions VALUES ('one', 'not JSON')"); db.close(); }
  else { writeFileSync(path, 'file'); path += '/nested.sqlite'; }
  let claims = 0, settlements = 0, handlers = 0;
  const errors = [], stop = new AbortController();
  const w = runWorker({ url: 'http://test', token: 'seat', ledger: path, signal: stop.signal, wait: 0,
    effects: { notify: () => { handlers++; } }, onError: e => errors.push(String(e)),
    fetch: async url => { await sleep(1); if (url.endsWith('/claim')) { claims++; return Response.json({effects:[{id:'one',effect:'notify',payload:{},attempt:claims,seq:1,at:0}]}); } settlements++; return Response.json({ok:true}); },
  });
  // Always observe a rejected done as well, so the original broken finally is contained.
  const done = w.done.catch(e => errors.push(String(e)));
  await until(() => errors.length || settlements);
  await sleep(100); stop.abort(); await done;
  assert.equal(claims, 0); assert.equal(settlements, 0); assert.equal(handlers, 0);
  assert.equal(errors.length, 1);
});

test('named workers receive only entry-named declared secrets, defaulting to none', { timeout: hangBudget(2) }, async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir, 'snapback/schema.q'), 'effect notify secrets [WK_PUSH_KEY]\neffect digest secrets [WK_MAIL_KEY]\nquery hello():\n  return true\n');
  for (const name of ['push', 'plain']) writeFileSync(join(f.dir, `snapback/workers/${name}.mjs`), `${name === 'push' ? '// snapback4 secrets: WK_PUSH_KEY' : ''}
import { appendFileSync } from 'node:fs';
appendFileSync('starts',JSON.stringify({pid:process.pid,name:${JSON.stringify(name)},push:Object.hasOwn(process.env,'WK_PUSH_KEY'),mail:Object.hasOwn(process.env,'WK_MAIL_KEY')})+'\\n');
setInterval(()=>{},1000);`);
  await f.start([], { WK_PUSH_KEY: 'push-test-value', WK_MAIL_KEY: 'mail-test-value' });
  await until(() => rows(join(f.dir, 'starts')).length === 2);
  for (const row of rows(join(f.dir, 'starts'))) {
    assert.equal(row.push, row.name === 'push'); assert.equal(row.mail, false);
  }
});

test('shutdown starts every worker grace period together', { timeout: hangBudget(3) }, async t => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) writeFileSync(join(f.dir, `snapback/workers/w${i}.mjs`), `import {appendFileSync} from 'node:fs';
process.on('SIGTERM',()=>appendFileSync('terms',JSON.stringify({pid:process.pid,at:Date.now()})+'\\n'));
appendFileSync('starts',JSON.stringify({pid:process.pid})+'\\n');setInterval(()=>{},1000);`);
  const s = await f.start();
  await until(() => rows(join(f.dir, 'starts')).length === 4);
  s.child.kill('SIGTERM'); await s.done;
  const terms = rows(join(f.dir, 'terms'));
  assert.equal(terms.length, 4);
  assert.ok(Math.max(...terms.map(r => r.at))-Math.min(...terms.map(r => r.at)) < 1500, 'later workers must not wait for an earlier grace period');
  for (const row of terms) assert.equal(alive(row.pid), false);
});

test('repeated secret admission failures increase restart backoff', { timeout: hangBudget(2) }, async t => {
  const f = fixture(t, '// snapback4 secrets: UNDECLARED_KEY\n'+idle), s = await f.start();
  const failures = () => s.events.filter(e => e.text.includes('UNDECLARED_KEY is not a declared'));
  await until(() => failures().length >= 4);
  assert.ok(failures()[3].at-failures()[0].at >= 1400, 'four failures must not repeat at the initial 250ms interval');
  assert.equal(rows(join(f.dir, 'starts')).length, 0);
});

test('SQLite busy retries return the winning receipt to both waiters', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-busy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stop = new AbortController(), path = join(dir, 'ledger.sqlite');
  const first = await WorkerLedger.open(path, stop.signal), second = await WorkerLedger.open(path, stop.signal);
  t.after(() => { first.close(); second.close(); });
  let entered, release, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const a = first.run('shared', async () => { calls++; entered(); await gate; return 'original-receipt'; }, stop.signal);
  await started;
  const b = second.run('shared', async () => { calls++; return 'wrong-receipt'; }, stop.signal);
  void b.catch(() => {});
  await sleep(100); release();
  assert.deepEqual(await Promise.all([a, b]), ['original-receipt', 'original-receipt']);
  assert.equal(calls, 1);
});

for (const failure of ['disk-full', 'commit-and-rollback']) test(`ledger ${failure} closes storage and stops without failed settlement`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let initialized = false, claims = 0, settlements = 0;
  const original = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (failure === 'commit-and-rollback' && initialized && (sql === 'COMMIT' || sql === 'ROLLBACK')) throw new Error('injected storage failure');
    const result = original.call(this, sql);
    if (sql === 'COMMIT' && !initialized) {
      initialized = true;
      if (failure === 'disk-full') original.call(this, 'PRAGMA max_page_count = 2');
    }
    return result;
  });
  const errors = [], stop = new AbortController(), path = join(dir, 'ledger.sqlite');
  const w = runWorker({url:'http://test',token:'seat',ledger:path,signal:stop.signal,wait:0,
    effects:{notify:()=> 'x'.repeat(100_000)},onError:e=>errors.push(String(e)),
    fetch:async url=>{ await sleep(1); if(url.endsWith('/claim')) { claims++; return Response.json({effects:[{id:'one',effect:'notify',payload:{},attempt:claims,seq:1,at:0}]}); } settlements++; return Response.json({ok:true}); },
  });
  const done = w.done.catch(e => errors.push(String(e)));
  await until(() => errors.length || settlements); stop.abort(); await done;
  assert.equal(claims, 1); assert.equal(settlements, 0); assert.equal(errors.length, 1);
  assert.match(errors[0], /ledger unavailable/);
  const db = new DatabaseSync(path); db.exec('BEGIN IMMEDIATE; ROLLBACK');
  assert.equal(db.prepare('SELECT count(*) AS n FROM completions').get().n, 0); db.close();
});

for (const mode of ['dev', 'serve']) test(`${mode} credentialed worker receives only the explicit runtime environment`, async t => {
  const f = fixture(t, `import {writeFileSync,renameSync} from 'node:fs';
writeFileSync('environment-result.tmp',JSON.stringify({keys:Object.keys(process.env).sort(),preloaded:!!globalThis.preloaded}));renameSync('environment-result.tmp','environment-result');setInterval(()=>{},1000);`);
  const preload = join(f.dir, 'preload.cjs');
  writeFileSync(preload, 'globalThis.preloaded=true;');
  const s = await f.start([], {NODE_OPTIONS:`--require=${preload}`, NODE_PATH:f.dir, WK_UNDECLARED:'unused'}, false, mode);
  await until(() => existsSync(join(s.workdir, 'environment-result')));
  const actual = JSON.parse(readFileSync(join(s.workdir, 'environment-result'), 'utf8'));
  assert.equal(actual.preloaded, false, 'only validated project source runs before its declared imports');
  const allowed = ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','SNAPBACK_URL','SNAPBACK_SERVICE_TOKEN','SNAPBACK_PROJECT_DIR','SNAPBACK_WORKER_LEDGER','SNAPBACK_WORKER_SUPERVISED'];
  if (process.platform === 'darwin') allowed.push('__CF_USER_TEXT_ENCODING');
  assert.deepEqual(actual.keys.filter(key => !allowed.includes(key)), []);
});

for (const mode of ['dev', 'serve']) test(`${mode} ledger initialization stops the child and doctor reports ledger-unavailable`, async t => {
  const f = fixture(t, `import {runWorker} from ${JSON.stringify(workerModule)};
import {appendFileSync} from 'node:fs';
appendFileSync('starts',JSON.stringify({pid:process.pid})+'\\n');
setInterval(()=>{},1000);
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:'snapback',
 effects:{notify:()=>{throw Error('must not perform');}},fetch:async()=>{appendFileSync('claims','claim');return Response.json({effects:[]});}}).done;`);
  const s = await f.start([], {}, false, mode);
  await until(() => s.log.includes('worker ledger initialization failed'));
  const status = () => {
    const result = spawnSync(binary, ['doctor', ...(mode === 'serve' ? ['--release',join(f.dir,'release')] : [])], {cwd:f.dir,encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  await until(() => status().includes('ledger-unavailable'));
  const starts = rows(join(s.workdir,'starts'));
  assert.ok(starts.length > 0);
  assert.equal(alive(starts[0].pid), false);
  assert.equal(existsSync(join(s.workdir,'claims')), false);
});

test('serve renews peers once after a failed credential retirement fences their revision', async t => {
  const f = fixture(t);
  writeFileSync(join(f.dir,'snapback/schema.q'),'query who():\n  return viewer\n');
  for (const name of ['push','digest']) writeFileSync(join(f.dir,`snapback/workers/${name}.mjs`),
    `import {appendFileSync} from 'node:fs';
appendFileSync('starts',JSON.stringify({name:'${name}',pid:process.pid,token:process.env.SNAPBACK_SERVICE_TOKEN})+'\\n');setInterval(()=>{},1000);`);
  const s = await f.start([], {}, false, 'serve');
  const starts = () => rows(join(s.workdir,'starts'));
  await until(() => starts().length===2);
  const original = starts(), db = new DatabaseSync(join(f.dir,'release/store.sqlite'));
  t.after(() => db.close());
  // Refuse deletion without blocking status writes, so both stopped states
  // and repeated retries can be observed while the original rows stay valid.
  await fixtureDdl(db, "CREATE TRIGGER hold_retirement BEFORE DELETE ON _sessions BEGIN SELECT RAISE(FAIL,'retirement held'); END");
  try {
    process.kill(original.find(row=>row.name==='push').pid,'SIGKILL');
    const statuses = () => db.prepare("SELECT value FROM _meta WHERE key LIKE 'worker:status:%'").all().map(row=>JSON.parse(row.value));
    await until(() => statuses().length===2 && statuses().every(row=>row.state==='revocation-blocked'));
    assert.equal(starts().length,2,'no replacement may overtake its retained credential');
    for (const row of original) {
      assert.equal(alive(row.pid),false);
      const response=await fetch(s.url+'/q/who',{method:'POST',headers:{authorization:'Bearer '+row.token},body:'{}'});
      assert.equal(response.status,401);
    }
  } finally {await fixtureDdl(db, 'DROP TRIGGER hold_retirement');}
  await until(() => starts().length===4);
  const replacements=starts().slice(2);
  assert.deepEqual(replacements.map(row=>row.name).sort(),['digest','push']);
  for (const row of replacements) {
    const response=await fetch(s.url+'/q/who',{method:'POST',headers:{authorization:'Bearer '+row.token},body:'{}'});
    assert.equal(response.status,200,'both peers must receive the new revision');
  }
  await sleep(300);
  assert.equal(starts().length,4,'retirement retries must not cause repeated revision changes');
});

for (const kind of ['entry-copy', 'linked-helper']) test(`automatic snapshot validates checked project imports: ${kind}`, async t => {
  const f = fixture(t);
  mkdirSync(join(f.dir,'src'));
  mkdirSync(join(f.dir,'snapback/generated'));
  const helper=join(f.dir,'src/provider.mjs');
  writeFileSync(helper,"export const value='validated';");
  writeFileSync(join(f.dir,'snapback/generated/server-watch.json'),JSON.stringify([[helper,['0','0']]]));
  writeFileSync(join(f.dir,'snapback/worker.mjs'),`import {value} from '../src/provider.mjs';
import {writeFileSync,renameSync} from 'node:fs';writeFileSync('checked-value.tmp',value);renameSync('checked-value.tmp','checked-value');setInterval(()=>{},1000);`);
  const wrapper=join(f.dir,'node-wrapper');
  writeFileSync(wrapper,`#!/bin/bash\nif [ "$1" = --version ]; then exec '${process.execPath}' "$@"; fi\ntouch launch-ready\nwhile [ ! -f launch-go ]; do sleep 0.02; done\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper,0o700);
  if(kind==='linked-helper') {
    writeFileSync(join(f.dir,'replacement.mjs'),"export const value='changed';");
    rmSync(helper);symlinkSync(join(f.dir,'replacement.mjs'),helper);
    const s=await f.start();
    await until(()=>s.log.includes('workers:'));
    assert.equal(existsSync(join(f.dir,'checked-value')),false);
    const db=new DatabaseSync(join(f.dir,'.snapback4/store.sqlite'),{readOnly:true});
    try {assert.equal(db.prepare("SELECT count(*) n FROM _sessions WHERE kind='service'").get().n,0);}
    finally {db.close();}
  } else {
    await f.start([], {SNAPBACK_NODE:wrapper});
    await until(()=>existsSync(join(f.dir,'launch-ready')));
    writeFileSync(helper,"export const value='changed';");writeFileSync(join(f.dir,'launch-go'),'');
    await until(()=>existsSync(join(f.dir,'checked-value')));
    assert.equal(readFileSync(join(f.dir,'checked-value'),'utf8'),'validated');
  }
});

for (const [mode, entry] of [['dev','workers/push.mjs'], ['serve','workers/push.mjs'], ['dev','worker.mjs'], ['serve','external.mjs']])
test(`${mode} ${entry} runs the published file-output recipe in the project data directory`, async t => {
  const guide = spawnSync(binary, ['guide','effects','--full'], {encoding:'utf8'});
  assert.equal(guide.status, 0, guide.stderr);
  const recipe = guide.stdout.split('## Worker files and imports')[1].match(/```js\n([\s\S]*?)```/)[1];
  const reference = readFileSync(fileURLToPath(new URL('../CLIENT-AND-OPERATIONS.md', import.meta.url)), 'utf8')
    .split('#### Worker files, modules and runtime paths')[1].match(/```js\n([\s\S]*?)```/)[1];
  assert.equal(recipe, reference, 'both published entry points teach the same runnable recipe');
  const f = fixture(t);
  const source = join(f.dir, 'snapback', entry);
  writeFileSync(source, recipe + `
await recordPush({text:'acceptance'}, {idempotencyKey:'stable-key'});
const {writeFileSync}=await import('node:fs');
writeFileSync('paths.json',JSON.stringify({projectDir:process.env.SNAPBACK_PROJECT_DIR,cwd:process.cwd(),module:import.meta.url}));
process.chdir('/');
await recordPush({text:'after chdir'}, {idempotencyKey:'next-key'});
setInterval(()=>{},1000);
`);
  const s = await f.start(mode === 'serve' && entry === 'external.mjs' ? ['--worker',source] : [],
    {SNAPBACK_PROJECT_DIR:'/must-not-inherit'}, false, mode);
  const log = join(s.workdir,'data/push-log.jsonl');
  await until(() => rows(log).length === 2);
  assert.deepEqual(rows(log), [{id:'stable-key',payload:{text:'acceptance'}},{id:'next-key',payload:{text:'after chdir'}}]);
  const paths=JSON.parse(readFileSync(join(s.workdir,'paths.json'),'utf8'));
  assert.equal(paths.projectDir,realpathSync(s.workdir)); assert.equal(paths.cwd,realpathSync(s.workdir));
  if(entry === 'external.mjs') assert.equal(fileURLToPath(paths.module),realpathSync(source));
  else assert.ok(fileURLToPath(paths.module).startsWith(join(realpathSync(s.workdir),'.snapback4/worker-')));
});
