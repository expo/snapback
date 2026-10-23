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
        if !bytes.starts_with(b"%PDF-") {std::fs::remove_file(e.store().asset_location().unwrap().path(&asset)).unwrap();}
        let new=FILES.replace("  names: file", "  quantity: int\n  names: file").replace("mutation add(names: file <=1000):\n  return insert orders {names}\n", "")+"backfill orders quantity(names: file <=1000): {quantity:nonemptyLines(fileText(names))}\n";
        let generation=e.generation();let error=adopt(&mut e,&new,2).unwrap_err().to_string();assert!(error.contains("fileText"),"{error}");assert_eq!(generation,e.generation());assert!(row(&mut e,"orders",&id).field("quantity").is_err());
    }
}

#[test]
fn child_extraction_moves_file_home_and_round_trips_without_uploading() {
    let old=FILES;
    let next="table orders:\n  public 'fixture'\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  public 'fixture'\n  online only\nextract documents from orders via order: {names:names}\n";
    let mut e=engine(old);let id=upload_and_add(&mut e,b"Ada\n");
    let asset=crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))).unwrap().to_owned();
    for _ in 0..2 {
        adopt(&mut e,next,2).unwrap();
        assert_eq!(e.store().asset(&asset).unwrap().unwrap().home,Some(("documents".into(),id.clone(),"names".into())));
        assert_eq!(crate::assets::asset_id(Some(&field(&mut e,"documents",&id,"names"))),Some(asset.as_str()));
        adopt(&mut e,old,1).unwrap();
        assert_eq!(e.store().asset(&asset).unwrap().unwrap().home,Some(("orders".into(),id.clone(),"names".into())));
        assert_eq!(crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))),Some(asset.as_str()));
    }
}

#[test]
fn native_extraction_child_cannot_attach_to_a_parent_born_after_its_write() {
    let source="table orders:\n  public 'fixture'\n  insert <- allow\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  public 'fixture'\n  insert <- allow\n  online only\nextract documents from orders via order: {names:names}\nmutation attach(order: orders, names: file <=1000):\n  return insert documents {order,names}\n";
    let mut e=engine(source);
    let asset=e.store_file("alice",b"Ada",Some("text/plain"),"names.txt",100).unwrap();let asset_id=asset.id.clone();
    let handle=Value::Map(std::collections::BTreeMap::from([("id".into(),Value::Id(asset.id))]).into());
    let result=e.mutate("attach",None,Context::new("alice",std::collections::BTreeMap::from([("order".into(),Value::Id("p".into())),("names".into(),handle)])).at(101)).unwrap();assert!(matches!(result.state,WriteState::Sent{..}),"{result:?}");
    seed(&mut e,"orders",json!({"id":"p"}));let before=e.generation();
    let error=adopt(&mut e,FILES,2).unwrap_err().to_string();assert!(error.contains("parent-lifetime evidence"),"{error}");assert_eq!(e.generation(),before);assert_eq!(e.store().asset(&asset_id).unwrap().unwrap().home.unwrap().0,"documents");
}

#[test]
fn extraction_refuses_public_child_for_private_parent_and_missing_bytes_atomically() {
    let old=FILES.replace("  public 'fixture'", "  owner: principal\n  immutable owner\n  read <- .owner = viewer").replace("{names}","{names,owner:viewer}");
    let child="table orders:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  read <- allow\n  online only\nextract documents from orders via order: {names:names}\n";
    let mut e=engine(&old);let id=upload_and_add(&mut e,b"private");let generation=e.generation();
    assert!(adopt(&mut e,child,2).unwrap_err().to_string().contains("read through"));assert_eq!(e.generation(),generation);
    let through=child.replace("  read <- allow","  immutable order\n  read through .order");
    adopt(&mut e,&through,2).unwrap();adopt(&mut e,&old,1).unwrap();
    let asset=crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))).unwrap().to_owned();
    std::fs::remove_file(e.store().asset_location().unwrap().path(&asset)).unwrap();let generation=e.generation();
    assert!(adopt(&mut e,&through,2).unwrap_err().to_string().contains("bytes are unavailable"));assert_eq!(e.generation(),generation);assert_eq!(e.store().asset(&asset).unwrap().unwrap().home.unwrap().0,"orders");
}

#[test]
fn extraction_does_not_overwrite_independent_destination_or_choose_ambiguous_native_children() {
    let old=FILES.replace("names: file <=1000\n", "names: file <=1000 ?\n")+"table documents:\n  order: orders on delete cascade\n  names: file <=1000 ?\n  public 'fixture'\n  online only\n";
    let next=old.replace("  names: file <=1000 ?\n", "").replace("  order: orders on delete cascade\n", "  order: orders on delete cascade\n  names: file <=1000 ?\n").replace("mutation add(names: file <=1000):\n  return insert orders {names}\n", "")+"extract documents from orders via order: {names:names}\n";
    let mut e=engine(&old);let id=upload_and_add(&mut e,b"source");seed(&mut e,"documents",json!({"id":id,"order":id,"names":null}));
    let generation=e.generation();let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("independent history"),"{error}");assert_eq!(generation,e.generation());
    let mut e=engine(&next);seed(&mut e,"orders",json!({"id":"p"}));
    for id in ["x","y"]{seed(&mut e,"documents",json!({"id":id,"order":"p","names":null}));}
    let generation=e.generation();assert!(adopt(&mut e,&old,1).unwrap_err().to_string().contains("several child rows compete"));assert_eq!(generation,e.generation());
}

const EXTRACT_FILES:&str="table orders:\n  public 'fixture'\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  public 'fixture'\n  online only\nextract documents from orders via order: {names:names}\n";
#[test]
fn extraction_receipts_survive_table_asset_and_reference_renames(){
    let mut e=engine(FILES);let id=upload_and_add(&mut e,b"retained bytes");let asset=crate::assets::asset_id(Some(&field(&mut e,"orders",&id,"names"))).unwrap().to_owned();
    let renamed=EXTRACT_FILES.replace("table orders:","table shipments renamed from orders:").replace("table documents:","table records renamed from documents:").replace("order: orders on delete cascade","booking: shipments renamed from order on delete cascade").replace("names: file <=1000","roster: file <=1000 renamed from names").replace("extract documents from orders via order: {names:names}","extract records from shipments via booking: {roster:names}");
    for _ in 0..2 {
        adopt(&mut e,EXTRACT_FILES,2).unwrap();adopt(&mut e,&renamed,3).unwrap();assert_eq!(e.store().asset(&asset).unwrap().unwrap().home,Some(("records".into(),id.clone(),"roster".into())));
        assert_eq!(field(&mut e,"records",&id,"booking"),Value::Id(id.clone()));
        adopt(&mut e,FILES,1).unwrap();assert_eq!(e.store().asset(&asset).unwrap().unwrap().home,Some(("orders".into(),id.clone(),"names".into())));
    }
}
#[test]
fn extraction_does_not_overwrite_a_narrowed_independent_child_destination(){
    let old=FILES.to_owned()+"table documents:\n  order: orders on delete cascade\n  names: file <=1000 ?\n  public 'fixture'\n  online only\n";
    let mut e=engine(&old);let id=upload_and_add(&mut e,b"parent");seed(&mut e,"documents",json!({"id":id,"order":id,"names":null}));
    adopt(&mut e,&old.replace("names: file <=1000 ?","names: file <=1000"),2).unwrap();assert_eq!(e.store().count("documents").unwrap(),0);
    let generation=e.generation();let error=adopt(&mut e,EXTRACT_FILES,3).unwrap_err().to_string();assert!(error.contains("independent history"),"{error}");assert_eq!(generation,e.generation());assert!(field(&mut e,"orders",&id,"names").field("id").is_ok());
}
#[test]
fn pruned_extraction_children_are_not_recreated_from_receipt_metadata(){
    let mut e=engine(FILES);let id=upload_and_add(&mut e,b"retained");adopt(&mut e,EXTRACT_FILES,2).unwrap();adopt(&mut e,FILES,1).unwrap();e.store_mut().prune_dormant(true,None).unwrap();
    let generation=e.generation();let error=adopt(&mut e,EXTRACT_FILES,2).unwrap_err().to_string();assert!(error.contains("pruned/deleted history"),"{error}");assert_eq!(generation,e.generation());assert!(field(&mut e,"orders",&id,"names").field("id").is_ok());
}

#[test]
fn table_rename_normalizes_extraction_table_slots_without_rewriting_column_names(){
    let source="table orders:\n  public 'fixture'\n  online only\ntable documents:\n  link: orders on delete cascade\n  parent: file <=1000 renamed from orders\n  public 'fixture'\n  online only\nextract documents from orders via link: {parent:orders}\n";
    let(s,_)=compile(source);let mapped=s.with_table_names(&std::collections::BTreeMap::from([("orders".into(),"shipments".into())])).unwrap();assert_eq!(mapped.extractions[0].parent,"shipments");assert_eq!(mapped.extractions[0].fields["parent"],"orders");assert_eq!(mapped.asset_renames["documents"]["parent"],"orders");
}
