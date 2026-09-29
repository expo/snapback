from pathlib import Path
import subprocess,time,json
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3';deadline=time.time()+1800
while True:
 j=json.loads((e/'sealed-a-ownbuild-1-command.json').read_text())
 if 'exitStatus' in j:assert j['exitStatus']==0;break
 assert time.time()<deadline
 time.sleep(.5)
for script in ['sealed-sample','controls','verify-evidence','pins-and-sizes']:
 with (e/(script+'-execution.log')).open('x') as log:
  p=subprocess.run(['python3',str(r/(script+'-r3.py'))],stdout=log,stderr=subprocess.STDOUT)
 print(script,p.returncode,flush=True);assert p.returncode==0
