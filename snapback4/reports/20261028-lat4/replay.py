"""Paired same-window immutable lane copies; raw logs remain private in /tmp/lat4."""
import argparse,collections,hashlib,importlib.util,json,os,pathlib,shutil,signal,subprocess,sys,tarfile,time
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('lat3',HERE.parent/'20261027-lat3/replay.py');lat3=importlib.util.module_from_spec(spec);spec.loader.exec_module(lat3)
SCRATCH=pathlib.Path('/tmp/lat4')

def relocate_links(source,dest):
 for path in dest.rglob("*"):
  if not path.is_symlink():continue
  target=os.readlink(path)
  if target==str(source)or target.startswith(str(source)+"/"):
   path.unlink();path.symlink_to(str(dest)+target[len(str(source)):])
  if path.name.startswith("store.sqlite")and not path.resolve().is_relative_to(dest.resolve()):raise RuntimeError("escaping copied store link refused")

def overlay(dst,archive):
 base=dst/'node_modules/snapback4'
 with tarfile.open(archive) as tar:
  for m in tar:
   if not m.isfile() or not m.name.startswith(('package/dist/','package/bin/','package/package.json')):continue
   rel=pathlib.PurePosixPath(m.name.removeprefix('package/'))
   target=base/rel
   if '..' in rel.parts or not target.resolve().is_relative_to(base.resolve()):raise RuntimeError('escaping archive entry')
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(tar.extractfile(m).read());target.chmod(m.mode&0o777)

def wrap_entries(dst,scripts,variant):
 wrapped=[]
 for name in sorted(set(scripts.values())):
  # Historical scripts are explicit node entries. Shell compositions are not
  # guessed or partially wrapped. Imported helpers remain unmodified.
  import shlex
  parts=shlex.split(name)
  if len(parts)<2 or parts[0]!='node' or parts[1].startswith('-'):continue
  target=dst/parts[1]
  if not target.is_file() or target.suffix!='.mjs':continue
  result=subprocess.run(['node',str(HERE/'wrap.mjs'),str(target),'file:///tmp/lat4/observe-runner.mjs' if variant=='before' else 'snapback4/proof-runner'],capture_output=True,text=True)
  if result.returncode:raise RuntimeError('entry completion requires explicit adaptation: '+str(target.relative_to(dst))+': '+result.stderr[-300:])
  wrapped.append(json.loads(result.stdout))
 return [{**x,'file':str(pathlib.Path(x['file']).relative_to(dst))} for x in wrapped]

def run(dst,script,base,binary,slot,port=None):
 observer=base.with_suffix('.observer.jsonl');trace=base.with_suffix('.native.jsonl')
 tmp=SCRATCH/'t'/hashlib.sha256(str(dst).encode()).hexdigest()[:10];tmp.mkdir(parents=True,exist_ok=True)
 env={**os.environ,'SNAPBACK4_BIN':str(binary),'SNAPBACK4_LATENCY_TRACE':str(trace),'NODE_OPTIONS':'--import='+str(HERE/'observe.mjs'),'LAT4_OBSERVER':str(observer),'TMPDIR':str(tmp),'CHROME':str(pathlib.Path.home()/'.cache/ms-playwright/chromium-1193/chrome-linux/chrome'),'PORT_LO':str(36000+slot*3000),'PORT_HI':str(37999+slot*3000),'SNAPBACK4_PROBE_HOLD':'1'}
 if port:env.update(PORT_LO=str(port),PORT_HI=str(port+9))
 begin=time.monotonic();started=time.time();load=os.getloadavg()
 with base.with_suffix('.log').open('w') as log:
  args=['node',str(HERE.parent/'20261027-lat3/probe.mjs')] if script=='probe:serve/client:calls' else ['npm','run',script]
  child=subprocess.Popen(args,cwd=dst,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=child.wait(timeout=900)
  except subprocess.TimeoutExpired:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   code='timeout'
 result={'code':code,'seconds':time.monotonic()-begin,'startedAt':started,'load':load,'messages':lat3.messages(base.with_suffix('.log'))}
 phases=collections.defaultdict(float);by_pid=collections.defaultdict(lambda:collections.defaultdict(float))
 if trace.exists():
  for line in trace.read_text().splitlines():
   x=json.loads(line);phases[x['phase']]+=x['seconds'];by_pid[x['pid']][x['phase']]+=x['seconds']
 result['phases']=dict(phases);result['preflightSeconds']=sum(phases[k] for k in ['deploy.security','check.report','check.witnesses','check.restored_questions']);result['withoutPreflightSeconds']=result['seconds']-result['preflightSeconds']
 events=[json.loads(x)for x in observer.read_text().splitlines()] if observer.exists()else[]
 completions=[]
 for done in [x for x in events if x['event']=='suite-done']:
  exits=[x for x in events if x['event']=='exit' and x['pid']==done['pid']]
  if not exits:continue
  output=[x['at']for x in events if x['event']=='output' and x['pid']==done['pid'] and x['at']<=done['at']]
  completions.append({'entry':done['entry'],'code':exits[-1]['code'],'resources':done['resources'],'postCompletionSeconds':(exits[-1]['at']-done['at'])/1000,'postReportSeconds':(exits[-1]['at']-max(output))/1000 if output else None})
 if script=='probe:serve/client:calls' and (dst/'lat3-probe.json').exists():
  result.update(json.loads((dst/'lat3-probe.json').read_text()))
  for ext in ['stdout','stderr']:
   source=dst/('lat3-calls.'+ext)
   if source.exists():shutil.copyfile(source,base.with_suffix('.calls.'+ext))
  result['messages']+=lat3.messages(base.with_suffix('.calls.stderr'))
 result['completions']=completions
 closes={x['child']:x for x in events if x['event']=='command-close'}
 commands=[]
 for event in events:
  if event['event']!='command' or event['child'] not in closes:continue
  end=closes[event['child']];p=by_pid.get(event['child'],{})
  commands.append({'verb':event['verb'],'seconds':end['ms']/1000,'code':end['code'],'nativePhases':dict(p)})
 result['commands']=commands
 shutil.rmtree(tmp)
 return result

def main():
 global SCRATCH
 ap=argparse.ArgumentParser();ap.add_argument('--worker',type=int,default=0);ap.add_argument('--workers',type=int,default=1);ap.add_argument('--slot',type=int);ap.add_argument('--out',type=pathlib.Path);ap.add_argument('--revision',type=int,default=1);ap.add_argument('--waves',default='32,33,34');ap.add_argument('--lanes');ap.add_argument('--scripts',default='acceptance,frontend:proof,day2:proof');ap.add_argument('--candidate',type=pathlib.Path,required=True);ap.add_argument('--before-native',type=pathlib.Path,required=True);ap.add_argument('--after-native',type=pathlib.Path,required=True);a=ap.parse_args()
 SCRATCH=a.out or SCRATCH;SCRATCH.mkdir(parents=True,exist_ok=True,mode=0o700);SCRATCH.chmod(0o700)
 slot=a.worker if a.slot is None else a.slot
 cases=[(wave,p.parent)for wave in map(int,a.waves.split(','))for p in sorted(pathlib.Path(f'/home/ccheever/sb4-loop/wave{wave}/apps').glob('*-snapback-*/package.json'))]
 if a.lanes:cases=[(w,p)for w,p in cases if p.name[:3]in a.lanes.split(',')]
 for i,(wave,src)in enumerate(cases):
  if i%a.workers!=a.worker:continue
  root=SCRATCH/f'worker-{slot}'/f'w{wave}-{src.name}';logs=SCRATCH/'logs'/f'w{wave}-{src.name}';logs.mkdir(parents=True,exist_ok=True)
  if root.exists():shutil.rmtree(root)
  before=root/'before';after=root/'after'
  try:
   lat3.copy_source(src,before);lat3.install(before);lat3.overlay_candidate(before);shutil.copytree(before,after,symlinks=True);relocate_links(before,after);overlay(after,a.candidate)
   scripts=json.loads((before/'package.json').read_text())['scripts'];wanted=[s for s in a.scripts.split(',')if s in scripts or s=='probe:serve/client:calls' and all(k in scripts for k in ['probe:serve','client:calls'])]
   # client:calls children are invoked by the authored proof; wrap their entry
   # too so their own complete awaited suite cannot pin the parent.
   entries={k:v for k,v in scripts.items()if k in wanted+['client:calls']}
   wrapped={v:wrap_entries(d,entries,v)for v,d in [('before',before),('after',after)]}
   for script in wanted:
    row={'wave':wave,'lane':src.name,'script':script,'measurementRevision':a.revision,'wrapped':wrapped,'beforeBinarySha256':hashlib.sha256(a.before_native.read_bytes()).hexdigest(),'afterBinarySha256':hashlib.sha256(a.after_native.read_bytes()).hexdigest()}
    for variant,dst,binary in ([('before',before,a.before_native),('after',after,a.after_native)]if i%2==0 else [('after',after,a.after_native),('before',before,a.before_native)]):
     key=script.replace(':','-').replace('/','-')+'-'+variant;port=21120 if (wave in [32,33]and src.name.startswith('012-'))else 21280 if wave==34 and src.name.startswith('028-')else 21090 if wave==33 and src.name[:3]in ['009','035']else None
     digest=lat3.client_digest(dst)
     row[variant]=run(dst,script,logs/key,binary,slot,port)
     row[variant]['clientInputDigest']=digest;row[variant]['clientOutputDigest']=lat3.client_digest(dst)
    row['sameExit']=row['before']['code']==row['after']['code'];row['sameMessages']=row['before']['messages']==row['after']['messages']
    with (SCRATCH/f'results-{slot}.jsonl').open('a')as f:f.write(json.dumps(row)+'\n')
    print(wave,src.name,script,*[row[v]['code']for v in ['before','after']],*[round(row[v]['seconds'],3)for v in ['before','after']],row['sameMessages'],flush=True)
  except Exception as error:
   with (SCRATCH/f'results-{slot}.jsonl').open('a')as f:f.write(json.dumps({'wave':wave,'lane':src.name,'setupError':str(error)})+'\n')
   print(wave,src.name,type(error).__name__,str(error),flush=True)
  finally:
   if root.exists():shutil.rmtree(root)
if __name__=='__main__':main()
