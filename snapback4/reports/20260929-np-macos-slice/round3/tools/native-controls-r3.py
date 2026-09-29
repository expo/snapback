import pathlib,subprocess,json,os
root=pathlib.Path('/Users/ccheever/sb4-np'); base=root/'evidence/round3/sealed-a-ownbuild-1/build.json'; subject=root/'subject'; udid=(root/'evidence/round3/owned.udid').read_text().strip()
def run(name,receipt):
 return subprocess.run(['python3',str(root/'run-witness-r3.py'),name,'--repack',str(receipt),'--app-project',str(subject),'--smoke','--udid',udid,'--port','49371'],stdout=subprocess.DEVNULL).returncode
config=subject/'app.json'; original=config.read_bytes()
try:
 data=json.loads(original);data['expo']['scheme']='np-control-changed-scheme';config.write_text(json.dumps(data,indent=2)+'\n')
 code=run('control-scheme',base);assert code==1;assert not (root/'evidence/round3/control-scheme/proof.json').exists();print('scheme',code)
finally: config.write_bytes(original)
tamper=root/'evidence/round3/control-base-input';tamper.mkdir();subprocess.run(['/bin/cp','-cR',str(base.parent/'base.app'),str(tamper/'base.app')],check=True)
(tamper/'build.json').write_bytes(base.read_bytes()); target=tamper/'base.app/main.jsbundle'
with target.open('r+b') as f:f.write(b'not-HBC!')
code=run('control-tampered-base',tamper/'build.json');assert code==1;assert not (root/'evidence/round3/control-tampered-base/proof.json').exists();print('tampered',code)
