"""Requalify client timers and search fixture corrections after the ongoing runs."""
from pathlib import Path
import json,os,shutil,subprocess,time
report=Path(__file__).resolve().parent;root=report.parents[1]
while not (report/'followup-results.json').exists():time.sleep(10)
runs=json.loads((report/'runs.json').read_text());children=[]
names=['packages/snapback4/test/client-seams.test.mjs','packages/snapback4/test/ordinary-search-oracle.test.mjs']
for run in runs:
 target=Path(run['root'])
 for name in names:shutil.copy2(root/name,target/name)
 env=dict(os.environ,WB_RUN_ROOT=str(target),WB_CPUS=run['cpus'],WB_MANIFEST='source-manifest-repaired.json')
 children.append((run,subprocess.Popen(['python3',str(report/'run.py'),run['name']+'-repair','48','--','node','--test','--test-concurrency=3',*names],env=env)))
results=[dict(name=run['name']+'-repair',exit=child.wait()) for run,child in children]
(report/'repair-results.json').write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(any(run['exit'] for run in results))
