from pathlib import Path
import subprocess,os,shutil,json
r=Path('/Users/ccheever/sb4-np');src=r/'lane/snapback4';e=r/'evidence/round3';env=dict(os.environ,PATH=str(Path.home()/'np-tools/node/bin')+':'+os.environ['PATH'],TMPDIR=str(r/'tmp'))
cases=[
 ('resolved-stage','prepare.mjs','    sameInputs(base.inputs, resolvedInputs);','', 'preparation rejects'),
 ('dependency-boundary','native-closure.mjs','    refuse(`native input outside covered roots: ${raw} -> ${p}`);',"    return {path:p,kind:'input'};",'compiler records|linker records'),
 ('compiler-coverage','native-closure.mjs','  for (const source of sources) if (!seen.has(canonical(source))) refuse(`missing compiler dependency coverage for ${source}`);','', 'compiler records'),
 ('linker-coverage','native-closure.mjs','  for (const product of products) if (!linked.has(canonical(product))) refuse(`missing linker dependency coverage for ${product}`);','','linker records'),
 ('resolved-outputs','native-closure.mjs','export function validateOutputs(rows, cache) {','export function validateOutputs(rows, cache) { return;','all target outputs'),
 ('pods-searches','native-closure.mjs',"for (const p of paths) { if (p !== '/usr/lib/swift') check(p, s); }",'', 'Pods graph audit'),
 ('pods-scripts','native-closure.mjs',"if (!['/bin/sh', '/bin/bash'].includes(phase.shellPath) || !phaseHashes.has(digest)) refuse(`unsupported native script ${row.target}: ${phase.name ?? id}`);",'', 'Pods graph audit'),
 ('pods-links','prepare.mjs','for (const row of podTargets)','for (const row of [])','preparation rejects'),
 ('quoted-include','native-inputs.mjs','for (const match of fs.readFileSync(file, \'utf8\').matchAll(/^\\s*#\\s*(?:include|import)\\s+"([^\"]+)"/gm)) input(match[1], path.dirname(file));','','native Xcode'),
]
res=[]
for name,file,old,new,pattern in [('baseline',None,None,None,'.*')]+cases:
 d=e/'stage-mutations'/name
 shutil.copytree(src/'crates/snapback4/src/verbs/witness',d/'crates/snapback4/src/verbs/witness')
 t=d/'packages/snapback4/test';t.mkdir(parents=True)
 for f in ['witness-preparation.test.mjs','witness-preparation-fixture.mjs']:shutil.copy2(src/'packages/snapback4/test'/f,t/f)
 if file:
  p=d/'crates/snapback4/src/verbs/witness'/file;s=p.read_text();assert old in s,(name,'mutation not applied');s=s.replace(old,new)
  if name=='resolved-stage':s=s.replace("  if (base) sameInputs(base.inputs, preparedInputs, 'E_WITNESS_PROOF');",'')
  p.write_text(s)
 cmd=['node','--test','--test-name-pattern',pattern,str(t/'witness-preparation.test.mjs')]
 result=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(e/f'stage-mutation-{name}.log').write_text(result.stdout)
 row={'name':name,'argv':cmd,'exitStatus':result.returncode,'expected':'pass' if file is None else 'fail','matched':result.returncode==0 if file is None else result.returncode!=0};res.append(row);print(row['name'],row['exitStatus'],flush=True)
(e/'stage-mutations.json').write_text(json.dumps(res,indent=2));assert all(x['matched'] for x in res)
