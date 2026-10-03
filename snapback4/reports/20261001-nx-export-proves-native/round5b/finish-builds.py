from pathlib import Path
import subprocess,shutil,os,json,time,tarfile,hashlib
work=Path('/Users/ccheever/sb4-np/nx-r5b');root=Path('/Users/ccheever/sb4-np/lane-nx/snapback4')
# Launched only after the round-4 build succeeds.
shutil.copy2(root/'target/production/snapback4',work/'packages/r4/snapback4')
env=dict(os.environ,LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT')
with (work/'build-r5.log').open('w') as f:subprocess.run(['cargo','build','--profile','production','-p','snapback4'],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
shutil.copy2(root/'target/production/snapback4',work/'packages/r5/snapback4')
rows=[]
for rev in ['r4','r5']:
    stage=work/'packages'/rev/'platform';stage.mkdir()
    for name in ['package.json','THIRD-PARTY-NOTICES']:
        src=root/'packages/snapback4-darwin-arm64'/name
        if src.exists():shutil.copy2(src,stage/name)
    shutil.copy2(work/'packages'/rev/'snapback4',stage/'snapback4')
    tarpath=work/'packages'/rev/'snapback4-darwin-arm64-0.4.10.tgz'
    with tarfile.open(tarpath,'w:gz') as tar:tar.add(stage,arcname='package')
    consumer=work/'packages'/rev/'consumer';consumer.mkdir()
    (consumer/'package.json').write_text('{"name":"nx-timing-package-install-control","private":true}')
    env2=dict(os.environ,PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+os.environ['PATH'])
    command=['npm','install','--offline','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--package-lock=false',str(work/'packages'/rev/'snapback4-0.4.10.tgz'),str(work/'packages'/rev/'snapback4-expo-0.4.10.tgz'),str(tarpath)]
    with (work/f'install-{rev}.log').open('w') as f:subprocess.run(command,cwd=consumer,env=env2,stdout=f,stderr=subprocess.STDOUT,check=True)
    command2=[str(consumer/'node_modules/.bin/snapback4'),'--version'];env2.pop('SNAPBACK4_BIN',None)
    result=subprocess.check_output(command2,cwd=consumer,env=env2,text=True)
    rows.append({'revision':rev,'installCommand':command,'versionCommand':command2,'version':result.strip(),'binarySha256':hashlib.sha256((stage/'snapback4').read_bytes()).hexdigest(),'binaryBytes':(stage/'snapback4').stat().st_size,'platformTarSha256':hashlib.sha256(tarpath.read_bytes()).hexdigest(),'platformTarBytes':tarpath.stat().st_size,'sourceCommit':'e1adc01ddc' if rev=='r4' else 'adbabda71e'})
(root/'reports/20261001-nx-export-proves-native/round5b/builds.json').write_text(json.dumps(rows,indent=2)+'\n');print('Both exact revisions built and npm-installed successfully',flush=True)
