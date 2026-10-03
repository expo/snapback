//! Byte-for-byte default-schema and deterministic transition control.
use sha2::{Digest,Sha256};
use snapback4_core::{Engine,Context,Value,WriteState};
use std::time::Duration;
fn digest(bytes:impl AsRef<[u8]>)->String {format!("{:x}",Sha256::digest(bytes.as_ref()))}
#[test]
fn ordinary_following_bytes() {
 let mut records=Vec::new();
 for (label,source) in [("timeline",include_str!("fixtures/timeline-v2.q")),("view",include_str!("fixtures/following-view.q"))] {
  for bounded in [false,true] {
   let source=if bounded {source.replacen("sync public","sync public last 100 by .at",1)}else{source.into()};
   let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
   records.push(serde_json::json!({"label":label,"bounded":bounded,"schema":digest(serde_json::to_vec(&b.schema).unwrap()),"programs":digest(serde_json::to_vec(&b.programs.iter().map(|p|&p.program).collect::<Vec<_>>()).unwrap()),"typescript":digest(snapback4_lang::emit::typescript(&b))}));
   if label!="timeline" {continue;}
   let tables=b.schema.tables.keys().cloned().collect::<Vec<_>>();let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
   let mut outcomes=Vec::new();
   for n in 0..1100 {let o=e.mutate("post",None,Context::new("a",[("postId".into(),Value::Id(format!("p{n:04}"))),("parentId".into(),Value::Null)].into()).at(n).with_entropy(17)).unwrap();assert!(matches!(o.state,WriteState::Sent{..}));outcomes.push(serde_json::to_value(o).unwrap());}
   for (step,op) in ["follow","unfollow","follow"].into_iter().enumerate(){
    let o=e.mutate(op,None,Context::new("reader",[("actor".into(),Value::Id("a".into()))].into()).at(2000).with_ids([format!("f{step}")])).unwrap();assert!(matches!(o.state,WriteState::Sent{..}));outcomes.push(serde_json::to_value(o).unwrap());
    while let Some(m)=e.run_timeline_chunk_for(3000,Duration::ZERO).unwrap(){outcomes.push(serde_json::to_value(m).unwrap());}
    outcomes.push(serde_json::to_value(e.query("home",Context::new("reader",Default::default()).at(4000)).unwrap()).unwrap());
   }
   let rows=tables.iter().map(|t|(t,e.store().rows(t).unwrap())).collect::<Vec<_>>();
   records.push(serde_json::json!({"label":"trace","bounded":bounded,"rows":digest(serde_json::to_vec(&rows).unwrap()),"outcomes":digest(serde_json::to_vec(&outcomes).unwrap())}));
  }
 }
 let result=serde_json::to_string_pretty(&records).unwrap();
 // Captured by running this test against committed base 22f2207f3fadb355f2964ba0e463e002e16c3f07.
 assert_eq!(result,include_str!("fixtures/following-history-v2-control.json"));
 if let Ok(out)=std::env::var("FOLLOW_HISTORY_COMPAT_OUT"){std::fs::write(out,&result).unwrap();}
 if let Ok(base)=std::env::var("FOLLOW_HISTORY_COMPAT_BASE"){assert_eq!(result,std::fs::read_to_string(base).unwrap());}
 println!("COMPAT {result}");
}
