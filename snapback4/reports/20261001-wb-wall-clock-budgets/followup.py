"""After the five main repetitions, qualify the last audited file at final bytes."""
from pathlib import Path
import json,os,shutil,subprocess,time
report=Path(__file__).resolve().parent;root=report.parents[1]
while not (report/'heavy-results.json').exists() or not (report/'final-source-ready.json').exists():time.sleep(10)
results=json.loads((report/'heavy-results.json').read_text())
# Complete the scoped follow-up even if the earlier run found another failure;
# the final qualification checker, not this driver, decides eligibility.
runs=json.loads((report/'runs.json').read_text());children=[]
names=json.loads((report/'late-files.json').read_text())
for run in runs:
 target=Path(run['root'])
 for name in names:shutil.copy2(root/name,target/name)
 env=dict(os.environ,WB_RUN_ROOT=str(target),WB_CPUS=run['cpus'],WB_MANIFEST='source-manifest-final.json')
 children.append((run,subprocess.Popen(['python3',str(report/'run.py'),run['name']+'-final','48','--','python3',str(report/'followup-tests.py')],env=env)))
results=[dict(name=run['name']+'-final',exit=child.wait()) for run,child in children]
(report/'followup-results.json').write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(any(run['exit'] for run in results))
