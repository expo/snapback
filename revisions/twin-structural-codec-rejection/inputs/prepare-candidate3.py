from pathlib import Path
import os,sys,json,hashlib,shutil,subprocess,datetime,time,signal
O=Path(sys.argv[1]);S=O/'candidate3-source';P=O/'parent-source'
T=Path('/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f');node=T/'node-v22.23.2-linux-x64/bin/node'
D=Path('/home/ccheever/clique-tooling/search-twin-runtime-redesign-23a0-candidate1-20260907T0852Z')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
write=lambda n,d:(O/n).write_text(json.dumps(d,indent=2)+'\n')
assert not S.exists()
assert sha(node)=='3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327'
man=json.loads((O/'parent-source-manifest.json').read_text());changes=json.loads((O/'candidate3-owned.json').read_text())
def verify(root,rows):
 for x in rows:
  p=root/x['path'];h=hashlib.sha256(os.readlink(p).encode()).hexdigest() if 'symlink' in x else sha(p)
  assert h==x['sha256'],str(p)
verify(P,man['sources']);assert sha(D/'dependency-manifest.json')=='e6ac59cbac74fef0bbe17620816adc958eb5054f90d697a334ff877a423ffc85'
dep=json.loads((D/'dependency-manifest.json').read_text())
def dependencies(root):
 for x in dep:
  p=root/x['path']
  if 'symlink' in x:assert p.is_symlink() and os.readlink(p)==x['symlink'] and p.resolve().is_relative_to(root.resolve()),str(p)
  else:assert p.stat().st_size==x['bytes'] and sha(p)==x['sha256'],str(p)
dependencies(P)
mem=int(next(l for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])*1024
assert mem>8*1024**3 and shutil.disk_usage(O).free>5*1024**3
write('candidate3-host.json',dict(utc=utc(),pid=os.getpid(),load=os.getloadavg(),availableBytes=mem,diskFree=shutil.disk_usage(O).free,node=str(node),nodeSha=sha(node),host=os.uname(),sharedHost=True))
shutil.copytree(P,S,symlinks=True)
rows={x['path']:x for x in man['sources']}
for x in changes['source']:
 p=O/'candidate3-owned'/x['path'];assert sha(p)==x['sha256'];shutil.copyfile(p,S/x['path']);rows[x['path']]=x
verify(S,rows.values());dependencies(S)
write('candidate3-source-manifest.json',dict(base=changes['base'],sources=list(rows.values()),dependencyManifestSha256=sha(D/'dependency-manifest.json')))
write('candidate3-dependencies.json',dict(utc=utc(),entries=len(dep),parentVerified=True,candidateVerified=True,symlinkTargetsVerified=True))

checker=Path('/home/ccheever/clique-tooling/search-native-linux-26c9-20260907T0203Z-01a07995/artifacts/snapback2-linux-x86_64-debug')
assert sha(checker)=='2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175'
bun=T/'bun-v1.3.12-linux-x64/bin/bun';assert sha(bun)=='92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa'
E=O/'candidate3-checks';E.mkdir();(O/'candidate3-tmp').mkdir();(O/'candidate3-bun-cache').mkdir()
env=dict(os.environ)
for k in ['NODE_OPTIONS','NODE_PATH','BUN_OPTIONS','BUN_INSTALL','LD_PRELOAD','LD_LIBRARY_PATH','ESBUILD_BINARY_PATH']:env.pop(k,None)
env.update(ROOT=str(S),OUT=str(O/'candidate3-oracles'),CORPUS=str(S/'native-corpus'),PATH=f'{node.parent}:{bun.parent}:/usr/local/bin:/usr/bin:/bin',TMPDIR=str(O/'candidate3-tmp'),BUN_INSTALL_CACHE_DIR=str(O/'candidate3-bun-cache'),SNAPBACK2_CORPUS=str(S/'native-corpus'),SNAPBACK2_BIN=str(checker))
write('candidate3-checker.json',dict(path=str(checker),sha256=sha(checker),corpusManifestSha256=sha(S/'native-corpus/manifest.json'),sourceManifestSha256=sha(O/'candidate3-source-manifest.json'),role='unchanged26c9 check --ir --json; no server/build/population; whole ir-contract version mismatch remains scoped to consumed systemPrincipalId'))
summary=[]
for command in json.loads((O/'candidate3-commands.json').read_text()):
 name=command['name'];started=utc();t=time.monotonic();mem=int(next(l for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])*1024
 assert mem>8*1024**3
 with (E/(name+'.log')).open('xb') as log:
  child=subprocess.Popen(command['argv'],env=env,cwd=command['cwd'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  launch=dict(command,pid=child.pid,startedUtc=started,load=os.getloadavg(),availableBytes=mem)
  (E/(name+'-launch.json')).write_text(json.dumps(launch,indent=2)+'\n');print(json.dumps(launch),flush=True)
  try:code=child.wait(timeout=command['outerSeconds'])
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait();code=124
 terminal=dict(launch,endedUtc=utc(),elapsedSeconds=time.monotonic()-t,exitCode=code,logSha256=sha(E/(name+'.log')))
 (E/(name+'-terminal.json')).write_text(json.dumps(terminal,indent=2)+'\n');summary.append(terminal);write('candidate3-check-summary.json',summary);print(json.dumps(terminal),flush=True)
 verify(P,man['sources']);verify(S,rows.values());assert sha(checker)=='2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175'
 if code:print((E/(name+'.log')).read_text(),flush=True);sys.exit(code)
 if name=='candidate3-oracle':
  before=(O/'parent-root-oracles/result.json').read_bytes();after=(O/'candidate3-oracles/result.json').read_bytes();equal=before==after
  write('candidate3-oracle-comparison.json',dict(equal=equal,beforeSha256=hashlib.sha256(before).hexdigest(),afterSha256=hashlib.sha256(after).hexdigest(),scope='complete raw outputs,2,425 policy cases+250canonical entries;12post-edit added controls explicitly separate'))
  if not equal:print('ORACLE MISMATCH',flush=True);sys.exit(2)
 if name=='candidate3-bun-oracle':
  before=(O/'parent-bun-root/result.json').read_bytes();after=(O/'candidate3-bun-result.json').read_bytes();equal=before==after
  write('candidate3-bun-comparison.json',dict(equal=equal,beforeSha256=hashlib.sha256(before).hexdigest(),afterSha256=hashlib.sha256(after).hexdigest(),scope='same2,425inputs on pinnedBun; native error messages are compared within each runtime'))
  if not equal:print('BUN ORACLE MISMATCH',flush=True);sys.exit(2)
 if name=='package-build':
  import tarfile
  D=S/'snapback2/packages/snapback2/dist';files=[];inputs={};maps={}
  with tarfile.open(O/'candidate3-public-build.tar.gz','w:gz') as archive:
   for file in sorted(D.rglob('*')):
    if not file.is_file():continue
    relative=str(file.relative_to(S));files.append(dict(path=relative,bytes=file.stat().st_size,sha256=sha(file)));archive.add(file,arcname=relative,recursive=False)
    if file.name.endswith('.map'):
     mapping=json.loads(file.read_text());assert len(mapping['sources'])==len(mapping['sourcesContent']);names=[]
     for source,content in zip(mapping['sources'],mapping['sourcesContent']):
      origin=(file.parent/source).resolve();assert origin.read_text()==content,str(origin);path=str(origin.relative_to(S));inputs[path]=dict(path=path,bytes=origin.stat().st_size,sha256=sha(origin));names.append(path)
     maps[relative]=names
  write('candidate3-public-build.json',dict(files=files,sourceInputs=list(inputs.values()),maps=maps,archiveSha256=sha(O/'candidate3-public-build.tar.gz')))
print('CANDIDATE2 WORKLOAD COMPLETE',flush=True)
