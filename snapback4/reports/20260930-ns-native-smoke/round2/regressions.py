import pathlib,subprocess,shutil,json,hashlib,os
root=pathlib.Path.cwd(); report=root/'snapback4/reports/20260930-ns-native-smoke/round2'
binary=root/'snapback4/target/debug/snapback4'; old=root.parent/'ns-r1-binary'; backup=root.parent/'ns-r2-binary'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(old)==json.loads((report.parent/'round1/regression-provenance.json').read_text())['round1Binary']['sha256']
shutil.copy2(binary,backup)
test_binary=root/'snapback4/target/debug/deps/witness-36ce455ec1c0dbb8'
provenance={'round1Commit':'2f2154e7ba','round1Binary':str(old),'round1Sha256':sha(old),'round2Sha256':sha(binary),'testBinary':str(test_binary),'testSha256':sha(test_binary)}
(report/'regression-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
tests=['interrupted_startup_does_not_leak_listener_to_checker','timed_out_startup_does_not_leak_listener_to_checker','symlinked_simulator_record_is_ignored','world_writable_simulator_record_is_ignored','group_writable_simulator_record_is_ignored','symlinked_simulator_directory_is_ignored','writable_simulator_directory_is_ignored']
results=[]
try:
 shutil.copy2(old,binary)
 for test in tests:
  with (report/('round1-'+test+'.log')).open('w') as log:
   r=subprocess.run([str(test_binary),'driver::'+test,'--exact','--nocapture'],stdout=log,stderr=subprocess.STDOUT)
  results.append({'test':test,'round1Exit':r.returncode})
finally: shutil.copy2(backup,binary)
paths=[root/f'snapback4/packages/{p}/README.md' for p in ['snapback4','snapback4-expo']]; saved={p:p.read_bytes() for p in paths}
try:
 for p in paths:p.write_bytes(subprocess.check_output(['git','show','2f2154e7ba:'+str(p.relative_to(root))],cwd=root))
 with (report/'round1-doc-regressions.log').open('w') as log:
  r=subprocess.run(['node','--test','--test-name-pattern=README uses the qualified starter',str(root/'snapback4/packages/snapback4/test/periphery.test.mjs')],stdout=log,stderr=subprocess.STDOUT)
 results.append({'test':'both package README cohort labels','round1Exit':r.returncode})
finally:
 for p,b in saved.items():p.write_bytes(b)
(report/'round1-regressions.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2));assert all(r['round1Exit']!=0 for r in results)
assert sha(binary)==provenance['round2Sha256']
