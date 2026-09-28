// Mutate disposable built SDK copies; never the worktree's source or dist.
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve('snapback4'), pkg = join(root, 'packages/snapback4');
const out = join(root, 'reports/20260928-fu-fresh-replay-uploads/round4'), target = join(root, 'target/fu-r4-controls');
const cases = [
  ['cache-peer-claim', 'session-rotation', 'if (prior)\n                return warn(prior);', 'if (prior) rotate.cached = prior; if (rotate.cached) return warn(rotate.cached);', 'peer releases', 'refresh-custody'],
  ['no-durable-claim', 'session-rotation', 'await storage.set(key, JSON.stringify({ ...saved, snapback4Rotation: { why: uncertain(), pending: true } }));', '', 'shared-store peer.*reset', 'refresh-custody'],
  ['fence-unsent', 'http-response', 'export function provenNonDispatch(error) {', 'export function provenNonDispatch(error) { return false;', 'proven unsent', 'refresh-custody'],
  ['malformed-auth', 'auth', 'json.denied ?? invalidResponse(response.status, "session refresh")', 'json.denied ?? {code:"E_AUTH",family:"auth",message:"session refresh was refused"}', 'shared-store peer.*json', 'refresh-custody'],
  ['spin-nonretryable', 'local', 'await pauseRefusal(response, { ...denied, retryable: true }, aborter.signal);', 'if (denied.retryable !== false) await pauseRefusal(response, { ...denied, retryable: true }, aborter.signal);', 'probe recovery paces nonretryable', 'overload'],
  ['discard-probe-headers', 'local', 'await pauseRefusal(response, { ...denied, retryable: true }, aborter.signal);', 'await pauseRefusal(new Response(null, {status:response.status}), { ...denied, retryable: true }, aborter.signal);', 'probe recovery', 'overload'],
  ['hide-changes-refusal', 'http-response', 'if (!refusal(why)?.retryable)', 'if (!refusal(why))', 'nonretryable changes', 'refresh-custody'],
];
const results = [];
for (const [name, module, needle, replacement, pattern, file] of cases) {
  const dest = join(target, name); mkdirSync(dest, {recursive:true});
  for (const path of ['dist','src/wasm','package.json','test/overload.test.mjs','test/refresh-custody.test.mjs','test/helpers/app-server.mjs']) cpSync(join(pkg,path),join(dest,path),{recursive:true});
  if(!existsSync(join(dest,'node_modules'))) symlinkSync(join(root,'node_modules'),join(dest,'node_modules'),'dir');
  const source = readFileSync(join(dest,'dist',module+'.js'),'utf8');
  if (!source.includes(needle)) throw Error('missing control needle: '+name);
  writeFileSync(join(dest,'dist',module+'.js'),source.replace(needle,replacement));
  const run = spawnSync(process.execPath,['--test','--test-name-pattern='+pattern,join(dest,'test',file+'.test.mjs')], {env:{...process.env,SNAPBACK4_BIN:join(root,'target/debug/snapback4')},encoding:'utf8',timeout:180000,maxBuffer:16<<20});
  writeFileSync(join(out,name+'-negative.log'),run.stdout+run.stderr);
  const failed = [...new Set([...run.stdout.matchAll(/^✖ (.*) \([0-9.]+ms\)$/gm)].map(m=>m[1]))];
  const record = {name,exit:run.status,signal:run.signal,failed}; results.push(record); console.log(JSON.stringify(record));
  if(run.status!==1 || !failed.length) throw Error('control did not fail: '+name);
}
writeFileSync(join(out,'negative-controls.json'),JSON.stringify(results,null,2)+'\n');
