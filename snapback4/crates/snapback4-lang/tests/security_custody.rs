//! A repaired ordinary 015 workflow: no pet or handoff is seeded.
use snapback4_lang::compile;
use snapback4_core::{Engine,Context,Value,WriteState};
use std::collections::BTreeMap;
const NOW:i64=1_800_000_000_000;
fn call(e:&mut Engine,name:&str,viewer:&str,args:impl IntoIterator<Item=(&'static str,Value)>)->Value{
    match e.mutate(name,None,Context::new(viewer,args.into_iter().map(|(n,v)|(n.into(),v)).collect()).at(NOW)).unwrap().state {
        WriteState::Sent{result,..}=>result,other=>panic!("{name}: {other:?}"),
    }
}
fn id(row:&Value)->Value{row.field("id").unwrap().clone()}
#[test]
fn placement_transfer_adoption_and_confirmations_record_real_handoffs(){
 let b=compile(&[("schema.q".into(),include_str!("security/wave16/015-fixed.q").into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
 call(&mut e,"grantCoordinator","service:ops",[("who",Value::Id("account:coordinator".into()))]);
 for (viewer,role) in [("account:foster-a","foster"),("account:foster-b","foster"),("account:adopter","adopter"),("account:vet","vet")]{call(&mut e,"registerProfile",viewer,[("role",Value::String(role.into())),("displayName",Value::Null)]);}
 let pet=call(&mut e,"registerPet","account:coordinator",[("name",Value::String("Mochi".into())),("species",Value::String("cat".into())),("breed",Value::Null),("description",Value::Null)]);let pet=id(&pet);
 const PNG:[u8;24]=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1];
 for (next,count) in [("account:foster-a",1),("account:foster-b",2)]{
  let photo=e.store_asset("account:coordinator",&PNG,NOW).unwrap().column_value();
  call(&mut e,"placeWithFoster","account:coordinator",[("pet",pet.clone()),("foster",Value::Id(next.into())),("photo",photo.clone())]);
  let handoffs=e.store().rows("handoffs").unwrap();assert_eq!(handoffs.len(),count);
  assert!(handoffs.iter().any(|h|h.field("pet").ok()==Some(&pet)&&h.field("toParty").ok()==Some(&Value::Id(next.into()))));
 }
 let hidden=e.query("petDetail",Context::new("account:foster-a",BTreeMap::from([("pet".into(),pet.clone())])).at(NOW)).unwrap();assert_eq!(hidden.data,Value::Null);
 let application=call(&mut e,"applyForAdoption","account:adopter",[("pet",pet.clone()),("note",Value::Null)]);
 let photo=e.store_asset("account:coordinator",&PNG,NOW).unwrap().column_value();
 call(&mut e,"approveAdoption","account:coordinator",[("application",id(&application)),("photo",photo.clone())]);
 let handoffs=e.store().rows("handoffs").unwrap();assert_eq!(handoffs.len(),3);
 let adoption=handoffs.iter().find(|h|h.field("toParty").ok()==Some(&Value::Id("account:adopter".into()))).unwrap();let handoff=id(adoption);
 for who in ["account:foster-b","account:adopter"]{call(&mut e,"confirmHandoff",who,[("handoff",handoff.clone())]);}
 let h=e.store().rows("handoffs").unwrap().into_iter().find(|h|h.field("id").ok()==Some(&handoff)).unwrap();
 assert_eq!(h.field("fromConfirmed").unwrap(),&Value::Bool(true));assert_eq!(h.field("toConfirmed").unwrap(),&Value::Bool(true));
 // A coordinator still must validate a handoff recipient and distinct parties.
 for (from,to,code) in [("account:coordinator","account:vet","INVALID_RECIPIENT"),("account:coordinator","account:coordinator","SAME_PARTY")]{
  let result=e.mutate("recordHandoff",None,Context::new("account:coordinator",BTreeMap::from([("pet".into(),pet.clone()),("fromParty".into(),Value::Id(from.into())),("toParty".into(),Value::Id(to.into())),("photo".into(),photo.clone()),("note".into(),Value::Null),("at".into(),Value::Null)])).at(NOW)).unwrap();
  assert!(matches!(result.state,WriteState::Failed{ref why,..} if why.code==code),"{code}: {result:?}");
 }
}
