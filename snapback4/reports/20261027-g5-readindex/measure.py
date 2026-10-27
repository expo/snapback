#!/usr/bin/env python3
"""Shared-host S1 diagnostic using the unmodified native seed/load/delay tools.
The caller owns PG and stops it; only aggregate JSON is written to --out.
"""
import argparse,hashlib,json,os,re,shutil,subprocess as sp,time,urllib.parse,urllib.request
from pathlib import Path

ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--stage',choices=['prepare','measure'],required=True)
ap.add_argument('--scope',choices=['grid','w1fresh'],default='grid')
ap.add_argument('--scratch',type=Path,required=True)
ap.add_argument('--repo',type=Path,required=True)
ap.add_argument('--out',type=Path,required=True)
a=ap.parse_args(); os.umask(0o077)
repo=a.repo.resolve(); work=a.scratch.resolve(); work.mkdir(exist_ok=True)
bin=repo/'target/release'; pg=Path('/home/ccheever/tools/pg16/usr/lib/postgresql/16/bin')
owner=json.loads((work/'pg-owner.json').read_text());assert owner['port']>=55700
assert int((Path(owner['data'])/'postmaster.pid').read_text().splitlines()[0])==owner['pid']
base=f"host={owner['socket']} port={owner['port']} user=g5r"
env={k:v for k,v in os.environ.items() if not k.startswith('SNAPBACK4_')}
env['LD_LIBRARY_PATH']='/home/ccheever/tools/pg16/usr/lib/x86_64-linux-gnu'
def disk():
 free=shutil.disk_usage('/home').free
 if free<60*1024**3:raise RuntimeError(f'/home free below conservative 60 GiB floor: {free} bytes')
 return free
def sql(source,db='g5r_s1'):
 return sp.check_output([str(pg/'psql'),base+' dbname='+db,'-XqAt','-v','ON_ERROR_STOP=1','-c',source],env=env,text=True).strip()
def record(p,kind):
 with (work/'runtime-pids.jsonl').open('a') as f:f.write(json.dumps(dict(pid=p.pid,kind=kind))+'\n')
def spawn(cmd,name,cwd=None,e=None):
 p=sp.Popen(list(map(str,cmd)),cwd=cwd,env=e or env,stdin=sp.DEVNULL,stdout=(work/(name+'.stdout')).open('w'),stderr=(work/(name+'.stderr')).open('w'));record(p,name);return p
def stop(p):
 if p.poll() is None:p.terminate()
 try:p.wait(timeout=15)
 except sp.TimeoutExpired:p.kill();p.wait()
def store_env(host):
 return dict(env,SNAPBACK4_STORE_URL=f"postgres://g5r@/g5r_s1?host={urllib.parse.quote(str(host),safe='')}&port={owner['port']}&schema=bench&ha=none")
release=work/'release';project=work/'project'
stable=work/'s';stable.mkdir(exist_ok=True)
link_socket=stable/f".s.PGSQL.{owner['port']}"
if a.stage=='prepare':
 disk();link_socket.symlink_to(Path(owner['socket'])/link_socket.name);sql('CREATE DATABASE g5r_s1','postgres')
 sql("CREATE EXTENSION pg_stat_statements")
 (project/'snapback').mkdir(parents=True)
 shutil.copyfile(repo/'snapback4/experiments/scale-controls/snapback-app/snapback/schema.q',project/'snapback/schema.q')
 p=spawn([bin/'snapback4','deploy',release,'--json'],'deploy',project,store_env(stable));assert p.wait()==0
 binding=json.loads((release/'store-binding.json').read_text())
 config=work/'seed.json';config.write_text(json.dumps(dict(connection=base+' dbname=g5r_s1',store_id=binding['store_id'],rows=1000000,tokens_path=str(work/'tokens.json'))))
 p=spawn([bin/'sb4-postgres-scale-seed',config],'seed');assert p.wait()==0
 (work/'tokens.json').chmod(0o600)
 counts=json.loads(sql("SELECT json_object_agg(t,n) FROM (SELECT t,count(*) n FROM bench.r GROUP BY t) q"))
 expected=dict(messages=1000000,rooms=1025,users=256,memberships=8448,counters=257)
 assert {k:counts[k] for k in expected}==expected,counts
 assert all(k in expected or k.startswith('$column:') for k in counts),counts
 assert sorted(v for k,v in counts.items() if k not in expected)==[256,1024],counts
 sql('VACUUM ANALYZE')
 sql('SELECT pg_stat_statements_reset()')
 (work/'seed-aggregate.json').write_text(json.dumps(counts));print('prepared',counts,flush=True)
 raise SystemExit

records=[];pids=[];service=None;proxy=None
report=dict(scope=a.scope,method='1M S1 fixture; 128 readers/32 writers; 2s warm + 4s measured; 4s untimed read priming per service; rotating three-arm order; extra reverse-order W2/W3 repeats at 8000/11313; no affinity/quiet-host qualification',
 binary_sha256={n:hashlib.sha256((bin/n).read_bytes()).hexdigest() for n in ['snapback4','sb4-scale-controls','sb4-postgres-scale-seed']},pg_version=sql('SHOW server_version'),seed=json.loads((work/'seed-aggregate.json').read_text()),runs=records)

def snapshot():
 return json.loads(sql("""SELECT json_build_object(
 'calls',(SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE 'SHOW %'),
 'validations',(SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND (query LIKE '%FROM _sessions WHERE token_digest%' OR query LIKE '%CROSS JOIN _owner o%') AND query NOT LIKE '%pg_stat_statements%'),
 'connections',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND application_name LIKE 'sb:%'),
 'counter',(SELECT sum((data::jsonb->'Row'->'n'->>'Int')::bigint) FROM bench.r WHERE t='counters'))"""))
def load(workload,rate,seconds,name,url,prime=False):
 command=[bin/'sb4-scale-controls','load','--target','snapback','--url',url,'--workload',workload,'--workers',128 if workload in ['W1','W2','W3'] else 32,'--keys','disjoint','--rows',1000000,'--rate',rate,'--warmup-ms',2000,'--duration-ms',seconds*1000,'--cpu-pids',f'{service.pid},{proxy.pid}','--cpu-tree-root',owner['pid']]
 le=dict(env,SCALE_JWT_TOKENS_FILE=str(work/'tokens.json'))
 p=spawn(command,name,e=le);assert p.wait(timeout=90)==0,name
 result=json.loads((work/(name+'.stdout')).read_text())
 return result
try:
 cohorts=[(w,link,[5656,8000,9514,11313,16000],0) for w in ['W1','W2','W3'] for link in ['A','B']]
 cohorts += [(w,link,[8000,11313],1) for w in ['W2','W3'] for link in ['B','A']]
 cohorts += [('W4',link,[400,800],0) for link in ['A','B']]
 if a.scope=='w1fresh':
  cohorts=[('W1',link,[rate],0) for link in ['A','B'] for rate in [5656,8000,9514,11313,16000]]
  report['method']='S1 W1, 1M fixture; fresh service for every rate/arm; no repeated-key priming; 2s warm + 4s measurement; rotating arm order; shared host diagnostic'
 for cohort,(w,link,rates,repeat) in enumerate(cohorts):
  order=['g5','ri','g6']
  if repeat:order.reverse()
  order=order[cohort%3:]+order[:cohort%3]
  for arm in order:
   disk();name=f'{a.scope}-{cohort}-{w}-{link}-{arm}';proxy_sock=work/('proxy-'+name+'-'+str(time.time_ns()))
   proxy=spawn([bin/'sb4-scale-controls','unix-proxy','--socket-dir',proxy_sock,'--upstream-dir',owner['socket'],'--delay-us',500 if link=='A' else 1000,'--port',owner['port']],name+'-proxy')
   for _ in range(100):
    if (proxy_sock/f".s.PGSQL.{owner['port']}").exists():break
    assert proxy.poll() is None;time.sleep(.02)
   link_socket.unlink(missing_ok=True);link_socket.symlink_to(proxy_sock/link_socket.name)
   se=store_env(stable)
   if arm=='ri':se['SNAPBACK4_G5_READ_INDEX']='1'
   if arm=='g6':se['SNAPBACK4_READ_GRANT_CLOCK_BOUNDS']='1000,250'
   service=spawn([bin/'snapback4','serve',release,'--worker-state-dir',work/'workers','--port','0'],name+'-serve',e=se)
   deadline=time.monotonic()+30;url=None
   while time.monotonic()<deadline:
    assert service.poll() is None,name+' service exited'
    text=(work/(name+'-serve.stdout')).read_text()+(work/(name+'-serve.stderr')).read_text()
    match=re.search(r'url=(http://[\d.:]+)',text)
    if match:
     try:
      with urllib.request.urlopen(match[1]+'/auth/config',timeout=.2) as r:
       if r.status==200:url=match[1];break
     except OSError:pass
    time.sleep(.05)
   assert url,'readiness timeout'
   if w in ['W1','W2','W3'] and a.scope!='w1fresh':load(w,8000,2,name+'-prime',url,True)
   for rate in rates:
    before=snapshot();free=disk();r=load(w,rate,4,name+'-'+str(rate),url);after=snapshot()
    ack=r['total_success_including_warmup'];calls=after['calls']-before['calls']
    c=r['cpu_window'];valid=c['before']['valid'] and c['after']['valid']
    cpu_us=(c['after']['tree']['cpu_s']-c['before']['tree']['cpu_s'])*1e6/r['success'] if valid and r['success'] else None
    assert max(before['connections'],after['connections'])<=32
    entry=dict(connections=[before['connections'],after['connections']],workload=w,link=link,arm=arm,rate=rate,repeat=repeat,p50_ms=r['latency']['p50_ms'],p99_ms=r['latency']['p99_ms'],errors=r['error_count'],scheduled=r['scheduled'],success=r['success'],slo_pass=r['slo_pass'],achieved_per_s=r['achieved_per_s'],pg_cpu_us_per_ack=cpu_us,cpu_valid=valid,statements_per_cohort_ack=calls/ack if ack else None,validation_statements_per_cohort_ack=(after['validations']-before['validations'])/ack if ack else None,dispatch_p99_ms=r['dispatch_lag']['p99_ms'],service_p99_ms=r['http_service']['p99_ms'],load1=[c['before']['load1'],c['after']['load1']],free_bytes=free)
    if w=='W4':
     entry['counter_delta']=after['counter']-before['counter'];entry['cohort_acks']=ack;entry['counter_ok']=entry['counter_delta']==ack
     assert entry['counter_ok'],entry
    records.append(entry);a.out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(entry),flush=True)
   stop(service);service=None;stop(proxy);proxy=None
   # Serving leaves its fenced lease/grant to expire. Only private metadata.
   while sql("SELECT lease_until<=clock_timestamp() FROM bench._owner WHERE singleton")!='t':time.sleep(.1)
   if sql("SELECT to_regclass('bench._read_grant') IS NOT NULL")=='t':
    while sql("SELECT count(*) FROM bench._read_grant WHERE valid_until>=clock_timestamp()")!='0':time.sleep(.1)
except Exception as error:
 report['stopped_reason']=str(error)
 raise
finally:
 if service:stop(service)
 if proxy:stop(proxy)
 report['runtime_pids_left']=[json.loads(x)['pid'] for x in (work/'runtime-pids.jsonl').read_text().splitlines() if Path('/proc/'+str(json.loads(x)['pid'])).exists()]
 report['home_free_bytes']=shutil.disk_usage('/home').free
 a.out.write_text(json.dumps(report,indent=2)+'\n')
