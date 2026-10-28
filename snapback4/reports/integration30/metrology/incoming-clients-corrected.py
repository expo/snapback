from pathlib import Path
import json,subprocess,time,os
p=Path(__file__).parent;plan=json.loads((p/'incoming-clients-corrected.json').read_text());args=['node','scripts/run-client-tests.mjs','4','files',*plan['files']];start=time.time();assert all((Path('/home/ccheever/projects/snapback-sb4loop/snapback4')/f).is_file()for f in plan['files'])
with(p/'incoming-clients-corrected.log').open('w')as log:r=subprocess.run(['timeout','--kill-after=20s','1800s',*args],cwd='/home/ccheever/projects/snapback-sb4loop/snapback4',stdout=log,stderr=subprocess.STDOUT)
(p/'incoming-clients-corrected-result.json').write_text(json.dumps(dict(source=plan['source'],files=plan['files'],exit=r.returncode,seconds=time.time()-start,command=args),indent=2)+'\n');raise SystemExit(r.returncode)
