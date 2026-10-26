import subprocess,json,os,time,sys
from pathlib import Path
root=Path('/home/ccheever/projects/snapback-sb4loop');out=Path('/home/ccheever/sb4-loop/reports/integration27')
r=json.loads((root/'target/affected/80411b9d8f63-1793039549314.json').read_text()); rows=[]
ids=set(sys.argv[1:]); env=os.environ.copy();env.update(CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0');env['PATH']='/home/ccheever/.bun-1.4.2/bin:/home/ccheever/.local/bin:'+env['PATH']
for step in r['steps']:
 if step['id'] not in ids:continue
 name=step['id'].replace(':','-'); start=time.time();log=out/('finish-'+name+'.log')
 with log.open('w') as f:code=subprocess.run(['timeout',str(min(step['timeoutSeconds'],3600))+'s',*step['argv']],cwd=root/step['cwd'],env=env,stdout=f,stderr=subprocess.STDOUT).returncode
 rows.append(dict(id=step['id'],status=code,elapsedSeconds=time.time()-start,log=log.name,argv=step['argv'],cwd=step['cwd']))
 (out/('finish-'+sys.argv[1].replace(':','-')+'-receipt.json')).write_text(json.dumps(rows,indent=2)+'\n')
 print(step['id'],code,flush=True)
