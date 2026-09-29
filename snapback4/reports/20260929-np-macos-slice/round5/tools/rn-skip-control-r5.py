from pathlib import Path
import hashlib,json,subprocess
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';d=e/'rn-skip';d.mkdir();(d/'Fixture.app').mkdir();(d/'home').mkdir();(d/'tmp').mkdir()
script=r/'subject/node_modules/react-native/scripts/react-native-xcode.sh'
bundle=d/'Fixture.app/main.jsbundle';bundle.write_bytes((e/'final-a-ownbuild-1/base.app/main.jsbundle').read_bytes())
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before=h(bundle);env={'PATH':'/Users/ccheever/np-tools/node/bin:/usr/bin:/bin','HOME':str(d/'home'),'TMPDIR':str(d/'tmp'),'DEVELOPER_DIR':'/Applications/Xcode.app/Contents/Developer','CONFIGURATION':'Release','CONFIGURATION_BUILD_DIR':str(d),'UNLOCALIZED_RESOURCES_FOLDER_PATH':'Fixture.app','SKIP_BUNDLING':'1'}
argv=['/bin/bash',str(script)]
p=subprocess.run(argv,cwd=d,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
(e/'rn-skip-control.log').write_text(p.stdout+p.stderr)
assert p.returncode==0 and before==h(bundle) and 'SKIP_BUNDLING enabled; skipping.' in p.stdout
(e/'rn-skip-control.json').write_text(json.dumps({'argv':argv,'cwd':str(d),'env':env,'rnVersion':'0.86.3','scriptSha256':h(script),'exitStatus':p.returncode,'bundleSha256Before':before,'bundleSha256After':h(bundle),'oldBundleRetained':True,'meaning':'Pinned RN script itself exits zero preserving A; warm preparation must refuse SKIP_BUNDLING before this phase.'},indent=2))
print('Pinned RN successful-skip behavior reproduced with actual A HBC')
