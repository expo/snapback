from pathlib import Path
import os,subprocess,json,time,signal,fcntl,shutil
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round4';d=r/'interrupt-bin-r4';d.mkdir(exist_ok=True);u=(e/'owned.udid').read_text().strip();real=shutil.which('pod');heartbeat=e/'control-interrupted-heartbeat';record=e/'control-interrupted-child.json'
(d/'pod').write_text('''#!/usr/bin/python3
import sys,os,subprocess,json,time,signal
if sys.argv[1:]!=['install']:os.execv(os.environ['NP_REAL_POD'],[os.environ['NP_REAL_POD'],*sys.argv[1:]])
'''.replace("os.environ['NP_REAL_POD']",repr(real))+f'''
code="import os,signal,time,pathlib; signal.signal(signal.SIGTERM,lambda *_:None); p=pathlib.Path({str(heartbeat)!r}); p.write_text('ready'); " + "\\nwhile True: p.open('a').write('x'); time.sleep(.03)"
p=subprocess.Popen(['/usr/bin/python3','-c',code])
open({str(record)!r},'w').write(json.dumps({{'child':p.pid,'parent':os.getpid(),'group':os.getpgrp()}}))
p.wait()
''');(d/'pod').chmod(0o755)
env=dict(os.environ,PATH=str(d)+':'+os.environ['PATH']);name='control-interrupted-preparation'
p=subprocess.Popen(['python3',str(r/'lane/snapback4/reports/20260929-np-macos-slice/round4/tools/run-witness-r4.py'),name,'--build',str(r/'subject'),'--smoke','--udid',u,'--port','49371'],env=env,stdout=subprocess.DEVNULL)
end=time.monotonic()+180
while not heartbeat.exists() and p.poll() is None and time.monotonic()<end:time.sleep(.03)
assert heartbeat.exists(),'controlled descendant never started'
command=json.loads((e/(name+'-command.json')).read_text());owned=json.loads(record.read_text())
def locked():
 with (r/'subject/.snapback4-witness/owner.lock').open('a+') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);return False
  except BlockingIOError:return True
assert locked();os.kill(command['pid'],signal.SIGINT)
time.sleep(.25);heldDuring=locked();assert heldDuring
code=p.wait(timeout=20);before=heartbeat.stat().st_size;time.sleep(.2);after=heartbeat.stat().st_size
assert code==1 and before==after and not locked(),(code,before,after)
(e/'interruption-control.json').write_text(json.dumps({'driverPid':command['pid'],'owned':owned,'signal':'SIGINT','leaseHeldDuringCleanup':heldDuring,'heartbeatStopped':before==after,'leaseReleasedAfterCleanup':not locked(),'exitStatus':code},indent=2));print('interrupted group cleaned',flush=True)
