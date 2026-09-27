from pathlib import Path
import subprocess,os,json
root=Path.cwd(); repo=root.parent; out=root/'target/lane-dc-round12'
env={**os.environ,'CARGO_INCREMENTAL':'0','CARGO_BUILD_JOBS':'8','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_PROFILE_TEST_DEBUG':'0'}
command=['cargo','test','-p','snapback4-lang','--test','guide','delivery_bound_guidance_requires_start_only_recovery']
results=[]
for name in ['codes.rs','refusals.rs','sequences.md','bounds.rs','obsolete-appended']:
 path=root/'crates/snapback4-lang/src/guide'/('codes.rs' if name=='obsolete-appended' else name)
 original=path.read_bytes()
 if name=='obsolete-appended':
  old=b'A committed report that runs again is a no-op report (guide receipts).'
  assert original.count(old)==1
  mutant=original.replace(old,old+b' Replay the same id first.')
 else:
  mutant=subprocess.check_output(['git','show',f'HEAD:{path.relative_to(repo)}'],cwd=repo)
 assert original!=mutant
 try:
  path.write_bytes(mutant)
  result=subprocess.run(command,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
  log=result.stdout.decode();(out/f'guide-mutant-{name}.log').write_text(log)
  assert result.returncode==101 and 'panicked at' in log and ('obsolete replay the same id first' if name=='obsolete-appended' else 'missing E_BOUND is an ordinary non-retryable refusal') in log,log
  results.append({'mutation':name,'exit':result.returncode,'assertion':next(line for line in log.splitlines() if ': missing ' in line or ': obsolete ' in line)})
  print(results[-1],flush=True)
 finally:
  path.write_bytes(original)
  assert path.read_bytes()==original
(out/'guide-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
