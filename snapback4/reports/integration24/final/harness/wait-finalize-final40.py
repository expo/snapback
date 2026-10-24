from pathlib import Path
import time,subprocess
b=Path('/home/ccheever/sb4-loop/integ24')
for name in ['rust-wave26-final40.exit','docs-budget-wave26-final40.exit']:
 while not(b/name).exists():time.sleep(3)
 assert(b/name).read_text().strip()=='0',name
r=subprocess.run(['timeout','240s','python3',str(b/'harness/finalize-final40.py')],timeout=260)
(b/'finalize-final40.exit').write_text(str(r.returncode)+'\n');assert r.returncode==0
