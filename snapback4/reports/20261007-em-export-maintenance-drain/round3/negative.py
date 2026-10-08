#!/usr/bin/env python3
"""Build a lane-local scratch mutation, preserving barriers, then require both 90 s failures."""
import argparse, difflib, hashlib, json, os, pathlib, shutil, subprocess, time
p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--cpus',default='80-83');a=p.parse_args()
workspace=pathlib.Path.cwd();out=pathlib.Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
scratch=workspace/f'target/em/round3-without-wakeup-fixes-{os.getpid()}'
assert not scratch.exists(),f'refusing to overwrite {scratch}'
scratch.mkdir(parents=True)
for name in ['Cargo.toml','Cargo.lock']:shutil.copy2(workspace/name,scratch/name)
shutil.copytree(workspace/'crates',scratch/'crates',symlinks=True)
for name in ['apps','packages','vendor']:(scratch/name).symlink_to(workspace/name,target_is_directory=True)
if (workspace/'.cargo').exists():shutil.copytree(workspace/'.cargo',scratch/'.cargo')
source=scratch/'crates/snapback4/src/verbs/witness/retention.rs';fixed=source.read_text()
old='''            drop(queued);
            if let Some(fresh_expires) = unobserved_deadline(root) { expires = expires.max(fresh_expires); }
            continue;'''
assert fixed.count(old)==1
mutated=fixed.replace(old,'            return Ok(Value::Null); // NEGATIVE: exit under the empty queue lease')
old='''        if let Err(e) = resume_unobserved(&root) { eprintln!("witness: evidence cleanup deferred: {e}"); }'''
assert mutated.count(old)==1
mutated=mutated.replace(old,'        // NEGATIVE: omit the fresh-wakeup handoff after the failed guard')
source.write_text(mutated)
(out/'mutation.diff').write_text(''.join(difflib.unified_diff(fixed.splitlines(True),mutated.splitlines(True),fromfile='fixed/retention.rs',tofile='negative/retention.rs')))
with (out/'build.log').open('w') as log:
 subprocess.run(['taskset','-c',a.cpus,'cargo','build','-j','2','-p','snapback4','--manifest-path',str(scratch/'Cargo.toml')],env={**os.environ,'CARGO_TARGET_DIR':str(workspace/'target')},stdout=log,stderr=subprocess.STDOUT,check=True)
binary=workspace/'target/debug/snapback4';digest=hashlib.sha256(binary.read_bytes()).hexdigest()
pinned=workspace/'target/em/binaries'/digest/'snapback4';pinned.parent.mkdir(parents=True,exist_ok=True)
if not pinned.exists():shutil.copy2(binary,pinned)
command=['taskset','-c',a.cpus,'node','--test','--test-reporter=tap','--test-name-pattern=empty second check|expiry guard cannot strand','packages/snapback4/test/export-maintenance-wakeup.test.mjs']
(out/'control.json').write_text(json.dumps(dict(command=command,binarySha256=digest,fixedSourceSha256=hashlib.sha256(fixed.encode()).hexdigest(),mutatedSourceSha256=hashlib.sha256(mutated.encode()).hexdigest(),testSha256=hashlib.sha256(pathlib.Path(command[-1]).read_bytes()).hexdigest()),indent=2))
started=time.monotonic()
with (out/'controls.log').open('w') as log:
 r=subprocess.run(command,env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(pinned),'SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/'snapshots')},stdout=log,stderr=subprocess.STDOUT)
text=(out/'controls.log').read_text();snapshots=list((out/'snapshots').rglob('*-drain-timeout'))
assert r.returncode==1 and text.count("error: 'coalesced maintenance queue drained'")==2 and len(snapshots)==2,text
(out/'result.json').write_text(json.dumps(dict(expectedExit=1,actualExit=r.returncode,elapsed=time.monotonic()-started,snapshots=[str(s) for s in snapshots]),indent=2))
print('Both forced windows stranded a request without the fixes and failed at the unchanged 90-second guard.',flush=True)
