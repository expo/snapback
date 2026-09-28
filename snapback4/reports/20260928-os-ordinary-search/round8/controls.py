"""Run from snapback4/: isolated negative controls; never edit live src/dist."""
from pathlib import Path
import os,json,shutil,subprocess
root=Path.cwd(); package=root/'packages/snapback4'; out=root/'reports/20260928-os-ordinary-search/round8'; base=root/'target/os-r8-controls'
cases=[
 ('search-decode-guard','local.ts','    } catch (error) {\n      if (error instanceof SearchBound) throw error;','    } catch (error) {\n      throw error;\n      if (error instanceof SearchBound) throw error;','116','optional search decoding does not reject dispatch transport'),
 ('search-identity-guard','local.ts','    } catch (error) {\n      if (error instanceof SearchBound) throw error;','    } catch (error) {\n      throw error;\n      if (error instanceof SearchBound) throw error;','12','optional query bookkeeping does not reject dispatch transport'),
 ('new-delivery-await','local.ts','  async function flushOnce(acquire = true) {','  async function flushOnce(acquire = true) {\n    await Promise.resolve();','','new or changed await needs delivery reachability classification'),
 ('new-helper-await','local.ts','  async function flushOnce(acquire = true) {','  async function unclassifiedHelper() { await Promise.resolve(); }\n  async function flushOnce(acquire = true) {','','new or changed await needs delivery reachability classification'),
 ('new-search-await','local-search.ts','  const stateReply = await env.call','  await Promise.resolve();\n  const stateReply = await env.call','','new or changed await needs delivery reachability classification'),
]
results=[]
for name,file,before,after,sites,assertion in cases:
 target=base/name
 if target.exists():shutil.rmtree(target)
 target.mkdir(parents=True)
 for folder in ['src','dist']:shutil.copytree(package/folder,target/folder)
 (target/'test').mkdir()
 for filename in ['delivery-fault-matrix.test.mjs','delivery-fault-fixture.mjs','delivery-fault-instrument.mjs','delivery-fault-recipes.mjs','delivery-fault-sites.json','delivery-await-boundary.json','chat-schema.json']:shutil.copy2(package/'test'/filename,target/'test'/filename)
 shutil.copy2(package/'package.json',target/'package.json');(target/'node_modules').symlink_to(package/'node_modules',target_is_directory=True)
 path=target/'src'/file;source=path.read_text();assert source.count(before)==1,(name,source.count(before));path.write_text(source.replace(before,after))
 env=os.environ.copy();env['RG_MATRIX_SITE']=sites
 if sites:env['RG_MATRIX_CONTROL']='1'
 with (out/(name+'.log')).open('w') as log:run=subprocess.run(['timeout','30s','node','--test','--test-reporter=tap',str(target/'test/delivery-fault-matrix.test.mjs')],env=env,stdout=log,stderr=subprocess.STDOUT)
 log=(out/(name+'.log')).read_text();killed=run.returncode==1 and assertion in log and "code: 'ERR_ASSERTION'" in log
 results.append({'name':name,'exit':run.returncode,'assertion':assertion,'killed':killed});print(name,run.returncode,killed,flush=True)
(out/'controls.json').write_text(json.dumps(results,indent=2)+'\n');assert all(r['killed'] for r in results)
