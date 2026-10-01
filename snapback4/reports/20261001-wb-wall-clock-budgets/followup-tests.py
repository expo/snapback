"""Run every changed final scope, preserving the separate model pool."""
from pathlib import Path
import json,os,subprocess
root=Path(os.environ['WB_RUN_ROOT']);report=Path(__file__).resolve().parent
files=json.loads((report/'late-tests.json').read_text())
models=[p for p in files if Path(p).name in ('app-session-model.test.mjs','online-client-model.test.mjs')]
ordinary=[p for p in files if p not in models]
status=0
for group,concurrency in [(ordinary,3),(models,1)]:
 if group:status |= subprocess.call(['node','--test','--test-concurrency='+str(concurrency),*group],cwd=root)
raise SystemExit(status)
