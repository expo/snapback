from pathlib import Path
import subprocess,time,json,hashlib
root=Path('/home/ccheever/projects/sb4-w10-flake/snapback4')
report=root/'reports/20261013-flake'
while True:
 p=report/'rust-results.json'
 if p.exists() and len(json.loads(p.read_text()))==2 and not (report/'rust-active.json').exists():break
 time.sleep(5)
assert (root/'target/event-slots-traces.json').exists()
models=['packages/snapback4/test/app-session-model.test.mjs','packages/snapback4/test/online-client-model.test.mjs']
files=sorted(str(p.relative_to(root)) for p in (root/'packages/snapback4/test').glob('*.test.mjs') if str(p.relative_to(root)) not in models)
results=[]
for number in [2,3,4]:
 began=time.time(); commands=[['node','scripts/run-client-tests.mjs','24','files',*files],['node','scripts/run-client-tests.mjs','1','models',*models]]
 codes=[]
 with (report/f'client-run{number}.log').open('w') as out:
  for command in commands:
   child=subprocess.Popen(command,cwd=root,stdout=out,stderr=subprocess.STDOUT)
   (report/'client-active.json').write_text(json.dumps({'run':number,'pid':child.pid,'started':began,'stage':command[3],'pooled_files':len(files),'models':len(models)})+'\n')
   codes.append(child.wait())
 results.append({'run':number,'exits':codes,'started':began,'finished':time.time(),'commands':commands})
 (report/'client-results.json').write_text(json.dumps(results,indent=2)+'\n')
(report/'client-active.json').unlink()
