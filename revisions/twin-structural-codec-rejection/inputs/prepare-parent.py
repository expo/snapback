from pathlib import Path
import os,sys,json,hashlib,shutil,subprocess,datetime,time,signal
O=Path(sys.argv[1]);D=Path('/home/ccheever/clique-tooling/search-twin-runtime-redesign-23a0-candidate1-20260907T0852Z');S=O/'parent-source'
T=Path('/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f');node=T/'node-v22.23.2-linux-x64/bin/node';bun=T/'bun-v1.3.12-linux-x64/bin/bun'
checker=Path('/home/ccheever/clique-tooling/search-native-linux-26c9-20260907T0203Z-01a07995/artifacts/snapback2-linux-x86_64-debug')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
write=lambda n,d:(O/n).write_text(json.dumps(d,indent=2)+'\n')
assert not S.exists()
assert sha(node)=='3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327'
assert sha(bun)=='92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa'
assert sha(checker)=='2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175'
packet=json.loads((O/'parent-packet.json').read_text())
assert sha(D/'source-manifest.json')==packet['donorManifestSha256']
assert sha(O/'parent-source-manifest.json')==packet['parentManifestSha256']
for x in packet['records']:assert sha(O/x['path'])==x['sha256'],x['path']
def verify(root,manifest):
 for x in manifest['sources']:
  p=root/x['path'];h=hashlib.sha256(os.readlink(p).encode()).hexdigest() if 'symlink' in x else sha(p)
  assert h==x['sha256'],str(p)
verify(D/'source',json.loads((D/'source-manifest.json').read_text()))
assert sha(D/'dependency-manifest.json')=='e6ac59cbac74fef0bbe17620816adc958eb5054f90d697a334ff877a423ffc85'
dep=json.loads((D/'dependency-manifest.json').read_text())
def verify_dependencies(root):
 for row in dep:
  p=root/row['path']
  if 'symlink' in row:
   assert p.is_symlink() and os.readlink(p)==row['symlink'],str(p)
   assert p.resolve().is_relative_to(root.resolve()),str(p)
  else:assert p.stat().st_size==row['bytes'] and sha(p)==row['sha256'],str(p)
verify_dependencies(D/'source')
mem=int(next(l for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])*1024
assert mem>8*1024**3 and shutil.disk_usage(O).free>5*1024**3
write('parent-host.json',dict(utc=utc(),pid=os.getpid(),load=os.getloadavg(),availableBytes=mem,diskFree=shutil.disk_usage(O).free,node=str(node),nodeSha=sha(node),bunSha=sha(bun),checkerSha=sha(checker),host=os.uname(),sharedHost=True))
shutil.copytree(D/'source',S,symlinks=True)
for n in ['certificate-identity.ts','test.ts']:shutil.copyfile(O/'parent-owned'/n,S/'snapback2/packages/evaluator/src'/n)
manifest=json.loads((O/'parent-source-manifest.json').read_text());verify(S,manifest)
assert sha(S/'snapback2/packages/evaluator/src/types.ts')=='afc6bc7ffd25fc007787b10e0fc8bdafbe4ae61cb12f7d2442f2c2df95686618'
assert sha(S/'snapback2/packages/evaluator/dist/unicode-tables.ts')=='9eccdccd99e9b936a40dcbf8ae63c55d980086df1ae71f92019f9ab040f6a521'
verify_dependencies(S)
write('parent-dependency-verification.json',dict(utc=utc(),inventory=str(D/'dependency-manifest.json'),inventorySha256=sha(D/'dependency-manifest.json'),entries=len(dep),donorVerified=True,copyVerified=True,symlinkTargetsVerified=True))
env=dict(os.environ,ROOT=str(S),OUT=str(O/'before-oracles'),CORPUS=str(S/'native-corpus'),PATH=str(node.parent)+':'+str(bun.parent)+':'+os.environ['PATH'])
argv=[str(node),str(O/'capture-oracles.mjs')];started=utc();t=time.monotonic()
with (O/'parent-oracle.log').open('xb') as log:
 child=subprocess.Popen(argv,env=env,cwd=S,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 write('parent-oracle-launch.json',dict(argv=argv,pid=child.pid,startedUtc=started,outerSeconds=10));print(json.dumps(dict(phase='parent-oracle',pid=child.pid)),flush=True)
 try:code=child.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait();code=124
write('parent-oracle-terminal.json',dict(argv=argv,pid=child.pid,startedUtc=started,endedUtc=utc(),elapsedSeconds=time.monotonic()-t,exitCode=code,outerSeconds=10,logSha256=sha(O/'parent-oracle.log')))
verify(S,manifest);verify(D/'source',json.loads((D/'source-manifest.json').read_text()))
write('parent-source-verified.json',dict(utc=utc(),parentManifestSha256=sha(O/'parent-source-manifest.json'),donorUnchanged=True,parentUnchanged=True,sourceCount=len(manifest['sources']),nodeSha256=sha(node)))
print((O/'parent-oracle.log').read_text(),flush=True)
sys.exit(code)
