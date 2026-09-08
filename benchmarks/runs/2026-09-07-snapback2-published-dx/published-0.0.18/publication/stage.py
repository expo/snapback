"""Nonsecret exclusive staging, derived from the accepted014 stage mechanics. No activation."""
from pathlib import Path
import hashlib,io,json,os,shlex,subprocess,tarfile,time
E=Path(__file__).resolve().parent
P=E.parent/'cli-018-publication-preparation-r1'
C=json.loads((P/'command-manifest.json').read_text());B=json.loads((P/'bindings.json').read_text())
PREFIX=C['sshArgv'][:19]
ENV={'HOME':B['home'],'USER':'ccheever','LOGNAME':'ccheever','PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C','LC_ALL':'C'}
if 'SSH_AUTH_SOCK' in os.environ:ENV['SSH_AUTH_SOCK']=os.environ['SSH_AUTH_SOCK']
os.umask(0o077)
def call(name,source,data=None,seconds=60):
 (E/(name+'-remote.py')).write_text(source)
 argv=PREFIX+[shlex.join(['/usr/bin/python3','-B','-c',source])]
 start=time.time();clock=time.monotonic()
 child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,start_new_session=True)
 print(json.dumps({'phase':name,'sshPid':child.pid,'driverPid':os.getpid(),'startedEpoch':start}),flush=True)
 timed=False
 try:out,err=child.communicate(data,timeout=seconds)
 except subprocess.TimeoutExpired:timed=True;child.kill();out,err=child.communicate(timeout=3)
 # Only our fixed nonsecret remote probe emits JSON; arbitrary diagnostics are never retained.
 events=[];unknown=False
 for line in out.splitlines():
  try:
   x=json.loads(line);assert type(x)==dict and set(x)<={'phase','pid','epoch','pass','sourceLeaves','bundleFiles','homeMatches','modelMatches','architectureMatches','pathsAbsent','load','createdSource','createdBundle'}
   assert x.get('phase')==name and type(x.get('pid'))==int and type(x.get('pass'))==bool
   for k,v in x.items():
    if k not in ['phase','pid','epoch','load','sourceLeaves','bundleFiles']:assert type(v)==bool
   if 'load' in x:assert type(x['load'])==list and len(x['load'])==3 and all(type(v) in (int,float) for v in x['load'])
   events.append(x)
  except BaseException:unknown=True
 record={'phase':name,'sshPid':child.pid,'driverPid':os.getpid(),'startedEpoch':start,'endedEpoch':time.time(),'elapsedSeconds':time.monotonic()-clock,'exitCode':child.returncode,'timeout':timed,'stderrPresent':bool(err),'unclassifiedOutputPresent':unknown,'events':events,'pass':child.returncode==0 and not timed and not err and not unknown and any(x['pass'] for x in events),'sourceFile':name+'-remote.py','sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'outerSeconds':seconds,'childReaped':True,'automaticRetry':False,'authAccess':False}
 with (E/(name+'-result.json')).open('x') as f:json.dump(record,f,indent=2)
 print(json.dumps(record),flush=True)
 assert record['pass'], name+' stopped; no retry'
 return record
prelude='from pathlib import Path\nimport os,sys,json,time,platform\nB='+repr(B)+'\n'
probe=prelude+'''ok=False
try:
 absent=all(not os.path.lexists(x) for x in [B['source'],str(Path(B['remoteBundle']).parent),B['remoteBundle'],B['remoteRun']])
 home=str(Path.home())==B['home'] and str(Path.home().resolve())==B['home']
 model=platform.system()=='Darwin';arch=platform.machine()=='arm64'
 ok=absent and home and model and arch
 print(json.dumps({'phase':'route-preflight','pid':os.getpid(),'epoch':time.time(),'pass':ok,'homeMatches':home,'modelMatches':model,'architectureMatches':arch,'pathsAbsent':absent,'load':list(os.getloadavg())}),flush=True)
finally:sys.exit(0 if ok else 1)
'''
call('route-preflight',probe,seconds=15)
files=['bundle.json']+[r['path'] for r in json.loads((P/'bundle.json').read_text())['files']]
hashes={f:hashlib.sha256((P/f).read_bytes()).hexdigest() for f in files}
assert hashes['bundle.json']=='2fa6edaf3f1edbf89f1b69564425c0c0eaf208e790a805cfee1ba9dfbc611e59'
archive=E/'nonsecret-bundle.tar'
with archive.open('xb') as f:
 with tarfile.open(fileobj=f,mode='w') as tf:
  for name in files:
   data=(P/name).read_bytes();assert (P/name).stat().st_mode&0o777==0o444
   ti=tarfile.TarInfo(name);ti.size=len(data);ti.mode=0o444;tf.addfile(ti,io.BytesIO(data))
 f.flush();os.fsync(f.fileno())
archive.chmod(0o444);data=archive.read_bytes();digest=hashlib.sha256(data).hexdigest()
(E/'archive-receipt.json').write_text(json.dumps({'path':str(archive),'sha256':digest,'bytes':len(data),'files':hashes,'completeBeforeTransfer':True},indent=2))
source=prelude+'import hashlib,io,tarfile\nHASHES='+repr(hashes)+'\nSIZE='+repr(len(data))+'\nDIGEST='+repr(digest)+'\n'+'''ok=False;created=False
try:
 data=sys.stdin.buffer.read(SIZE+1);assert len(data)==SIZE and hashlib.sha256(data).hexdigest()==DIGEST
 root=Path(B['remoteBundle']);assert root.parent.parent.resolve()==root.parent.parent
 assert not os.path.lexists(root.parent) and not os.path.lexists(B['source'])
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as tf:
  members=tf.getmembers();assert len(members)==12 and {x.name for x in members}==set(HASHES)
  for x in members:assert x.isfile() and x.mode==0o444 and hashlib.sha256(tf.extractfile(x).read()).hexdigest()==HASHES[x.name]
  root.parent.mkdir(mode=0o700);root.mkdir(mode=0o700);created=True
  for x in members:
   target=root/x.name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o444)
   with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),0o444);f.write(tf.extractfile(x).read());f.flush();os.fsync(f.fileno())
 assert {str(x.relative_to(root)) for x in root.rglob('*') if x.is_file() or x.is_symlink()}==set(HASHES)
 for name,digest in HASHES.items():
  x=root/name;assert not x.is_symlink() and x.stat().st_mode&0o777==0o444 and hashlib.sha256(x.read_bytes()).hexdigest()==digest
 ok=True
finally:
 print(json.dumps({'phase':'bundle-stage','pid':os.getpid(),'epoch':time.time(),'pass':ok,'bundleFiles':12,'createdBundle':created}),flush=True)
 sys.exit(0 if ok else 1)
'''
call('bundle-stage',source,data)
source=prelude+'import hashlib,io,tarfile\nSIZE='+repr(C['sourceArchive']['bytes'])+'\nDIGEST='+repr(C['sourceArchive']['sha256'])+'\nBUNDLE='+repr(C['bundleSha256'])+'\n'+'''ok=False;created=False
try:
 data=sys.stdin.buffer.read(SIZE+1);assert len(data)==SIZE and hashlib.sha256(data).hexdigest()==DIGEST
 root=Path(B['source']);assert root.parent.resolve()==root.parent and not os.path.lexists(root)
 sys.path.insert(0,B['remoteBundle'])
 from custody import bundle,verify_leaves,resume_check
 bound=bundle(B['remoteBundle'],BUNDLE);assert bound==B
 manifest=json.loads((Path(B['remoteBundle'])/'inputs/source-manifest.json').read_text())
 expected={x['path'] for x in manifest['leaves']}|{'snapback2/dist/npm/publish-snapback2-darwin-arm64-0.0.18/resume.json'}
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tf:
  members=tf.getmembers();assert len(members)==948 and {x.name for x in members}==expected
  for x in members:
   assert not Path(x.name).is_absolute() and '..' not in Path(x.name).parts and (x.isfile() or x.issym())
   if x.issym():assert not Path(x.linkname).is_absolute() and (root/x.name).parent.joinpath(x.linkname).resolve().is_relative_to(root)
  root.mkdir(mode=0o700);created=True
  for x in members:
   target=root/x.name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   if x.issym():os.symlink(x.linkname,target)
   else:
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,x.mode)
    with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),x.mode);f.write(tf.extractfile(x).read());f.flush();os.fsync(f.fileno())
 verify_leaves(root,manifest,source=True);resume_check(B)
 assert {str(x.relative_to(root)) for x in root.rglob('*') if x.is_file() or x.is_symlink()}==expected
 for row in json.loads((Path(B['remoteBundle'])/'inputs/artifact-inputs.json').read_text()):
  x=Path(B['artifacts'])/row['path'];assert not x.is_symlink() and x.stat().st_mode&0o777==int(row['mode'],8) and hashlib.sha256(x.read_bytes()).hexdigest()==row['sha256']
 ok=True
finally:
 print(json.dumps({'phase':'source-stage','pid':os.getpid(),'epoch':time.time(),'pass':ok,'sourceLeaves':947,'createdSource':created}),flush=True)
 sys.exit(0 if ok else 1)
'''
call('source-stage',source,(P/'source-stage.tar.gz').read_bytes())
(E/'stage-result.json').write_text(json.dumps({'stagePassed':True,'sourceLeaves':947,'bundleFiles':12,'bundleSha256':C['bundleSha256'],'sourceSha256':C['sourceArchive']['sha256'],'activationInvoked':False},indent=2))
