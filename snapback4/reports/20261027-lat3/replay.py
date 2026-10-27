"""Paired original-lane copies; never opens an original store. Private artifacts in /tmp/lat3.
Run as a bounded systemd scope. Each worker executes one command at a time.
"""
import argparse,collections,hashlib,json,os,pathlib,re,shutil,signal,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
HERE=pathlib.Path(__file__).resolve().parent
SCRATCH=pathlib.Path('/tmp/lat3')
PACK=pathlib.Path('/home/ccheever/sb4-loop/reports/integration28/ready-pack')

def copy_source(src,dst):
 empty=[]
 def ignore(path,names):
  empty.extend(pathlib.Path(path).relative_to(src)/n for n in names if n in ['logs','.scratch'] and (pathlib.Path(path)/n).is_dir())
  return [n for n in names if n in ['node_modules','.git','logs','.scratch','target'] or 'store.sqlite-owner' in n or n.endswith('store.sqlite-token')]
 shutil.copytree(src,dst,ignore=ignore,symlinks=True)
 # Preserve empty artifact-directory preconditions without carrying prior
 # disposable proof worlds or credential logs into an independent proof.
 for name in empty:(dst/name).mkdir(parents=True,exist_ok=True)
 for path in dst.rglob('*'):
  if not path.is_symlink():continue
  target=os.readlink(path)
  if os.path.isabs(target) and (target==str(src) or target.startswith(str(src)+'/')):
   path.unlink();path.symlink_to(str(dst)+target[len(str(src)):])
  elif path.name.startswith('store.sqlite') and os.path.isabs(target):
   raise RuntimeError('external store symlink refused')
  if path.name.startswith('store.sqlite') and not path.resolve().is_relative_to(dst.resolve()):
   raise RuntimeError('escaping store symlink refused')

def install(dst):
 p=dst/'package.json';pkg=json.loads(p.read_text())
 for group in ['dependencies','devDependencies','optionalDependencies']:
  for name in list(pkg.get(group,{})):
   if name in ['snapback4','snapback4-expo','snapback4-linux-x64']:
    pkg[group][name]='file:'+str(PACK/f'{name}-0.4.44.tgz')
 pkg.setdefault('dependencies',{})['snapback4']='file:'+str(PACK/'snapback4-0.4.44.tgz')
 pkg.setdefault('optionalDependencies',{})['snapback4-linux-x64']='file:'+str(PACK/'snapback4-linux-x64-0.4.44.tgz')
 p.write_text(json.dumps(pkg,indent=2)+'\n')
 env={**os.environ,'npm_config_cache':str(SCRATCH/'npm-cache')}
 with (dst/'lat3-install.log').open('w') as f:
  subprocess.run(['npm','install','--ignore-scripts','--prefer-offline','--no-audit','--no-fund'],cwd=dst,env=env,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)

def run(dst,script,log,timeout=360):
 env={**os.environ,'CHROME':str(pathlib.Path.home()/'.cache/ms-playwright/chromium-1193/chrome-linux/chrome'),
  'SNAPBACK4_BIN':str(dst/'node_modules/snapback4-linux-x64/snapback4'),'SNAPBACK4_PROBE_HOLD':'1',
  'PORT_LO':str(36000+int(dst.parents[1].name.split('-')[-1])*3000),'PORT_HI':str(37999+int(dst.parents[1].name.split('-')[-1])*3000),
  'npm_config_cache':str(SCRATCH/'npm-cache')}
 env.pop('NODE_OPTIONS',None);env.pop('LAT3_TRACE',None);env.pop('SNAPBACK4_LATENCY_TRACE',None)
 args=['node',str(HERE/'probe.mjs')] if script=='probe:serve/client:calls' else ['npm','run',script]
 start=time.monotonic();load=os.getloadavg()
 with log.open('w') as f:
  child=subprocess.Popen(args,cwd=dst,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=child.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   code='timeout'
  except BaseException:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   raise
 result={'code':code,'seconds':time.monotonic()-start,'load':load}
 if script=='probe:serve/client:calls' and (dst/'lat3-probe.json').exists():
  result.update(json.loads((dst/'lat3-probe.json').read_text()))
  for suffix in ['stdout','stderr']:shutil.copyfile(dst/f'lat3-calls.{suffix}',log.with_suffix('.calls.'+suffix))
 return result

def messages(path):
 text=path.read_text(errors='replace')
 # Keep failure messages verbatim; drop process stacks, CLI timing summaries and
 # randomized paths/identifiers only for a separate diagnostic comparator.
 lines=[l for l in text.splitlines() if re.search(r'Error|Assertion|expected|actual|E_[A-Z_]+|"ok":false|"expected":',l) and 'ExperimentalWarning' not in l]
 return lines

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--worker',type=int,default=0);ap.add_argument('--workers',type=int,default=1);ap.add_argument('--waves',default='30,31,32,33,34');ap.add_argument('--lanes');ap.add_argument('--scripts',default='acceptance,frontend:proof,day2:proof,probe:serve/client:calls');ap.add_argument('--resume',action='store_true');a=ap.parse_args()
 cases=[(w,p.parent) for w in map(int,a.waves.split(',')) for p in sorted(pathlib.Path(f'/home/ccheever/sb4-loop/wave{w}/apps').glob('*-snapback-*/package.json'))]
 if a.lanes:cases=[(w,p) for w,p in cases if p.name[:3] in a.lanes.split(',')]
 directory=SCRATCH/f'corpus-{a.worker}';directory.mkdir(exist_ok=True)
 results=SCRATCH/f'corpus-{a.worker}.jsonl'
 previous=[json.loads(line) for line in results.read_text().splitlines()] if a.resume and results.exists() else []
 for index,(wave,src) in enumerate(cases):
  if index%a.workers!=a.worker:continue
  authored=json.loads((src/'package.json').read_text()).get('scripts',{})
  expected=[s for s in a.scripts.split(',') if (s in authored or s=='probe:serve/client:calls' and 'probe:serve'in authored and 'client:calls'in authored)]
  old=[x for x in previous if x.get('wave')==wave and x.get('lane')==src.name]
  copy_failure=any(not x.get('artifactDirectoriesPreserved') and 'ENOENT:' in m and ("'.scratch/" in m or "'logs/" in m) for x in old for v in ['before','after'] for m in x.get(v,{}).get('messages',[]))
  if old and expected and all(any(x.get('script')==s for x in old) for s in expected) and not copy_failure:
   print(f'w{wave}-{src.name}','resume complete',flush=True);continue
  if old:
   # Retain partial/invalid copy attempts; rerun the whole lane from identical
   # fresh sources so earlier command side effects remain paired and ordered.
   with (SCRATCH/f'corpus-{a.worker}.superseded.jsonl').open('a') as f:
    for x in old:f.write(json.dumps(x)+'\n')
   previous=[x for x in previous if x not in old]
   current=[json.loads(line) for line in results.read_text().splitlines()]
   current=[x for x in current if not(x.get('wave')==wave and x.get('lane')==src.name)]
   temporary=results.with_suffix('.resume.tmp');temporary.write_text(''.join(json.dumps(x)+'\n' for x in current));temporary.replace(results)
  key=f'w{wave}-{src.name}';out=directory/key;logdir=SCRATCH/'corpus-logs'/key;logdir.mkdir(parents=True,exist_ok=True)
  if out.exists():shutil.rmtree(out)
  before=out/'before';after=out/'after'
  try:
   copy_source(src,before);install(before)
   # Independent store bytes and dependencies; no state from the before command
   # enters the after copy. All stores and owner-sidecars are task-local.
   shutil.copytree(before,after,symlinks=True)
   for name in ['dist','bin']:
    shutil.copytree(ROOT/'snapback4/packages/snapback4'/name,after/'node_modules/snapback4'/name,dirs_exist_ok=True)
   scripts=json.loads((before/'package.json').read_text()).get('scripts',{})
   for script in a.scripts.split(','):
    if script=='probe:serve/client:calls':
     if 'probe:serve' not in scripts or 'client:calls' not in scripts:continue
    elif script not in scripts:continue
    name=script.replace(':','-').replace('/','-')
    pair={'wave':wave,'lane':src.name,'script':script,'index':index,'artifactDirectoriesPreserved':True}
    # Alternate order across lanes to reduce systematic shared-load/order bias.
    for variant,dst in ([('before',before),('after',after)] if index%2==0 else [('after',after),('before',before)]):
     path=logdir/f'{name}-{variant}.log';pair[variant]=run(dst,script,path)
     pair[variant]['messages']=messages(path)
    pair['sameExit']=pair['before']['code']==pair['after']['code']
    pair['sameMessages']=pair['before']['messages']==pair['after']['messages']
    with results.open('a') as f:f.write(json.dumps(pair)+'\n')
    print(key,script,pair['before']['code'],pair['after']['code'],round(pair['before']['seconds'],3),round(pair['after']['seconds'],3),flush=True)
  except Exception as e:
   with results.open('a') as f:f.write(json.dumps({'wave':wave,'lane':src.name,'setupError':str(e)})+'\n')
   print(key,'setup error',type(e).__name__,flush=True)
  finally:
   if out.exists():shutil.rmtree(out)
if __name__=='__main__':main()
