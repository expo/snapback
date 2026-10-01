"""Final unconfined converted files, then exactly one whole suite invocation."""
from pathlib import Path
import json,os,subprocess,time
report=Path(__file__).resolve().parent;root=report.parents[1]
while not (report/'repair-results.json').exists():time.sleep(10)
from check_initial import check_initial
from check_followup import check_followup
check_initial(report)
check_followup(report)
assert all(x['exit']==0 for x in json.loads((report/'repair-results.json').read_text())), 'diagnose final contention failures before final runs'
env=dict(os.environ,WB_MANIFEST='source-manifest-repaired.json')
command=['python3',str(report/'run.py'),'final-unconfined','0','unconfined','--','python3',str(report/'converted.py')]
result=subprocess.run(command,env=env)
assert result.returncode==0, 'diagnose converted-file failures before the once-only full suite'
assert not (report/'whole-suite.json').exists(), 'the whole suite must run once'
result=subprocess.run(['python3',str(report/'run.py'),'whole-suite','0','unconfined'],env=env)
raise SystemExit(result.returncode)
