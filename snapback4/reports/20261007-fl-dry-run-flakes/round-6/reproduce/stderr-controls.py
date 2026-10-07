"""Force the old pre-saturation snapshot, and prove the drop assertion remains.
Only mutates the integration test; restores/rebuilds it in finally.
"""
import json, os, pathlib, subprocess
root = pathlib.Path.cwd()
out = root/'reports/20261007-fl-dry-run-flakes/round-6/evidence'
source = root/'crates/snapback4/tests/dev_refusals.rs'
original = source.read_text()
env = {**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT', 'CARGO_BUILD_JOBS': '6'}
def build(label):
    result = subprocess.run(['cargo','test','-p','snapback4','--test','dev_refusals','--no-run','--message-format=json'], env=env, capture_output=True, text=True)
    (out/(label+'-build.log')).write_text(result.stderr)
    assert result.returncode == 0, result.stderr
    return next(row['executable'] for line in result.stdout.splitlines() if line.startswith('{') for row in [json.loads(line)] if row.get('reason')=='compiler-artifact' and row.get('target',{}).get('name')=='dev_refusals' and row.get('executable'))
needle = '''  let record:Value=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
  if record["records"].as_array().unwrap().last().unwrap()["operation"]=="add" {break record;}'''
injection = '''  let mut record:Value=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
  fl_inspections += 1;
  if fl_inspections == 1 {
   record["records"].as_array_mut().unwrap().last_mut().unwrap()["operation"]=json!("add39");
   record["dropped"]=json!(0);
   eprintln!("STALE_BEFORE_DRAIN operation=add39 dropped=0");
  }
  if std::env::var("FL_STDERR_CONTROL").as_deref()==Ok("zero-drops") { record["dropped"]=json!(0); }
  if record["records"].as_array().unwrap().last().unwrap()["operation"]=="add" {eprintln!("FRESH_RECOVERY inspections={fl_inspections}");break record;}'''
results = []
try:
    assert original.count(needle)==1
    modified = original.replace(' let recovered=loop {', ' let mut fl_inspections=0;\n let recovered=loop {').replace(needle, injection)
    source.write_text(modified)
    binary = build('stderr-control')
    for mode in ['old-first', 'zero-drops', 'old-recovery-guard']:
        if mode == 'old-recovery-guard':
            source.write_text(modified.replace('=="add" {eprintln!("FRESH_RECOVERY', '=="add39" {eprintln!("FRESH_RECOVERY'))
            binary = build('stderr-old-guard')
        result = subprocess.run([binary,'--exact','blocked_stderr_cannot_block_responses_or_later_mutations','--nocapture'], env={**env,'FL_STDERR_CONTROL':mode}, capture_output=True, text=True, timeout=60)
        output = result.stdout+result.stderr
        (out/f'stderr-{mode}.log').write_text(output)
        assert 'STALE_BEFORE_DRAIN' in output
        if mode == 'old-first':
            assert result.returncode==0 and 'FRESH_RECOVERY inspections=1\n' not in output, output
        else:
            assert result.returncode!=0 and 'saturation must report lost evidence' in output, output
        results.append({'mode':mode,'exit':result.returncode,'expectedResult':True})
finally:
    source.write_text(original)
    build('stderr-restored')
(out/'stderr-controls-summary.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
