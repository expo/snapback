import subprocess,sys,time,datetime,json,os
from pathlib import Path
name='attempt-3-'+sys.argv[1]; command=sys.argv[2:]
root=Path('/Users/ccheever/projects/snapback-pub-041b/snapback4')
report=root/'reports/20260924-publication-0.4.1'
assert not (report/(name+'.json')).exists(), 'Attempt already exists: '+name
env=os.environ.copy()
env['PATH']='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:'+env['PATH']
t0=time.monotonic(); started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (report/(name+'.log')).open('w') as log:
 result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env=env)
record={'name':name,'command':command,'cwd':os.getcwd(),'started_at':started,'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-t0,3),'exit_code':result.returncode,'log':name+'.log'}
(report/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
print('\n'.join((report/(name+'.log')).read_text(errors='replace').splitlines()[-15:]),flush=True)
sys.exit(result.returncode)
