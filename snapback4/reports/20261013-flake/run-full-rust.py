from pathlib import Path
import subprocess,time,json,os
root=Path('/home/ccheever/projects/sb4-w10-flake/snapback4')
prior=3054648
def birth(pid):
 try:return Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
stamp=birth(prior)
while stamp is not None and birth(prior)==stamp: time.sleep(5)
results=[]
for number in [2,3]:
 path=root/'reports/20261013-flake'/f'rust-run{number}.log'
 command=['env','CARGO_INCREMENTAL=0','CARGO_PROFILE_DEV_DEBUG=0','CARGO_PROFILE_TEST_DEBUG=0','RUST_MIN_STACK=33554432','cargo','test','--workspace']
 began=time.time()
 with path.open('w') as out:
  child=subprocess.Popen(command,cwd=root,stdout=out,stderr=subprocess.STDOUT)
  (root/'reports/20261013-flake/rust-active.json').write_text(json.dumps({'run':number,'pid':child.pid,'started':began,'default_threads':True,'command':command})+'\n')
  code=child.wait()
 results.append({'run':number,'exit':code,'started':began,'finished':time.time(),'command':command})
 (root/'reports/20261013-flake/rust-results.json').write_text(json.dumps(results,indent=2)+'\n')
(root/'reports/20261013-flake/rust-active.json').unlink()
