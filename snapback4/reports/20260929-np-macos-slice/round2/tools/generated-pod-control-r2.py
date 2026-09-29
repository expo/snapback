from pathlib import Path
import subprocess
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round2';u=(e/'owned.udid').read_text().strip()
f=s/'ios/build/generated/ios/ReactAppDependencyProvider/RCTAppDependencyProvider.h';original=f.read_bytes()
try:
 f.write_bytes(original+b'\n// NP controlled generated input change\n')
 p=subprocess.run(['python3',str(r/'run-witness-r2.py'),'control-generated-pod','--repack',str(e/'sealed-a-ownbuild-2/build.json'),'--app-project',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL)
 assert p.returncode==1
 assert 'input differences in podsGenerated' in (e/'control-generated-pod.log').read_text()
 print('generated Pods target edit refused',flush=True)
finally:f.write_bytes(original)
