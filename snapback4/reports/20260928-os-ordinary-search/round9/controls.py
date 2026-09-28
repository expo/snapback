from pathlib import Path
import os,json,shutil,subprocess
root=Path.cwd();package=root/'packages/snapback4';out=root/'reports/20260928-os-ordinary-search/round9';base=root/'target/os-round9/controls'
cases=[
 ('offline-cut-prefix','dist/local-query.js','data: outcome.data, complete:',"data: env.link !== 'online' && outcome.cut === 'words' && Array.isArray(outcome.data) && outcome.data.length > 1 ? outcome.data.slice(0,-1) : outcome.data, complete:",'ordinary-search-oracle.test.mjs','generated oracle','12,24,36,48,60,72,84,96,108,120,132,144,156,168,180,192,204,216,228,240,252,264,276,288','offline word-cut exact discovered prefix'),
 ('seen','dist/local-search.js','&& !seen.has(row.id)','&& true','ordinary-search-ledger.test.mjs','seen set',None,'Expected values'),
 ('cut-refusal','dist/local-search.js','if (local.cut && !local.next) {','if (local.cut && !local.next) { throw new SearchBound("mutant cut");','ordinary-search-oracle.test.mjs','generated oracle','12','unjustified cut refusal'),
 ('comparison-steps','dist/local-search.js','ledger.charge("steps", 2);','ledger.charge("steps", 0);','ordinary-search-ledger.test.mjs','mixed comparisons',None,'E_BOUND'),
 ('tie-steps','dist/local-search.js','ledger.charge("steps", a.id.length + b.id.length + 1);','ledger.charge("steps", 0);','ordinary-search-ledger.test.mjs','equal-time Unicode IDs',None,'E_BOUND'),
 ('subset-steps','dist/local-search.js','ledger.charge("steps", retained.length + current.length * 2);','ledger.charge("steps", 0);','ordinary-search-ledger.test.mjs','mixed comparisons',None,'E_BOUND'),
]
results=[]
for name,file,before,after,test,pattern,seeds,assertion in cases:
 if os.environ.get('OS_CONTROL') and os.environ['OS_CONTROL'] != name:continue
 target=base/name
 if target.exists():shutil.rmtree(target)
 target.mkdir(parents=True)
 for folder in ['dist','test']:shutil.copytree(package/folder,target/folder)
 (target/'src').mkdir();shutil.copytree(package/'src/wasm',target/'src/wasm')
 shutil.copy2(package/'package.json',target/'package.json');(target/'node_modules').symlink_to(package/'node_modules',target_is_directory=True)
 path=target/file;s=path.read_text();assert s.count(before)==1,(name,s.count(before));path.write_text(s.replace(before,after))
 env=os.environ.copy();env['SNAPBACK4_BIN']=str(root/'target/debug/snapback4')
 if seeds:env['SB4_SEARCH_SEEDS']=seeds
 cmd=['timeout','60s','node','--test','--test-reporter=tap','--test-name-pattern='+pattern,str(target/'test'/test)]
 with (out/('control-'+name+'.log')).open('w') as log:r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 log=(out/('control-'+name+'.log')).read_text();killed=r.returncode==1 and assertion in log and "code: 'ERR_ASSERTION'" in log
 results.append(dict(name=name,command=cmd,exit=r.returncode,killed=killed,assertion=assertion));print(name,killed,flush=True)
(out/('controls-'+os.environ['OS_CONTROL']+'.json' if os.environ.get('OS_CONTROL') else 'controls.json')).write_text(json.dumps(results,indent=2)+'\n');assert all(r['killed'] for r in results)
