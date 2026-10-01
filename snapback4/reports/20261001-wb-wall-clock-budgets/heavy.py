"""Run five independent 10-CPU/48-worker repetitions on isolated sources/caches."""
from pathlib import Path
import json,os,subprocess
report=Path(__file__).resolve().parent
runs=json.loads((report/'runs.json').read_text());assert len(runs)==5
children=[]
for run in runs:
 env=dict(os.environ,WB_RUN_ROOT=run['root'],WB_CPUS=run['cpus'],WB_MANIFEST='source-manifest-repaired.json')
 command=['python3',str(report/'run.py'),run['name'],'48','--','python3',str(report/'converted.py')]
 children.append((run,subprocess.Popen(command,env=env)))
results=[dict(name=run['name'],exit=child.wait()) for run,child in children]
(report/'heavy-results.json').write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(any(run['exit'] for run in results))
