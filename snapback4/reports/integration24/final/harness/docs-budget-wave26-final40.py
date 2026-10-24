from pathlib import Path
import time,subprocess,os
b=Path.home()/'sb4-loop/integ24'
while not(b/'rust-wave26-final40.exit').exists():time.sleep(3)
while not(b/'client-wave26-final40-status.txt').exists()or not(b/'qualify-wave26-final40.exit').exists():time.sleep(3)
assert (b/'client-wave26-final40-status.txt').read_text()==''
assert (b/'qualify-wave26-final40.exit').read_text().strip()=='0'
assert (b/'rust-wave26-final40.exit').read_text().strip()=='0','full Rust red; final budget check waits for a successful complete repeat'
env=dict(os.environ,CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='8')
with(b/'docs-budget-wave26-final40.log').open('w')as log:r=subprocess.run(['timeout','900s','node','scripts/docs-budget.mjs'],cwd='/home/ccheever/projects/snapback-sb4loop/snapback4',env=env,stdout=log,stderr=subprocess.STDOUT,timeout=920)
(b/'docs-budget-wave26-final40.exit').write_text(str(r.returncode)+'\n');assert r.returncode==0,r.returncode
