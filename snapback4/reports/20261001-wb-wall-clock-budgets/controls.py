"""Mutate only disposable built JS; exercise the real WB test and guard."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,time
root=Path(__file__).resolve().parents[2]; report=Path(__file__).resolve().parent
scratch=root/'target/wb-fallback-control'; scratch.mkdir(exist_ok=True)
package=root/'packages/snapback4'; target=scratch/'packages/snapback4'
target.mkdir(parents=True,exist_ok=True)
for name in ['dist','test/helpers','src/wasm']:
 shutil.copytree(package/name,target/name,dirs_exist_ok=True)
shutil.copy2(package/'package.json',target/'package.json')
shutil.copy2(package/'test/live-propagation-fallback.test.mjs',target/'test/live-propagation-fallback.test.mjs')
if not (scratch/'node_modules').exists():(scratch/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
product=target/'dist/local.js';original=product.read_text()
needle='                const accepted = publishLocal(result, () => {'
assert original.count(needle)==1
records=[]
for name,delay in [('delayed-publication',15000),('missing-publication',None)]:
 patch='''                if (watch.op.name === 'presentTransition' && read.data?.body === 'image-2') {
                    console.error('WB_MUTATION: fallback reached publication');
                    await new Promise(resolve => {
                        WB_REAL_TIMER(resolve, 15000);
                        signal.addEventListener('abort', resolve, { once: true });
                    });
                }
'''
 if delay is None:patch=patch.replace('WB_REAL_TIMER(resolve, 15000);', '// held until test cleanup aborts the watch')
 mutated='const WB_REAL_TIMER = globalThis.setTimeout.bind(globalThis);\n'+original.replace(needle,patch+needle)
 product.write_text(mutated)
 command=['node','--test','--test-name-pattern=^wasm: pending cut preserves presentTransition before sync publication$',str(target/'test/live-propagation-fallback.test.mjs')]
 started=time.monotonic()
 with (report/(name+'.log')).open('w') as output:
  result=subprocess.run(command,cwd=root,env=dict(os.environ,SNAPBACK4_BIN=str(root/'target/debug/snapback4')),stdout=output,stderr=subprocess.STDOUT,timeout=180)
 text=(report/(name+'.log')).read_text()
 assert 'WB_MUTATION: fallback reached publication' in text, 'control missed its target'
 expected=result.returncode==0 if delay is not None else result.returncode==1 and 'TEST_HANG: new branch obtains a current whole-server answer while sync remains held' in text
 records.append(dict(name=name,exit=result.returncode,expected=expected,seconds=time.monotonic()-started,command=command,original=hashlib.sha256(original.encode()).hexdigest(),mutant=hashlib.sha256(mutated.encode()).hexdigest(),test_sha256=hashlib.sha256((target/'test/live-propagation-fallback.test.mjs').read_bytes()).hexdigest(),wait_sha256=hashlib.sha256((target/'test/helpers/wait.mjs').read_bytes()).hexdigest()))
 (report/(name+'.patch')).write_text(patch)
 (report/'controls.json').write_text(json.dumps(records,indent=2)+'\n')
 print(name,records[-1]['exit'],expected,flush=True)
 assert expected
product.write_text(original)
