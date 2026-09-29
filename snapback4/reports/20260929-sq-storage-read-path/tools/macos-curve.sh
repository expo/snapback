#!/usr/bin/env bash
# Run from the repository root with Node 24, Python 3 and the built local SDK.
# Usage: macos-curve.sh BEFORE_BINARY AFTER_BINARY PRIVATE_STORE_ROOT [OUTPUT_DIR]
# STORE_ROOT: PF layout (10pct, 50pct, full, replay/scripts, original-state.private.json).
# Input stores must be quiescent; they are copied and never opened for writing.
# Builds nothing. Reports every frozen read rule; write ratios require replay receipts.
set -euo pipefail
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then echo "usage: $0 BEFORE AFTER STORE_ROOT [OUTPUT_DIR]" >&2; exit 2; fi
python3 - "$@" <<'SQ_PY'
CURVE = r'''
// PF's protocol expanded to every calibration read. No builds; no source store writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const base=path.resolve(process.env.SQ_ROOT??'target/sq');
const {createClient,read,idFrom}=await import(pathToFileURL(path.join(base,'replay/scripts/api-client.mjs')));
const {defaultFetch}=await import(pathToFileURL(path.resolve('snapback4/packages/snapback4/dist/node-fetch.js')));
export const host=()=>({at:new Date().toISOString(),loadavg:os.loadavg(),cpus:os.cpus().length,freeBytes:os.freemem(),...Object.fromEntries(['/proc/stat','/proc/pressure/cpu'].filter(p=>fs.existsSync(p)).map(p=>[p,fs.readFileSync(p,'utf8').split('\n').slice(0,2).join('\n')]))});
const tag=process.env.SQ_TAG??process.argv[2]??'before';
const stages=JSON.parse(process.env.SQ_STAGES??'[["10pct",49562],["50pct",49563],["full",49560]]');
const specs=[['busyHistory','u0001','chat.history',{conversation:idFrom('g0001'),c:null}],['following500','u0500','home',{c:null}],['following5','u0005','home',{c:null}],['celebrityFollower','u0901','home',{c:null}],['search100','u0500','chat.searchMessages',{q:'coffee',conversation:null,c:null}],['insights','u0500','insights.summary',{}],['trending','u0500','insights.trending',{c:null}]];
const registrations=new Map();
for(const file of ['starter-m1.log','starter-m2.log','starter-m3.log','scale.log']){
 for(const line of fs.readFileSync('benchmarks/fixtures/social-messenger/'+file,'utf8').split('\n')){
  if(!line.includes(' register '))continue;
  const [,who,,email,password]=line.match(/"(?:\\.|[^"\\])*"|\S+/g).map(x=>x[0]==='"'?JSON.parse(x):x);
  registrations.set(who,{email,password});
 }
}
const clients=[];
const result={tag,host:host(),method:'PF: nine rotating checkpoint rounds, three warmups, ten reads; p50=item4 p95=max=item9',rounds:[]};
try{
 for(const [stage,port]of stages){
  const state=JSON.parse(fs.readFileSync(path.join(base,stage,stage==='full'?'../original-state.private.json':'state.private.json')));
  const c={stage,port,users:{},capture:[],warm:[]};
  for(const who of new Set(specs.map(s=>s[1]))){
   let token=state.users[who].token;
   if(process.env.SQ_LOGIN!=='0'){
    const r=await defaultFetch(`http://127.0.0.1:${port}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(registrations.get(who))}).then(r=>r.json());
    if(!r.session)throw Error('login '+who+' '+JSON.stringify(r));
    token=r.session.token;
   }
   const fetch=async(input,init)=>{const r=await defaultFetch(input,init);if(String(input).includes('/q/'))c.capture.push({timing:r.headers.get('server-timing'),op:String(input).split('/q/')[1]});return r;};
   c.users[who]=createClient({url:`http://127.0.0.1:${port}`,token,fetch});
  }
  clients.push(c);
  for(const [name,who,op,args]of specs)for(let i=0;i<Number(process.env.SQ_WARMUPS??3);i++){
   const t=performance.now();c.capture.length=0;const r=await read(c.users[who],op,args);c.warm.push({name,i,ms:performance.now()-t,serverTiming:[...c.capture]});
  }
  result[stage]={warmups:c.warm};
 }
 for(let round=0;round<Number(process.env.SQ_ROUNDS??9);round++)for(let position=0;position<clients.length;position++){
  const c=clients[(round+position)%clients.length];
  const batch={round,stage:c.stage,host:host(),probes:{}};
  for(const [name,who,op,args]of specs){
   const times=[],timestamps=[],completeness=[];let last;c.capture.length=0;
   for(let i=0;i<10;i++){const start=performance.now();timestamps.push(Date.now());last=await read(c.users[who],op,args);times.push(performance.now()-start);completeness.push(last.complete);}

   const data=structuredClone(last.data);if(name==='insights')delete data.asOf;
   const sorted=[...times].sort((a,b)=>a-b);
   batch.probes[name]={p50:sorted[4],p95:sorted[9],max:sorted[9],times,timestamps,serverTiming:[...c.capture],meter:last.meter,complete:last.complete,completeness,dataHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
  }
  result.rounds.push(batch);
 }
 // Deep page uses the same nine rotating rounds and three warmups.
 const deepClients=[];
 for(const c of process.env.SQ_SKIP_DEEP==='1'?[]:clients){
  let cursor=null;for(let i=1;i<50;i++){cursor=(await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:cursor})).next;if(!cursor)break;}
  if(!cursor){result[c.stage].deepPaging={unavailable:true};continue;}
  c.deepCursor=cursor;deepClients.push(c);result[c.stage].deepPaging={rounds:[]};
  for(let i=0;i<3;i++)await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:cursor});
 }
 for(let round=0;round<9;round++)for(let position=0;position<deepClients.length;position++){
  const c=deepClients[(round+position)%deepClients.length],samples=[],load=host();
  for(let i=0;i<10;i++){const start=performance.now();await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:c.deepCursor});samples.push(performance.now()-start);}
  const sorted=[...samples].sort((a,b)=>a-b);
  result[c.stage].deepPaging.rounds.push({round,host:load,p50:sorted[4],p95:sorted[9],samples});
 }
 for(const c of deepClients){const d=result[c.stage].deepPaging;d.p95=d.rounds.map(r=>r.p95).sort((a,b)=>a-b)[4];d.max=Math.max(...d.rounds.flatMap(r=>r.samples));}
 result.end=host();
 fs.writeFileSync(path.join(base,tag+'-curve.json'),JSON.stringify(result,null,2));
 console.log(tag,'completed',result.rounds.length,'batches');
}finally{for(const c of clients)for(const client of Object.values(c.users))await client.close();}

'''
RUNNER = r'''
"""Start only owned servers against the already PRIVATE SQ copies."""
import os,pathlib,subprocess,socket,time,sys,signal
root=pathlib.Path.cwd();base=(root/os.environ.get('SQ_ROOT','target/sq')).resolve()
tag,binary=sys.argv[1:3];binary=str(pathlib.Path(binary).resolve())
stages=__import__('json').loads(os.environ.get('SQ_STAGES','[["10pct",49562],["50pct",49563],["full",49560]]'))
children=[]
try:
 for stage,port in stages:
  command=[binary,'dev','--port',str(port),'--replay','--no-watch']
  if os.environ.get('SQ_STRACE')=='1':command=['strace','-s','0','-f','-C','-ttt','-T','-yy','-e','trace=pread64,read,fcntl,fsync,fdatasync,clock_nanosleep,futex','-o',str(base/f'{tag}-{stage}.strace')]+command
  with (base/f'{tag}-{stage}.log').open('wb') as f:p=subprocess.Popen(command,cwd=base/stage,stdout=f,stderr=f,start_new_session=True)
  children.append(p)
  for _ in range(300):
   if p.poll() is not None:raise RuntimeError(f'{stage} exited {p.returncode}')
   try:
    with socket.create_connection(('127.0.0.1',port),.1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError(f'{stage} startup timed out')
 subprocess.run(['node',str(pathlib.Path(__file__).with_name('curve.mjs')),tag],env=dict(os.environ,SQ_ROOT=str(base)),check=True)
finally:
 for p in children:
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 for p in children:p.wait(timeout=30)

'''
SUMMARY = r'''
import json,pathlib,statistics,sys,csv
base=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'target/sq')
med=statistics.median
stages=['10pct','50pct','full']
def summarize(x):
 stages=list(dict.fromkeys(b['stage'] for b in x['rounds']))
 probes=list(x['rounds'][0]['probes']);out={'points':{},'rules':{},'roundRules':[]}
 for name in probes:
  out['points'][name]={}
  for stage in stages:
   batches=[b['probes'][name] for b in x['rounds'] if b['stage']==stage]
   times=sorted(t for b in batches for t in b['times'])
   out['points'][name][stage]={'p50':med(b['p50'] for b in batches),'p95':med(b['p95'] for b in batches),'max':max(times),'n':len(times),'pooledP95':times[__import__('math').ceil(len(times)*.95)-1]}
 def rules(points,deep):
  if len(stages)!=3:return {}
  a,b,z=stages
  rs={}
  def rule(n,v,ceiling,units):rs[n]={'measured':v,'ceiling':ceiling,'margin':ceiling-v,'pass':v<=ceiling,'units':units}
  for name in ['search100','insights','trending']:
   lo,mid,hi=[points[name][s] for s in stages]
   rule(name+'FullSmall',hi/lo,3,'ratio');rule(name+'MidCurve',mid,lo+(hi-lo)*4/9,'ms')
  rule('following500',points['following500'][z]/points['following5'][z],3,'ratio')
  rule('celebrityRead',points['celebrityFollower'][z]/points['following5'][z],3,'ratio')
  if deep:rule('deepPaging',deep/points['busyHistory'][z],3,'ratio')
  return rs
 out['rules']=rules({name:{stage:out['points'][name][stage]['p95'] for stage in stages} for name in probes},x.get(stages[-1],{}).get('deepPaging',{}).get('p95'))
 for r in sorted(set(b['round'] for b in x['rounds'])):
  p={name:{b['stage']:b['probes'][name]['p95'] for b in x['rounds'] if b['round']==r} for name in probes}
  out['roundRules'].append({'round':r,'rules':rules(p,next((v['p95'] for v in x.get(stages[-1],{}).get('deepPaging',{}).get('rounds',[]) if v['round']==r),None))})
 return out
all={}
for p in sorted(base.glob('*-curve.json')):
 x=json.loads(p.read_text());all[p.stem]=summarize(x)
 print(p.stem)
 for name,r in all[p.stem]['rules'].items(): print(f"  {name:22} {r['measured']:.3f} <= {r['ceiling']:.3f}, margin {r['margin']:+.3f} {r['units']} {'PASS' if r['pass'] else 'FAIL'}")
print('celebrityWrite: not measured by read-only curves; use the separate replay receipt rule (no inferred pass).')
(base/'summary.json').write_text(json.dumps(all,indent=2))
with (base/'batches.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['tag','round','stage','probe','p50','p95','max','at','load1','load5','load15','cpus','freeBytes'])
 for p in sorted(base.glob('*-curve.json')):
  for b in json.loads(p.read_text())['rounds']:
   for name,v in b['probes'].items():w.writerow([p.stem,b['round'],b['stage'],name,v['p50'],v['p95'],v['max'],b['host']['at'],*b['host']['loadavg'],b['host']['cpus'],b['host']['freeBytes']])

'''
import pathlib,sys,tempfile,shutil,os,subprocess,json,hashlib,socket
root=pathlib.Path.cwd()
before,after,source=map(lambda x:pathlib.Path(x).resolve(),sys.argv[1:4])
if not (root/'snapback4/packages/snapback4/dist/node-fetch.js').exists():raise SystemExit('Run from the repo root with its SDK already built; this script builds nothing.')
out=pathlib.Path(sys.argv[4]).resolve() if len(sys.argv)>4 else pathlib.Path(tempfile.mkdtemp(prefix='sq-macos-'))
if len(sys.argv)>4:out.mkdir(mode=0o700,parents=True,exist_ok=False)
os.chmod(out,0o700)
for n,b in [('before',before),('after',after)]:
 if not b.is_file():raise SystemExit(f'missing {n} binary: {b}')
(out/'binaries.json').write_text(json.dumps({n:{'path':str(b),'sha256':hashlib.sha256(b.read_bytes()).hexdigest()} for n,b in [('before',before),('after',after)]},indent=2))
(out/'curve.mjs').write_text(CURVE)
(out/'run-curves.py').write_text(RUNNER)
(out/'summarize.py').write_text(SUMMARY)
for name,binary in [('before',before),('after',after)]:
 base=out/name;base.mkdir(mode=0o700)
 for stage in ['10pct','50pct','full']:
  (base/stage).mkdir()
  shutil.copytree(source/stage/'snapback',base/stage/'snapback')
  shutil.copytree(source/stage/'.snapback4',base/stage/'.snapback4')
  if stage!='full':shutil.copyfile(source/stage/'state.private.json',base/stage/'state.private.json')
 shutil.copyfile(source/'original-state.private.json',base/'original-state.private.json')
 (base/'replay/scripts').mkdir(parents=True)
 shutil.copyfile(source/'replay/scripts/api-client.mjs',base/'replay/scripts/api-client.mjs')
 shutil.copytree(source/'replay/snapback',base/'replay/snapback')
 (base/'replay/node_modules').mkdir()
 (base/'replay/node_modules/snapback4').symlink_to(root/'snapback4/packages/snapback4',target_is_directory=True)
 env={k:v for k,v in os.environ.items() if not k.startswith('SQ_')}
 env['SQ_ROOT']=str(base)
 sockets=[];stages=[]
 for stage in ['10pct','50pct','full']:
  listener=socket.socket();listener.bind(('127.0.0.1',0));sockets.append(listener)
  stages.append([stage,listener.getsockname()[1]])
 for listener in sockets:listener.close()
 env['SQ_STAGES']=json.dumps(stages)
 subprocess.run([sys.executable,str(out/'run-curves.py'),name,str(binary)],cwd=root,env=env,check=True)
 shutil.copyfile(base/(name+'-curve.json'),out/(name+'-curve.json'))
subprocess.run([sys.executable,str(out/'summarize.py'),str(out)],check=True)
print('All batches and rule margins:',out)

SQ_PY
