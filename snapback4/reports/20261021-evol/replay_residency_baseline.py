import io,os,pathlib,signal,subprocess,tarfile,tempfile
root=pathlib.Path.cwd()
signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(SystemExit(124)))
base=subprocess.check_output(['git','rev-parse','5bee0be37d^'],text=True,timeout=15).strip();print('BASELINE',base,flush=True)
archive=subprocess.check_output(['git','archive',base,'snapback4/Cargo.toml','snapback4/Cargo.lock','snapback4/crates','snapback4/vendor','snapback4/packages/snapback4/CHANGELOG.md','snapback4/apps/chat/snapback'],timeout=30)
with tempfile.TemporaryDirectory(prefix='evol-residency-baseline-',dir=root) as tmp:
 with tarfile.open(fileobj=io.BytesIO(archive)) as tf:tf.extractall(tmp,filter='data')
 env=os.environ.copy();env.update(CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='8',CARGO_TARGET_DIR=str(root/'snapback4/target'))
 p=subprocess.Popen(['cargo','test','-p','snapback4-device','--test','residency','legacy_counters_stay_temporary_until_adoption_and_follow_other_owners','--','--exact'],cwd=pathlib.Path(tmp)/'snapback4',env=env,start_new_session=True)
 try:status=p.wait(timeout=1100)
 except BaseException:
  try:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=10)
  except ProcessLookupError:pass
  raise
 print('BASELINE_EXIT',status,flush=True)
 raise SystemExit(status)
