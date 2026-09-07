from pathlib import Path
import os,json,hashlib,subprocess,datetime,time,signal,sys
O=Path(sys.argv[1]);B=Path('/home/ccheever/clique-tooling/epyc-linux-tooling-20260907T010007Z-0fd567d96f/bun-v1.3.12-linux-x64/bin/bun');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
assert sha(B)=='92a1cd8b6185f676010bb18e767dfc65c772273e79ae9984480843261939eeaa'
for variant in ['parent','candidate1']:
 F=O/(variant+'-root-oracles');C=json.loads((F/'custody.json').read_text());assert sha(F/'probe.mjs')==C['bundleSha256']
 for x in C['inputs']:assert sha(x['origin'])==x['sha256']
 S=O/(variant+'-source');E=O/(variant+'-bun-root');E.mkdir();argv=[str(B),str(F/'probe.mjs'),str(E/'result.json')];start=utc();t=time.monotonic()
 with (E/'log.txt').open('xb') as log:
  p=subprocess.Popen(argv,env=dict(os.environ,CORPUS=str(S/'native-corpus')),cwd=S,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);print(variant,p.pid,flush=True)
  try:code=p.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait();code=124
 (E/'terminal.json').write_text(json.dumps(dict(argv=argv,pid=p.pid,start=start,end=utc(),elapsedSeconds=time.monotonic()-t,exitCode=code,outerSeconds=10,bunSha=sha(B),bundleSha=sha(F/'probe.mjs'),inputCustodySha=sha(F/'custody.json'),load=os.getloadavg(),sharedHost=True,resultSha=sha(E/'result.json') if (E/'result.json').exists() else None),indent=2)+'\n')
 if code:print((E/'log.txt').read_text());sys.exit(code)
