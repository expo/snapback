mod common;
use common::*;
use snapback4_core::{Context, WriteState};
use snapback4_device::{device::Device,store::DeviceStore};
use serde_json::json;
const SOURCE:&str="table parents:\n  label: text <=20\n  unique label\n  public\n  insert <- allow\n  sync public\ntable kids:\n  parent: parents on delete keep\n  unique parent\n  public\n  insert <- allow\n  sync public\nfn label(p: parents): p.label\nmutation add(id: id, child: id, title: text <=20):\n  p = insert parents { id, label: title }\n  insert kids { id: child, parent: p }\n  return label(p)\nmutation clash(id: id, parent: parents):\n  insert parents { id: 'rolledback', label: 'temporary' }\n  insert kids { id, parent }\nquery parents(c: cursor ?):\n  return parents first 20 by .id after c\n";
fn run<H:Host>(host:&mut H){
 let (mut e,b)=compile(SOURCE);
 let mut d=host.open("qdiag",Some(b)).unwrap();
 for (i,page) in snapshot_pages(&mut e,"alice",10).iter().enumerate(){d.apply(page,i==0).unwrap();}
 let args=json!({"id":"p","child":"k","title":"label"});
 d.predict("add","alice",&args,100,vec![],1).unwrap();
 let actual=e.mutate("add",None,Context::new("alice",common::args(&[("id",id("p")),("child",id("k")),("title",snapback4_core::Value::String("label".into()))])).at(100)).unwrap();
 assert!(matches!(actual.state,WriteState::Sent { result:snapback4_core::Value::String(ref s),.. } if s=="label"),"{actual:?}");
 let row=e.store().rows("kids").unwrap().pop().unwrap();
 assert_eq!(row.field("parent").unwrap(),&id("p"));
 let predicted=d.predict("clash","alice",&json!({"id":"other","parent":"p"}),100,vec![],2).unwrap_err();
 assert_eq!(predicted.code(),"E_UNIQUE","{predicted:?}");
 let conflict=e.mutate("clash",None,Context::new("alice",common::args(&[("id",id("other")),("parent",id("p"))])).at(100)).unwrap();
 assert!(matches!(conflict.state,WriteState::Failed { ref why,.. } if why.code=="E_UNIQUE" && why.message.contains("unique parent") && !why.message.contains("$intent")),"{conflict:?}");
 assert_eq!(e.store().rows("parents").unwrap().len(),1,"the earlier write rolled back");
 assert_eq!(query(&mut d),json!([{"id":"p","label":"label","pending":true}]),"device refusal rolled back");
 host.close("qdiag",d);
}
fn query<S:DeviceStore>(d:&mut Device<S>)->serde_json::Value{snapback4_device::call::call(d,json!({"op":"query","name":"parents","viewer":"alice","args":{"c":null},"now":100}))["ok"]["data"].clone()}
#[test]fn qdiag_memory(){run(&mut Memory::default());}
#[test]fn qdiag_sqlite(){run(&mut Sqlite::new("wave11-qdiag"));}
