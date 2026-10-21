//! Wave-21 regressions: ordinary v2 edits must survive rollback/forward.
use super::*;
const OLD:&str="table items:\n  input: int\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {input: 2}\n";
fn next()->String {OLD.replace("  input: int", "  label: int\n  input: int")+"backfill items label(input: int):\n  {label: input * 10}\nmutation editBoth():\n  update items['a'] {input: 2, label: 20}\nmutation editNative():\n  update items['a'] {input: 2, label: 99}\n"}
#[test]
fn wave21_native_v2_edits_refresh_fingerprint_without_rederiving_authored_output() {
    let new=next();let mut e=engine(&new);
    seed(&mut e,"items",json!({"id":"a","input":1,"label":10}));write(&mut e,"editNative");
    for _ in 0..2 {adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(99));}
}
#[test]
fn wave21_migrated_v2_edits_refresh_inputs_and_preserve_current_output() {
    let new=next();let mut e=engine(OLD);seed(&mut e,"items",json!({"id":"a","input":1}));adopt(&mut e,&new,2).unwrap();write(&mut e,"editBoth");
    for _ in 0..2 {adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));}
}
#[test]
fn wave21_recompute_agreement_adopts_legacy_native_marker_but_disagreement_refuses() {
    for label in [20,99] {
        let new=next();let mut e=engine(&new);seed(&mut e,"items",json!({"id":"a","input":1,"label":label}));adopt(&mut e,OLD,1).unwrap();write(&mut e,"edit");
        let result=adopt(&mut e,&new,2);
        if label==20 {result.unwrap();assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));}else {assert!(result.unwrap_err().to_string().contains("recomputation differs"));}
    }
}
#[test]
fn wave21_nullable_rename_absence_is_not_a_conflict_in_either_direction() {
    let old="table items:\n  title: text <=40 ?\n  public 'fixture'\n  online only\n";
    let new="table items:\n  name: text <=40 ? renamed from title\n  public 'fixture'\n  online only\n";
    let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","title":"first"}));adopt(&mut e,new,2).unwrap();assert_eq!(field(&mut e,"items","a","name"),Value::String("first".into()));
    adopt(&mut e,old,1).unwrap();seed(&mut e,"items",json!({"id":"b","title":"old client"}));adopt(&mut e,new,2).unwrap();assert_eq!(field(&mut e,"items","b","name"),Value::String("old client".into()));
    adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","b","title"),Value::String("old client".into()));
}

#[test]
fn wave21_hidden_inputs_keep_their_native_fingerprint_on_unrelated_active_writes() {
    let new=next();let hidden=new.replace("  input: int\n", "").replace("mutation edit():\n  update items['a'] {input: 2}\n", "").replace("mutation editBoth():\n  update items['a'] {input: 2, label: 20}\n", "").replace("{input: 2, label: 99}","{label:99}");
    let mut e=engine(&new);seed(&mut e,"items",json!({"id":"a","input":1,"label":99}));
    adopt(&mut e,&hidden,3).unwrap();write(&mut e,"editNative");adopt(&mut e,OLD,1).unwrap();adopt(&mut e,&new,2).unwrap();
    assert_eq!(field(&mut e,"items","a","label"),Value::Int(99));
}
#[test]
fn wave21_reversed_existing_output_accepts_exact_recomputation() {
    let old=OLD.replace("  input: int","  label: int\n  input: int").replace("{input: 2}","{input:2,label:20}");
    let new=old.clone()+"backfill items label(input: int):\n  {label:input * 10}\n";
    let mut e=engine(&old);seed(&mut e,"items",json!({"id":"a","input":1,"label":0}));
    adopt(&mut e,&new,2).unwrap();adopt(&mut e,&old,1).unwrap();write(&mut e,"edit");adopt(&mut e,&new,2).unwrap();
    assert_eq!(field(&mut e,"items","a","label"),Value::Int(20));
}
#[test]
fn wave21_table_rename_preserves_ids_references_and_old_release_writes() {
    let old="table behaviors:\n  note: text <=40\n  public 'fixture'\n  online only\ntable links:\n  parent: behaviors\n  public 'fixture'\n  online only\n";
    let new=old.replace("table behaviors:","table observations renamed from behaviors:").replace("parent: behaviors","parent: observations");
    let mut e=engine(old);seed(&mut e,"behaviors",json!({"id":"a","note":"old"}));seed(&mut e,"links",json!({"id":"l","parent":"a"}));
    adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"observations","a","note"),Value::String("old".into()));
    seed(&mut e,"observations",json!({"id":"b","note":"new"}));adopt(&mut e,old,1).unwrap();
    assert_eq!(e.store().count("behaviors").unwrap(),2);assert_eq!(e.store().count("links").unwrap(),1);
    seed(&mut e,"behaviors",json!({"id":"c","note":"old client"}));adopt(&mut e,&new,2).unwrap();assert_eq!(e.store().count("observations").unwrap(),3);
}
fn upload_and_add(e:&mut Engine,bytes:&[u8])->String {
    let asset=e.store_file("alice",bytes,Some(if bytes.starts_with(b"%PDF-"){"application/pdf"}else{"text/plain"}),"names.txt",100).unwrap();
    let handle=Value::Map(std::collections::BTreeMap::from([("id".into(),Value::Id(asset.id))]).into());
    let r=e.mutate("add",None,Context::new("alice",std::collections::BTreeMap::from([("names".into(),handle)])).at(101)).unwrap();
    match r.state {WriteState::Sent{result,..}=>result.field("id").unwrap().as_str().unwrap().to_owned(),_=>panic!("{r:?}")}
}
const FILES:&str="table orders:\n  names: file <=1000\n  public 'fixture'\n  insert <- allow\n  online only\nmutation add(names: file <=1000):\n  return insert orders {names}\n";
#[test]
fn wave21_file_text_backfill_counts_repeated_nonempty_entries_and_catches_up_old_writes() {
    let mut e=engine(FILES);let id=upload_and_add(&mut e,b"Ada\n \nAda\nLin\r\n");
    let new=FILES.replace("  names: file", "  quantity: int\n  names: file").replace("mutation add(names: file <=1000):\n  return insert orders {names}\n", "")+"backfill orders quantity(names: file <=1000):\n  {quantity:nonemptyLines(fileText(names))}\n";
    adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"orders",&id,"quantity"),Value::Int(3));
    adopt(&mut e,FILES,1).unwrap();let empty=upload_and_add(&mut e,b"\n\t\n");adopt(&mut e,&new,2).unwrap();
    assert_eq!(field(&mut e,"orders",&empty,"quantity"),Value::Int(0));
}
#[test]
fn wave21_asset_rename_keeps_the_home_and_restores_native_old_client_uploads() {
    let old=FILES;let new=old.replace("  names: file <=1000", "  roster: file <=1000 renamed from names").replace("return insert orders {names}","return insert orders {roster:names}");
    let mut e=engine(old);let id=upload_and_add(&mut e,b"Ada\n");let asset=crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))).unwrap().to_owned();
    adopt(&mut e,&new,2).unwrap();assert_eq!(e.store().asset(&asset).unwrap().unwrap().home.unwrap().2,"roster");
    let native=upload_and_add(&mut e,b"Lin\n");adopt(&mut e,old,1).unwrap();assert_eq!(e.store().asset(&asset).unwrap().unwrap().home.unwrap().2,"names");
    assert!(row(&mut e,"orders",&native).field("names").is_ok());let older=upload_and_add(&mut e,b"Kai\n");adopt(&mut e,&new,2).unwrap();assert!(row(&mut e,"orders",&older).field("roster").is_ok());
}
#[test]
fn wave21_cross_table_existence_backfill_is_atomic_and_reversible() {
    let old="table orders:\n  public 'fixture'\n  online only\ntable uploads:\n  order: orders\n  by byOrder: order\n  public 'fixture'\n  online only\n";
    let new=old.replace("table orders:","table orders:\n  attached: bool")+"backfill orders evidence(id: id):\n  {attached:exists uploads where .order = id}\n";
    let mut e=engine(old);for id in ["a","b"] {seed(&mut e,"orders",json!({"id":id}));}seed(&mut e,"uploads",json!({"id":"u","order":"a"}));
    adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"orders","a","attached"),Value::Bool(true));assert_eq!(field(&mut e,"orders","b","attached"),Value::Bool(false));
    adopt(&mut e,old,1).unwrap();seed(&mut e,"uploads",json!({"id":"v","order":"b"}));adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"orders","b","attached"),Value::Bool(true));
}
#[test]
fn wave21_table_rename_preserves_carried_backfill_evidence_across_old_writes() {
    let old=OLD.to_owned()+"backfill items n(input: int): {input:input * 2}\n";
    let new=old.replace("table items:","table things renamed from items:").replace("backfill items", "backfill things").replace("update items", "update things");
    let mut e=engine(OLD);seed(&mut e,"items",json!({"id":"a","input":1}));adopt(&mut e,&old,2).unwrap();
    adopt(&mut e,&new,3).unwrap();assert_eq!(field(&mut e,"things","a","input"),Value::Int(2));adopt(&mut e,&old,2).unwrap();
    assert_eq!(field(&mut e,"items","a","input"),Value::Int(2));adopt(&mut e,OLD,1).unwrap();assert_eq!(field(&mut e,"items","a","input"),Value::Int(1));
    adopt(&mut e,&new,3).unwrap();assert_eq!(field(&mut e,"things","a","input"),Value::Int(2));
}
#[test]
fn wave21_file_text_missing_bytes_and_invalid_utf8_refuse_atomically() {
    for bytes in [b"%PDF-1.4\n\xff".as_slice(),b"valid\n".as_slice()] {
        let mut e=engine(FILES);let id=upload_and_add(&mut e,bytes);let asset=crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))).unwrap().to_owned();
        if !bytes.starts_with(b"%PDF-") {std::fs::remove_file(e.store().asset_path(&asset)).unwrap();}
        let new=FILES.replace("  names: file", "  quantity: int\n  names: file").replace("mutation add(names: file <=1000):\n  return insert orders {names}\n", "")+"backfill orders quantity(names: file <=1000): {quantity:nonemptyLines(fileText(names))}\n";
        let generation=e.generation();let error=adopt(&mut e,&new,2).unwrap_err().to_string();assert!(error.contains("fileText"),"{error}");assert_eq!(generation,e.generation());assert!(row(&mut e,"orders",&id).field("quantity").is_err());
    }
}
