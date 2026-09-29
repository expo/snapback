from pathlib import Path
import shutil,subprocess,json
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round2';repo=r/'lane/snapback4';u=(e/'owned.udid').read_text().strip()
p=s/'src/NPProbe.tsx';p.write_text(p.read_text().replace("marker = 'NP B'", "marker = 'NP A'"));(e/'NPProbe-qualified-A.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/A-assets/probe-A{suffix}.png',s/f'assets/np/probe{suffix}.png')
code=subprocess.run(['python3',str(r/'run-witness-r2.py'),'qualified-a-ownbuild-1','--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
print('qualified-a-ownbuild-1',code,flush=True);assert code==0
subprocess.run(['python3',str(r/'qualified-sample-r2.py')],check=True)
code=subprocess.run(['python3',str(r/'run-witness-r2.py'),'qualified-b-warm-ownbuild-1','--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
print('qualified-b-warm-ownbuild-1',code,flush=True);assert code==0
