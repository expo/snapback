import pathlib,subprocess,os,socket,time,signal
root=pathlib.Path.cwd();base=root/'target/sq';live=base/'live';tool=pathlib.Path(__file__).resolve().parent
binary=str(base/'snapback4-diagnostic')
env=dict(os.environ,SQ_DIAGNOSTIC='1',SQ_QUEUES=str(tool/'queues.py'),SQ_REPO=str(root),SQ_CURVE=str(tool/'curve.mjs'),SQ_SNAPSHOT=str(root/'snapback4/reports/20260928-pf-scale-curves/tools/snapshot.py'),REPLAY_BACKEND_DIR=str(live),SNAPBACK_URL='http://127.0.0.1:49561')
with (base/'live-server.log').open('wb') as f:p=subprocess.Popen([binary,'dev','--port','49561','--replay','--no-watch'],cwd=live,env=env,stdout=f,stderr=f,start_new_session=True)
(base/'live-pid.json').write_text(__import__('json').dumps({'pid':p.pid}))
monitor=subprocess.Popen(['python3',str(tool/'monitor.py'),str(p.pid),str(base/'live-host.jsonl'),str(live/'.snapback4/store.sqlite')])
try:
 for _ in range(300):
  if p.poll() is not None:raise RuntimeError('server exited')
  try:
   with socket.create_connection(('127.0.0.1',49561),.1):break
  except OSError:time.sleep(.1)
 for name in ['starter-m1','starter-m2','starter-m3','scale']:
  with (base/f'live-{name}.log').open('wb') as f:
   subprocess.run(['node','scripts/replay.mjs','instrument/fixtures/'+name+'.log'],cwd=live,env=dict(env,REPLAY_STATE=str(live/'evidence/replay')),stdout=f,stderr=f,check=True)
finally:
 if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 p.wait(timeout=30)
 monitor.wait(timeout=5)
