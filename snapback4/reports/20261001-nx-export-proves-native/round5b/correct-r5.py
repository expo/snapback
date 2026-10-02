from pathlib import Path
import subprocess,shutil,json,os,tarfile,hashlib
work=Path('/Users/ccheever/sb4-np/nx-r5b');root=Path('/Users/ccheever/sb4-np/lane-nx/snapback4');out=root/'reports/20261001-nx-export-proves-native/round5b'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(root/'target/production/snapback4')!=sha(work/'packages/r4/snapback4')
shutil.copy2(root/'target/production/snapback4',work/'packages/r5/snapback4');stage=work/'packages/r5/platform';shutil.copy2(root/'target/production/snapback4',stage/'snapback4')
tarpath=work/'packages/r5/snapback4-darwin-arm64-0.4.10.tgz'
with tarfile.open(tarpath,'w:gz') as tar:tar.add(stage,arcname='package')
consumer=work/'packages/r5/consumer';shutil.rmtree(consumer);consumer.mkdir();(consumer/'package.json').write_text('{"name":"nx-timing-package-install-control","private":true}')
rows=json.loads((out/'builds.json').read_text());r=rows[1];env=dict(os.environ,PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+os.environ['PATH']);env.pop('SNAPBACK4_BIN',None)
with (work/'install-r5-corrected.log').open('w') as f:subprocess.run(r['installCommand'],cwd=consumer,env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
r.update(version=subprocess.check_output(r['versionCommand'],cwd=consumer,env=env,text=True).strip(),binarySha256=sha(stage/'snapback4'),binaryBytes=(stage/'snapback4').stat().st_size,platformTarSha256=sha(tarpath),platformTarBytes=tarpath.stat().st_size)
assert sha(consumer/'node_modules/snapback4-darwin-arm64/snapback4')==r['binarySha256']
assert rows[0]['binarySha256']!=rows[1]['binarySha256']
(out/'builds.json').write_text(json.dumps(rows,indent=2)+'\n');print('round5 corrected',r['binarySha256'],flush=True)
