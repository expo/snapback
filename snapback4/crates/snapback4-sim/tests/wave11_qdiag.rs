//! Compare implicit/explicit row-reference worlds through the simulator's
//! wire, receipts, stream, settlement and device-reopen observation harness.
#[path="common/write_observation.rs"] mod observation;
use snapback4_core::Engine;
use serde_json::json;
fn engine(source:&str)->Engine{let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()}
#[test]
fn contextual_projection_preserves_every_published_observation(){
 let source="table media:\n  photo: image <=5MB\n  public\ntable parents:\n  label: text <=20\n  public\n  insert <- allow\n  sync public\ntable kids:\n  parent: parents on delete keep\n  public\n  insert <- allow\n  sync public\nmutation create(id: id, kid: id):\n  parent = insert parents { id, label:'parent' }\n  insert kids { id:kid, parent }\n  return parent.id\nquery list(c: cursor ?):\n  return kids first 10 by .id after c\n";
 let mut a=engine(source);let mut b=engine(&source.replace("id:kid, parent","id:kid, parent:parent.id").replace("5MB","5000000"));
 let (_,a)=observation::observe(&mut a,"create","alice",json!({"id":"p","kid":"k"}),"qdiag-op",("list",json!({"c":null})));
 let (_,b)=observation::observe(&mut b,"create","alice",json!({"id":"p","kid":"k"}),"qdiag-op",("list",json!({"c":null})));
 a.assert_same(&b);
}
