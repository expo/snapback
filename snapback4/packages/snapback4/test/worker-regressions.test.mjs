import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
const { runWorker } = await import(process.env.SNAPBACK4_TEST_WORKER ?? '../dist/worker.js');
const { WorkerLedger } = await import(process.env.SNAPBACK4_TEST_WORKER_LEDGER ?? '../dist/worker-ledger.js');

const binary = process.env.SNAPBACK4_BIN ?? fileURLToPath(new URL('../../../target/debug/snapback4', import.meta.url));
const workerModule = new URL('../dist/worker.js', import.meta.url).href;
async function until(fn) { return awaitState(fn); }
function rows(path) { try { return readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse); } catch { return []; } }
function alive(pid) {
  try {
    process.kill(pid, 0);
    // Orphans can remain zombies until the container's init reaps them.
    if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch { return false; }
}
function fixture(t, source) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-worker-regression-'));
  mkdirSync(join(dir, 'snapback/workers'), { recursive: true });
  writeFileSync(join(dir, 'snapback/schema.q'), "use personas alice\neffect notify\nmutation send():\n  emit notify { message: 'hello' }\n  return true\n");
  if (source) writeFileSync(join(dir, 'snapback/workers/push.mjs'), source);
  const servers = [];
  t.after(async () => {
    for (const s of servers) { if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGTERM'); await s.done; }
    for (const workdir of new Set([dir, ...servers.map(s => s.workdir)]))
      for (const row of rows(join(workdir, 'starts'))) for (const pid of [row.pid, row.helper]) if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, async start(extra = [], env = {}, watch = false, mode = "dev") {
    const release = join(dir, 'release');
    if (mode === 'serve' && !existsSync(release)) { const deploy = spawnSync(binary, ['deploy', release], {cwd:dir,encoding:'utf8'}); assert.equal(deploy.status, 0, deploy.stderr); }
    const child = spawn(binary, mode === 'serve' ? ['serve', release, '--port', '0', ...extra] : ['dev', '--port', '0', ...(watch ? [] : ['--no-watch']), ...extra], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const s = { child, done: once(child, 'exit'), log: '', url: '', events: [], workdir: mode === 'serve' ? join(release, 'releases/1') : dir };
    servers.push(s);
    child.stderr.on('data', b => { s.log += b; s.events.push({ at: performance.now(), text: String(b) }); });
    child.stdout.on('data', b => { s.url ||= String(b).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? ''; });
    await until(() => s.url); return s;
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
  writeFileSync(join(f.dir, 'snapback', entry), `import {writeFileSync} from 'node:fs';
const result=await import('wk-parent-only').then(m=>m.default,error=>error.code);
writeFileSync('package-lookup',JSON.stringify(result));setInterval(()=>{},1000);`);
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
  const result=spawnSync(binary,['dev','--port','0','--no-watch'],{cwd:project,encoding:'utf8',timeout:hangBudget()});
  assert.match(result.stderr,/workers:.*(symbolic|symlink|regular|loop)/i);
  assert.equal(existsSync(join(project,'starts')),false);
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
import {writeFileSync} from 'node:fs';
const values={local,helper};
if(process.env.SNAPBACK_SERVICE_TOKEN){writeFileSync('package-result',JSON.stringify(values));setInterval(()=>{},1000);}
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
  await until(() => s.log.includes('snapback4 worker:'));
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
  writeFileSync(join(f.dir, 'snapback/worker.mjs'), `import {value} from './helpers/value.mjs';\n${idle}\nappendFileSync('values',value);`);
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
  db.exec('BEGIN IMMEDIATE');
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
  const f = fixture(t, `import { value } from './helpers/value.mjs';\n${idle}\nappendFileSync('values',value);`);
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

test('new declarations retry failed admission after Node is repaired without another source edit', {timeout:hangBudget(3)}, async t => {
  const f = fixture(t), wrapper = join(f.dir, 'node-wrapper');
  writeFileSync(join(f.dir, 'bad-node'), '');
  writeFileSync(wrapper, `#!/bin/bash\nif [ "$1" = --version ] && [ -f '${f.dir}/bad-node' ]; then printf 'v23.0.0\\n'; exit 0; fi\nexec '${process.execPath}' "$@"\n`);
  chmodSync(wrapper, 0o700);
  const s = await f.start([], {SNAPBACK_NODE:wrapper}, true);
  writeFileSync(join(f.dir, 'snapback/workers/push.mjs'), idle);
  await until(() => s.log.includes('worker needs Node 24'));
  const adoptions = s.log.match(/schema adopted as generation/g)?.length ?? 0;
  rmSync(join(f.dir, 'bad-node'));
  await until(() => rows(join(f.dir, 'starts')).length === 1);
  assert.equal(s.log.match(/schema adopted as generation/g)?.length ?? 0, adoptions);
});

for (const signal of ['SIGTERM','SIGINT','SIGHUP']) test(`watchdog ${signal} completes group cleanup without a live supervisor`, {timeout:hangBudget(5)}, async t => {
  const f = fixture(t, `import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
process.on('SIGTERM',()=>{});appendFileSync('starts',JSON.stringify({pid:process.pid,helper:helper.pid})+'\\n');setInterval(()=>{},1000);`);
  const watchdog=spawn(binary,['--internal-worker-watchdog',process.execPath,join(f.dir,'snapback/workers/push.mjs'),'-1'],{cwd:f.dir,stdio:['pipe','pipe','pipe']});
  const done=once(watchdog,'exit');watchdog.stdout.resume();watchdog.stderr.resume();
  t.after(async()=>{watchdog.stdin.end();await done;});
  await until(()=>rows(join(f.dir,'starts')).length===1);
  const first=rows(join(f.dir,'starts'))[0];await sleep(150);
  watchdog.kill(signal);await done;
  assert.equal(alive(first.pid),false);
  // The watchdog reaps Node, but cannot waitpid Node's child. SIGKILL delivery
  // to that descendant can finish after the watchdog's exit event is observed.
  // Keep the test's existing timeout and still require the descendant to die.
  await until(() => !alive(first.helper));
  assert.equal(alive(first.helper),false);
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
  db.exec('BEGIN IMMEDIATE');
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
  assert.ok(paths.slice(0, 2).every(p => !p.startsWith(join(f.dir, '.snapback4'))));
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
  const f = fixture(t, `import {writeFileSync} from 'node:fs';
writeFileSync('environment-result',JSON.stringify({keys:Object.keys(process.env).sort(),preloaded:!!globalThis.preloaded}));setInterval(()=>{},1000);`);
  const preload = join(f.dir, 'preload.cjs');
  writeFileSync(preload, 'globalThis.preloaded=true;');
  const s = await f.start([], {NODE_OPTIONS:`--require=${preload}`, NODE_PATH:f.dir, WK_UNDECLARED:'unused'}, false, mode);
  await until(() => existsSync(join(s.workdir, 'environment-result')));
  const actual = JSON.parse(readFileSync(join(s.workdir, 'environment-result'), 'utf8'));
  assert.equal(actual.preloaded, false, 'only validated project source runs before its declared imports');
  const allowed = ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','SNAPBACK_URL','SNAPBACK_SERVICE_TOKEN','SNAPBACK_WORKER_LEDGER','SNAPBACK_WORKER_SUPERVISED'];
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
  db.exec("CREATE TRIGGER hold_retirement BEFORE DELETE ON _sessions BEGIN SELECT RAISE(FAIL,'retirement held'); END");
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
  } finally {db.exec('DROP TRIGGER hold_retirement');}
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
import {writeFileSync} from 'node:fs';writeFileSync('checked-value',value);setInterval(()=>{},1000);`);
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
