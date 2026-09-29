"""Isolated controls: production workspace and a running suite remain untouched."""
from pathlib import Path
import os, shutil, subprocess, tempfile
root=Path.cwd(); report=root/'reports/20260929-pq-per-row-hooks/round2'
variants=[
 ('no-due-expiry-retry','dist/client.js','result.nextExpiry !== null && result.nextExpiry > clock.estimatedServerNow()','true','due floor still permits','keep-clock'),
 ('no-client-reset','dist/client.js','resetVersion !== watch.resetVersion','false','online.*pre-reset','per-row-publication'),
 ('no-local-reset','dist/local.js','resetVersion !== watch.resetVersion','false','(?:wasm|process).*pre-reset','per-row-publication'),
 ('no-unknown-drain','dist/local.js','committedTables.unknown = true','committedTables.unknown = false','unknown apply refresh drains','per-row-publication'),
 ('client-floor-loading','dist/client.js','if (result.deadlineWithdrawn?.())\n                return;','if (result.deadlineWithdrawn?.()) { watch.publish({ loading: true }); return; }','online.*floor-rejected','per-row-publication'),
 ('local-floor-loading','dist/local-query.js','return { ...loading, deadlineWithdrawn: true };','return loading;','(?:wasm|process).*floor-rejected','per-row-publication'),
 ('move-duplicate-to-tail','dist/read-work.js','this.pending.set(watch, run);','this.pending.delete(watch); this.pending.set(watch, run);','queued owners progress','per-row-work'),
 ('no-active-cancel','dist/read-work.js','active?.abort();','','closed active reads','per-row-liveness'),
 ('no-attempt-expiry','dist/read-work.js','attempt.abort(READ_WORK_EXPIRED)','void 0','expired active reads','per-row-liveness'),
 ('react-raw-keys','src/react.tsx','const key = readKey(op, args);','const key = JSON.stringify(args);','canonical arguments across renders','per-row-react'),
 ('queued-loading','src/client.ts','watch.reload(); notify(watch);','watch.publish({ loading: true }); notify(watch);','zero loading renders','per-row-react'),
]
with tempfile.TemporaryDirectory(prefix='.pq-r2-controls-',dir=root) as directory:
 home=Path(directory)/'snapback4'; package=home/'packages/snapback4'; package.mkdir(parents=True)
 original=root/'packages/snapback4'
 for name in ['dist','test','src']: shutil.copytree(original/name,package/name)
 (package/'node_modules').symlink_to(original/'node_modules',target_is_directory=True)
 shutil.copy(original/'package.json',package/'package.json')
 for name in ['witness','apps','node_modules']: (home/name).symlink_to(root/name,target_is_directory=True)
 shutil.copy(root/'package.json',home/'package.json')
 env={**os.environ,'SNAPBACK4_BIN':str(root/'target/debug/snapback4')}
 for name,file,old,new,pattern,test in ([] if os.environ.get("PQ_BASELINE_ONLY") else variants):
  if os.environ.get("PQ_CONTROL_ONLY") and name != os.environ["PQ_CONTROL_ONLY"]: continue
  path=package/file; source=path.read_text()
  assert old in source,(name,old)
  try:
   path.write_text(source.replace(old,new))
   with (report/(name+'.log')).open('w') as log:
    run=subprocess.run(['node','--test','--test-name-pattern='+pattern,str(package/'test'/(test+'.test.mjs'))],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
   print(name,run.returncode,flush=True)
   assert run.returncode==1,name+' survived'
  finally:path.write_text(source)
 if os.environ.get("PQ_CONTROL_ONLY"): raise SystemExit(0)
 # Main's pre-LV implementation, transpiled in the same isolated package.
 tracked=subprocess.check_output(['git','ls-tree','-r','--name-only','HEAD','packages/snapback4/src'],text=True).splitlines()
 # git paths from this cwd are relative to the repository root in ls-tree.
 if not tracked: tracked=subprocess.check_output(['git','ls-tree','-r','--name-only','HEAD','snapback4/packages/snapback4/src'],cwd=root.parent,text=True).splitlines()
 for name in tracked:
  rel=name.split('packages/snapback4/src/',1)[1]
  target=package/'src'/rel
  target.parent.mkdir(parents=True,exist_ok=True)
  content=subprocess.check_output(['git','show','HEAD:snapback4/packages/snapback4/src/'+rel])
  target.write_bytes(content)
 script="""
import ts from 'typescript';import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
for(const f of readdirSync('src'))if(/\\.tsx?$/.test(f)&&!f.endsWith('.d.ts')) {
 const result=ts.transpileModule(readFileSync('src/'+f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,rewriteRelativeImportExtensions:true}});
 writeFileSync('dist/'+f.replace(/\\.tsx?$/,'.js'),result.outputText);
}
"""
 subprocess.run(['node','--input-type=module','-e',script],cwd=package,check=True)
 with (report/'baseline-unknown.log').open('w') as log:
  run=subprocess.run(['node','--test','--test-name-pattern=unknown apply refresh drains',str(package/'test/per-row-publication.test.mjs')],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
 print('pre-LV unknown-footprint case',run.returncode,flush=True)
 assert run.returncode==0
