"""Astra round-0 corruption cases against the FL round-1 fix.
Adapted from fl-r0.astra.evidence/retry-masking.py: local output, expected
rejection in both modes, and an explicit equal seq for the no-drift control.
Restores the test source and rebuilds it before returning.
"""
import os, pathlib, subprocess, json
root=pathlib.Path.cwd()
ev=root/'reports/20261007-fl-dry-run-flakes/round-1/evidence'
p=root/'crates/snapback4/tests/dev_refusals.rs'
original=p.read_text()
needle='   let hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));'
injection='''   let mut hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));
   if attempt==0 {
    if let Ok(field)=std::env::var("FL_MASK_FIELD") {
     if field=="/extraField" || field=="/existence" {hidden[field.trim_start_matches('/')]=json!("injected disclosure");}
     else {*hidden.pointer_mut(&field).expect("negative field exists")=json!({"injected_difference":true});}
     hidden["seq"]=if std::env::var("FL_MASK_DRIFT").as_deref()==Ok("1") {json!(missing["seq"].as_u64().unwrap()+1)} else {missing["seq"].clone()};
     eprintln!("MASK_CONTROL field={} attempt={} absent_seq={} hidden_seq={} corrupted={}",field,attempt,missing["seq"],hidden["seq"],hidden.pointer(&field).unwrap());
    }
   }'''
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
cmd=['cargo','test','-p','snapback4','--test','dev_refusals','--no-run','--message-format=json']
results=[]
try:
    assert original.count(needle)==1
    p.write_text(original.replace(needle,injection))
    built=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    (ev/'retry-masking-build.log').write_text(built.stderr)
    assert built.returncode==0,built.stderr
    artifacts=[json.loads(s) for s in built.stdout.splitlines() if s.startswith('{')]
    binary=next(x['executable'] for x in artifacts if x.get('reason')=='compiler-artifact' and x.get('target',{}).get('name')=='dev_refusals' and x.get('executable'))
    fields=json.loads((ev/'review-fields.json').read_text())
    with (ev/'retry-masking.log').open('w') as log:
        for field in fields:
            for drift in [False,True]:
                r=subprocess.run([binary,'--exact','empty_read_evidence_is_top_level_proved_and_opt_in_only','--nocapture'],env={**env,'FL_MASK_FIELD':field,'FL_MASK_DRIFT':str(int(drift))},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=60)
                row={'field':field,'seqDrift':drift,'exit':r.returncode,'defectRejected':r.returncode!=0}
                results.append(row);print(json.dumps(row),flush=True)
                log.write(json.dumps(row)+'\n'+r.stdout+'\n');log.flush()
                assert 'MASK_CONTROL' in r.stdout
                assert r.returncode!=0,(row,r.stdout)
                assert 'hidden and absent wire answers differ beyond seq' in r.stdout
                assert r.stdout.count('MASK_CONTROL')==1, 'must fail on the corrupted first pair, before any retry'
    (ev/'retry-masking-summary.json').write_text(json.dumps(results,indent=2)+'\n')
finally:
    p.write_text(original)
    restored=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    (ev/'retry-masking-restored-build.log').write_text(restored.stderr)
    assert restored.returncode==0,restored.stderr
print('PASS: all 42 transient field controls rejected on the first pair, including all 21 mixed with seq drift.')
