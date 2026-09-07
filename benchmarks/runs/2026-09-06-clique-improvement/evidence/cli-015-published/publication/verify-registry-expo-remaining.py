#!/usr/bin/env python3
"""Equivalent to old010 verify-installed.py Expo checks, from exact dry-qualified tarballs.
This proves installed CLI/template init/check/guide, not native device execution.
Derivative:015/source/path/count bindings and direct final-source guide/Expo manifest equality.
"""
from pathlib import Path
import os,json,hashlib,subprocess,time,tarfile,base64,signal,re
r=Path(__file__).resolve().parent
root=Path('/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.15-78924a1e7')
assert json.loads((r/'registry-observation-04.json').read_text())['allMatching']
assert any(e.get('phase')=='publisher' and e.get('status')=='complete' and e.get('exitCode')==0 for e in map(json.loads,(r/'activation-events.jsonl').read_text().splitlines()))
consumer=r/'registry-installed-consumer'; assert consumer.is_dir()
prior=json.loads((r/'installed-expo-verification.json').read_text())
assert prior['checks'][0]['exit_code']==0 and prior['checks'][1]['files']==3 and prior['checks'][2]['files']==153 and prior['checks'][3]['ok'] is True
# Fresh explicit token-free environment for this public registry verification.
env={'HOME':'/Users/ccheever','USER':'ccheever','LOGNAME':'ccheever','PATH':'/Users/ccheever/.volta/tools/image/node/22.23.2/bin:/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C','LC_ALL':'C','NPM_CONFIG_USERCONFIG':str(r/'registry-verification-state/user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(r/'registry-verification-state/global.npmrc'),'NPM_CONFIG_CACHE':str(r/'registry-install-cache'),'NPM_CONFIG_LOGS_DIR':str(r/'registry-verification-state/logs'),'NPM_CONFIG_LOGS_MAX':'0','NPM_CONFIG_TIMING':'false','NPM_CONFIG_REGISTRY':'https://registry.npmjs.org/','NPM_CONFIG_STRICT_SSL':'true','NPM_CONFIG_FETCH_TIMEOUT':'15000','NPM_CONFIG_FETCH_RETRIES':'0','TMPDIR':str(r/'registry-verification-state/tmp'),'CARGO_BUILD_JOBS':'2','CMAKE_BUILD_PARALLEL_LEVEL':'2','NEXTEST_TEST_THREADS':'2'}
old_receipt=Path('/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.10-967f857e6/installed-verification.json')
expected_operations=json.loads(old_receipt.read_text())['guideRepair']['checks'][0]['operationNames']
assert len(expected_operations)==26
checks=[]; report={'version':'0.0.15','source':'78924a1e7286907d2378221902ec22747e7d188f','ok':False,'scope':'fresh exact-version registry install compared with original qualified tarballs; untouched chat Expo init/check/guide; no native device execution','consumer_directory':str(consumer),'checks':checks,'started_epoch':time.time()}
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def snapshot(directory):
 return {str(path.relative_to(directory)):digest(path) for path in directory.rglob('*') if path.is_file()}
def execute(label,args):
 start=time.monotonic(); logfile=r/'receipts'/(label+'.log');assert not logfile.exists()
 record={'name':label,'argv':args,'cwd':str(consumer),'timeout_seconds':30,'started_epoch':time.time()}
 with logfile.open('xb') as log:
  child=subprocess.Popen(args,cwd=consumer,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  record['pid']=child.pid;record['process_identity']=subprocess.check_output(['ps','-p',str(child.pid),'-o','pid=,lstart=,comm='],text=True).strip();(r/'receipts'/(label+'.running.json')).write_text(json.dumps(record,indent=2)+'\n')
  try:code=child.wait(timeout=30)
  except subprocess.TimeoutExpired:
   current=subprocess.run(['ps','-p',str(child.pid),'-o','pid=,lstart=,comm='],capture_output=True,text=True).stdout.strip()
   assert current==record['process_identity'], 'timed-out child identity changed'
   os.killpg(child.pid,signal.SIGKILL);child.wait();code=124
 record.update(exit_code=code,elapsed_seconds=time.monotonic()-start,log_sha256=digest(logfile))
 (r/'receipts'/(label+'.json')).write_text(json.dumps(record,indent=2)+'\n');(r/'receipts'/(label+'.running.json')).unlink()
 checks.append(record);assert code==0,label+' failed'
 return logfile.read_text()
try:
 packages=['snapback2-darwin-arm64','snapback2']; tarballs=[]; packed={}
 for name in packages:
  path=root/(name+'-0.0.15.tgz'); data=path.read_bytes()
  tarballs.append({'package':name,'path':str(path),'sha256':digest(path),'bytes':len(data),'integrity':'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()})
  with tarfile.open(path) as tar:
   packed[name]={m.name.removeprefix('package/'):tar.extractfile(m).read() for m in tar if m.isfile()}
 report['tarballs']=tarballs
 before=json.loads((r/'installed-files-before.json').read_text())
 cli=str(consumer/'node_modules/snapback2/bin/snapback2.mjs')
 source_receipt=json.loads((r/'version-receipt.json').read_text())
 def committed(path):
  return subprocess.check_output(['git','show',source_receipt['commit']+':snapback2/packages/snapback2/'+path],cwd='/Users/ccheever/projects/snapback-worktrees/clique-cli-journey-repair-r2')
 report['prior_install_file_and_source_proof']={'path':str(r/'installed-expo-verification.json'),'sha256':digest(r/'installed-expo-verification.json'),'install_repeated':False,'initial_156_file_audit_repeated':False,'passed_checks':prior['checks']}
 readme=packed['snapback2']['README.md'];grammar=packed['snapback2']['dist/guide/grammar.md']
 assert readme==committed('README.md') and grammar==committed('guide/grammar.md')
 assert b'Start an Expo app with `npx snapback2 init my-app --template chat --client expo`.' in readme
 assert b'Use `npx snapback2 guide init`' in readme and b'`npx snapback2 guide auth`' in readme and b'`npx snapback2 guide app`' in readme
 assert b'Start an Expo app with `snapback2 init my-app --template chat --client expo`.' in grammar
 assert b'`snapback2 guide init` covers scaffolding and CLI setup' in grammar and b'`snapback2 guide auth`' in grammar and b'`snapback2 guide app`' in grammar
 paragraph=re.search(r'^## Assets\n\n([\s\S]*?)\n\n',readme.decode(),re.M).group(1)
 expected_assets='# `assets`\n\n'+paragraph+'\n\nSee the packaged [README.md](../../README.md), section "Assets", for the full documentation.\n'
 keywords=json.loads(packed['snapback2']['dist/guide/keywords.json'])
 old_tar=Path('/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.13-ae7d86a11/snapback2-0.0.13.tgz')
 with tarfile.open(old_tar) as tar:old_keywords_bytes=tar.extractfile('package/dist/guide/keywords.json').read()
 old_keywords=json.loads(old_keywords_bytes);assert len(old_keywords)==23
 assert set(keywords)==set(old_keywords)|{'assets'}
 changed_constructs=sorted(k for k in old_keywords if keywords[k]!=old_keywords[k])
 assert changed_constructs==['cap']
 cap_line=next(line[2:] for line in grammar.decode().splitlines() if line.startswith('- `cap`: '))
 expected_constructs=dict(old_keywords)
 expected_constructs['cap']=re.sub(r'^`cap`:[^\n]*',lambda _:cap_line,old_keywords['cap'],count=1,flags=re.M)
 assert all(keywords[k]==value for k,value in expected_constructs.items())

 assert keywords['assets']==expected_assets
 page=json.loads(execute('installed-guide-assets',['node',cli,'guide','assets','--json']))
 assert page['page']=='assets' and page['content']==expected_assets
 guide_record={'README_sha256':hashlib.sha256(readme).hexdigest(),'grammar_sha256':hashlib.sha256(grammar).hexdigest(),'exact_committed_packed_startup_prose':True,'source_commit':source_receipt['commit'],'npx_README_route':True,'source_grammar_route':True,'assets_exact_first_README_paragraph_and_packaged_pointer':True,'assets_content':page['content'],'prior_construct_count':23,'all_prior_construct_values_unchanged':False,'unchanged_prior_construct_count':22,'changed_constructs':changed_constructs,'all_23_constructs_match_current_source_contract':True,'cap_current_source_line':cap_line,'construct_values':{k:{'before_sha256':hashlib.sha256(value.encode()).hexdigest(),'after_sha256':hashlib.sha256(keywords[k].encode()).hexdigest()} for k,value in old_keywords.items()},'new_index_count':len(keywords),'old_original_tarball':str(old_tar),'old_tarball_sha256':digest(old_tar),'old_keywords_sha256':hashlib.sha256(old_keywords_bytes).hexdigest()}
 (r/'installed-guide-fixes.json').write_text(json.dumps(guide_record,indent=2)+'\n');report['guide_fixes']=guide_record
 assert '0.0.15' in execute('expo-installed-version',['node',cli,'version'])
 assert '"effects":"ibex2 + vanilla hermes"' in execute('expo-installed-doctor',['node',cli,'doctor','--json'])
 media=consumer/'node_modules/snapback2-darwin-arm64/bin/snapback2-media'
 capabilities=json.loads(execute('expo-installed-media',[str(media),'capabilities']));assert capabilities['images'] and capabilities['heic'];report['media']=capabilities
 verbs_source=subprocess.check_output(['git','show',source_receipt['commit']+':snapback2/crates/snapback2/src/verbs.rs'],cwd='/Users/ccheever/projects/snapback-worktrees/clique-cli-journey-repair-r2').decode()
 init_literal=re.search(r'"init" => \{\s*"((?:\\.|[^"\\])*)"\s*\}',verbs_source,re.S).group(1)
 expected_init=json.loads('"'+init_literal.replace('\n','\\n')+'"')
 for topic,expected_page in [('init',expected_init),('testing',packed['snapback2']['dist/guide/testing.md'].decode())]:
  served=json.loads(execute('installed-guide-'+topic,['node',cli,'guide',topic,'--json']))
  assert served['page']==topic and served['content']==expected_page
 report['served_guide_source_equality']={'init_command_help':True,'testing_packaged_markdown':True,'verbs_source_sha256':hashlib.sha256(verbs_source.encode()).hexdigest()}
 project=consumer/'chat-expo'
 execute('expo-installed-init',['node',cli,'init',str(project),'--template','chat','--client','expo','--json'])
 backend_before=snapshot(project/'snapback'); template_before=snapshot(project)
 (r/'expo-project-after-init.json').write_text(json.dumps(template_before,indent=2)+'\n')
 (r/'expo-backend-before.json').write_text(json.dumps(backend_before,indent=2)+'\n')
 guide_checks=[];initial_cache=snapshot(project/'.snapback/build')
 for phase in ['before-check','after-check']:
  if phase=='after-check':execute('expo-installed-check',['node',cli,'check','--project',str(project),'--json'])
  build=project/'.snapback/build';raw=json.loads((build/'project.json').read_text());certificates=json.loads((build/'certificates.json').read_text())
  schedule=next(x for x in raw['schema']['schedules'] if x['name']=='expireMessage');binding=schedule['binding'];assert binding=='deliveries._timerBinding_expireMessage'
  assert any(x['name']==binding for x in raw['programs']) and binding not in certificates
  cache_before=snapshot(build);(r/('expo-cache-'+phase+'-before.json')).write_text(json.dumps(cache_before,indent=2)+'\n')
  page=json.loads(execute('expo-installed-guide-'+phase,['node',cli,'guide','app','--project',str(project),'--json']))
  assert page['page']=='app';app=json.loads(page['content']);operations=app['operations']
  assert binding not in operations and 'deliveries.purgeMessage' in operations
  assert sorted(operations)==sorted(certificates)==sorted(expected_operations) and len(operations)==26
  cache_after=snapshot(build);assert cache_before==cache_after and backend_before==snapshot(project/'snapback')
  (r/('expo-cache-'+phase+'-after.json')).write_text(json.dumps(cache_after,indent=2)+'\n')
  guide_checks.append({'phase':phase,'internalBinding':binding,'rawBindingPresent':True,'bindingAbsentFromPublicOperations':True,'publicPurgeRetained':True,'operationCount':len(operations),'exactCertifiedOperationSet':True,'cacheUnchanged':True,'backendUnchanged':True,'operations':sorted(operations)})
 assert initial_cache==snapshot(project/'.snapback/build')
 assert template_before==snapshot(project)
 after={name:snapshot(consumer/'node_modules'/name) for name in packages};assert before==after
 (r/'installed-files-after.json').write_text(json.dumps(after,indent=2)+'\n')
 (r/'expo-backend-after.json').write_text(json.dumps(snapshot(project/'snapback'),indent=2)+'\n')
 (r/'expo-project-after-check-guide.json').write_text(json.dumps(snapshot(project),indent=2)+'\n')
 assert all(digest(Path(x['path']))==x['sha256'] for x in tarballs)
 report.update(expected_operations_receipt=str(old_receipt),expected_operations_receipt_sha256=digest(old_receipt),ok=True,guide_checks=guide_checks,installed_packages_unchanged=True,tarballs_unchanged=True,backend_unchanged=True,complete_initialized_project_unchanged=True,cache_unchanged_across_explicit_check=True)
finally:
 report['finished_epoch']=time.time();(r/'installed-expo-remaining.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
