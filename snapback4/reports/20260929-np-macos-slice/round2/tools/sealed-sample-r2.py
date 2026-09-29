from pathlib import Path
import shutil,subprocess,json
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round2';repo=r/'lane/snapback4';u=(e/'owned.udid').read_text().strip()
p=s/'src/NPProbe.tsx';p.write_text(p.read_text().replace("marker = 'NP A'", "marker = 'NP B'"));(e/'NPProbe-B.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/assets/np/probe{suffix}.png',s/f'assets/np/probe{suffix}.png')
results=[]
for n in range(1,6):
 name=f'sealed-b-repack-{n}'
 code=subprocess.run(['python3',str(r/'run-witness-r2.py'),name,'--repack',str(e/'sealed-a-ownbuild-2/build.json'),'--app-project',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
 record=json.loads((e/f'{name}-command.json').read_text());print(name,code,record['durationMs'],flush=True);results.append({'name':name,'exitStatus':code,'durationMs':record['durationMs']})
(e/'sealed-sample-results.json').write_text(json.dumps(results,indent=2))
assert all(x['exitStatus']==0 for x in results)
