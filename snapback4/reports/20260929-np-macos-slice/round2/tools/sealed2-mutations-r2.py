from pathlib import Path
import subprocess,os,shutil,json
r=Path('/Users/ccheever/sb4-np');source=r/'lane/snapback4';dest=r/'evidence/round2/sealed2-mutations';results=[]
env=dict(os.environ,PATH=str(Path.home()/'np-tools/node/bin')+':'+os.environ['PATH'],TMPDIR=str(r/'tmp'))
for name,pattern in [('hbc-both-guards','preparation rejects wrong HBC'),('native-reference-audit','native Xcode'),('kept-facts','all residency'),('runtime-dev-url','prepared launch'),('pods-key','preparation rejects wrong HBC'),('conditional-native','conditional native'),('pods-link-roots','preparation rejects wrong HBC'),('generated-pod-key','preparation rejects wrong HBC')]:
 d=dest/name
 for folder in ['crates/snapback4/src/verbs/witness','packages/snapback4-expo/src']:
  shutil.copytree(source/folder,d/folder)
 t=d/'packages/snapback4/test';t.mkdir(parents=True)
 for f in ['witness-preparation.test.mjs','witness-preparation-fixture.mjs','native-smoke.test.mjs','witness.test.mjs']:shutil.copy2(source/'packages/snapback4/test'/f,t/f)
 if name=='hbc-both-guards':
  p=d/'crates/snapback4/src/verbs/witness/prepare.mjs';text=p.read_text();text='\n'.join(line for line in text.split('\n') if not ('if (executedApp.javascript.version !==' in line));p.write_text(text);test='witness-preparation.test.mjs'
 elif name=='native-reference-audit':
  p=d/'crates/snapback4/src/verbs/witness/native-inputs.mjs';text=p.read_text().replace('  root = fs.realpathSync(root);', '  return {};\n  root = fs.realpathSync(root);');p.write_text(text);test='witness-preparation.test.mjs'
 elif name=='kept-facts':
  p=d/'packages/snapback4-expo/src/smoke.ts';text=p.read_text().replace('assert(kept && kept.runs === fact.runs && (kept.held ?? false) === fact.held,','assert(true,');p.write_text(text);test='native-smoke.test.mjs'
 elif name=='pods-key':
  p=d/'crates/snapback4/src/verbs/witness/prepare.mjs';text=p.read_text().replace("'ios', 'pods', 'podsGenerated', 'references']", "'ios', 'podsGenerated', 'references']");p.write_text(text);test='witness-preparation.test.mjs'
 elif name=='generated-pod-key':
  p=d/'crates/snapback4/src/verbs/witness/prepare.mjs';text=p.read_text().replace("'pods', 'podsGenerated', 'references']", "'pods', 'references']");p.write_text(text);test='witness-preparation.test.mjs'
 elif name=='pods-link-roots':
  p=d/'crates/snapback4/src/verbs/witness/prepare.mjs';text=p.read_text().replace("for (const row of pods?.files ?? [])", "for (const row of [])");p.write_text(text);test='witness-preparation.test.mjs'
 elif name=='conditional-native':
  p=d/'packages/snapback4-expo/src/smoke.ts';text=p.read_text().replace('assert(eligible.every(program => program.native !== true),','assert(true,');p.write_text(text);test='native-smoke.test.mjs'
 else:
  p=d/'packages/snapback4-expo/src/witness-core.ts';text=p.read_text().replace('if (!runtime || runtime.launcherManifestPresent !== false || runtime.updatesPresent !== false || runtime.updatesManifestPresent !== false || runtime.dev !== false || runtime.hermes !== true || !runtime.scriptURL?.startsWith("file://")) {','if (!runtime) {');p.write_text(text);test='witness.test.mjs'
 result=subprocess.run(['node','--test','--test-name-pattern',pattern,str(t/test)],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 (r/f'evidence/round2/sealed2-mutation-{name}.log').write_text(result.stdout);results.append({'mutation':name,'exitStatus':result.returncode,'killed':result.returncode!=0});assert result.returncode!=0,name
(r/'evidence/round2/sealed2-mutation-results.json').write_text(json.dumps(results,indent=2));print(results)
