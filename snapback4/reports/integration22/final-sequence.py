import os,time,subprocess,json,pathlib
out=pathlib.Path('/tmp/integ22');proc=pathlib.Path('/proc/230643/stat')
while proc.exists():
 try:
  if proc.read_text().split()[21]!='139412050':break
 except OSError:break
 time.sleep(5)
env=os.environ.copy();env.update(CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_PROFILE_DEV_OPT_LEVEL='1',CARGO_BUILD_JOBS='12')
record={'source':subprocess.check_output(['timeout','15s','git','rev-parse','HEAD'],text=True).strip(),'start':time.time()}
with (out/'cargo-full-final.log').open('w') as f:
 r=subprocess.run(['timeout','14400s','cargo','test','-p','snapback4-core','-p','snapback4-lang','-p','snapback4-device','-p','snapback4-sim','-p','snapback4','--no-fail-fast'],env=env,stdout=f,stderr=subprocess.STDOUT)
record.update(exit=r.returncode,finished=time.time());(out/'cargo-full-final.json').write_text(json.dumps(record,indent=2));print('final cargo',record,flush=True)
if r.returncode==0:
 with (out/'client-pool-final.log').open('w') as f:
  r=subprocess.run(['timeout','28800s','node',str(out/'final-client-pool.mjs')],env=env,stdout=f,stderr=subprocess.STDOUT)
 print('final client exit',r.returncode,flush=True)
raise SystemExit(r.returncode)
