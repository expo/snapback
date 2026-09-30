#!/usr/bin/env python3
"""Observe owned C ABI replay: /proc fd sizes include SQLite's unlinked scratch.
Run from repo root. Arguments: library, opening, requests, fresh db, output prefix.
Sampling logical file sizes (not cumulative I/O) every 20ms, best-effort peaks.
"""
import json, os, subprocess, sys, time
from pathlib import Path
lib, opening, requests, db, prefix = sys.argv[1:]
out=Path(prefix); samples=[]; peak_scratch=peak_total=peak_rss=0; peak_sample={}
with open(str(out)+'.json','w') as result, open(str(out)+'.stderr','w') as err:
 child=subprocess.Popen([sys.executable,str(Path(__file__).parent.parent/'replay-ffi.py'),lib,opening,requests,db],stdout=result,stderr=err)
 while child.poll() is None:
  scratch=0; files={}
  try:
   for fd in Path(f'/proc/{child.pid}/fd').iterdir():
    try:
     name=os.readlink(fd)
     if name.endswith(' (deleted)') and ('etilqs' in name or '/tmp/' in name):
      st=fd.stat();files[(st.st_dev,st.st_ino)]={'path':name,'bytes':st.st_size}
    except OSError: pass
   scratch=sum(f['bytes'] for f in files.values())
   state=Path(f'/proc/{child.pid}/status').read_text()
   rss=int(state.split('VmRSS:')[1].split()[0])*1024 if 'VmRSS:' in state else 0
  except OSError: rss=0
  disk={}
  for suffix in ['', '-wal', '-shm']:
   try: disk[suffix or 'db']=Path(db+suffix).stat().st_size
   except FileNotFoundError: pass
  total=scratch+sum(disk.values());peak_rss=max(peak_rss,rss);peak_scratch=max(peak_scratch,scratch)
  if total>peak_total:
   peak_total=total;peak_sample={'disk':disk,'scratchFiles':list(files.values()),'rssBytes':rss}
  time.sleep(.02)
 status=child.wait()
Path(str(out)+'.space.json').write_text(json.dumps({'exit':status,'intervalMs':20,'scratchPeakBytes':peak_scratch,'totalPeakBytes':peak_total,'rssPeakBytes':peak_rss,'atTotalPeak':peak_sample,'finalDbBytes':Path(db).stat().st_size if Path(db).exists() else None},indent=2)+'\n')
sys.exit(status)
