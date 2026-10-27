import pathlib,os,subprocess,json,shutil,hashlib,time,concurrent.futures
repo=pathlib.Path('/home/ccheever/projects/sb4-b31-sec11');out=pathlib.Path('/home/ccheever/sb4-loop/reports/sec11/history-retry');out.mkdir(exist_ok=True)
changed=subprocess.check_output(['git','diff','--name-only','58f30f47f0','HEAD'],cwd=repo,text=True).splitlines()
assert changed==['snapback4/crates/snapback4-lang/tests/security_histories.rs'],changed
command=['cargo','test','-p','snapback4-lang','--test','security_histories','--no-run','--message-format=json']
env={**os.environ,'CARGO_INCREMENTAL':'0','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_PROFILE_TEST_DEBUG':'0'}
r=subprocess.run(command,cwd=repo/'snapback4',env=env,capture_output=True,text=True)
(out/'build.jsonl').write_text(r.stdout);(out/'build.stderr').write_text(r.stderr);assert r.returncode==0,'test executable build failed'
artifacts=[json.loads(line)for line in r.stdout.splitlines()if line.startswith('{')]
artifact=next(a for a in reversed(artifacts)if a.get('reason')=='compiler-artifact'and a.get('target',{}).get('name')=='security_histories'and a.get('executable'))
binary=out/'security-histories-immutable';shutil.copy2(artifact['executable'],binary)
names=['an_empty_trusted_store_can_reach_authored_disclosure','real_media_creation_is_replayed_before_role_revocation','time_arguments_expose_a_deadline_checked_on_the_wrong_reference']
def run(name):
 start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','900s',str(binary),'--exact',name,'--test-threads=1'],cwd=repo/'snapback4',env=env,capture_output=True,text=True)
 log=out/(name+'.private.log');log.write_text(r.stdout+r.stderr);log.chmod(0o600)
 return dict(name=name,exit=r.returncode,oneTestPassed='test result: ok. 1 passed;'in r.stdout,seconds=time.monotonic()-start)
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:results=list(pool.map(run,names))
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
summary=dict(head=head,baseQualification='58f30f47f0',runtimeSourceChanged=False,testOnlyChanged=changed,binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),testSourceSha256=hashlib.sha256((repo/changed[0]).read_bytes()).hexdigest(),buildCommand=command,cargoEnvironment={k:env[k]for k in['CARGO_INCREMENTAL','CARGO_PROFILE_DEV_DEBUG','CARGO_PROFILE_TEST_DEBUG']},results=results,ok=all(r['exit']==0 and r['oneTestPassed']for r in results))
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2));raise SystemExit(not summary['ok'])
