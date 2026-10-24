from pathlib import Path
import time,subprocess,concurrent.futures,json
b=Path.home()/'sb4-loop/integ24'
while not(b/'diff-wave26-final40-build.exit').exists():time.sleep(3)
assert (b/'diff-wave26-final40-build.exit').read_text().strip()=='0'
def run(which):
 with(b/('diff-wave26-final40-'+which+'-wrapper.log')).open('w')as log:r=subprocess.run(['timeout','6000s','python3',str(b/'harness/diff-wave26-final40.py'),which],stdout=log,stderr=subprocess.STDOUT,timeout=6020)
 print(which,r.returncode,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as p:list(p.map(run,['base','candidate']))
