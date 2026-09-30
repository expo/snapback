import pathlib,subprocess,shutil,os,json
root=pathlib.Path('/Users/ccheever/sb4-np/lane-ns');report=root/'snapback4/reports/20260930-ns-native-smoke/round1'
binary=root/'snapback4/target/debug/snapback4'; backup=pathlib.Path('/Users/ccheever/sb4-np/ns-r1-binary')
tests=['prefix_without_creation_record_is_ignored','owned_devices_use_numeric_runtime_order','created_device_type_is_current_not_last_listed','boot_failure_keeps_created_identity_in_receipt','preparation_keeps_origin_port_owned_until_backend_startup','missing_schema_uses_one_message_and_witness_exit_one','project_lease_precedes_check_generation','dev_accepts_the_still_owned_listener_without_a_rebind_gap']
results=[]
try:
 shutil.copy2('/Users/ccheever/sb4-np/ns-r0-built-binary',binary)
 with (report/'round0-built-regressions.log').open('w') as log:
  for test in tests:
   r=subprocess.run([str(root/'snapback4/target/debug/deps/witness-90194dd3bf3d9a0f'),test,'--nocapture'],stdout=log,stderr=subprocess.STDOUT)
   results.append({'test':test,'round0Exit':r.returncode})
finally: shutil.copy2(backup,binary)
paths=[root/f'snapback4/packages/{p}/README.md' for p in ['snapback4','snapback4-expo']]; saved={p:p.read_bytes() for p in paths}
try:
 for p in paths:p.write_bytes(subprocess.check_output(['git','show','3f59b23d2c:'+str(p.relative_to(root))],cwd=root))
 with (report/'round0-built-doc-regressions.log').open('w') as log:
  r=subprocess.run(['node','--test','--test-name-pattern=README uses the qualified starter',str(root/'snapback4/packages/snapback4/test/periphery.test.mjs')],stdout=log,stderr=subprocess.STDOUT)
 results.append({'test':'both package README measurements','round0Exit':r.returncode})
finally:
 for p,b in saved.items():p.write_bytes(b)
(report/'round0-built-regressions.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2));assert all(r['round0Exit']!=0 for r in results)
