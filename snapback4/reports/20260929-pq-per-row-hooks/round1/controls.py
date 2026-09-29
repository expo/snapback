"""Run dist-only mutations in an isolated SDK copy; never alter a running suite's SDK."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
root=Path.cwd()
report=root/'reports/20260929-pq-per-row-hooks/round1'
variants=[
 ('no-active-cancel','dist/read-work.js','active?.abort();','', 'closed active reads', 'per-row-liveness'),
 ('no-attempt-expiry','dist/read-work.js','attempt.abort(READ_WORK_EXPIRED)','void 0','expired active reads','per-row-liveness'),
 ('no-unknown-refresh','dist/local.js',' || touched === undefined','', 'unknown apply footprint', 'per-row-liveness'),
 ('move-duplicate-to-tail','dist/read-work.js','this.pending.set(watch, run);','this.pending.delete(watch); this.pending.set(watch, run);','queued owners progress','per-row-work'),
 ('react-raw-keys','src/react.tsx','const key = readKey(op, args);','const key = JSON.stringify(args);','canonical arguments across renders','per-row-react'),
]
with tempfile.TemporaryDirectory(prefix='.pq-r1-controls-',dir=root) as directory:
 home=Path(directory)/'snapback4'
 package=home/'packages/snapback4'
 package.mkdir(parents=True)
 original=root/'packages/snapback4'
 for name in ['dist','test','src']:
  shutil.copytree(original/name,package/name)
 for name in ['node_modules']:
  (package/name).symlink_to(original/name,target_is_directory=True)
 shutil.copy(original/'package.json',package/'package.json')
 (home/'witness').symlink_to(root/'witness',target_is_directory=True)
 for name in ['apps','node_modules']:
  (home/name).symlink_to(root/name,target_is_directory=True)
 shutil.copy(root/'package.json',home/'package.json')
 env={**os.environ,'SNAPBACK4_BIN':str(root/'target/debug/snapback4')}
 for name,file,old,new,pattern,test in variants:
  p=package/file
  source=p.read_text()
  assert old in source,(name,old)
  try:
   p.write_text(source.replace(old,new,2 if name == "react-raw-keys" else 1))
   with (report/(name+'.log')).open('w') as log:
    result=subprocess.run(['node','--test','--test-name-pattern='+pattern,str(package/'test'/(test+'.test.mjs'))],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=45)
   print(name, result.returncode,flush=True)
   assert result.returncode==1, name+' survived'
  finally:
   p.write_text(source)
