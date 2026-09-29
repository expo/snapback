from pathlib import Path
import shutil,subprocess,json,sys
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round3';repo=r/'lane/snapback4';u=(e/'owned.udid').read_text().strip()
p=s/'src/NPProbe.tsx';p.write_text(p.read_text().replace("marker = 'NP B'", "marker = 'NP A'"));(e/'NPProbe-A.tsx').write_bytes(p.read_bytes())
for suffix in ['', '@2x', '@3x']:shutil.copy2(repo/f'reports/20260929-np-macos-slice/subject/A-assets/probe-A{suffix}.png',s/f'assets/np/probe{suffix}.png')
name=sys.argv[1] if len(sys.argv)>1 else 'a-ownbuild-1'
code=subprocess.run(['python3',str(r/'run-witness-r3.py'),name,'--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
print(name,code,flush=True);sys.exit(code)
