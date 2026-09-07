from pathlib import Path
import os,sys,json,hashlib,subprocess,time,datetime,tarfile,platform,shutil,signal
O=Path(sys.argv[1]); mode=sys.argv[2]; S=O/'source'
P=Path('/home/ccheever/clique-tooling/search-twin-runtime-redesign-23a0-candidate1-20260907T0852Z')
T=Path('/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f')
node=T/'node-v22.23.2-linux-x64/bin/node';bun=T/'bun-v1.3.12-linux-x64/bin/bun'
checker=Path('/home/ccheever/clique-tooling/search-native-linux-26c9-20260907T0203Z-01a07995/artifacts/snapback2-linux-x86_64-debug')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(node)=='3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327'
assert sha(bun)=='92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa'
manifest=json.loads((O/'source-manifest.json').read_text())
def verify():
 for r in manifest['sources']:
  p=S/r['path'];b=os.readlink(p).encode() if 'symlink' in r else p.read_bytes()
  assert hashlib.sha256(b).hexdigest()==r['sha256'],r['path']
def host():
 available=int(next(l for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])*1024
 assert available>8*1024**3 and shutil.disk_usage(O).free>5*1024**3
 return {'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pid':os.getpid(),'platform':platform.platform(),'load':os.getloadavg(),'availableMemory':available,'diskFree':shutil.disk_usage(O).free,'node':str(node),'nodeSha256':sha(node),'bun':str(bun),'bunSha256':sha(bun),'sharedHost':True}
(O/(mode+'-host.json')).write_text(json.dumps(host(),indent=2)+'\n')
env=dict(os.environ)
for k in ['NODE_OPTIONS','NODE_PATH','BUN_OPTIONS','BUN_INSTALL','LD_PRELOAD','LD_LIBRARY_PATH','ESBUILD_BINARY_PATH']:env.pop(k,None)
(O/'tmp').mkdir(exist_ok=True)
env.update(PATH=f'{node.parent}:{bun.parent}:/usr/local/bin:/usr/bin:/bin',TMPDIR=str(O/'tmp'),BUN_INSTALL_CACHE_DIR=str(O/'bun-cache'),SNAPBACK2_CORPUS=str(S/'native-corpus'),SNAPBACK2_BIN=str(checker))
def run(name,args,cwd,deadline):
 start=time.monotonic();utc=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (O/(name+'.log')).open('xb') as log:
  p=subprocess.Popen([str(a) for a in args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  print(json.dumps({'phase':name,'pid':p.pid,'start':utc,'deadline':deadline}),flush=True)
  try:status=p.wait(timeout=deadline)
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=2)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   status=124
 result={'name':name,'argv':[str(a) for a in args],'cwd':str(cwd),'pid':p.pid,'started':utc,'elapsedSeconds':time.monotonic()-start,'ended':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':status,'outerDeadlineSeconds':deadline,'host':'EPYC Linux','nodeSha256':sha(node),'bunSha256':sha(bun)}
 (O/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True);verify();return status
if mode=='qualify':
 assert not S.exists()
 assert sha(O/'source.tar.gz')=='981804425b785b7de8774e91cab70b7cd39bfa9513a6ca89e947a7582094f96c'
 S.mkdir()
 with tarfile.open(O/'source.tar.gz') as t:t.extractall(S,filter='data')
 verify()
 # Copy ordinary installed dependencies into this exclusive derivative; never install or mutate the donor.
 deps=[]
 paths=[Path('snapback2/node_modules')]+[p.relative_to(P/'source') for p in sorted((P/'source/snapback2/packages').glob('*/node_modules'))]
 for name in paths:
  old=P/'source'/name;dest=S/name
  if old.is_symlink():dest.symlink_to(os.readlink(old))
  else:shutil.copytree(old,dest,symlinks=True)
  for directory,dirs,files in os.walk(dest,followlinks=False):
   for leaf in files+list(dirs):
    item=Path(directory)/leaf;original=P/'source'/item.relative_to(S)
    if item.is_symlink():
     link=os.readlink(item);assert link==os.readlink(original) and not os.path.isabs(link),str(item)
     deps.append({'path':str(item.relative_to(S)),'symlink':link})
    elif item.is_file():
     digest=sha(item);assert digest==sha(original)
     deps.append({'path':str(item.relative_to(S)),'bytes':item.stat().st_size,'sha256':digest})
 (O/'dependency-manifest.json').write_text(json.dumps(deps,indent=2)+'\n')
 assert sha(checker)=='2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175'
 (O/'checker-use.json').write_text(json.dumps({'path':str(checker),'sha256':sha(checker),'bytes':checker.stat().st_size,'corpusManifestSha256':sha(S/'native-corpus/manifest.json'),'sourceManifestSha256':sha(O/'source-manifest.json'),'role':'existing26c9 check --ir --json only; no native build/server/population; branch whole ir-contract remains predecessor v2'},indent=2)+'\n')
 status=run('package-build',[node,'build.mjs'],S/'snapback2/packages/snapback2',120)
 if status:sys.exit(status)
 status=run('evaluator',[bun,'src/test.ts'],S/'snapback2/packages/evaluator',120)
 if status:sys.exit(status)
 status=run('prepare-probe',['/usr/bin/python3',O/'prepare-probe.py',S,O],O,10)
 if status:sys.exit(status)
 status=run('comparison',[node,'--experimental-strip-types',O/'compare.mjs'],O,10)
 if status:sys.exit(status)
 status=run('capture-build',['/usr/bin/python3',O/'capture-build.py',O],O,30)
 assert sha(checker)=='2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175'
 (O/'source-after.json').write_text(json.dumps({'verified':len(manifest['sources']),'manifestSha256':sha(O/'source-manifest.json'),'allUnchanged':True,'checkerUnchanged':True},indent=2)+'\n')
elif mode=='measure':
 verify()
 assert json.loads((O/'package-build.json').read_text())['exit']==0
 assert json.loads((O/'evaluator.json').read_text())['exit']==0
 assert json.loads((O/'comparison.json').read_text())['exit']==0
 status=run('final-measure',[node,'--import',O/'measure-import.mjs','build.mjs','--measure-twin'],S/'snapback2/packages/snapback2',60)
else:raise ValueError(mode)
print('TERMINAL '+str(status),flush=True);sys.exit(status)
