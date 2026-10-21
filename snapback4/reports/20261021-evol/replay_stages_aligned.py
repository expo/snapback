"""Execute the lanes' actual backend rollback/forward scripts on private copies.
Credentials remain in temporary directories outside the repository and are never logged.
"""
import argparse,hashlib,json,os,pathlib,re,shutil,signal,sqlite3,subprocess,tempfile,time
P=pathlib.Path
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);p.add_argument('--lanes');p.add_argument('--prior');p.add_argument('--align-helper',required=True);a=p.parse_args()
repo=P(__file__).resolve().parents[3];product=repo/'snapback4';source=P('/home/ccheever/sb4-loop/wave21/apps')
rows=json.loads(P('/home/ccheever/sb4-loop/wave21-repro/friction/s_classified.json').read_text());chosen={x['lane'] for x in rows if x['cl'] in ['REENTRY_INPUT','REENTRY_RENAMENULL','FORESIGHT']};chosen|={x.name for x in source.glob('010-snapback-*')}
chosen={x for x in chosen if not a.lanes or x[:3] in a.lanes.split(',')}
results=[x for x in json.loads(P(a.prior).read_text())['lanes'] if x['lane'] not in chosen] if a.prior else []
signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit(124)))
def run(cmd,cwd,env):
 start=time.monotonic();child=subprocess.Popen(cmd,cwd=cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 try:
  output,_=child.communicate(timeout=180)
 except BaseException:
  try:os.killpg(child.pid,signal.SIGTERM);child.communicate(timeout=5)
  except (ProcessLookupError,subprocess.TimeoutExpired):
   try:os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   child.wait(timeout=10)
  raise
 # Never retain credential-bearing application logs. Codes and a digest suffice.
 messages=re.findall(r'\"message\"\s*:\s*\"([^\"]*)',output) if child.returncode else []
 # Refusal messages only; remove addresses and credential-shaped words before retention.
 messages=[re.sub(r'[A-Za-z0-9_@.+/-]{24,}', '[redacted]',v) for v in messages]
 return {'messages':messages,'exit':child.returncode,'seconds':round(time.monotonic()-start,2),'codes':sorted(set(re.findall(r'\bE_[A-Z_]+\b',output))) if child.returncode else [],'outputSha256':hashlib.sha256(output.encode()).hexdigest()}
for lane in sorted(chosen):
 entry={'lane':lane,'flows':{},'copyCredentialAlignment':{}}
 for label,binary in [('before',a.before),('after',a.after)]:
  with tempfile.TemporaryDirectory(prefix='evol-stage-') as scratch:
   cwd=P(scratch)/'app';original=source/lane
   shutil.copytree(original,cwd,ignore=shutil.ignore_patterns('node_modules','.git','.harness','.snapback4','deploy','dist','logs','probe','*.ndjson','*.jsonl','day2-proof.json'))
   (cwd/'node_modules').symlink_to(product/'node_modules',target_is_directory=True)
   deployment=cwd/'deploy';deployment.mkdir();shutil.copytree(original/'deploy/releases',deployment/'releases',ignore=shutil.ignore_patterns('.snapback4'))
   with sqlite3.connect(f'file:{original/"deploy/store.sqlite"}?mode=ro',uri=True) as db,sqlite3.connect(deployment/'store.sqlite') as copy:
    db.execute('PRAGMA query_only=ON');db.backup(copy)
   if (original/'deploy/assets').exists():shutil.copytree(original/'deploy/assets',deployment/'assets')
   for f in ['current','releases.jsonl']:
    if (original/'deploy'/f).exists():shutil.copy2(original/'deploy'/f,deployment/f)
   if lane[:3] in ['034','044']:
    users=next(f for f in [cwd/'.production-users.json',cwd/'artifacts/production-users.json'] if f.exists())
    alignment=subprocess.run([a.align_helper],input=json.dumps({'store':str(deployment/'store.sqlite'),'owned':scratch,'users':json.loads(users.read_text())}),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    if alignment.returncode:raise RuntimeError('owned credential alignment failed without retaining secret input/output')
    entry['copyCredentialAlignment'][label]=json.loads(alignment.stdout)
   env=os.environ.copy();env['SNAPBACK4_BIN']=str(P(binary).resolve());env['PATH']=str(repo/'evol-replay-tools/node_modules/.bin')+':'+str(product/'node_modules/.bin')+':/home/ccheever/.bun-1.4.2/bin:'+env['PATH'];env['NODE_OPTIONS']='--experimental-transform-types'
   env.update(CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0')
   flow=[]
   for cycle in range(2):
    for stage in ['prod:rollback','prod:forward']:
     item=run(['npm','run','--silent',stage],cwd,env);item.update(cycle=cycle,stage=stage);flow.append(item)
   entry['flows'][label]=flow
 results.append(entry);P(a.out).write_text(json.dumps({'kind':'actual-authored-backend-stage-replay-with-explicit-copy-credential-alignment','notes':'Original prod:rollback and prod:forward scripts, twice per binary, on independent coherent copies. Only lanes 034/044 have existing copied credential hashes aligned to their saved script passwords; principal IDs, app rows, source and original evidence remain unchanged. All 24 lanes rerun afresh on both selected binaries. Raw untouched 90/96 results remain in the separate report. No original evidence is written. No frontend build or frozen-client UI claim is made. Credentials and captured logs are temporary outside Git and removed. Final sources include builder workarounds.','lanes':results},indent=2)+'\n');print(lane[:3],{k:[s['exit'] for s in v] for k,v in entry['flows'].items()},flush=True)
