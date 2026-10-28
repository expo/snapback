from pathlib import Path
import subprocess,json,os,shutil,tempfile,hashlib,time
p=Path(__file__).parent;repo=Path('/home/ccheever/projects/snapback-sb4loop');out=p/'packed-guide-closure';out.mkdir(exist_ok=True);native=p/'snapback4-0.4.46-final';sdk=p/'packs-final/snapback4-0.4.46.tgz';old=p/'consumer-r4/snapback4-linux-x64-0.4.46.tgz';env=dict(os.environ);env.pop('SNAPBACK4_BIN',None);records=[]
def run(label,args,cwd,seconds=180):
 start=time.time();r=subprocess.run(['timeout','--kill-after=10s',str(seconds)+'s',*map(str,args)],cwd=cwd,env=env,capture_output=True,text=True);rec=dict(label=label,args=list(map(str,args)),exit=r.returncode,seconds=time.time()-start,stdout=r.stdout,stderr=r.stderr);records.append(rec);(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n');assert r.returncode==0,(label,r.returncode,r.stderr[-2000:]);return r.stdout
with tempfile.TemporaryDirectory(prefix='i30-guide-platform-')as tmp:
 d=Path(tmp);src=repo/'snapback4/packages/snapback4-linux-x64'
 for name in ['package.json','THIRD-PARTY-NOTICES']:shutil.copy2(src/name,d/name)
 shutil.copy2(native,d/'snapback4');packed=json.loads(run('pack-final-platform',['npm','pack','--ignore-scripts','--json','--pack-destination',out],d));new=out/packed[0]['filename']
for name,platform in [('previous',old),('fixed',new)]:
 with tempfile.TemporaryDirectory(prefix='i30-packed-guide-'+name+'-')as tmp:
  d=Path(tmp);(d/'package.json').write_text('{"private":true,"type":"module"}\n');run(name+'-install',['npm','install','--ignore-scripts','--no-audit','--no-fund',sdk,platform],d,300)
  binary=d/'node_modules/snapback4/bin/snapback4.js';text=run(name+'-section',['node',binary,'guide','release-json','--section','Postgres durability modes and read grants','--repeat'],d)
  blocked='LLP 'in text or any(f in text for f in ['identity.rs','authority.rs','session_clock.rs','opening.rs','store.rs'])
  if name=='previous':assert blocked and 'Every such writer takes the serialized head fence'not in text,'Previous packed counterexample no longer reproduces'
  else:
   assert not blocked and 'Every such writer takes the serialized head fence'in text and 'including administrative writes without a public sequence'in text
   for word in ['session/read-session','session/family invalidation','clock updates','same commit','unified revision']:assert word in text,word
   assert 'snapback4 0.4.46'in run('fixed-version',['node',binary,'--version'],d)
result=dict(source=subprocess.check_output(['timeout','20s','git','rev-parse','HEAD'],cwd=repo,text=True).strip(),exit=0,previousPackedCounterexampleReproduced=True,fixedPackedGuideClosesAllReferences=True,serializedFenceAndRevisionContractVisible=True,binarySha256=hashlib.sha256(native.read_bytes()).hexdigest(),sdkSha256=hashlib.sha256(sdk.read_bytes()).hexdigest(),oldPlatformSha256=hashlib.sha256(old.read_bytes()).hexdigest(),newPlatformSha256=hashlib.sha256(new.read_bytes()).hexdigest(),commandCaptureSha256=hashlib.sha256((out/'commands.json').read_bytes()).hexdigest(),method='Fresh packed SDK/platform consumers, no binary override/checkout dependencies. Same closure rule rejects the pre-fix packed content and accepts fixed content; fixed actual section must show the supported-writer serialized-fence/same-commit revision contract. All SDK/runtime/HTTP/proof code is unchanged from full R4; only guide prose changed, so unrelated complete R4 consumer proofs are reused with an explicit source binding under LLP0232/FIX43 affected-scope cadence.')
(p/'packed-guide-closure-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
