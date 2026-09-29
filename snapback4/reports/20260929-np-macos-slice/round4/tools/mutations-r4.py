from pathlib import Path
import shutil,subprocess,json,os
r=Path('/Users/ccheever/sb4-np');repo=r/'lane/snapback4';e=r/'evidence/round4';root=e/'mutations';root.mkdir()
helper='crates/snapback4/src/verbs/witness';test='packages/snapback4/test';node='/Users/ccheever/np-tools/node/bin/node'
cases=[('baseline',None,None,None,'preparation rejects'),
 ('linker-resolved', 'native-closure.mjs', 'const outputKey = key => linkerOutputKey(key) || ', 'const outputKey = key => ', 'preparation rejects'),
 ('linker-raw', 'native-inputs.mjs', 'if (linkerOutputKey(key) || ', 'if (', 'native Xcode'),
 ('hbc-version','prepare.mjs', "  if (executedApp.javascript.version !== hbcVersion) fail('E_WITNESS_HERMES', 'bundle and installed compiler HBC versions differ');", '', 'preparation rejects'),
 ('withdrawal','prepare.mjs', "if (mode !== 'build') fail('E_WITNESS_INPUT', 'repack is withdrawn; use witness ios --build <project> --smoke with fresh artifacts');", '', 'preparation rejects')]
rows=[]
for name,file,old,new,pattern in cases:
 d=root/name
 (d/helper).mkdir(parents=True);(d/test).mkdir(parents=True)
 for f in (repo/helper).glob('*.mjs'):shutil.copy2(f,d/helper/f.name)
 for f in ['witness-preparation.test.mjs','witness-preparation-fixture.mjs']:shutil.copy2(repo/test/f,d/test/f)
 if file:
  p=d/helper/file;s=p.read_text();assert s.count(old)==1,(name,s.count(old));p.write_text(s.replace(old,new))
 with (e/f'mutation-{name}.log').open('x') as log:
  c=subprocess.run([node,'--test','--test-name-pattern',pattern,str(d/test/'witness-preparation.test.mjs')],stdout=log,stderr=subprocess.STDOUT,env=dict(os.environ,TMPDIR=str(r/'tmp'))).returncode
 rows.append({'name':name,'exitStatus':c,'expected':0 if name=='baseline' else 1,'file':file,'removed':old});assert c==(0 if name=='baseline' else 1),(name,c)
(e/'mutations.json').write_text(json.dumps(rows,indent=2));print('Passing baseline and four detecting mutations',flush=True)
