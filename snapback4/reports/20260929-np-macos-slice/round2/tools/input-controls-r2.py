from pathlib import Path
import subprocess,json,os,hashlib
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round2';s=r/'subject';u=(e/'owned.udid').read_text().strip()
args=['python3',str(r/'run-witness-r2.py')]
def run(name):
 p=subprocess.run([*args,name,'--repack',str(e/'final-a-ownbuild-1/build.json'),'--app-project',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL);print(name,p.returncode,flush=True);assert p.returncode==1
project=s/'ios/Clique.xcodeproj/project.pbxproj';original=project.read_bytes();outside=s/'SharedNative';outside.mkdir(exist_ok=True);swift=outside/'Foo.swift'
try:
 project.write_text(original.decode().replace('objects = {','objects = {\n NP_EXTERNAL = {isa = PBXFileReference; path = "../SharedNative/Foo.swift"; sourceTree = SOURCE_ROOT; };',1))
 env={k:os.environ[k] for k in ['PATH','HOME','USER','LOGNAME','LANG'] if k in os.environ};env.update(PATH=str(Path.home()/'np-tools/node/bin')+':'+env['PATH'],EXPO_NO_DOTENV='1',CI='1',EXPO_NO_TELEMETRY='1')
 fp="require('@expo/fingerprint').createFingerprintAsync(process.cwd(),{platforms:['ios'],silent:true,sourceSkips:0}).then(x=>console.log(JSON.stringify(x)))"
 def fingerprint(label):
  p=subprocess.run(['node','-e',fp],cwd=s,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,check=True);(e/(label+'.json')).write_text(p.stdout);return json.loads(p.stdout)['hash']
 swift.write_text('let nativeValue = "A"\n');before=fingerprint('external-fingerprint-before')
 swift.write_text('let nativeValue = "B"\n');after=fingerprint('external-fingerprint-after')
 assert before==after
 (e/'external-input-control.json').write_text(json.dumps({'externalInput':'SharedNative/Foo.swift','fingerprintBefore':before,'fingerprintAfter':after,'unchanged':before==after},indent=2))
 run('control-external-native')
finally:
 project.write_bytes(original);swift.unlink();outside.rmdir()
pod=s/'ios/Pods/hermes-engine/destroot/bin/hermesc';original=pod.read_bytes();mode=pod.stat().st_mode
try:
 pod.chmod(0o755);pod.write_bytes(original+b'\nNP intentional pod bytes change\n')
 run('control-pod-input')
finally:pod.write_bytes(original);pod.chmod(mode)
