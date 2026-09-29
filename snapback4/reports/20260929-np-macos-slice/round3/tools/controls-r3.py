from pathlib import Path
import subprocess,time,json
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3';results=[]
assert json.loads((e/'sealed-b-warm-ownbuild-1-command.json').read_text())['exitStatus']==0
for name,args in [('preserve-build-records',['sealed-b-warm-ownbuild-1']),('input-controls',[]),('native-controls',[]),('cold-error-control',[]),('death-control',[]),('owner-controls',[])]:
 command=['python3',str(r/(name+'-r3.py')),*args];start=time.time()
 with (e/(name+'-execution.log')).open('x') as log:p=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'argv':command,'exitStatus':p.returncode,'durationMs':round((time.time()-start)*1000)})
 (e/'control-executions.json').write_text(json.dumps(results,indent=2));print(name,p.returncode,flush=True);assert p.returncode==0
