//! Wave-27 day-two cycles with actual asset homes and edited scalar outputs.
use super::*;
const PARENT:&str="table orders:\n  names: file <=1000\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nmutation add(names: file <=1000):\n  return insert orders {names}\nmutation replace(id: orders, names: file <=1000):\n  return update orders[id] {names}\n";
const CHILD:&str="table orders:\n  public 'fixture'\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000 ?\n  public 'fixture'\n  online only\nextract documents from orders via order: {names:names}\n";
fn upload(e:&mut Engine,body:&[u8])->Value {
    let asset=e.store_file("alice",body,Some("text/plain"),"name.txt",100).unwrap();
    Value::Map(BTreeMap::from([("id".into(),Value::Id(asset.id))]).into())
}
fn call(e:&mut Engine,op:&str,args:BTreeMap<String,Value>)->Value {
    let out=e.mutate(op,None,Context::new("alice",args).at(101)).unwrap();
    match out.state {WriteState::Sent{result,..}=>result,_=>panic!("{out:?}")}
}
#[test]
fn required_to_optional_extraction_refills_reversed_child_from_current_parent() {
    let mut e=engine(PARENT);let handle=upload(&mut e,b"first");
    let parent=call(&mut e,"add",BTreeMap::from([("names".into(),handle)])).field("id").unwrap().as_str().unwrap().to_owned();
    for cycle in 0..3 {
        adopt(&mut e,CHILD,2).unwrap();
        let before=field(&mut e,"documents",&parent,"names");
        let id=crate::assets::asset_id(Some(&before)).unwrap().to_owned();
        assert_eq!(e.store().asset(&id).unwrap().unwrap().home.unwrap().0,"documents");
        adopt(&mut e,PARENT,1).unwrap();
        if cycle==0 {let replacement=upload(&mut e,b"replacement");call(&mut e,"replace",BTreeMap::from([("id".into(),Value::Id(parent.clone())),("names".into(),replacement)]));}
        let current=field(&mut e,"orders",&parent,"names");
        adopt(&mut e,CHILD,2).unwrap();
        assert_eq!(field(&mut e,"documents",&parent,"names"),current);
        adopt(&mut e,PARENT,1).unwrap();
    }
}
#[test]
fn reference_rename_may_change_delete_policy_without_recapturing_identity() {
    let old="table parents:\n  public 'fixture'\n  delete <- allow\n  online only\ntable items:\n  parent: parents on delete restrict\n  unique parent\n  public 'fixture'\n  online only\nmutation remove():\n  delete parents['p']\n";
    let next=old.replace("parent: parents on delete restrict","anchor: parents renamed from parent on delete cascade").replace("unique parent","unique anchor");
    let mut e=engine(old);seed(&mut e,"parents",json!({"id":"p"}));seed(&mut e,"items",json!({"id":"c","parent":"p"}));
    adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","c","anchor"),Value::Id("p".into()));
    adopt(&mut e,old,1).unwrap();let denied=e.mutate("remove",None,Context::new("alice",Default::default())).unwrap();assert!(matches!(denied.state,WriteState::Failed{..}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"remove");assert_eq!(e.store().count("items").unwrap(),0);
}
#[test]
fn backfill_retained_authored_value_survives_many_release_cycles() {
    let next=cues()+"down cues oldStatus(status: enum('standby','complete','skipped')): {status:'done' if status != 'standby' else 'standby'}\n";
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"skip");
    for _ in 0..8 {adopt(&mut e,CUE,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("skipped".into()));}
}

#[test]
fn enum_spelling_alias_keeps_edited_current_values_across_cycles() {
    let old=CUE.replace("'standby','done'","'standby','done','released'");
    let next=old.replace("'done'","'complete'")+"alias cues.status 'done' = 'complete'\nmutation release():\n  update cues['a'] {status:'released'}\n";
    let mut e=engine(&old);seed(&mut e,"cues",json!({"id":"a","status":"done"}));
    adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("complete".into()));
    write(&mut e,"release");
    for _ in 0..3 {adopt(&mut e,&old,1).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("released".into()));adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("released".into()));}
}

#[test]
fn in_place_edit_to_renamed_enum_recomputes_after_repeated_reverse_projection() {
    let next=cues()+"down cues oldStatus(status: enum('standby','complete','skipped')): {status:'done' if status != 'standby' else 'standby'}\nmutation finish():\n  update cues['a'] {status:'complete'}\n";
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"standby"}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"finish");
    for _ in 0..4 {adopt(&mut e,CUE,1).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("done".into()));adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("complete".into()));}
}

#[test]
fn replacing_an_edited_enum_transform_after_a_bridge_survives_repeated_cycles() {
    let next=cues()+"down cues oldStatus(status: enum('standby','complete','skipped')): {status:'done' if status != 'standby' else 'standby'}\nmutation finish():\n  update cues['a'] {status:'complete'}\n";
    let bridge=CUE.replace("enum('standby','done')","enum('standby','done','complete','skipped')")+"mutation repair():\n  update cues['a'] {status:'done'}\n";
    let replacement=next.replace("backfill cues rename(","backfill cues rename2(").replace("down cues oldStatus(","down cues oldStatus2(");
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"skip");write(&mut e,"finish");adopt(&mut e,&bridge,3).unwrap();write(&mut e,"repair");
    adopt(&mut e,&replacement,4).unwrap();
    for _ in 0..4 {adopt(&mut e,CUE,1).unwrap();adopt(&mut e,&replacement,4).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("complete".into()));}
}

#[test]
fn replacing_a_transform_cannot_discard_a_different_retained_authored_value() {
    let next=cues()+"down cues oldStatus(status: enum('standby','complete','skipped')): {status:'done' if status != 'standby' else 'standby'}\n";
    let bridge=CUE.replace("enum('standby','done')","enum('standby','done','complete','skipped')");
    let replacement=next.replace("backfill cues rename(","backfill cues rename2(").replace("down cues oldStatus(","down cues oldStatus2(");
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));adopt(&mut e,&next,2).unwrap();write(&mut e,"skip");adopt(&mut e,&bridge,3).unwrap();
    let generation=e.generation();let error=adopt(&mut e,&replacement,4).unwrap_err().to_string();
    assert!(error.contains("retained authored output")&&error.contains("authorized mutation"),"{error}");assert_eq!(e.generation(),generation);
}

#[test]
fn extraction_accepts_a_structurally_stricter_child_audience_without_a_bridge() {
    let old=PARENT.replace("  names: file <=1000", "  owner: principal\n  immutable owner\n  names: file <=1000")
        .replace("public 'fixture'","read <- .owner = viewer or viewer = 'service:operator'\n  read(names) <- .owner = viewer or viewer = 'service:operator'")
        .replace("{names}","{names,owner:viewer}");
    let current="table orders:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer or viewer = 'service:operator'\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000 ?\n  read <- viewer = 'service:operator'\n  online only\nextract documents from orders via order: {names:names}\nquery list():\n  return documents first 10 by .id\n";
    let mut e=engine(&old);let handle=upload(&mut e,b"private");call(&mut e,"add",BTreeMap::from([("names".into(),handle)]));
    let broad=current.replace("read <- viewer = 'service:operator'","read <- allow");let generation=e.generation();
    assert!(adopt(&mut e,&broad,2).unwrap_err().to_string().contains("cannot broaden"));assert_eq!(e.generation(),generation);
    adopt(&mut e,current,2).unwrap();
    let guest=e.query("list",Context::new("alice",Default::default())).unwrap();
    let operator=e.query("list",Context::new("service:operator",Default::default())).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&guest.data),json!([]));
    assert_eq!(snapback4_core::wire::to_json(&operator.data).as_array().unwrap().len(),1);
}

#[test]
fn hiding_a_positive_freeze_witness_refuses_under_the_writer() {
    use crate::engine::release::{ReleaseActivation,VisibilityPolicy,HiddenNull};
    let current="table locks:\n  value: int ?\n  public 'fixture'\n  online only\ntable docs:\n  body: text <=20\n  public 'fixture'\n  immutable body when exists locks['lock']\n  online only\n";
    let target=current.replace("value: int ?","value: int");
    let mut e=engine(current);seed(&mut e,"locks",json!({"id":"lock","value":null}));seed(&mut e,"docs",json!({"id":"d","body":"frozen"}));
    let (schema,programs)=compile(&target);let generation=e.generation();
    let mut activation=ReleaseActivation::new(2,Some(1));activation.visibility=Some(VisibilityPolicy{hides:vec![HiddenNull{table:"locks".into(),column:"value".into(),reason:"pending".into()}]});
    let error=e.adopt_release(schema,programs,&activation,false).unwrap_err().to_string();assert!(error.contains("lookup population"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(e.store().count("locks").unwrap(),1);
}
