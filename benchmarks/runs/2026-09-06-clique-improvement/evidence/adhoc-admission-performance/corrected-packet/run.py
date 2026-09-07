#!/usr/bin/env python3
"""PROPOSED correction only: reuse built candidate, baseline then candidate; no retry."""
import argparse,collections,hashlib,http.client,json,os,pathlib,shutil,signal,socket,sqlite3,subprocess,sys,threading,time,traceback
from validate import *
P=pathlib.Path(__file__).resolve().parent; R=P.parent

def read(p):return json.loads(p.read_text())
def write(p,x):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
def identity(pid):
 p=pathlib.Path('/proc')/str(pid);s=(p/'stat').read_text();return dict(pid=pid,startTicks=s[s.rindex(')')+2:].split()[19],exe=os.readlink(p/'exe'),bootId=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip())
def claim(p,x):
 with p.open('x') as f:json.dump(x,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def host():return dict(atEpoch=time.time(),load=os.getloadavg(),memory=pathlib.Path('/proc/meminfo').read_text(),disk=shutil.disk_usage(R)._asdict())
def verify_manifest(root,m):
 leaves={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
 assert leaves==set(m), 'leaf set changed'
 for n,v in m.items():
  p=root/n;data=os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
  assert hashlib.sha256(data).hexdigest()==v['sha256'] and len(data)==v['bytes'],n
  if 'gitBlob' in v:
   assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==v['gitBlob']
   assert p.is_symlink()==(v['mode']=='120000')
   if not p.is_symlink():assert bool(p.stat().st_mode&0o111)==(v['mode']=='100755')
  else:
   assert p.is_symlink()==(v.get('type')=='symlink'),n
   assert oct(p.lstat().st_mode&0o777)==v['mode'],n

def verify(cfg):
 assert str(R)==cfg['remoteRoot']
 verify_manifest(R/'candidate-source',read(P/'candidate-source-manifest.json'))
 verify_manifest(pathlib.Path(cfg['originalSource']),read(P/'original-source-manifest.json'))
 verify_manifest(R/'runtime',read(P/'runtime-manifest.json'))
 verify_manifest(R/'private',read(P/'private-input-manifest.json'))
 for path,v in read(P/'installed-toolchain-manifest.json').items():assert sha(pathlib.Path(path))==v['sha256'],path
 for section,rows in read(P/'cache-manifest.json').items():verify_manifest(R/'cargo-home'/section,rows)
 for path,h in cfg['externalFiles'].items():assert sha(pathlib.Path(path))==h,path
 sf=pathlib.Path(cfg['linuxScaleFreeze']);frozen=read(sf)
 assert frozen['leaf_count']==1158
 for n,h in frozen['files'].items():
  p=sf.parent/n;assert sha(p)==h,n
  assert oct(p.stat().st_mode&0o777)==frozen['file_modes'][n],n
 assert sha(R/'private/checkpoint-10.sqlite')==cfg['checkpointSha256']
 for arm in ('baseline','candidate'):
  root=R/'private/arm-inputs'/arm/'project';assert sha(root/'.snapback/store.sqlite')==cfg['checkpointSha256']
  assert not (root/'.snapback/owner.json').exists()
 verify_retained_attempt(cfg)
 return host()

def verify_retained_attempt(cfg):
 old=R/'packet';assert sha(old/'freeze.json')==cfg['originalPacketFreezeSha256']
 for n,h in read(old/'freeze.json')['files'].items():assert sha(old/n)==h, 'original packet changed'
 for n,v in read(P/'retained-attempt-manifest.json').items():
  p=R/n;assert sha(p)==v['sha256'] and p.stat().st_size==v['bytes'] and oct(p.stat().st_mode&0o777)==v['mode'],n
 # Metadata/hash verification only; no original owner state, credentials or raw response values read.
 terminal=read(R/'execution-01/build.terminal.json');assert terminal['exit']==0 and not terminal['timedOut']
 binding=read(R/'execution-01/candidate-binary.json');binary=pathlib.Path(cfg['candidateOwner'])
 assert binding['path']==str(binary) and binding['sha256']==cfg['candidateOwnerSha256']==sha(binary)
 assert binding['sourceManifest']==sha(P/'candidate-source-manifest.json')
 assert binding['lock']==sha(R/'candidate-source/snapback2/Cargo.lock')
 for i in [read(R/'execution-01.once.json')['identity'],read(R/'execution-01/baseline/owner.launch.json')['identity']]:
  p=pathlib.Path('/proc')/str(i['pid'])/'stat'
  if p.exists():
   s=p.read_text();assert s[s.rindex(')')+2:].split()[19]!=i['startTicks'], 'retained attempt identity still present'

def stop(p,events):
 if p.poll() is None:
  # Only this retained Popen child; no discovered PID or process-name signals.
  events.append(dict(action='SIGTERM',identity=identity(p.pid)));p.terminate()
  try:p.wait(timeout=30)
  except subprocess.TimeoutExpired:
   events.append(dict(action='SIGKILL',identity=identity(p.pid)));p.kill();p.wait(timeout=5)
 return p.returncode

def alarm(*_):raise TimeoutError('original HTTP30s deadline')
def request(port,secret,source,q,private):
 body=encoded(dict(source=source,args=q['args'],**{'as':'system','by':'native-search-scale'}))
 headers={'Content-Type':'application/json','Connection':'close','Accept-Encoding':'identity','X-Snapback-Control':secret}
 c=http.client.HTTPConnection('127.0.0.1',port,timeout=30);prior=signal.signal(signal.SIGALRM,alarm)
 record=dict(index=q['index'],phase=q['phase'],requestSha256=hashlib.sha256(body).hexdigest(),deadlineSeconds=30,loadBefore=os.getloadavg(),wallStartMs=time.time_ns()//1000000)
 signal.setitimer(signal.ITIMER_REAL,30);start=time.perf_counter_ns()
 try:
  c.request('POST','/control/run',body=body,headers=headers);response=c.getresponse();raw=response.read()
  elapsed=(time.perf_counter_ns()-start)/1e6;signal.setitimer(signal.ITIMER_REAL,0)
  record.update(ms=elapsed,status=response.status,responseBytes=len(raw),responseSha256=hashlib.sha256(raw).hexdigest(),wallEndMs=time.time_ns()//1000000,loadAfter=os.getloadavg())
  p=private/(str(q['index'])+'.json');p.write_bytes(raw);p.chmod(0o600)
  value=json.loads(raw);assert response.status==200, 'HTTP failure'
  return value,record
 except BaseException as e:
  record.update(errorType=type(e).__name__,elapsedUntilFailureMs=(time.perf_counter_ns()-start)/1e6);raise
 finally:
  signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,prior);c.close();write(private.parent/(str(q['index'])+'-http.json'),record)

def arm(cfg,name,binary,out,workload):
 a=out/name;a.mkdir();private=a/'private';private.mkdir(mode=0o700)
 home=private/'project';shutil.copytree(R/'private/arm-inputs'/name/'project',home)
 db=home/'.snapback/store.sqlite';assert sha(db)==cfg['checkpointSha256']
 # Explicit Root review must cover this ONLY proposed fixture delta. No rotation during preparation.
 before=state(db);c=sqlite3.connect(db);old=c.execute("SELECT value FROM _meta WHERE key='id_namespace'").fetchone()[0];namespace=cfg['armNamespaces'][name];assert old!=namespace
 c.execute("UPDATE _meta SET value=? WHERE key='id_namespace'",[namespace]);c.commit();c.close()
 assert state(db)==before, 'namespace isolation changed counts/sequence/high-water/generation'
 write(a/'copy.json',dict(sourceSha256=cfg['checkpointSha256'],isolatedSha256=sha(db),onlyLogicalEdit='_meta.id_namespace',namespace=namespace,before=before))
 started=assert_start(db,workload,cfg)
 assert started['meta']['id_high_water']==before['meta']['id_high_water']
 write(a/'starting-state.json',dict(observation='SQL before owner startup; namespace-different execution copy',state=started))
 port=cfg['ports'][name];s=socket.socket();s.bind(('127.0.0.1',port));s.close()
 env=cfg['ownerEnv'];cmd=[str(binary),'dev','--project',str(home),'--port',str(port),'--foreground','--json']
 log=(private/'owner.log').open('xb');p=None;events=[];rows=[];records=[];samplerStop=threading.Event();stopped=False
 def finish_owner():
  nonlocal stopped
  code=stop(p,events);stopped=True
  write(a/'owner.terminal.json',dict(exit=code,cleanup=events,atEpoch=time.time()))
  return code
 def sample():
  with (a/'host-load.jsonl').open('x') as f:
   while not samplerStop.wait(1):f.write(json.dumps(dict(atEpoch=time.time(),load=os.getloadavg()))+'\n');f.flush()
 sampler=threading.Thread(target=sample,daemon=True);sampler.start()
 try:
  start=time.monotonic();p=subprocess.Popen(cmd,cwd=a,env=env,stdout=log,stderr=log,start_new_session=True)
  launch=dict(identity=identity(p.pid),command=cmd,env=env,port=port,atEpoch=time.time(),binarySha256=sha(binary),startupSeconds=30)
  write(a/'owner.launch.json',launch);print(json.dumps(launch),flush=True)
  while not (home/'.snapback/owner.json').exists():
   assert p.poll() is None, 'owner exited during startup'
   assert time.monotonic()-start<30, 'owner startup deadline'
   time.sleep(.05)
  info=read(home/'.snapback/owner.json');assert info['pid']==p.pid and info['port']==port and info['generation']==cfg['generation']
  secret=info['secret'] # newly generated own secret used only in memory; never logged/copied.
  certs=read(home/'.snapback/build/certificates.json');expected=read(P/'expected-certificates.json');assert certs==expected and len(certs)==23,'base certificates changed'
  write(a/'certificate-binding.json',dict(sha256=sha(home/'.snapback/build/certificates.json'),expectedSemanticSha256=digest(expected),programs=23))
  source=read(R/'runtime/prepared/catalog.json')['putMessage']['source'];last_at=workload['maxMessageAt']
  responses=private/'responses';responses.mkdir(mode=0o700)
  for q in workload['requests']:
   # Original native arrival-order wait; outside the HTTP timer, no clock substitution.
   wait_start=time.monotonic()
   while time.time_ns()//1000000<=last_at:
    assert time.monotonic()-wait_start<30, 'wall clock has not advanced; no request was retried'
    time.sleep(.001)
   value,record=request(port,secret,source,q,responses)
   row=assert_response(value,q,source,workload['sequence']+q['index'],last_at,record['wallStartMs'],record['wallEndMs'])
   last_at=row['at'];rows.append(row);records.append(record)
   # Receipt/row/native-clock validation is immediate. No external SQL while the owner holds EXCLUSIVE.
   expected_state=dict(seq=workload['sequence']+q['index'],counts=dict(workload['sourceCounts'],messages=10015+q['index']),idHighWater=int(before['meta']['id_high_water'])+q['index']*1024)
   write(a/('mutation-%02d.json'%q['index']),dict(request=q,receipt=dict(state=value['state'],seq=value['seq'],principal=value['principal'],sourceHash=value['sourceHash']),row=row,timing=record,expectedPostState=expected_state,observation='receipt verified in memory; intermediate SQL state not observed; persisted rows and full ledger checked after stop'))
  assert finish_owner()==0 and not any(e['action']=='SIGKILL' for e in events), 'graceful owner stop required before SQL'
  result=assert_final(db,R/'private/checkpoint-10.sqlite',workload,rows,source)
  assert result['meta']['generation']==result['meta']['schema_hash']==cfg['generation']
  assert result['meta']['program_generation']==cfg['programGeneration']
  assert int(result['meta']['id_high_water'])==int(before['meta']['id_high_water'])+23*1024
  assert read(home/'.snapback/build/certificates.json')==expected, 'final base certificates changed'
  summary=dict(final=result,timing=stats([r['ms'] for r in records if r['phase']=='measured']),warmups=3,measured=20,retries=0,order=name,observation='all persisted rows/ledger/counts/generation/allocator checked after graceful stop; no intermediate SQL snapshots',scope='historical source-bound putMessage diagnostic; no scale or publication qualification')
  write(a/'result.json',summary);return summary
 finally:
  samplerStop.set();sampler.join(timeout=5)
  if p is not None and not stopped:finish_owner()
  log.close()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--packet-sha256',required=True);parser.add_argument('--root-reviewed-fork-namespace-isolation',action='store_true');parser.add_argument('--root-reviewed-stopped-store-observations',action='store_true');args=parser.parse_args()
 assert args.execute and args.root_reviewed_fork_namespace_isolation and args.root_reviewed_stopped_store_observations, 'Root must review this exact correction before execution'
 freeze=P/'freeze.json';assert sha(freeze)==args.packet_sha256,'packet approval hash mismatch'
 for n,v in read(freeze)['files'].items():assert sha(P/n)==v,'changed execution packet'
 cfg=read(P/'config.json');assert len(set(cfg['armNamespaces'].values()))==2
 pre=verify(cfg)
 for port in cfg['ports'].values():
  s=socket.socket();s.bind(('127.0.0.1',port));s.close()
 out=R/cfg['attempt'];assert cfg['attempt']=='execution-02' and not out.exists();claim(R/(cfg['attempt']+'.once.json'),dict(identity=identity(os.getpid()),atEpoch=time.time(),packetSha256=args.packet_sha256,command=sys.argv))
 out.mkdir(mode=0o700);write(out/'preflight.json',pre);write(out/'supervisor.launch.json',dict(identity=identity(os.getpid()),atEpoch=time.time(),command=sys.argv))
 code=1
 try:
  candidate=pathlib.Path(cfg['candidateOwner']);write(out/'candidate-reuse.json',dict(path=str(candidate),sha256=sha(candidate),builtIn='execution-01',newBuild=False))
  verify_manifest(R/'candidate-source',read(P/'candidate-source-manifest.json'))
  workload=read(P/'workload.json');results={}
  for name,binary in [('baseline',pathlib.Path(cfg['baselineOwner'])),('candidate',candidate)]:results[name]=arm(cfg,name,binary,out,workload)
  write(out/'results.json',dict(arms=results,confounds=['fixed baseline-first order','shared host load','OS/filesystem/compiler/store warm state','starting SQL scan warms pages; final SQL moved after stop; no between-request SQL/cache effects','intermediate counts/pending/generation/allocator states are not SQL observations','different real wall-clock timestamps','isolated allocator namespaces only; same high-water marks','retained build and failed zero-request baseline may warm caches'],claim='one bounded historical diagnostic; no full population speedup inference'))
  code=0
 except BaseException as e:
  write(out/'first-failure.json',dict(type=type(e).__name__,message=str(e),atEpoch=time.time(),retries=0));raise
 finally:
  protected_error=None
  try:
   verify_manifest(R/'candidate-source',read(P/'candidate-source-manifest.json'))
   verify_manifest(R/'private',read(P/'private-input-manifest.json'))
   verify_manifest(R/'runtime',read(P/'runtime-manifest.json'))
   verify_manifest(pathlib.Path(cfg['originalSource']),read(P/'original-source-manifest.json'))
   for path,h in cfg['externalFiles'].items():assert sha(pathlib.Path(path))==h,path
   verify_retained_attempt(cfg)
  except BaseException as e:
   protected_error=dict(type=type(e).__name__,message=str(e));code=1
  write(out/'terminal.json',dict(exit=code,atEpoch=time.time(),host=host(),protectedInputError=protected_error,writerReleased=True))
  if protected_error is not None:raise RuntimeError('protected input changed; see terminal')
if __name__=='__main__':main()
