"""Repeat the complete script/test.sh client stages after callback hardening.

No build, source mutation, seed override or test exclusion beyond the script's
own separation of its two model files from the ordinary client pool.
"""
from pathlib import Path
import json,subprocess,sys
root=Path(__file__).resolve().parents[2]
report=Path(__file__).resolve().parent
models=['packages/snapback4/test/app-session-model.test.mjs','packages/snapback4/test/online-client-model.test.mjs']
files=sorted(str(p.relative_to(root)) for p in (root/'packages/snapback4/test').glob('*.test.mjs') if str(p.relative_to(root)) not in models)
cpus=int(subprocess.check_output(['node','-p','require("node:os").availableParallelism()'],text=True))
concurrency=max(1,min(24,cpus//3))
(report/'final-client-files.json').write_text(json.dumps({'cpus':cpus,'concurrency':concurrency,'files':files,'models':models},indent=2)+'\n')
failures=0
for name,paths,slots in [('client tests',files,concurrency),('client models',models,1)]:
 print(f'== {name}: {len(paths)} files, concurrency {slots}',flush=True)
 p=subprocess.run(['node','--test',f'--test-concurrency={slots}',*paths],cwd=root)
 failures+=int(p.returncode!=0)
 print(f'== {name}: exit {p.returncode}',flush=True)
sys.exit(int(failures!=0))
