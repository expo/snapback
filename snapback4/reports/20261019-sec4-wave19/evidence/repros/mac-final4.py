import os,pathlib,tarfile,subprocess,sys
root=pathlib.Path.home()/"sb4-ws-sec4"
os.chdir(root)
with tarfile.open("mac-source-final4.tgz") as t:
 t.extractall(root)
 for m in t.getmembers():
  if m.isfile():os.utime(root/m.name,None)
os.chdir(root/"snapback4")
base=["env","CARGO_INCREMENTAL=0","CARGO_PROFILE_DEV_DEBUG=0","CARGO_PROFILE_TEST_DEBUG=0","CARGO_BUILD_JOBS=8","RUST_TEST_THREADS=8",str(pathlib.Path.home()/".cargo/bin/cargo")]
for cmd in [["test","-p","snapback4-lang","--test","security_wave19","--test","security_sec4"],["test","-p","snapback4","--test","security_wave19"],["test","-p","snapback4","auth_envelopes_follow_the_declared_door_without_accepting_app_refusals_or_payloads","--bin","snapback4"],["build","-p","snapback4","--profile","production"]]:
 r=subprocess.run(base+cmd,timeout=1800);print("MAC FINAL4",cmd,r.returncode,flush=True)
 if r.returncode:sys.exit(r.returncode)
