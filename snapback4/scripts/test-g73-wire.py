"""Numeric-only wire witness over a private loopback PG connection."""
import json,os,pathlib,re,socket,struct,subprocess,sys,threading,time
from collections import deque
config=dict(re.findall(r'(host|port|user|dbname)=([^ ]+)',os.environ['SNAPBACK4_EVAL_POSTGRES_TCP']))
server=socket.socket();server.bind(('127.0.0.1',0));server.listen(64);server.settimeout(.2)
stop=threading.Event();lock=threading.Lock();records=[];sockets=[];workers=[];next_id=0
fault=os.environ.get('WF_WIRE_FAULT');injected=False
delay_ms=int(os.environ.get('WF_WIRE_DELAY_MS','0'));forward_delays=[]
assert delay_ms in [0,300] and not (delay_ms and fault)

def read(s,n):
 out=bytearray()
 while len(out)<n:
  b=s.recv(n-len(out))
  if not b:raise EOFError()
  out.extend(b)
 return bytes(out)
def packet(s):
 tag=read(s,1);length=read(s,4);data=read(s,struct.unpack('!I',length)[0]-4);return tag,length,data

def connection(front,ident):
 global injected
 back=socket.create_connection(('127.0.0.1',int(config['port'])))
 front.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
 back.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
 def empty():return dict(final=False,error=None,commit=False,cut=False,combined=False)
 # Startup, each simple query and each extended-protocol Sync get one
 # ReadyForQuery. A queued ROLLBACK must not erase its predecessor's error.
 replies=deque([empty()])
 with lock:sockets.extend([front,back])
 def requests():
  global injected
  extended=False;delay_armed=False
  try:
   size=read(front,4);payload=read(front,struct.unpack('!I',size)[0]-4);back.sendall(size+payload)
   while True:
    tag,length,payload=packet(front)
    if tag==b'Q':
     if b'/* wf_dispatch_delay */' in payload:delay_armed=True
     with lock:
      final=payload.rstrip(b'\x00; \n').upper().endswith(b'COMMIT')
      cut=bool(fault and final and b'EXECUTE sb4_rt6_' in payload and not injected)
      if cut:injected=True
      guard=re.search(rb'SELECT [^;]*\._sb4_guard_[^;]*;',payload)
      fence=re.search(rb'SELECT [^;]*\._sb4_fence_[^;]*;',payload)
      tail=payload.find(b'EXECUTE sb4_rt6_')
      deadline=payload.find(b'SELECT pg_temp.sb4_assert_deadline(')
      commit=payload.rfind(b'COMMIT')
      ordered=bool(guard and fence and guard.start()<fence.start()<tail and
                   (deadline<0 or tail<deadline<commit))
      replies.append(dict(final=final,error=None,commit=False,cut=cut,combined=bool(final and tail>=0),checks_before_data=ordered))
     if cut and fault=='before-forward':
      front.shutdown(socket.SHUT_RDWR);back.shutdown(socket.SHUT_RDWR);return
     if delay_ms and delay_armed and b'EXECUTE sb4_rt6_' in payload:
      started=time.monotonic_ns();time.sleep(delay_ms/1000)
      budget=re.search(rb'sb4_assert_deadline\((\d+)\)',payload)
      with lock:forward_delays.append(dict(connection=ident,final=final,delay_us=(time.monotonic_ns()-started)//1000,budget_us=int(budget[1]) if budget else None))
      if final:delay_armed=False
    elif tag in [b'P',b'B',b'D',b'E',b'C']:
     if not extended:
      with lock:replies.append(empty())
      extended=True
    elif tag==b'S':
     if not extended:
      with lock:replies.append(empty())
     extended=False
    back.sendall(tag+length+payload)
  except (EOFError,OSError):
   try:back.shutdown(socket.SHUT_WR)
   except OSError:pass
 t=threading.Thread(target=requests);t.start()
 try:
  while True:
   tag,length,payload=packet(back)
   with lock:
    state=replies[0]
    if tag==b'E':state['error']=next((x[1:].decode('ascii','replace') for x in payload.split(b'\x00') if x.startswith(b'C')),None)
    if tag==b'C' and payload==b'COMMIT\x00':state['commit']=True
    if tag==b'Z':
     records.append(dict(connection=ident,rfq=payload.decode(),**state));replies.popleft()
    cut=state['cut'] and ((fault=='after-row' and tag==b'D') or (fault=='after-commit' and tag==b'C' and payload==b'COMMIT\x00'))
   if cut:break
   front.sendall(tag+length+payload)
 except (EOFError,OSError):pass
 finally:
  for s in [front,back]:
   try:s.shutdown(socket.SHUT_RDWR)
   except OSError:pass
   s.close()
  t.join(5)

def accept():
 global next_id
 while not stop.is_set():
  try:front,_=server.accept()
  except socket.timeout:continue
  except OSError:return
  next_id+=1;t=threading.Thread(target=connection,args=(front,next_id));workers.append(t);t.start()
listener=threading.Thread(target=accept);listener.start()
env=dict(os.environ,SNAPBACK4_EVAL_POSTGRES=f'host=127.0.0.1 port={server.getsockname()[1]} user={config["user"]} dbname={config["dbname"]} sslmode=disable')
if fault:env['WF_WIRE_LOSS']='1'
try:
 child=subprocess.run([sys.argv[1],'g73_dispatch_to_receipt_delay' if delay_ms else 'g73_lost_combined_message' if fault else 'g73_','--include-ignored','--nocapture','--test-threads','1'],env=env)
finally:
 stop.set();server.close();listener.join(5)
 for s in sockets:
  try:s.shutdown(socket.SHUT_RDWR)
  except OSError:pass
 for t in workers:t.join(5)
 assert not any(t.is_alive() for t in workers)
finals=[r for r in records if r['combined']]
checks={'complete_idle_commits':sum(r['commit'] and r['rfq']=='I' and r['error'] is None for r in finals),'assertion_aborts_skip_commit':sum(r['error']=='S4003' and r['rfq']=='E' and not r['commit'] for r in finals),'ticket_timeouts_skip_commit':sum(r['error'] in ['55P03','57014'] and r['rfq']=='E' and not r['commit'] for r in finals),'identity_aborts_skip_commit':sum(r['error'] in ['S4004','S4005'] and r['rfq']=='E' and not r['commit'] for r in finals)}
checks['cumulative_deadline_aborts_skip_commit']=sum(r['error']=='S4006' and r['rfq']=='E' and not r['commit'] for r in finals)
pathlib.Path(os.environ.get('WF_WIRE_OUT','/tmp/wf-wire.json')).write_text(json.dumps({'checks':checks,'records':records,'forward_delays':forward_delays,'child_exit':child.returncode},indent=2))
print(json.dumps(dict(checks, fault=fault,injected=injected,forward_delays=forward_delays)),flush=True)
assert child.returncode==0
assert all(r['checks_before_data'] for r in finals)
if delay_ms:
 assert len(forward_delays)==2 and len({r['connection'] for r in forward_delays})==1
 assert all(r['delay_us']>=delay_ms*1000 for r in forward_delays)
 assert checks['cumulative_deadline_aborts_skip_commit']==1 and checks['complete_idle_commits']==0
elif fault:assert injected
else:assert checks['complete_idle_commits']>=1 and checks['assertion_aborts_skip_commit']==8 and checks['ticket_timeouts_skip_commit']==1 and checks['identity_aborts_skip_commit']==2 and checks['cumulative_deadline_aborts_skip_commit']==1
