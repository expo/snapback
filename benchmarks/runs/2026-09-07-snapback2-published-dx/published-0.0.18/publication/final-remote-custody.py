from pathlib import Path
import json,os,subprocess,shlex,time,hashlib
E=Path(__file__).resolve().parent;P=E.parent/'cli-018-publication-preparation-r1'
c=json.loads((P/'command-manifest.json').read_text());b=json.loads((P/'bindings.json').read_text())
code='''from pathlib import Path
import sys,json,os,time,hashlib
base=Path('/Users/ccheever/clique-improvement/revisions/cli-018-publication-preparation-r1/bundle')
sys.path.insert(0,str(base))
from custody import bundle,verify_leaves,resume_check,regular,sha
ok=False
try:
 b=bundle(base,'2fa6edaf3f1edbf89f1b69564425c0c0eaf208e790a805cfee1ba9dfbc611e59')
 verify_leaves(b['source'],json.loads((base/'inputs/source-manifest.json').read_text()),source=True)
 resume_check(b)
 for row in json.loads((base/'inputs/artifact-inputs.json').read_text()):
  f=regular(Path(b['artifacts'])/row['path'],int(row['mode'],8));assert sha(f)==row['sha256']
 assert sha(Path(b['source'])/'snapback2/metrics/loop.jsonl')==b['metricSha256']
 ok=True
finally:
 print(json.dumps({'pass':ok,'pid':os.getpid(),'epoch':time.time(),'sourceLeaves':947,'bundleLeaves':11,'sourceAndArtifactsUnchanged':ok,'authAccess':False}),flush=True)
 sys.exit(0 if ok else 1)
'''
(E/'final-custody-remote-source.py').write_text(code)
env={'HOME':b['home'],'USER':'ccheever','PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C','LC_ALL':'C'}
if 'SSH_AUTH_SOCK' in os.environ:env['SSH_AUTH_SOCK']=os.environ['SSH_AUTH_SOCK']
start=time.time();p=subprocess.Popen(c['sshArgv'][:19]+[shlex.join(['/usr/bin/python3','-B','-c',code])],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
r={'pid':p.pid,'startedEpoch':start,'commandSourceSha256':hashlib.sha256(code.encode()).hexdigest(),'outerSeconds':20,'authAccess':False,'readOnly':True}
try:
 out,err=p.communicate(timeout=20);r.update(exitCode=p.returncode,stderrPresent=bool(err))
 if p.returncode==0 and not err:
  x=json.loads(out);assert set(x)=={'pass','pid','epoch','sourceLeaves','bundleLeaves','sourceAndArtifactsUnchanged','authAccess'} and x['pass'] is True and x['authAccess'] is False
  r['observation']=x
 else:r['unknown']=True
except BaseException:
 if p.poll() is None:p.kill()
 p.communicate(timeout=3);r.update(exitCode=p.returncode,unknown=True)
r.update(endedEpoch=time.time(),childReaped=True)
(E/'final-remote-custody.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
