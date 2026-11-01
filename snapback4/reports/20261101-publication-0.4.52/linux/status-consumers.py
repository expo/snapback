#!/usr/bin/env python3
"""Display proof outcomes only; do not print consumer or credential payloads."""
from pathlib import Path
from datetime import datetime, timezone
import json, shutil
r=Path.home()/'sb4-pub-0452-records';q=r/'linux-qualification-0.4.52'
print(datetime.now(timezone.utc).isoformat(),'freeGiB',shutil.disk_usage(r).free//2**30)
rows=[];bad=[]
for p in sorted(q.glob('*.json'),key=lambda p:p.stat().st_mtime):
 try:j=json.loads(p.read_text())
 except (OSError,json.JSONDecodeError):continue
 values=j if isinstance(j,list) else [j]
 states=[v.get('status') for v in values if isinstance(v,dict) and 'status' in v]
 states=[x if x in {'passed','failed','skipped','error'} else 'unknown' for x in states if isinstance(x,str)]
 rows.append((p.name,len(values),states))
 if any(x!='passed' for x in states):bad.append((p.name,states))
print('proof record files',len(rows),'recent',rows[-7:]);print('non-passing outcomes',bad)
for name in ['linux-1','qualify-after-native-a2']:
 p=r/(name+'.exit');print(name,p.read_text().strip() if p.exists() else 'pending')
p=q/'receipt.json';print('qualification receipt exists',p.exists())
