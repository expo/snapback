from pathlib import Path
import json,hashlib,subprocess,os
r=Path('/Users/ccheever/sb4-np');subject=r/'subject';old=Path('/Users/ccheever/np-stage0/clique');e=r/'evidence/round7';repo=r/'lane'
def h(b):return hashlib.sha256(b).hexdigest()
def files(p):return {str(f.relative_to(p)):h(f.read_bytes()) for f in p.rglob('*') if f.is_file() and not f.is_symlink()}
client_old=files(old/'node_modules/snapback4');client_new=files(subject/'node_modules/snapback4');assert client_old==client_new
core_old=files(old/'node_modules/snapback4-expo/ios/Snapback4Device.xcframework');core_new=files(subject/'node_modules/snapback4-expo/ios/Snapback4Device.xcframework');assert core_old==core_new
pins={}
for name in ['expo','react-native','@expo/cli','@expo/repack-app','@expo/fingerprint','hermes-compiler','snapback4','snapback4-expo','expo-dev-client','expo-router','expo-video','expo-image-picker','expo-secure-store','expo-sqlite','expo-font','expo-asset']:
 p=subject/'node_modules'/name/'package.json';j=json.loads(p.read_text());pins[name]={'version':j['version'],'packageJsonSha256':h(p.read_bytes())}
(e/'package-pins.json').write_text(json.dumps({'pins':pins,'unusedInstalledTool':'@expo/repack-app remains in the historical subject lock; preparation never invokes or requires it','packageLockSha256':h((subject/'package-lock.json').read_bytes()),'publishedClientFilesEqualToStage0':True,'publishedClientFileCount':len(client_new),'nativeCoreFilesEqualToStage0':True,'nativeCoreFileCount':len(core_new)},indent=2)+'\n')
env=dict(os.environ,PATH='/Users/ccheever/np-tools/node/bin:/Users/ccheever/np-tools/bun/bin:/Users/ccheever/.cargo/bin:'+os.environ['PATH'],DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer',TMPDIR=str(r/'tmp'))
commands=[['sw_vers'],['sysctl','-n','machdep.cpu.brand_string'],['sysctl','-n','hw.ncpu'],['sysctl','-n','hw.memsize'],['xcodebuild','-version'],['node','--version'],['bun','--version'],['rustc','--version'],['pod','--version'],['git','rev-parse','HEAD'],['git','rev-parse','origin/main']]
rows=[]
for argv in commands:
 p=subprocess.run(argv,cwd=repo,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE);rows.append({'argv':argv,'exitStatus':p.returncode,'stdout':p.stdout,'stderr':p.stderr});assert p.returncode==0
(e/'host-pins.json').write_text(json.dumps(rows,indent=2))
paths=[*r.glob('lane-npmac.r*.prompt.md'),repo/'snapback4/crates/snapback4/src/verbs/witness.rs',* (repo/'snapback4/crates/snapback4/src/verbs/witness').glob('*')]
(e/'native-source-pins.json').write_text(json.dumps({str(p):h(p.read_bytes()) for p in paths if p.is_file()},indent=2))
print('Pins and unchanged published client/core verified')
