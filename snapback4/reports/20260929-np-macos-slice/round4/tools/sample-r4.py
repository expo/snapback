from pathlib import Path
import shutil,subprocess,json,hashlib,statistics,math
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round4';repo=r/'lane/snapback4';tools=repo/'reports/20260929-np-macos-slice/round4/tools';u=(e/'owned.udid').read_text().strip()
results=[]
def run(name):
 code=subprocess.run(['python3',str(tools/'run-witness-r4.py'),name,'--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
 record=json.loads((e/f'{name}-command.json').read_text());results.append({'name':name,'exitStatus':code,'durationMs':record['durationMs']});(e/'sample-results.json').write_text(json.dumps(results,indent=2));print(name,code,record['durationMs'],flush=True)
 assert code==0, name
 receipt=json.loads((e/name/'build.json').read_text())
 for row in receipt['nativeClosure']['compiler']['records']:
  p=s/'.snapback4-witness'/row['path'];b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'];dest=e/name/'native-dependencies'/row['path'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
p=s/'src/NPProbe.tsx';p.write_text(p.read_text().replace("marker = 'NP B'", "marker = 'NP A'"));(e/'NPProbe-A.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/A-assets/probe-A{suffix}.png',s/f'assets/np/probe{suffix}.png')
run('a-ownbuild-1')
p.write_text(p.read_text().replace("marker = 'NP A'", "marker = 'NP B'"));(e/'NPProbe-B.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/assets/np/probe{suffix}.png',s/f'assets/np/probe{suffix}.png')
for n in range(1,6):run(f'b-warm-ownbuild-{n}')
times=sorted(x['durationMs'] for x in results[1:]);(e/'timings.json').write_text(json.dumps({'n':len(times),'medianMs':statistics.median(times),'nearestRankP95Ms':times[math.ceil(.95*len(times))-1],'runs':results},indent=2));print(times,flush=True)
