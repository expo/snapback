"""Run the audited affected files with the publication client-pool policy."""
import json, os, subprocess
from pathlib import Path
root=Path(os.environ.get("WB_RUN_ROOT", Path(__file__).resolve().parents[2]))
files=json.loads((Path(__file__).parent/'converted-files.json').read_text())
cpus=int(subprocess.check_output(['node','-p','require("node:os").availableParallelism()']))
models=[p for p in files if Path(p).name in ('app-session-model.test.mjs','online-client-model.test.mjs')]
ordinary=[p for p in files if p not in models]
slots=max(1,min(24,cpus//3))
print(f'WB converted files: {len(files)}; available CPUs: {cpus}; ordinary slots: {slots}; models: {len(models)}',flush=True)
status=0
for group,concurrency in [(ordinary,slots),(models,1)]:
 if group:status |= subprocess.call(['node','--test','--test-concurrency='+str(concurrency),*group],cwd=root)
raise SystemExit(status)
