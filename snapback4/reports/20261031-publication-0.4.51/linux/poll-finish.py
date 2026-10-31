from pathlib import Path
import subprocess,json
r=Path('/home/ccheever/sb4-pub-0451-records')
p=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','ccheever@charlies-macbook-pro-m5max-black','python3 ~/sb4-pub-0451/status-finish.py'],capture_output=True,text=True,timeout=45)
if p.returncode:raise RuntimeError(f'own finish status SSH exit {p.returncode}')
q=json.loads(p.stdout)
(r/'finish-latest.json').write_text(json.dumps(q,indent=2)+'\n')
with (r/'finish-progress.jsonl').open('a') as f:f.write(json.dumps(q)+'\n')
print(json.dumps(q,indent=2))
