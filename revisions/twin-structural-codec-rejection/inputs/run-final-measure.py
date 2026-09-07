from pathlib import Path
import os,sys,json,hashlib,subprocess,time,datetime,signal,shutil
O=Path(sys.argv[1]);S=O/'candidate3-source'
node=Path('/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/node-v22.23.2-linux-x64/bin/node')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert sha(node)=='3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327'
assert all(x['exitCode']==0 for x in json.loads((O/'candidate3-check-summary.json').read_text()))
manifest=json.loads((O/'candidate3-source-manifest.json').read_text())
def verify():
 for x in manifest['sources']:
  p=S/x['path'];h=hashlib.sha256(os.readlink(p).encode()).hexdigest() if 'symlink' in x else sha(p)
  assert h==x['sha256'],str(p)
verify();assert not (O/'final-byte-bundle.mjs').exists() and not (O/'final-measure-terminal.json').exists()
entry='\n'.join(json.loads((O/'historical-byte-attribution.json').read_text())['entry']).encode();assert len(entry)==395 and hashlib.sha256(entry).hexdigest()=='3ba527bb0fe022dcaab8b54a20055fe1484cf1a11e1d4744f54e1739d489d2ac'
mem=int(next(l for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')).split()[1])*1024;assert mem>8*1024**3 and shutil.disk_usage(O).free>1024**3
(O/'final-measure-host.json').write_text(json.dumps(dict(utc=utc(),pid=os.getpid(),load=os.getloadavg(),availableBytes=mem,diskFree=shutil.disk_usage(O).free,sharedHost=True,nodeSha=sha(node),sourceManifestSha=sha(O/'candidate3-source-manifest.json'),hookSha=sha(O/'final-measure-import.mjs'),historicalAttributionSha=sha(O/'historical-byte-attribution.json')),indent=2)+'\n')
env=dict(os.environ)
for k in ['NODE_OPTIONS','NODE_PATH','BUN_OPTIONS','BUN_INSTALL','LD_PRELOAD','LD_LIBRARY_PATH','ESBUILD_BINARY_PATH']:env.pop(k,None)
env['PATH']=str(node.parent)+':/usr/local/bin:/usr/bin:/bin'
argv=[str(node),'--import',str(O/'final-measure-import.mjs'),'build.mjs','--measure-twin'];started=utc();t=time.monotonic()
with (O/'final-measure.log').open('xb') as log:
 p=subprocess.Popen(argv,cwd=S/'snapback2/packages/snapback2',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 launch=dict(argv=argv,pid=p.pid,cwd=str(S/'snapback2/packages/snapback2'),startedUtc=started,outerSeconds=60);(O/'final-measure-launch.json').write_text(json.dumps(launch,indent=2)+'\n');print(json.dumps(launch),flush=True)
 try:code=p.wait(timeout=60)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait();code=124
terminal=dict(launch,endedUtc=utc(),elapsedSeconds=time.monotonic()-t,exitCode=code,logSha=sha(O/'final-measure.log'))
(O/'final-measure-terminal.json').write_text(json.dumps(terminal,indent=2)+'\n');verify();print(json.dumps(terminal),flush=True);print((O/'final-measure.log').read_text(),flush=True);sys.exit(code)
