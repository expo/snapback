import os, pathlib, subprocess, json
root=pathlib.Path.cwd(); p=root/'crates/snapback4/tests/dev_refusals.rs'; original=p.read_text(); out=root/'reports/20261007-fl-dry-run-flakes/evidence'
needle='   let hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));'
injection='''   let mut hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));
   if let Ok(field)=std::env::var("FL_NEGATIVE_FIELD") {
    if field=="inventory" { eprintln!("FL_FIELDS {}",serde_json::to_string(&hidden).unwrap()); }
    else if field=="moving-seq" || (field=="retry-once" && attempt==0) { hidden["seq"]=json!(missing["seq"].as_u64().unwrap()+1); }
    else if field!="retry-once" {
     if field=="/extraField" {hidden["extraField"]=json!("injected");}
     else {*hidden.pointer_mut(&field).expect("negative field exists")=json!({"injected_difference":true});}
    }
   }'''
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
cmd=['cargo','test','-p','snapback4','--test','dev_refusals','--no-run']
results=[]
try:
    assert original.count(needle)==1;p.write_text(original.replace(needle,injection))
    built=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(out/'empty-negative-build.log').write_text(built.stdout);assert built.returncode==0
    binary=next(x for x in (root/'target/debug/deps').glob('dev_refusals-*') if x.is_file() and os.access(x,os.X_OK))
    def run(field):
        r=subprocess.run([str(binary),'--exact','empty_read_evidence_is_top_level_proved_and_opt_in_only','--nocapture'],env={**env,'FL_NEGATIVE_FIELD':field},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=60)
        with (out/'empty-negative.log').open('a') as log:log.write('CONTROL '+field+'\n'+r.stdout+'\n')
        return r
    inventory=run('inventory');assert inventory.returncode==0
    wire=json.loads(next(s[len('FL_FIELDS '):] for s in inventory.stdout.splitlines() if s.startswith('FL_FIELDS ')))
    fields=['/'+k for k in wire if k!='seq']+['/meter/'+k for k in wire['meter']]+['/extraField']
    for field in fields:
        r=run(field);assert r.returncode!=0 and 'hidden and absent wire answers at the same watermark' in r.stdout,(field,r.stdout)
        results.append({'field':field,'exit':r.returncode,'rejected':True})
    moving=run('moving-seq');assert moving.returncode!=0 and 'no common watermark in eight read pairs' in moving.stdout
    retry=run('retry-once');assert retry.returncode==0,retry.stdout
    (out/'empty-negative-summary.json').write_text(json.dumps({'fieldControls':results,'movingSeqRejected':True,'oneMovingSeqThenEqualPassed':True},indent=2)+'\n')
finally:
    p.write_text(original)
    restored=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);(out/'empty-restored-build.log').write_text(restored.stdout)
    assert restored.returncode==0
print(f'{len(results)} non-seq field corruptions rejected; endless seq drift rejected; one changed seq retried successfully; original restored')
