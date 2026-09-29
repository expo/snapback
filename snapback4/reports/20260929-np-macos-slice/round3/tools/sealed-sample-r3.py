from pathlib import Path
import shutil,subprocess,json,hashlib
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round3';repo=r/'lane/snapback4';u=(e/'owned.udid').read_text().strip();base=e/'sealed-a-ownbuild-1/build.json'
a=json.loads(base.read_text());cache=s/'.snapback4-witness'
for row in a['nativeClosure']['compiler']['records']:
 p=cache/row['path'];b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'];dest=e/'sealed-a-ownbuild-1/native-dependencies'/row['path'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
p=s/'src/NPProbe.tsx';p.write_text(p.read_text().replace("marker = 'NP A'", "marker = 'NP B'"));(e/'NPProbe-B.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/assets/np/probe{suffix}.png',s/f'assets/np/probe{suffix}.png')
results=[]
for n in range(1,6):
 name=f'sealed-b-repack-{n}'
 code=subprocess.run(['python3',str(r/'run-witness-r3.py'),name,'--repack',str(base),'--app-project',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
 record=json.loads((e/f'{name}-command.json').read_text());print(name,code,record['durationMs'],flush=True);results.append({'name':name,'exitStatus':code,'durationMs':record['durationMs']})
(e/'sealed-sample-results.json').write_text(json.dumps(results,indent=2));assert all(x['exitStatus']==0 for x in results)
code=subprocess.run(['python3',str(r/'run-witness-r3.py'),'sealed-b-warm-ownbuild-1','--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
print('warm own B',code,flush=True);assert code==0
