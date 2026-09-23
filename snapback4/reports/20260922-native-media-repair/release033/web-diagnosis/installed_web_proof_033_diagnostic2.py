from pathlib import Path
import datetime,hashlib,json,os,shutil,subprocess,time
repo=Path('/Users/ccheever/projects/snapback-3011-20260922/snapback4')
base=Path('/tmp/sb4-3011-20260922'); root=base/'installed-web-033-2';root.mkdir(exist_ok=False)
stage=repo/'target/publication/snapback4-darwin-arm64-0.2.33';receipt=json.loads((stage/'resume.json').read_text())
env=dict(os.environ,PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/opt/homebrew/bin:'+os.environ['PATH'])
manifest=json.loads((repo/'apps/chat/package.json').read_text());deps={**manifest['dependencies'],**manifest['devDependencies'],'playwright-core':'1.55.1'}
for key in ['client','platformArtifact']:
 artifact=receipt[key];tarball=stage/artifact['filename'];import base64
 assert 'sha512-'+base64.b64encode(hashlib.sha512(tarball.read_bytes()).digest()).decode()==artifact['integrity']
 deps[artifact['name']]='file:'+str(tarball)
(root/'package.json').write_text(json.dumps({'name':'snapback4-installed-web-qualification','private':True,'type':'module','dependencies':deps},indent=2)+'\n')
(root/'witness').mkdir();(root/'packages').mkdir();(root/'apps/chat').mkdir(parents=True)
for name in ['starter.mjs','lib.mjs']:shutil.copyfile(repo/'witness'/name,root/'witness'/name)
(root/'packages/snapback4').symlink_to(root/'node_modules/snapback4',target_is_directory=True)
(root/'apps/chat/package.json').write_text((root/'package.json').read_text())
(root/'apps/chat/node_modules').symlink_to(root/'node_modules',target_is_directory=True)
metadata={'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'client':receipt['client'],'platform':receipt['platformArtifact'],'witnessHashes':{name:hashlib.sha256((root/'witness'/name).read_bytes()).hexdigest() for name in ['starter.mjs','lib.mjs']},'scope':'Unmodified production starter witness; actual init output and SDK from exact staged tarballs; pinned third-party tooling fresh install','steps':[]}
def run(name,command):
 started=time.time()
 with (root/(name+'.log')).open('w') as log:
  child=subprocess.Popen(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  (root/'process.json').write_text(json.dumps({'step':name,'pid':child.pid,'command':command}))
  code=child.wait()
 metadata['steps'].append({'step':name,'exit':code,'seconds':round(time.time()-started,3)})
 (root/'result.json').write_text(json.dumps(metadata,indent=2)+'\n')
 print(json.dumps(metadata['steps'][-1]),flush=True)
 print('\n'.join((root/(name+'.log')).read_text().splitlines()[-12:]),flush=True)
 if code:raise SystemExit(code)
shutil.copyfile(base/'installed-web-033-1/package-lock.json',root/'package-lock.json')
metadata['operatorObserverSha256']=hashlib.sha256((base/'observe_starter_navigation.mjs').read_bytes()).hexdigest()
metadata['dependencyLockSha256']=hashlib.sha256((root/'package-lock.json').read_bytes()).hexdigest()
run('install',['npm','ci','--no-audit','--no-fund','--loglevel=error'])
binary=root/'node_modules/snapback4-darwin-arm64/snapback4'
assert hashlib.sha256(binary.read_bytes()).hexdigest()==receipt['binarySha256']
metadata['binarySha256']=receipt['binarySha256'];env['SNAPBACK4_BIN']=str(binary)
run('browser',['node','--import',str(base/'observe_starter_navigation.mjs'),'witness/starter.mjs'])
metadata['ended']=datetime.datetime.now(datetime.timezone.utc).isoformat();metadata['status']='pass';(root/'result.json').write_text(json.dumps(metadata,indent=2)+'\n')
