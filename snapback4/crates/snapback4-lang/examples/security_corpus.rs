//! Read-only external corpus qualification. No schema or credential writes.
use snapback4_lang::{compile,security};
fn main(){
 let args=std::env::args().collect::<Vec<_>>();let manifest:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
 let mut records=Vec::new();
 for lane in manifest.as_array().unwrap(){
  let sources=lane["sources"].as_array().unwrap().iter().map(|f|{let p=f["path"].as_str().unwrap();(std::path::Path::new(p).file_name().unwrap().to_string_lossy().to_string(),std::fs::read_to_string(p).unwrap())}).collect::<Vec<_>>();
  let b=compile(&sources);let mut report=security::analyze(&b);security::add_source_notes(&mut report,&sources,&b);
  let mut campaign=security::challenges::run(&b);
  if b.diagnostics.is_empty(){match snapback4_core::Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())){Ok(engine)=>security::challenges::operations(&b,&engine,&mut campaign),Err(e)=>{campaign.unsupported.insert(e.to_string());}}}
  records.push(serde_json::json!({"wave":lane["wave"],"lane":lane["lane"],"diagnostics":b.diagnostics,"invariants":report.invariants,"securityNotes":report.notes,"generated":campaign,"coverage":"original schema; absent policy is explicitly not spec-level verification"}));
 }
 std::fs::write(&args[2],serde_json::to_string_pretty(&records).unwrap()+"\n").unwrap();println!("{} schemas analyzed",records.len());
}
