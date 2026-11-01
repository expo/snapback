from pathlib import Path
import json,shutil,re,subprocess
r=Path.home()/'sb4-pub-0452-records';qdir=r/'linux-qualification-0.4.52';log=qdir/'suite.log';t=log.read_text() if log.exists() else '';markers=re.findall(r'^== (.*)$',t,re.M)
q={'freeGiB':shutil.disk_usage(r).free//2**30,'phase':markers[-1] if markers else 'setup','failedFiles':re.findall(r'^-- client file FAIL: ([^\n]+)',t,re.M),'suiteFailures':re.findall(r'^-- FAIL.*$',t,re.M),'passedFiles':len([x for x in re.findall(r'^-- client file ok: (packages/snapback4/test/[^ ]+)',t,re.M) if not x.endswith(('app-session-model.test.mjs','online-client-model.test.mjs'))]),'suiteTail':t[-250:]}
p=r/'linux-1.exit';q['exit']=p.read_text().strip() if p.exists() else 'pending';q['receipt']=(qdir/'receipt.json').exists();q['proofJsonCount']=len(list(qdir.glob('*.json')))
if q['proofJsonCount'] and '0 failure(s)' in t:q['phase']='packed consumer/platform proofs'
# Follow only runner stdout files inside this qualifier's own cgroup.
try:
 cg=subprocess.check_output(['systemctl','--user','show','sb4-pub52-linux-1','-p','ControlGroup','--value'],text=True).strip()
 for pid in (Path('/sys/fs/cgroup')/cg.lstrip('/')/'cgroup.procs').read_text().split():
  try:
   args=Path('/proc',pid,'cmdline').read_bytes().split(b'\0')
   if not any(x.endswith(b'/run-client-tests.mjs') or x.endswith(b'/run-rust-tests.mjs') for x in args):continue
   out=Path('/proc',pid,'fd/1').resolve()
   if out.name not in ['client-tests.log','client-models.log','cargo-test.log'] or not out.parent.name.startswith('snapback4-test.'):continue
   live=out.read_text(errors='replace');q['phase']=out.stem
   if out.name=='client-tests.log':
    q['passedFiles']=len(re.findall(r'^-- client file ok:',live,re.M));q['failedFiles']=re.findall(r'^-- client file FAIL: ([^\n]+)',live,re.M)
   q['suiteFailures']+=re.findall(r'^-- FAIL.*$',live,re.M)
  except OSError:pass
except (OSError,subprocess.CalledProcessError):pass
print(json.dumps(q))
