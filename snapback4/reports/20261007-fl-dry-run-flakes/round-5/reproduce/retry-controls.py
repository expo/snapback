"""Check bounded seq-only retries and prove the permanent regression detects P1.
Temporarily mutates only the integration-test source and always restores it.
"""
import os, pathlib, subprocess, json
root=pathlib.Path.cwd();ev=root/'reports/20261007-fl-dry-run-flakes/round-5/evidence'
p=root/'crates/snapback4/tests/dev_refusals.rs';original=p.read_text()
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
cmd=['cargo','test','-p','snapback4','--test','dev_refusals','--no-run','--message-format=json']
def build(label):
 r=subprocess.run(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 (ev/(label+'-build.log')).write_text(r.stderr);assert r.returncode==0,r.stderr
 artifacts=[json.loads(s) for s in r.stdout.splitlines() if s.startswith('{')]
 return next(x['executable'] for x in artifacts if x.get('reason')=='compiler-artifact' and x.get('target',{}).get('name')=='dev_refusals' and x.get('executable'))
def run(binary,name,mode=''):
 r=subprocess.run([binary,'--exact',name,'--nocapture'],env={**env,'FL_SEQ_CONTROL':mode},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=60)
 (ev/((mode or 'regression-downgrade')+'.log')).write_text(r.stdout)
 return r
summary={}
try:
 needle='   let hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));'
 injected='''   let mut hidden=dev.post("/q/point",json!({"args":{"id":"hidden"}}));
   let mode=std::env::var("FL_SEQ_CONTROL").unwrap_or_default();
   if mode=="always-advance" || (mode=="advance-once" && attempt==0) {
    hidden["seq"]=json!(missing["seq"].as_u64().unwrap()+1);
    eprintln!("SEQ_CONTROL mode={mode} trace={trace_empty} attempt={attempt}");
   }'''
 assert original.count(needle)==1;p.write_text(original.replace(needle,injected))
 binary=build('seq-control')
 one=run(binary,'empty_read_evidence_is_top_level_proved_and_opt_in_only','advance-once')
 assert one.returncode==0 and one.stdout.count('SEQ_CONTROL')==2,one.stdout
 always=run(binary,'empty_read_evidence_is_top_level_proved_and_opt_in_only','always-advance')
 assert always.returncode!=0 and 'no common watermark in eight read pairs' in always.stdout and always.stdout.count('SEQ_CONTROL')==8,always.stdout
 summary.update(oneAdvancePassedBothTraceModes=True,endlessAdvanceFailedAtEightPairs=True)
 guard=' assert_eq!(serde_json::to_vec(&hidden_fields).unwrap(),serde_json::to_vec(&missing_fields).unwrap(),"hidden and absent wire answers differ beyond seq");\n'
 assert original.count(guard)==1;p.write_text(original.replace(guard,''))
 binary=build('regression-downgrade')
 broken=run(binary,'point_answer_corruption_is_rejected_even_with_a_moving_sequence')
 assert broken.returncode!=0 and 'corruption was accepted with seq drift=true' in broken.stdout,broken.stdout
 summary['permanentRegressionRejectsOldGuard']=True
finally:
 p.write_text(original);build('final-restored')
(ev/'retry-controls-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
