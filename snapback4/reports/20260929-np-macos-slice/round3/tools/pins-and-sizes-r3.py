from pathlib import Path
import json,hashlib,tarfile,gzip,io
r=Path('/Users/ccheever/sb4-np');subject=r/'subject'; old=Path('/Users/ccheever/np-stage0/clique');e=r/'evidence/round3'
def h(b):return hashlib.sha256(b).hexdigest()
def files(p):return {str(f.relative_to(p)):h(f.read_bytes()) for f in p.rglob('*') if f.is_file() and not f.is_symlink()}
client_old=files(old/'node_modules/snapback4');client_new=files(subject/'node_modules/snapback4');assert client_old==client_new
core_old=files(old/'node_modules/snapback4-expo/ios/Snapback4Device.xcframework');core_new=files(subject/'node_modules/snapback4-expo/ios/Snapback4Device.xcframework');assert core_old==core_new
pins={}
for name in ['expo','react-native','@expo/cli','@expo/repack-app','@expo/fingerprint','hermes-compiler','snapback4','snapback4-expo','expo-dev-client','expo-router','expo-video','expo-image-picker','expo-secure-store','expo-sqlite','expo-font','expo-asset']:
 p=subject/'node_modules'/name/'package.json';j=json.loads(p.read_text());pins[name]={'version':j['version'],'packageJsonSha256':h(p.read_bytes())}
lock=json.loads((subject/'package-lock.json').read_text()); pins['@expo/repack-app']['integrity']=lock['packages']['node_modules/@expo/repack-app']['integrity']; pins['@expo/repack-app']['installedFilesBytes']=sum(p.stat().st_size for p in (subject/'node_modules/@expo/repack-app').rglob('*') if p.is_file())
(e/'package-pins.json').write_text(json.dumps({'pins':pins,'packageLockSha256':h((subject/'package-lock.json').read_bytes()),'publishedClientFilesEqualToStage0':client_old==client_new,'publishedClientFileCount':len(client_new),'nativeCoreFilesEqualToStage0':core_old==core_new,'nativeCoreFileCount':len(core_new)},indent=2)+'\n')
sizes=[]
for name in ['sealed-a-ownbuild-1','sealed-b-repack-1','sealed-b-warm-ownbuild-1']:
 p=e/name/('repacked.app' if 'repack' in name else 'base.app');target=e/(name+'.app.tar.gz')
 # This is an artifact size measurement, not an npm publication estimate.
 with target.open('wb') as output:
  with gzip.GzipFile(fileobj=output,mode='wb',mtime=0) as z:
   with tarfile.open(fileobj=z,mode='w|') as tar:tar.add(p,arcname='application.app')
 sizes.append({'name':name,'tarGzipBytes':target.stat().st_size,'tarGzipSha256':h(target.read_bytes()),'path':str(target)})
(e/'compressed-app-sizes.json').write_text(json.dumps(sizes,indent=2)+'\n');print(sizes)
