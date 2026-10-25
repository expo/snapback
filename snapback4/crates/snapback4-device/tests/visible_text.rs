//! Shared validation refuses invisible-only evidence on both device stores.
mod common;use common::*;use serde_json::json;use snapback4_core::{Value,WriteState};
fn parity<H:Host>(host:&mut H){
 let source="table docs:\n  reason: text 1..30\n  public\n  insert <- allow\n  sync public\nmutation save(reason: text 1..30):\n  return insert docs {reason}\n";
 let(mut engine,backend)=compile(source);let mut device=host.open("visible",Some(backend)).unwrap();for(i,page)in snapshot_pages(&mut engine,"alice",100).iter().enumerate(){device.apply(page,i==0).unwrap();}
 for(n,value)in ["\u{200b}","\u{feff}","\u{2060}","\u{ad}","\u{fe0f}","❤️","同意"].iter().enumerate(){let id=format!("visible{n}");let predicted=device.predict("save","alice",&json!({"reason":value}),100,vec![id.clone()],0);let sent=engine.mutate("save",None,context("alice",&[("reason",Value::String((*value).into()))]).with_ids([id])).unwrap();if n<5{let WriteState::Failed{why,..}=sent.state else{panic!("{sent:?}")};assert_eq!(why.code,"E_INPUT");assert_eq!(predicted.unwrap_err().refusal(),why);}else{assert!(matches!(sent.state,WriteState::Sent{..}),"{sent:?}");device.withdraw(&predicted.unwrap().predicted).unwrap();}}
 host.close("visible",device);
}
#[test]fn memory(){parity(&mut Memory::new());}
#[test]fn sqlite(){parity(&mut Sqlite::new("visible-text"));}
