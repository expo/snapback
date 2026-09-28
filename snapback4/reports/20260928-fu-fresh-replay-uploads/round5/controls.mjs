// Run from the repository root. Every control changes only an ignored SDK copy.
import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import ts from 'typescript';
const root = resolve('snapback4'), pkg = join(root, 'packages/snapback4');
const out = join(root, 'reports/20260928-fu-fresh-replay-uploads/round5');
const target = join(root, 'target/fu-r5-controls'), results = [];
function copy(name, ref) {
  const dest = join(target, name); mkdirSync(dest, {recursive:true});
  for (const path of ['dist', 'src/wasm', 'package.json', 'test/overload.test.mjs', 'test/refresh-behavior.test.mjs', 'test/helpers/app-server.mjs']) cpSync(join(pkg,path), join(dest,path), {recursive:true});
  if (!existsSync(join(dest,'node_modules'))) symlinkSync(join(root,'node_modules'),join(dest,'node_modules'),'dir');
  if (ref) {
    const prefix = 'snapback4/packages/snapback4/src/';
    const paths = execFileSync('git',['ls-tree','-r','--name-only',ref,'--',prefix],{encoding:'utf8'}).trim().split('\n');
    for (const path of paths) {
      if (!path.endsWith('.ts') || path.endsWith('.d.ts')) continue;
      const source = execFileSync('git',['show',`${ref}:${path}`],{encoding:'utf8'});
      const relative = path.slice(prefix.length), output = join(dest,'dist',relative.replace(/\.ts$/,'.js'));
      mkdirSync(dirname(output),{recursive:true});
      const built = ts.transpileModule(source,{fileName:relative,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}});
      writeFileSync(output,built.outputText);
    }
  }
  return dest;
}
function run(name,dest,file,pattern,exit) {
  const r = spawnSync(process.execPath,['--test','--test-name-pattern='+pattern,join(dest,'test',file+'.test.mjs')],{env:{...process.env,SNAPBACK4_BIN:join(root,'target/debug/snapback4')},encoding:'utf8',timeout:180000,maxBuffer:16<<20});
  writeFileSync(join(out,name+'.log'),r.stdout+r.stderr);
  const record = {name,exit:r.status,signal:r.signal,error:r.error?.message,failed:[...new Set([...r.stdout.matchAll(/^✖ (.+?) \(/gm)].map(m=>m[1]))],summary:r.stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|cancelled|skipped)/.test(l))};
  results.push(record); writeFileSync(join(out,'controls.json'),JSON.stringify(results,null,2)+'\n'); console.log(JSON.stringify(record));
  if (r.status!==exit || (exit===1 && !record.failed.length)) throw Error('unexpected control result: '+name);
}
const main = copy('main','9ef49d43cb713dfd5c80e0a50ce05164bc0b331d');
run('main-refresh-parity',main,'refresh-behavior','supplied replacement|proven unsent',0);
run('main-refresh-diagnostics-negative',main,'refresh-behavior','refresh (empty|invalid-session|retryable-auth)',1);
run('main-confirmed-reproductions-negative',main,'overload','public asset rotation|public ephemeral refusal|public fresh web schema|public (probe|sync) overload|public auth|concurrent public',1);
const r4 = copy('round4','b22998869ee70e9797e7be9a4f59f2f93a69e150');
run('round4-replacement-negative',r4,'refresh-behavior','supplied replacement',1);
const headers = copy('no-online-probe-headers');
const path = join(headers,'dist/client.js'), source = readFileSync(path,'utf8'), needle = 'await pauseProbe(response, aborter.signal)';
if (!source.includes(needle)) throw Error('missing online probe control');
writeFileSync(path,source.replace(needle,'await pauseProbe(undefined, aborter.signal)'));
run('online-probe-headers-negative',headers,'overload','public online probe recovery',1);
