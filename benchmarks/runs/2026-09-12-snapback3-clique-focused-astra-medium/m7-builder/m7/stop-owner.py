import os,json,time,signal
from pathlib import Path
rows=[json.loads(s) for s in Path('m7/owned-pids.jsonl').read_text().splitlines()];report={'start':time.time(),'beforeSizes':{str(p):p.stat().st_size for p in Path('.snapback3').glob('store.sqlite*')},'signals':[]}
for r in rows:
 pid=r['pid']
 try:
  cmd=Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode()
  if not cmd:continue
  if 'snapback3' not in cmd:raise RuntimeError('Recorded PID no longer same server')
  os.kill(pid,signal.SIGTERM);report['signals'].append({'pid':pid,'signal':'SIGTERM','at':time.time(),'cmdline':cmd})
 except FileNotFoundError:report['signals'].append({'pid':pid,'alreadyExited':True})
 time.sleep(.5)
report['remaining']=[]
for r in rows:
 try:
  stat=Path(f"/proc/{r['pid']}/stat").read_text();state=stat.split(') ')[1].split()[0]
  if state!='Z':report['remaining'].append({'pid':r['pid'],'state':state})
 except FileNotFoundError:pass
report['end']=time.time();report['afterSizes']={str(p):p.stat().st_size for p in Path('.snapback3').glob('store.sqlite*')}
Path('m7/shutdown.json').write_text(json.dumps(report,indent=2));assert not report['remaining'];print(json.dumps(report,indent=2))
