from pathlib import Path
import subprocess
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round2';u=(e/'owned.udid').read_text().strip()
subprocess.run(['python3',str(r/'timed-sample-r2.py')],check=True)
p=subprocess.run(['python3',str(r/'run-witness-r2.py'),'timed-b-warm-ownbuild-1','--build',str(r/'subject'),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL);print('timed warm own B',p.returncode,flush=True);assert p.returncode==0
