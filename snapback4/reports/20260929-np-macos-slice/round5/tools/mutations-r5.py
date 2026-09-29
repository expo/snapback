from pathlib import Path
import shutil,subprocess,json,os
r=Path('/Users/ccheever/sb4-np');repo=r/'lane/snapback4';e=r/'evidence/round5';root=e/'mutations-complete';root.mkdir()
helper='crates/snapback4/src/verbs/witness';test='packages/snapback4/test';node='/Users/ccheever/np-tools/node/bin/node'
cases=[('baseline', None, None, None, 'preparation rejects'), ('skip-setting', 'native-closure.mjs', "['SKIP_BUNDLING', 'SOURCEMAP_FILE', 'BUNDLE_NAME'", "['SOURCEMAP_FILE', 'BUNDLE_NAME'", 'preparation rejects'), ('bundle-removal', 'prepare.mjs', '    fs.rmSync(bundle, { force: true });', '', 'preparation rejects'), ('skip-pin', 'prepare.mjs', "...args, 'SKIP_BUNDLING=', 'SOURCEMAP_FILE=',", "...args, 'SOURCEMAP_FILE=',", 'preparation rejects'), ('swift-key', 'native-closure.mjs', '(?:SWIFT|MODULE_VERIFIER)_FLAGS', '(?:SWIFT|MODULE_VERIFIER)FLAGS', 'preparation rejects'), ('forwarded-arguments', 'native-closure.mjs', 'streams[t].push(next);', 'streams.direct.push(t, next);', 'Pods graph audit'), ('compiler-output-boundary', 'native-closure.mjs', '!inside(canonical(dest), canonical(cache))', 'false', 'preparation rejects'), ('sourcemap', 'native-closure.mjs', "['SKIP_BUNDLING', 'SOURCEMAP_FILE', 'BUNDLE_NAME'", "['SKIP_BUNDLING', 'BUNDLE_NAME'", 'preparation rejects'), ('subprocess-status', 'prepare.mjs', "  if (r.error || r.status !== 0) fail('E_WITNESS_BUILD', `${label} failed (${r.error?.message ?? r.status}); see ${log}; use --build in a fresh artifacts directory`);", '', 'preparation rejects')]
cases += [('per-arch-output','native-closure.mjs',"['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH'].includes(key)","['COMPILATION_CACHE_CAS_PATH'].includes(key)",'preparation rejects'), ('cas-output','native-closure.mjs',"['PER_ARCH_OBJECT_FILE_DIR', 'COMPILATION_CACHE_CAS_PATH'].includes(key)","['PER_ARCH_OBJECT_FILE_DIR'].includes(key)",'preparation rejects')]
rows=[]
for name,file,old,new,pattern in cases:
 d=root/name
 (d/helper).mkdir(parents=True);(d/test).mkdir(parents=True)
 for f in (repo/helper).glob('*.mjs'):shutil.copy2(f,d/helper/f.name)
 for f in ['witness-preparation.test.mjs','witness-preparation-fixture.mjs']:shutil.copy2(repo/test/f,d/test/f)
 if file:
  p=d/helper/file;s=p.read_text();assert s.count(old)==1,(name,s.count(old));p.write_text(s.replace(old,new))
 with (e/f'mutation-complete-{name}.log').open('x') as log:
  c=subprocess.run([node,'--test','--test-name-pattern',pattern,str(d/test/'witness-preparation.test.mjs')],stdout=log,stderr=subprocess.STDOUT,env=dict(os.environ,TMPDIR=str(r/'tmp'))).returncode
 rows.append({'name':name,'exitStatus':c,'expected':0 if name=='baseline' else 1,'file':file,'removed':old});assert c==(0 if name=='baseline' else 1),(name,c)
(e/'mutations-complete.json').write_text(json.dumps(rows,indent=2));print('Passing baseline and ten detecting mutations',flush=True)
