#!/usr/bin/env python3
"""Build traced replay/upload binaries in a chosen checkout; restore all sources.
Usage: replay-build.py /checkout/snapback4 /output/directory
Run sequentially with source edits/builds in that checkout. LU_FIFO=1 is the
current-runtime ablation: only periodic delivery uses the FIFO drain selector.
"""
from pathlib import Path
import sys,os,subprocess,json,shutil
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
originals={}
clock='std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64()*1000.0'
def patch(rel,old,new,count=1):
 p=root/rel;s=p.read_text();originals.setdefault(p,s);assert s.count(old)==count,(rel,s.count(old),old);p.write_text(s.replace(old,new))
try:
 if os.environ.get('LU_FIFO')=='1':
  patch('crates/snapback4/src/serve_maintenance.rs','engine.run_timeline_turn_for(shared.now(), budget)','engine.run_timeline_chunk_for(shared.now(), budget)')
 patch('crates/snapback4/tests/replay.rs','const BIN: &str = env!("CARGO_BIN_EXE_snapback4");','fn bin() -> String { std::env::var("LU_SERVER").unwrap_or_else(|_| env!("CARGO_BIN_EXE_snapback4").into()) }')
 p=root/'crates/snapback4/tests/replay.rs';p.write_text(p.read_text().replace('Command::new(BIN)','Command::new(bin())'))
 patch('crates/snapback4-core/src/engine/mod.rs','        tx.commit()?;\n        Ok(outcome)','''        tx.commit()?;
        if name == "post" || name == "repost" { eprintln!("LU {}", serde_json::json!({"stage":"commit","name":name,"at":CLOCK})); }
        Ok(outcome)'''.replace('CLOCK',clock))
 patch('crates/snapback4-core/src/engine/timeline/work.rs','                Ok(()) => {','''                Ok(()) => {
                    let lu_row = tx.get(&timeline.table("Work"), &text(&work,"id")?)?;
                    let lu_trace = serde_json::json!({"stage":"delivery","kind":text(&work,"kind")?,"event":text(&work,"eventId").ok(),"reader":text(&work,"readerId").ok(),"id":text(&work,"id")?,"seq":seq,"rows":metered.rows_written,"done":lu_row.as_ref().is_none_or(|r|text(r,"status").ok().as_deref()==Some("done")),"cursor":lu_row.as_ref().and_then(|r|r.field("cursor").ok())});''')
 p=root/'crates/snapback4-core/src/engine/timeline/work.rs';s=p.read_text();pos=s.index('                    tx.commit()?;',s.index('let lu_trace'));s=s[:pos]+s[pos:].replace('                    tx.commit()?;','''                    tx.commit()?;
                    let mut lu_trace=lu_trace;lu_trace["at"]=serde_json::json!(CLOCK);eprintln!("LU {}",lu_trace);'''.replace('CLOCK',clock),1);p.write_text(s)
 pacing='crates/snapback4/src/serve_maintenance.rs'
 assignment='        self.resume_at = now + pause;'
 if assignment not in (root/pacing).read_text():
  assignment='        self.resume_at = self.resume_at.max(now) + pause;'
 # Round 3 shares the assignment with empty_cycle; trace only completed().
 patch(pacing,assignment+'\n    }',assignment+'''
        eprintln!("LU {}", serde_json::json!({"stage":"pause","at":CLOCK,"cpu_ms":elapsed.as_secs_f64()*1000.0,"pause_ms":pause.as_secs_f64()*1000.0,"contended":contended}));
    }'''.replace('CLOCK',clock))
 env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'12'}
 with (out/'build.jsonl').open('w') as f:
  subprocess.run(['cargo','test','-p','snapback4','--test','replay','--bin','snapback4','--no-run','--message-format=json'],cwd=root,env=env,stdout=f,check=True)
 for line in (out/'build.jsonl').read_text().splitlines():
  o=json.loads(line)
  if o.get('reason')=='compiler-artifact' and o.get('executable') and o['profile']['test']:
   shutil.copy2(o['executable'],out/('replay-test' if o['target']['name']=='replay' else 'unit-test'))
 shutil.copy2(root/'target/debug/snapback4',out/'server')
 (out/'revision').write_text(subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True))
 print('BUILT',out,flush=True)
finally:
 for p,s in originals.items():p.write_text(s)
