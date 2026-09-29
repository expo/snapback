from pathlib import Path
import subprocess
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round2';u=(e/'owned.udid').read_text().strip()
outside=s/'SharedNative';link=s/'ios/Pods/np-external.h';outside.mkdir();(outside/'NP.h').write_text('int np_external = 1;\n')
try:
 link.symlink_to('../../SharedNative/NP.h')
 p=subprocess.run(['python3',str(r/'run-witness-r2.py'),'control-pod-link','--repack',str(e/'qualified-a-ownbuild-1/build.json'),'--app-project',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL)
 assert p.returncode==1
 assert 'Pods input outside covered roots' in (e/'control-pod-link.log').read_text()
 print('external Pods link refused',flush=True)
finally:link.unlink();(outside/'NP.h').unlink();outside.rmdir()
