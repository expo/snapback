"""Drain copied stores, then close owned servers BEFORE the restart comparison."""
import pathlib,subprocess,os,socket,time,json,signal
base=pathlib.Path('target/sq').resolve();tool=pathlib.Path(__file__).resolve().parent
stages=json.loads(os.environ['SQ_STAGES']);children=[]
try:
 for stage,port in stages:
  with (base/(stage+'-quiesce.log')).open('wb') as f:p=subprocess.Popen([str(base/'snapback4-diagnostic'),'dev','--port',str(port),'--replay','--no-watch'],cwd=base/stage,stdout=f,stderr=f,start_new_session=True)
  children.append(p)
  for _ in range(300):
   if p.poll() is not None:raise RuntimeError('server exited')
   try:
    with socket.create_connection(('127.0.0.1',port),.1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  records=[];clean=0
  for _ in range(300):
   record=json.loads(subprocess.check_output(['python3',str(tool/'queues.py'),str(base/stage/'.snapback4/store.sqlite')],text=True));records.append(record)
   clean=clean+1 if all(n==0 for n in record['queues'].values()) else 0
   if clean==3:break
   time.sleep(1)
  else:raise RuntimeError('queues did not drain in five minutes')
  (base/(stage+'-drain.json')).write_text(json.dumps(records,indent=2))
finally:
 for p in children:
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 for p in children:p.wait(timeout=30)
