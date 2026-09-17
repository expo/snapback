from pathlib import Path
import subprocess,time,os,re
root=Path.cwd();out=root/'target/d2/r2';start=time.monotonic()
while not re.search(r'^== (?:\d+ failure|all checks)', (out/'suite.log').read_text(), re.M):
 if time.monotonic()-start>3600:raise RuntimeError('full suite has not completed after one hour; measurements not started')
 time.sleep(5)
print('full suite complete; starting non-overlapping pairs',flush=True)
commands=[('repeat-server',['python3','target/d2/r2/paired.py','server','repeat']),('paired-device',['python3','target/d2/r2/paired.py','device']),('paired-storage',['python3','target/d2/r2/storage-pairs.py'])]
env=dict(os.environ,TMPDIR='/private/tmp/snapback4-d2-r2')
for label,command in commands:
 print('start',label,flush=True)
 with (out/(label+'.log')).open('w') as log:subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 print('done',label,flush=True)
