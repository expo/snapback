//! Business-state regressions for declarative day-two adoption.
use snapback4_core::rows::Rows;
use super::*;
use crate::{Context,Engine,WriteState,wire};
use crate::engine::release::ReleaseActivation;
use serde_json::{json,Value as Json};
fn compile(source:&str)->(Schema,Vec<crate::ir::Program>){
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    (serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),b.programs.into_iter().map(|p|serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect())
}
fn engine(source:&str)->Engine{let(s,p)=compile(source);Engine::new_release(Store::memory().unwrap(),s,p,1,None).unwrap()}
fn adopt(e:&mut Engine,source:&str,n:u64)->Result<u64,RuntimeError>{
    let(s,p)=compile(source);let previous=(&e.store()).test_support_meta("release").unwrap().map(|s|s.parse().unwrap());
    e.adopt_release(s,p,&ReleaseActivation::new(n,previous),false)
}
fn seed(e:&mut Engine,table:&str,row:Json){let row=wire::row_from_json(&e.schema().tables[table],&row).unwrap();e.seed([(table.into(),row)]).unwrap();}
fn row(e:&mut Engine,table:&str,id:&str)->Value{e.store_mut().transaction().unwrap().get(table,id).unwrap().unwrap()}
fn field(e:&mut Engine,table:&str,id:&str,c:&str)->Value{row(e,table,id).field(c).unwrap().clone()}
const BASE:&str="table bookings:\n  weight: int\n  length: int\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\nmutation edit():\n  update bookings[id = 'a'] {weight:4000}\nmutation remove():\n  delete bookings[id = 'a']\n";
fn ferry()->String{BASE.replace("  weight: int","  vehicleClass: enum('car', 'van', 'commercial')\n  weight: int")+"backfill bookings vehicleClass(weight: int, length: int):\n  {vehicleClass: 'commercial' if weight > 3500 else 'van' if length >= 5 else 'car'}\nmutation classify():\n  update bookings[id = 'a'] {vehicleClass:'van'}\n"}
fn write(e:&mut Engine,op:&str){let r=e.mutate(op,None,Context::new("alice",Default::default())).unwrap();assert!(matches!(r.state,WriteState::Sent{..}),"{r:?}");}
#[test]
fn conditional_backfill_rollback_older_writes_and_forward_catchup(){
 let mut e=engine(BASE);seed(&mut e,"bookings",json!({"id":"a","weight":1000,"length":4}));
 seed(&mut e,"bookings",json!({"id":"b","weight":1000,"length":5}));
 seed(&mut e,"bookings",json!({"id":"c","weight":4000,"length":4}));
 adopt(&mut e,&ferry(),2).unwrap();
 for(id,class)in[("a","car"),("b","van"),("c","commercial")]{assert_eq!(field(&mut e,"bookings",id,"vehicleClass"),Value::String(class.into()));}
 assert!(e.store().adoption_report().backfills.iter().any(|s|s.contains("transformed 3 rows")));
 let g=e.generation();adopt(&mut e,&ferry(),2).unwrap();assert_eq!(g,e.generation());
 write(&mut e,"classify");
 adopt(&mut e,BASE,1).unwrap();assert!(row(&mut e,"bookings","a").field("vehicleClass").is_err());
 seed(&mut e,"bookings",json!({"id":"d","weight":3600,"length":1}));
 adopt(&mut e,&ferry(),2).unwrap();assert_eq!(field(&mut e,"bookings","a","vehicleClass"),Value::String("van".into()));
 assert_eq!(field(&mut e,"bookings","d","vehicleClass"),Value::String("commercial".into()));
 adopt(&mut e,BASE,1).unwrap();write(&mut e,"edit");
 let before=e.generation();let error=adopt(&mut e,&ferry(),2).unwrap_err().to_string();assert!(error.contains("edited")&&error.contains("historical inputs changed"),"{error}");assert_eq!(before,e.generation());
}
#[test]
fn older_input_change_recomputes_unedited_derived_value(){
 let mut e=engine(BASE);seed(&mut e,"bookings",json!({"id":"a","weight":1000,"length":4}));
 adopt(&mut e,&ferry(),2).unwrap();adopt(&mut e,BASE,1).unwrap();write(&mut e,"edit");
 adopt(&mut e,&ferry(),2).unwrap();assert_eq!(field(&mut e,"bookings","a","vehicleClass"),Value::String("commercial".into()));
}
const CUE:&str="table cues:\n  status: enum('standby','done')\n  public 'fixture'\n  update <- allow\n  online only\n";
fn cues()->String{CUE.replace("enum('standby','done')","enum('standby','complete','skipped')")+"backfill cues rename(status: enum('standby','done')):\n  {status: 'complete' if status = 'done' else status}\nmutation skip():\n  update cues['a'] {status:'skipped'}\n"}
#[test]
fn enum_rename_reverses_exact_preimage_and_refuses_post_backfill_edits(){
 let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));adopt(&mut e,&cues(),2).unwrap();
 assert_eq!(field(&mut e,"cues","a","status"),Value::String("complete".into()));
 adopt(&mut e,CUE,1).unwrap();assert_eq!(field(&mut e,"cues","a","status"),Value::String("done".into()));
 adopt(&mut e,&cues(),2).unwrap();write(&mut e,"skip");let g=e.generation();
 let error=adopt(&mut e,CUE,1).unwrap_err().to_string();assert!(error.contains("changed after backfill"),"{error}");assert_eq!(g,e.generation());
 assert_eq!(field(&mut e,"cues","a","status"),Value::String("skipped".into()));
}
#[test]
fn backfill_and_evidence_roll_back_with_later_unique_failure(){
 let mut e=engine(BASE);for id in["a","b"]{seed(&mut e,"bookings",json!({"id":id,"weight":1000,"length":4}));}
 let bad=ferry().replace("  vehicleClass:","  unique vehicleClass\n  vehicleClass:");let g=e.generation();
 assert!(adopt(&mut e,&bad,2).is_err());assert_eq!(g,e.generation());assert!(row(&mut e,"bookings","a").field("vehicleClass").is_err());
 assert_ne!((&e.store()).test_support_meta("version").unwrap().as_deref(),Some(super::backfills::VERSION));
 adopt(&mut e,&ferry(),3).unwrap();assert_eq!(field(&mut e,"bookings","a","vehicleClass"),Value::String("car".into()));
}
#[test]
fn deletion_and_id_reuse_never_inherit_an_old_receipt(){
 let mut e=engine(BASE);seed(&mut e,"bookings",json!({"id":"a","weight":1000,"length":4}));adopt(&mut e,&ferry(),2).unwrap();
 adopt(&mut e,BASE,1).unwrap();write(&mut e,"remove");seed(&mut e,"bookings",json!({"id":"a","weight":5000,"length":4}));
 adopt(&mut e,&ferry(),2).unwrap();assert_eq!(field(&mut e,"bookings","a","vehicleClass"),Value::String("commercial".into()));
}
#[test]
fn string_split_and_ascii_digit_classification_are_deterministic(){
 let source="table people:\n  name: text <=100\n  location: text <=100\n  public 'fixture'\n  online only\n";
 let next=source.replace("  name:","  first: text <=100\n  last: text <=100\n  room: bool\n  name:")+"backfill people parts(name: text <=100, location: text <=100):\n  {first: beforeLast(name, ' '), last: afterLast(name, ' '), room: allDigits(location)}\n";
 let mut e=engine(source);for(id,name,location)in[("a","Ada Lovelace","123"),("b","Prince","１２３"),("c","A B C","")]{seed(&mut e,"people",json!({"id":id,"name":name,"location":location}));}
 adopt(&mut e,&next,2).unwrap();
 for(id,first,last,room)in[("a","Ada","Lovelace",true),("b","Prince","",false),("c","A B","C",false)]{assert_eq!(field(&mut e,"people",id,"first"),Value::String(first.into()));assert_eq!(field(&mut e,"people",id,"last"),Value::String(last.into()));assert_eq!(field(&mut e,"people",id,"room"),Value::Bool(room));}
}
#[test]
fn backfill_fragment_refuses_clock_viewer_scans_and_overlapping_outputs(){
 for value in["viewer","now","new"]{let b=snapback4_lang::compile(&[("schema.q".into(),format!("{BASE}backfill bookings nope():\n  {{weight:{value}}}\n"))]);assert!(!b.diagnostics.is_empty(),"{value}");}
 let b=snapback4_lang::compile(&[("schema.q".into(),format!("{BASE}backfill bookings one():\n  {{weight:1}}\nbackfill bookings two():\n  {{weight:2}}\n"))]);assert!(b.diagnostics.iter().any(|d|d.message.contains("overlap")));
}
#[test]
fn all_fifty_wave17_change_shapes_run_without_migration_programs(){
 let cases:Vec<Json>=serde_json::from_str(include_str!("../../tests/backfills/wave17.json")).unwrap();assert_eq!(cases.len(),50);
 for case in cases {
  let lane=case["lane"].as_u64().unwrap();let inputs=case["inputs"].as_object().unwrap();let outputs=case["outputs"].as_object().unwrap();
  let columns=|fields:&serde_json::Map<String,Json>|fields.iter().map(|(c,t)|format!("  {c}: {}\n",t.as_str().unwrap())).collect::<String>();
  let old=format!("table rows:\n  legacy: bool default true\n{}  public 'fixture'\n  online only\n",columns(inputs));
  let args=inputs.iter().map(|(c,t)|format!("{c}: {}",t.as_str().unwrap())).collect::<Vec<_>>().join(", ");
  let next=format!("table rows:\n  legacy: bool default true\n{}  public 'fixture'\n  online only\nbackfill rows change{lane}({args}):\n  {}\n",columns(outputs),case["expression"].as_str().unwrap());
  let bound=snapback4_lang::compile(&[("schema.q".into(),next.clone())]);assert!(bound.diagnostics.is_empty(),"lane {lane} {}: {:?}\n{next}",case["slug"],bound.diagnostics);
  let mut e=engine(&old);
  for (i,r) in case["rows"].as_array().unwrap().iter().enumerate(){let mut input=r["input"].as_object().unwrap().clone();input.insert("id".into(),json!(format!("r{i}")));seed(&mut e,"rows",Json::Object(input));}
  adopt(&mut e,&next,2).unwrap_or_else(|error|panic!("lane {lane}: {error}\n{next}"));
  assert!(e.schema().public_projection().backfills.is_empty(),"historical transforms never enter device input");
  for(i,r)in case["rows"].as_array().unwrap().iter().enumerate(){
   let got=row(&mut e,"rows",&format!("r{i}"));
   for(c,wanted)in r["expect"].as_object().unwrap(){assert_eq!(crate::wire::to_json(got.field(c).unwrap()),*wanted,"lane {lane} row {i} column {c}");}
  }
  adopt(&mut e,&old,1).unwrap_or_else(|error|panic!("lane {lane} rollback: {error}"));
  for(i,r)in case["rows"].as_array().unwrap().iter().enumerate(){for(c,wanted)in r["input"].as_object().unwrap(){assert_eq!(crate::wire::to_json(&field(&mut e,"rows",&format!("r{i}"),c)),*wanted,"lane {lane} restored {c}");}}
  adopt(&mut e,&next,2).unwrap_or_else(|error|panic!("lane {lane} forward: {error}"));
 }
}
#[test]
fn unique_lookup_uses_historical_rows_and_rechecks_changed_lookup_values(){
 let old="table members:\n  principal: principal\n  plot: text <=24\n  unique principal\n  read <- deny\n  online only\ntable bookings:\n  owner: principal\n  public 'fixture'\n  online only\n";
 let next=old.replace("  owner: principal","  plot: text <=24\n  owner: principal")+"backfill bookings plot(owner: principal):\n  {plot:(members[principal = owner] ! else NOT_FOUND).plot}\n";
 let mut e=engine(old);seed(&mut e,"members",json!({"id":"m","principal":"user:a","plot":"A17"}));seed(&mut e,"bookings",json!({"id":"a","owner":"user:a"}));
 adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"bookings","a","plot"),Value::String("A17".into()));
 adopt(&mut e,old,1).unwrap();
 // Trusted seed replaces the source row as an operator update for this test.
 seed(&mut e,"members",json!({"id":"m","principal":"user:a","plot":"B20"}));
 adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"bookings","a","plot"),Value::String("B20".into()));
}
#[test]
fn cross_reference_existence_is_evaluated_before_any_table_output_changes(){
 let old="table sightings:\n  tower: text <=20\n  reportedAt: time\n  public 'fixture'\n  online only\n";
 let next=old.replace("  tower:","  confidence: enum('confirmed','possible')\n  tower:")+"backfill sightings confidence(tower: text <=20, reportedAt: time):\n  {confidence:'confirmed' if exists sightings where .tower != tower and .reportedAt >= reportedAt - 15m and .reportedAt <= reportedAt + 15m else 'possible'}\n";
 let mut e=engine(old);seed(&mut e,"sightings",json!({"id":"a","tower":"north","reportedAt":1000000}));seed(&mut e,"sightings",json!({"id":"b","tower":"south","reportedAt":1100000}));seed(&mut e,"sightings",json!({"id":"c","tower":"west","reportedAt":9000000}));
 adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"sightings","a","confidence"),Value::String("confirmed".into()));assert_eq!(field(&mut e,"sightings","b","confidence"),Value::String("confirmed".into()));assert_eq!(field(&mut e,"sightings","c","confidence"),Value::String("possible".into()));
}
#[test]
fn retained_table_reentry_never_feeds_a_transform_its_own_output(){
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let next=old.to_owned()+"backfill items twice(n: int):\n  {n:n * 2}\n";
 for direct_old in [false,true] {
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();
  adopt(&mut e,"query empty():\n  return true\n",3).unwrap();
  if direct_old {adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(3));}
  else {adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(6));adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(3));}
 }
}
#[test]
fn previously_narrowed_rows_join_the_backfill_source_snapshot(){
 let old="table facts:\n  principal: principal\n  n: int 0..20\n  unique principal\n  public 'fixture'\n  online only\ntable bookings:\n  owner: principal\n  public 'fixture'\n  online only\n";
 let narrow=old.replace("int 0..20","int 0..5");
 let next=old.replace("  n: int","  doubled: int\n  n: int").replace("  owner: principal","  score: int\n  owner: principal")+"backfill facts twice(n: int):\n  {doubled:n * 2}\nbackfill bookings scores(owner: principal):\n  {score:(facts[principal = owner] ! else NOT_FOUND).n}\n";
 let mut e=engine(old);seed(&mut e,"facts",json!({"id":"a","principal":"user:a","n":9}));seed(&mut e,"bookings",json!({"id":"b","owner":"user:a"}));
 adopt(&mut e,&narrow,2).unwrap();assert_eq!(e.store().count("facts").unwrap(),0);
 adopt(&mut e,&next,3).unwrap();assert_eq!(field(&mut e,"facts","a","doubled"),Value::Int(18));assert_eq!(field(&mut e,"bookings","b","score"),Value::Int(9));
}
#[test]
fn historical_lookup_duplicates_refuse_before_another_patch_can_resolve_them(){
 let old="table members:\n  principal: principal\n  replacement: principal\n  plot: text <=24\n  public 'fixture'\n  online only\ntable bookings:\n  owner: principal\n  public 'fixture'\n  online only\n";
 let next=old.replace("  principal: principal","  unique principal\n  principal: principal").replace("  owner: principal","  plot: text <=24\n  owner: principal")+"backfill members uniquePrincipals(replacement: principal):\n  {principal:replacement}\nbackfill bookings plots(owner: principal):\n  {plot:(members[principal = owner] ! else NOT_FOUND).plot}\n";
 let mut e=engine(old);for(id,replacement,plot)in[("a","user:a","A"),("b","user:b","B")]{seed(&mut e,"members",json!({"id":id,"principal":"user:x","replacement":replacement,"plot":plot}));}
 seed(&mut e,"bookings",json!({"id":"c","owner":"user:x"}));let g=e.generation();
 let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("historical lookup")&&error.contains("not unique")&&error.contains("2 affected rows"),"{error}");assert_eq!(g,e.generation());
}
#[test]
fn pruning_preimages_is_visible_and_exact_reversal_then_refuses(){
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";let next=old.to_owned()+"backfill items twice(n: int):\n  {n:n * 2}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();
 let preview=e.store_mut().prune_dormant(false,None).unwrap();assert!(preview["items"].as_array().unwrap().iter().any(|i|i["kind"]=="backfill"&&i["rows"]==1));
 e.store_mut().prune_dormant(true,None).unwrap();let error=adopt(&mut e,old,1).unwrap_err().to_string();assert!(error.contains("explicitly pruned"),"{error}");assert_eq!(field(&mut e,"items","a","n"),Value::Int(6));
}
#[test]
fn carried_backfills_apply_to_rows_restored_for_the_first_time(){
 let old="table items:\n  n: int\n  label: enum('a','b')\n  public 'fixture'\n  online only\n";
 let narrow=old.replace("enum('a','b')","enum('a')");
 let with_fill=narrow.replace("  n: int","  doubled: int\n  n: int")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let restored=with_fill.replace("enum('a')","enum('a','b')");
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":9,"label":"b"}));
 adopt(&mut e,&narrow,2).unwrap();adopt(&mut e,&with_fill,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&restored,4).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(18));
}
#[test]
fn identity_cannot_be_a_backfill_output() {
 let b=snapback4_lang::compile(&[("schema.q".into(),format!("{BASE}backfill bookings corrupt():\n  {{id:'replacement'}}\n"))]);
 assert!(!b.diagnostics.is_empty());
}
#[test]
fn pruned_active_membership_refuses_reentry_without_double_applying() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";let next=old.to_owned()+"backfill items twice(n: int):\n  {n:n * 2}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();
 e.store_mut().prune_dormant(true,None).unwrap();adopt(&mut e,"query empty():\n  return true\n",3).unwrap();
 let g=e.generation();let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("explicitly pruned"),"{error}");assert_eq!(g,e.generation());
}
#[test]
fn prune_drops_deleted_lifetime_receipts_before_id_reuse() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";let next=old.to_owned()+"backfill items twice(n: int):\n  {n:n * 2}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();
 adopt(&mut e,"query empty():\n  return true\n",3).unwrap();e.store_mut().prune_dormant(true,None).unwrap();
 adopt(&mut e,&next,2).unwrap();seed(&mut e,"items",json!({"id":"a","n":10}));adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(10));
}
#[test]
fn dropped_historical_reference_cannot_recapture_a_reused_parent() {
 let wide="table parents:\n  public 'fixture'\ntable children:\n  parent: parents on delete keep\n  status: enum('live','new')\n  public 'fixture'\n  online only\n";
 let mut e=engine(wide);seed(&mut e,"parents",json!({"id":"p"}));seed(&mut e,"children",json!({"id":"c","parent":"p","status":"new"}));
 adopt(&mut e,&wide.replace("enum('live','new')","enum('live')"),2).unwrap();
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}
 seed(&mut e,"parents",json!({"id":"p"}));
 let next=wide.replace("  parent: parents on delete keep","  replacement: parents on delete keep")+"backfill children copy(parent: parents):\n  {replacement:parent}\n";
 let error=adopt(&mut e,&next,3).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");
}
#[test]
fn expired_unswept_source_cannot_extend_its_dropped_expiry() {
 let old="table items:\n  until: time\n  expire at .until\n  public 'fixture'\n  online only\n";
 for dormant in [false,true] {
  let mut e=engine(old);let r=wire::row_from_json(&e.schema().tables["items"],&json!({"id":"a","until":50})).unwrap();e.seed_at([("items".into(),r)],0).unwrap();
  if dormant {let(s,p)=compile("query empty():\n  return true\n");e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,1).unwrap();}
  let next=old.replace("  expire at .until\n","")+"backfill items prolong(until: time):\n  {until:until + 1d}\n";
  let error=adopt(&mut e,&next,3).unwrap_err().to_string();assert!(error.contains("historical lifetime"),"{error}");
 }
}

#[test]
fn absent_optional_output_is_not_a_native_image_with_missing_historical_inputs() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let next=old.replace("  n: int","  derived: int ?\n  n: int")+"backfill items absent(missing: int):\n  {derived:missing}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));let g=e.generation();
 let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("historical input items.missing"),"{error}");assert_eq!(g,e.generation());
}
#[test]
fn removal_of_last_opening_boundary_keeps_the_durable_retirement_floor() {
 let old="table items:\n  opens: time\n  until: time\n  n: int\n  not before .opens\n  expire at .until\n  public 'fixture'\n  online only\n";
 let next=old.replace("  not before .opens\n","").replace("  expire at .until\n","")+"backfill items twice(n: int):\n  {n:n * 2}\n";
 for requested in [1,100] {
  let(s,p)=compile(old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let r=wire::row_from_json(&e.schema().tables["items"],&json!({"id":"a","opens":0,"until":50,"n":3})).unwrap();e.seed_at([("items".into(),r)],0).unwrap();
  {let tx=e.store_mut().transaction().unwrap();tx.pin_time_audience_clock(100).unwrap();tx.commit().unwrap();}
  let(s,p)=compile(&next);e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,requested).unwrap();
  assert_eq!(e.store().count("items").unwrap(),0,"source deadline before persisted floor, requested={requested}");
 }
}

#[test]
fn a_new_named_declaration_transforms_existing_historical_inputs() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let twice=old.replace("  n: int","  doubled: int\n  n: int")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let triple=twice.replace("twice(n:","triple(n:").replace("n * 2","n * 3");
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&twice,2).unwrap();adopt(&mut e,old,1).unwrap();adopt(&mut e,&triple,3).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(9));
}
#[test]
fn dropped_required_and_optional_inputs_survive_active_table_reentry() {
 for kind in ["int","int ?"] {
  let old=format!("table items:\n  n: {kind}\n  public 'fixture'\n  online only\n");
  let next=old.replace(&format!("  n: {kind}"),"  doubled: int")+&format!("backfill items twice(n: {kind}):\n  {{doubled:(n ?? 0) * 2}}\n");
  let mut e=engine(&old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,"query empty():\n  return true\n",3).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6));
 }
}
#[test]
fn reentry_restores_shared_snapshots_for_arguments_and_point_reads() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let twice=old.to_owned()+"backfill items twice(n: int):\n  {n:n * 2}\n";
 for later in [false,true] {
  let copied=twice.replace("  n: int","  copied: int\n  lookedUp: int\n  n: int")+"backfill items copy(n: int, id: items):\n  {copied:n, lookedUp:(items[id] ! else NOT_FOUND).n}\n";
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));
  if later {adopt(&mut e,&twice,2).unwrap();}
  adopt(&mut e,&copied,3).unwrap();let expected=if later {6}else{3};
  assert_eq!(field(&mut e,"items","a","copied"),Value::Int(expected));
  adopt(&mut e,"query empty():\n  return true\n",4).unwrap();adopt(&mut e,&copied,3).unwrap();
  assert_eq!(field(&mut e,"items","a","n"),Value::Int(6));assert_eq!(field(&mut e,"items","a","copied"),Value::Int(expected));assert_eq!(field(&mut e,"items","a","lookedUp"),Value::Int(expected));
 }
}

#[test]
fn a_retained_transform_output_cannot_prove_native_origin() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let twice=old.replace("  n: int","  doubled: int\n  n: int")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let broken=twice.replace("twice(n: int)","other(missing: int)").replace("doubled:n * 2","doubled:missing");
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&twice,2).unwrap();adopt(&mut e,old,1).unwrap();
 let error=adopt(&mut e,&broken,3).unwrap_err().to_string();assert!(error.contains("historical input items.missing"),"{error}");
}

#[test]
fn partial_table_reentry_restores_carried_declarations_in_the_same_cohort() {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let old=parents.to_owned()+"table children:\n  parent: parents\n  public 'fixture'\n  online only\n";
 let parent_fill="backfill parents twice(n: int):\n  {n:n * 2}\n";
 let next=old.replace("  parent: parents","  copied: int\n  parent: parents")+parent_fill+"backfill children copy(parent: parents):\n  {copied:(parents[parent] ! else NOT_FOUND).n}\n";
 let mut e=engine(&old);seed(&mut e,"parents",json!({"id":"p","n":3}));seed(&mut e,"children",json!({"id":"c","parent":"p"}));adopt(&mut e,&next,2).unwrap();
 adopt(&mut e,&(parents.to_owned()+parent_fill),3).unwrap();adopt(&mut e,&next,2).unwrap();
 assert_eq!(field(&mut e,"parents","p","n"),Value::Int(6));assert_eq!(field(&mut e,"children","c","copied"),Value::Int(3));
}

#[test]
fn leaving_the_last_backfill_cannot_remove_an_ended_source_lifetime() {
 let old="table items:\n  n: int\n  until: time\n  public 'fixture'\n  online only\n";
 let next=old.replace("  until: time","  until: time\n  expire at .until")+"backfill items twice(n: int):\n  {n:n * 2}\n";
 for absent in [false,true] {
  let(s,p)=compile(old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let r=wire::row_from_json(&e.schema().tables["items"],&json!({"id":"a","n":3,"until":50})).unwrap();e.seed_at([("items".into(),r)],0).unwrap();
  let(s,p)=compile(&next);e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,1).unwrap();
  if absent {let(s,p)=compile("query empty():\n  return true\n");e.adopt_release_at(s,p,&ReleaseActivation::new(3,Some(2)),false,2).unwrap();}
  let previous=if absent {3}else{2};let(s,p)=compile(old);e.adopt_release_at(s,p,&ReleaseActivation::new(1,Some(previous)),false,100).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 }
}
#[test]
fn reentry_keeps_absence_distinct_from_a_later_default() {
 let old="table items:\n  public 'fixture'\n  online only\n";
 let next=old.replace("  public","  n: int default 100\n  public")+"backfill items one(n: int ?):\n  {n:(n ?? 0) + 1}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a"}));adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(1));
 adopt(&mut e,"query empty():\n  return true\n",3).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(1));
 adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","n"),Value::Int(1));
}
#[test]
fn active_reference_input_refresh_tracks_the_authorized_retargeted_lifetime() {
 for kind in ["parents","id"] {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let mutation="mutation retarget():\n  update children['c'] {parent:'q'}\n";
 let old=parents.to_owned()+"table children:\n  parent: parents on delete keep\n  public 'fixture'\n  update <- allow\n  online only\n"+mutation;
 let fill=format!("backfill children copy(parent: {kind}):\n  {{copied:(parents[parent] ! else NOT_FOUND).n}}\n");
 let next=old.replace("  parent: parents","  copied: int\n  parent: parents")+&fill;
 let dropped=next.replace("  parent: parents on delete keep\n","").replace(mutation,"");
 let mut e=engine(&old);for(id,n)in[("p",3),("q",9)]{seed(&mut e,"parents",json!({"id":id,"n":n}));}seed(&mut e,"children",json!({"id":"c","parent":"p"}));adopt(&mut e,&next,2).unwrap();write(&mut e,"retarget");adopt(&mut e,&dropped,3).unwrap();
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","q").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"q","n":77}));
 adopt(&mut e,parents,4).unwrap();let error=adopt(&mut e,&dropped,3).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");
}
}

#[test]
fn a_new_reference_output_keeps_its_parent_lifetime_when_the_row_narrows() {
 let old="table parents:\n  name: text <=10\n  unique name\n  public 'fixture'\n  online only\ntable children:\n  n: int 0..10\n  public 'fixture'\n  online only\n";
 let next=old.replace("  n: int 0..10","  link: parents\n  n: int 0..5")+"backfill children link():\n  {link:(parents[name = 'p'] ! else NOT_FOUND).id}\n";
 let mut e=engine(old);seed(&mut e,"parents",json!({"id":"p","name":"p"}));seed(&mut e,"children",json!({"id":"c","n":9}));adopt(&mut e,&next,2).unwrap();assert_eq!(e.store().count("children").unwrap(),0);
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"p","name":"p"}));
 adopt(&mut e,&next.replace("int 0..5","int 0..10"),3).unwrap();assert_eq!(e.store().count("children").unwrap(),0,"a retained output reference cannot recapture a reused parent");
}
#[test]
fn a_transformed_restored_row_keeps_its_new_cells_when_it_becomes_dormant_again() {
 let old="table parents:\n  n: int 0..10\n  public 'fixture'\n  online only\ntable children:\n  label: enum('a','b')\n  n: int\n  public 'fixture'\n  online only\n";
 let narrow=old.replace("enum('a','b')","enum('a')");
 let next=old.replace("  n: int 0..10","  n: int 0..5").replace("  label:","  link: parents\n  label:")+"backfill children migration(n: int):\n  {n:n * 2, link:(parents['p'] ! else NOT_FOUND).id}\n";
 let mut e=engine(old);seed(&mut e,"parents",json!({"id":"p","n":9}));seed(&mut e,"children",json!({"id":"c","label":"b","n":3}));adopt(&mut e,&narrow,2).unwrap();adopt(&mut e,&next,3).unwrap();assert_eq!(e.store().count("children").unwrap(),0);
 adopt(&mut e,&next.replace("int 0..5","int 0..10"),4).unwrap();assert_eq!(field(&mut e,"children","c","n"),Value::Int(6));
}

#[test]
fn native_images_survive_optional_missing_inputs_and_constant_backfills() {
 for optional in [false,true] {
  let old="table items:\n  n: int ?\n  public 'fixture'\n  online only\n";
  let next=old.replace("  n: int ?","  derived: int")+if optional {"backfill items derive(n: int ?):\n  {derived:(n ?? 0) * 2}\n"}else{"backfill items derive():\n  {derived:0}\n"};
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();seed(&mut e,"items",json!({"id":"native","derived":9}));
  adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","native","derived"),Value::Int(9));
  adopt(&mut e,"query empty():\n  return true\n",3).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","native","derived"),Value::Int(9));
 }
}
#[test]
fn invalid_present_inputs_never_qualify_as_native_missing_inputs() {
 let v2="table items:\n  n: bool\n  derived: int\n  public 'fixture'\n  online only\n";
 let old=v2.replace("  derived: int\n","");
 let next=v2.to_owned()+"backfill items derive(n: int, missing: int ?):\n  {derived:n + (missing ?? 0)}\n";
 let mut e=engine(v2);seed(&mut e,"items",json!({"id":"a","n":true,"derived":9}));adopt(&mut e,&old,1).unwrap();
 let error=adopt(&mut e,&next,3).unwrap_err().to_string();assert!(error.contains("historical input items.n"),"{error}");
}
#[test]
fn original_absence_survives_later_defaults_until_a_meaningful_input_edit() {
 let old="table items:\n  label: text <=10\n  public 'fixture'\n  update <- allow\n  online only\n";
 let fill="backfill items derive(n: int ?):\n  {derived:n ?? 0}\n";
 let next=old.replace("  label:","  derived: int\n  label:")+fill;
 let later=next.replace("  label:","  n: int default 100\n  label:")+"mutation edit(n: int):\n  update items['a'] {n}\nmutation label():\n  update items['a'] {label:'changed'}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","label":"old"}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,&later,3).unwrap();write(&mut e,"label");
 adopt(&mut e,"query empty():\n  return true\n",4).unwrap();adopt(&mut e,&later,3).unwrap();assert_eq!(field(&mut e,"items","a","derived"),Value::Int(0));
 for n in [200,100] {let r=e.mutate("edit",None,Context::new("alice",std::collections::BTreeMap::from([("n".into(),Value::Int(n))]))).unwrap();assert!(matches!(r.state,WriteState::Sent{..}),"{r:?}");}
 adopt(&mut e,"query empty():\n  return true\n",4).unwrap();adopt(&mut e,&later,3).unwrap();assert_eq!(field(&mut e,"items","a","derived"),Value::Int(100));
}

#[test]
fn a_new_declaration_name_does_not_inherit_another_native_definition() {
 let old="table items:\n  public 'fixture'\n  online only\n";
 let next=old.replace("  public","  derived: int\n  public")+"backfill items zero():\n  {derived:0}\n";
 let newer=next.replace("items zero()","items one()").replace("derived:0","derived:1");
 let mut e=engine(old);adopt(&mut e,&next,2).unwrap();seed(&mut e,"items",json!({"id":"native","derived":9}));adopt(&mut e,old,1).unwrap();adopt(&mut e,&newer,3).unwrap();assert_eq!(field(&mut e,"items","native","derived"),Value::Int(1));
}

#[test]
fn native_authored_outputs_survive_matching_inputs_and_refuse_changed_inputs() {
 let old="table items:\n  n: int\n  public 'fixture'\n  update <- allow\n  online only\nmutation edit():\n  update items['native'] {n:4}\n";
 let next=old.replace("  n: int","  derived: int\n  n: int")+"backfill items twice(n: int):\n  {derived:n * 2}\n";
 let mut e=engine(old);adopt(&mut e,&next,2).unwrap();seed(&mut e,"items",json!({"id":"native","n":3,"derived":9}));adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","native","derived"),Value::Int(9));
 adopt(&mut e,old,1).unwrap();write(&mut e,"edit");let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("native backfill inputs changed"),"{error}");
}

#[test]
fn backfill_source_expiry_applies_cascade_set_null_and_restrict_atomically() {
 for action in ["cascade","set null","restrict"] {for restored in [false,true] {
  let optional=if action=="set null" {" ?"}else{""};
  let old=format!("table parents:\n  until: time\n  expire at .until\n  public 'fixture'\n  online only\ntable children:\n  parent: parents{optional} on delete {action}\n  cap 4 by parent\n  public 'fixture'\n  online only\ntable items:\n  n: int\n  public 'fixture'\n  online only\n");
  let next=old.replace("table items:\n  n:","table items:\n  doubled: int\n  n:")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
  let(s,p)=compile(&old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let rows=[("parents",json!({"id":"p","until":50})),("children",json!({"id":"c","parent":"p"})),("items",json!({"id":"i","n":3}))];
  let rows=rows.into_iter().map(|(t,r)|(t.to_owned(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>();e.seed_at(rows,0).unwrap();
  if restored {let(s,p)=compile("table items:\n  n: int\n  public 'fixture'\n  online only\n");e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,1).unwrap();}
  let g=e.generation();let(s,p)=compile(&next);let result=e.adopt_release_at(s,p,&ReleaseActivation::new(3,Some(if restored {2}else{1})),false,100);
  if action=="restrict" {let error=result.unwrap_err().to_string();assert!(error.contains("source expiry")&&error.contains("restrict"),"{error}");assert_eq!(g,e.generation());assert!(row(&mut e,"items","i").field("doubled").is_err());}
  else {result.unwrap();assert_eq!(e.store().count("parents").unwrap(),0);if action=="cascade" {assert_eq!(e.store().count("children").unwrap(),0);}else{assert_eq!(field(&mut e,"children","c","parent"),Value::Null);}assert_eq!(field(&mut e,"items","i","doubled"),Value::Int(6));}
 }}
}
#[test]
fn reset_rebuilds_retained_schema_metadata_before_native_inserts_or_reseeding() {
 for reseed in [false,true] {
  let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
  let next=old.replace("  n: int","  derived: int\n  n: int")+"backfill items twice(n: int):\n  {derived:n * 2}\n";
  let mut e=engine(old);adopt(&mut e,&next,2).unwrap();
  let native=wire::row_from_json(&e.schema().tables["items"],&json!({"id":"native","n":3,"derived":9})).unwrap();
  e.dev_reset_at(if reseed {vec![("items".into(),native)]}else{vec![]},crate::now_ms()).unwrap();
  if !reseed {seed(&mut e,"items",json!({"id":"native","n":3,"derived":9}));}
  adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","native","derived"),Value::Int(9));
 }
}

#[test]
fn enum_replacement_accepts_original_preimages_and_preserves_native_outputs() {
 let old="table cues:\n  status: enum('standby','done')\n  public 'fixture'\n  online only\n";
 let second=old.replace("enum('standby','done')","enum('standby','complete','skipped')")+"backfill cues complete(status: enum('standby','done')):\n  {status:'complete' if status = 'done' else status}\n";
 let third=old.replace("enum('standby','done')","enum('standby','finished','skipped')")+"backfill cues finished(status: enum('standby','done','complete','skipped')):\n  {status:'finished' if status = 'done' or status = 'complete' else status}\n";
 let mut e=engine(old);seed(&mut e,"cues",json!({"id":"a","status":"done"}));adopt(&mut e,&second,2).unwrap();seed(&mut e,"cues",json!({"id":"native","status":"complete"}));
 adopt(&mut e,&third,3).unwrap();for id in ["a","native"]{assert_eq!(field(&mut e,"cues",id,"status"),Value::String("finished".into()));}
 adopt(&mut e,&second,2).unwrap();for id in ["a","native"]{assert_eq!(field(&mut e,"cues",id,"status"),Value::String("complete".into()));}
}

#[test]
fn retained_hidden_optional_inputs_are_used_when_reentering_a_backfill() {
 let old="table items:\n  n: int ?\n  public 'fixture'\n  online only\n";
 let next="table items:\n  derived: int\n  public 'fixture'\n  online only\nbackfill items twice(n: int ?):\n  {derived:(n ?? 0) * 2}\n";
 let bridge="table items:\n  public 'fixture'\n  online only\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,next,2).unwrap();assert_eq!(field(&mut e,"items","a","derived"),Value::Int(6));
 adopt(&mut e,old,1).unwrap();adopt(&mut e,bridge,3).unwrap();adopt(&mut e,next,2).unwrap();assert_eq!(field(&mut e,"items","a","derived"),Value::Int(6));
}
#[test]
fn source_expiry_observes_children_removed_in_the_same_release() {
 for action in ["cascade","set null","restrict"] {
  let optional=if action=="set null" {" ?"}else{""};
  let parent="table parents:\n  until: time\n  expire at .until\n  public 'fixture'\n  online only\n";
  let child=format!("table children:\n  parent: parents{optional} on delete {action}\n  cap 4 by parent\n  public 'fixture'\n  online only\n");
  let item="table items:\n  n: int\n  public 'fixture'\n  online only\n";
  let old=format!("{parent}{child}{item}");let next=format!("{parent}{}backfill items twice(n: int):\n  {{doubled:n * 2}}\n",item.replace("  n:","  doubled: int\n  n:"));
  let(s,p)=compile(&old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let rows=[("parents",json!({"id":"p","until":50})),("children",json!({"id":"c","parent":"p"})),("items",json!({"id":"i","n":3}))];
  let rows=rows.into_iter().map(|(t,r)|(t.to_owned(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>();e.seed_at(rows,0).unwrap();
  let(s,p)=compile(&next);let result=e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,100);
  if action=="restrict" {let error=result.unwrap_err().to_string();assert!(error.contains("restrict"),"{error}");assert_eq!(e.store().count("parents").unwrap(),1);}else{
   result.unwrap();assert_eq!(e.store().count("parents").unwrap(),0);
   let tx=e.store_mut().transaction().unwrap();let t=tx.with_sqlite(|sqlite| sqlite.num("children")).unwrap();
   let saved:Option<String>=(&tx).test_support_conn().query_row("SELECT data FROM _dormant_rows WHERE t=?1 AND id='c'",[t],|r|r.get(0)).optional().unwrap();
   if action=="cascade" {assert!(saved.is_none());}else{let saved:Value=serde_json::from_str(&saved.unwrap()).unwrap();assert_eq!(*saved.field("parent").unwrap(),Value::Null);}
  }
 }
}

#[test]
fn physically_sparse_defaults_are_interpreted_and_receipts_keep_that_interpretation() {
 for kind in ["int","int ?"] {
  let old="table items:\n  public 'fixture'\n  online only\n";
  let defaulted=old.replace("  public","  n: int default 3\n  public");
  let fill=format!("backfill items twice(n: {kind}):\n  {{doubled:(n ?? 0) * 2}}\n");
  let next=defaulted.replace("  n:","  doubled: int\n  n:")+&fill;
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a"}));adopt(&mut e,&defaulted,2).unwrap();
  assert!(row(&mut e,"items","a").field("n").is_err(),"fixture is physically sparse");
  adopt(&mut e,&next,3).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6));
  let later=next.replace("default 3","default 100");adopt(&mut e,&later,4).unwrap();adopt(&mut e,"query empty():\n  return true\n",5).unwrap();adopt(&mut e,&later,4).unwrap();
  assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6));
  let rollback=later.replace("  doubled: int\n","").replace(&fill,"");adopt(&mut e,&rollback,6).unwrap();adopt(&mut e,&later,4).unwrap();
  assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6),"rollback/forward keeps the original omitted-input interpretation");
 }
}

#[test]
fn saved_generic_id_binding_survives_type_erasure_and_multiple_restorations() {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let old=parents.to_owned()+"table children:\n  parent: parents on delete keep\n  public 'fixture'\n  online only\n";
 let next=old.replace("  parent:","  copied: int\n  parent:")+"backfill children copy(parent: id):\n  {copied:(parents[parent] ! else NOT_FOUND).n}\n";
 let erased=next.replace("parent: parents on delete keep","parent: id");
 let mut e=engine(&old);seed(&mut e,"parents",json!({"id":"p","n":3}));seed(&mut e,"children",json!({"id":"c","parent":"p"}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,&erased,3).unwrap();
 adopt(&mut e,parents,4).unwrap();adopt(&mut e,&erased,3).unwrap();adopt(&mut e,parents,4).unwrap();
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}
 seed(&mut e,"parents",json!({"id":"p","n":77}));let error=adopt(&mut e,&erased,3).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");
}

#[test]
fn reentering_omission_cohorts_do_not_change_a_new_declarations_source_snapshot() {
 let old="table items:\n  public 'fixture'\n  online only\n";
 let defaulted=old.replace("  public","  n: int default 3\n  public");
 let fill="backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let next=defaulted.replace("  n:","  doubled: int\n  n:")+fill;
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a"}));adopt(&mut e,&defaulted,2).unwrap();adopt(&mut e,&next,3).unwrap();
 let rollback=defaulted.replace("default 3","default 100");adopt(&mut e,&rollback,4).unwrap();
 let fresh=next.replace("default 3","default 100").replace("  doubled:","  fresh: int\n  doubled:")+"backfill items current(n: int):\n  {fresh:n * 2}\n";
 adopt(&mut e,&fresh,5).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6));assert_eq!(field(&mut e,"items","a","fresh"),Value::Int(200));
}

#[test]
fn set_null_expiry_updates_a_column_archived_during_that_release() {
 let parent="table parents:\n  until: time\n  expire at .until\n  public 'fixture'\n  online only\n";
 let child="table children:\n  parent: parents ? on delete set null\n  cap 4 by parent\n  public 'fixture'\n  online only\n";
 let item="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let old=format!("{parent}{child}{item}");let next=old.replace("  parent: parents ? on delete set null\n","").replace("  cap 4 by parent\n","").replace("  n:","  doubled: int\n  n:")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let(s,p)=compile(&old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
 let rows=[("parents",json!({"id":"p","until":50})),("children",json!({"id":"c","parent":"p"})),("items",json!({"id":"i","n":3}))];
 let rows=rows.into_iter().map(|(t,r)|(t.to_owned(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>();e.seed_at(rows,0).unwrap();
 let(s,p)=compile(&next);e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,100).unwrap();assert_eq!(e.store().count("parents").unwrap(),0);
 let fresh=wire::row_from_json(&e.schema().tables["parents"],&json!({"id":"p","until":500})).unwrap();e.seed_at([("parents".into(),fresh)],100).unwrap();
 let(s,p)=compile(&old);e.adopt_release_at(s,p,&ReleaseActivation::new(1,Some(2)),false,101).unwrap();assert_eq!(field(&mut e,"children","c","parent"),Value::Null);
}

#[test]
fn inactive_generic_id_receipts_refuse_a_reused_parent_before_any_lookup() {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let old=parents.to_owned()+"table children:\n  parent: parents on delete keep\n  public 'fixture'\n  online only\n";
 let fill="backfill children copy(parent: id):\n  {copied:(parents[parent] ! else NOT_FOUND).n}\n";
 let next=old.replace("  parent:","  copied: int\n  parent:")+fill;let erased=next.replace("parent: parents on delete keep","parent: id");
 let without=erased.replace(fill,"").replace("  copied: int\n","");
 let mut e=engine(&old);seed(&mut e,"parents",json!({"id":"p","n":3}));seed(&mut e,"children",json!({"id":"c","parent":"p"}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,&erased,3).unwrap();adopt(&mut e,&without,4).unwrap();
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"p","n":77}));
 let generation=e.generation();let error=adopt(&mut e,&erased,3).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");assert_eq!(e.generation(),generation);
}
#[test]
fn historical_lifetime_outputs_refuse_before_transforming_or_retiring_children() {
 for action in ["cascade","set null","restrict"] {
  let optional=if action=="set null" {" ?"}else{""};
  let old=format!("table parents:\n  until: time\n  expire at .until\n  public 'fixture'\n  online only\ntable children:\n  parent: parents{optional} on delete {action}\n  cap 4 by parent\n  public 'fixture'\n  online only\n");
  let next=old.replace("  expire at .until\n","")+"backfill parents shorten(until: time):\n  {until:until - 1d}\n";
  let(s,p)=compile(&old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let rows=[("parents",json!({"id":"p","until":500})),("children",json!({"id":"c","parent":"p"}))];let rows=rows.into_iter().map(|(t,r)|(t.to_owned(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>();e.seed_at(rows,0).unwrap();
  let generation=e.generation();let(s,p)=compile(&next);let error=e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,100).unwrap_err().to_string();assert!(error.contains("historical lifetime"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(field(&mut e,"parents","p","until"),Value::Int(500));assert_eq!(e.store().count("children").unwrap(),1);
 }
}
#[test]
fn computed_text_minimum_and_format_failures_refuse_the_whole_adoption() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 for (kind,value,reason) in [("text 2..30","' '","non-whitespace"),("text 2..30 format handle","'Not A Handle'","handle"),("text <=80 format email","'bad@@example.test'","email")] {
  let next=old.replace("  n:",&format!("  label: {kind}\n  n:"))+&format!("backfill items label():\n  {{label:{value}}}\n");
  let mut e=engine(old);for id in ["a","b"]{seed(&mut e,"items",json!({"id":id,"n":3}));}let generation=e.generation();let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains(reason)&&error.contains("2 affected rows"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(e.store().count("items").unwrap(),2);assert!(row(&mut e,"items","a").field("label").is_err());
 }
}

#[test]
fn widened_narrowed_rows_capture_their_original_reference_argument_types() {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let old=parents.to_owned()+"table children:\n  parent: parents on delete keep\n  n: int 0..10\n  public 'fixture'\n  online only\n";
 let narrow=old.replace("parent: parents on delete keep","parent: id").replace("int 0..10","int 0..5");
 let wide=narrow.replace("int 0..5","int 0..10").replace("  parent: id","  copied: int\n  parent: id")+"backfill children copy(parent: id):\n  {copied:(parents[parent] ! else NOT_FOUND).n}\n";
 let mut e=engine(&old);seed(&mut e,"parents",json!({"id":"p","n":3}));seed(&mut e,"children",json!({"id":"c","parent":"p","n":9}));adopt(&mut e,&narrow,2).unwrap();assert_eq!(e.store().count("children").unwrap(),0);adopt(&mut e,&wide,3).unwrap();assert_eq!(field(&mut e,"children","c","copied"),Value::Int(3));
 adopt(&mut e,parents,4).unwrap();let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"p","n":77}));
 let error=adopt(&mut e,&wide,3).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");
}
#[test]
fn widened_narrowed_rows_cannot_rewrite_their_original_lifetime_fields() {
 for (clause,field,value) in [("expire at .until","until",500),("not before .opens","opens",0)] {
  let old=format!("table items:\n  n: int 0..10\n  {field}: time\n  {clause}\n  public 'fixture'\n  online only\n");
  let narrow=old.replace("int 0..10","int 0..5").replace(&format!("  {clause}\n"),"");
  let next=narrow.replace("int 0..5","int 0..10")+&format!("backfill items move({field}: time):\n  {{{field}:{field} + 1d}}\n");
  let(s,p)=compile(&old);let mut e=Engine::new_release_prepared_at(Store::memory().unwrap(),s,p,&ReleaseActivation::new(1,None),false,0).unwrap();
  let input=wire::row_from_json(&e.schema().tables["items"],&json!({"id":"a","n":9,field:value})).unwrap();e.seed_at([("items".into(),input)],0).unwrap();
  let(s,p)=compile(&narrow);e.adopt_release_at(s,p,&ReleaseActivation::new(2,Some(1)),false,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
  let(s,p)=compile(&next);let error=e.adopt_release_at(s,p,&ReleaseActivation::new(3,Some(2)),false,2).unwrap_err().to_string();assert!(error.contains("historical lifetime"),"{error}");assert_eq!(e.store().count("items").unwrap(),0);
 }
}

#[test]
fn returning_narrowed_rows_interpret_columns_added_by_later_predecessors() {
 let old="table items:\n  rank: int 0..10\n  public 'fixture'\n  online only\n";
 let narrow=old.replace("int 0..10","int 0..5");let defaulted=narrow.replace("  rank:","  n: int default 3\n  rank:");
 let next=defaulted.replace("int 0..5","int 0..10").replace("  n:","  doubled: int\n  n:")+"backfill items twice(n: int):\n  {doubled:n * 2}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","rank":9}));adopt(&mut e,&narrow,2).unwrap();adopt(&mut e,&defaulted,3).unwrap();adopt(&mut e,&next,4).unwrap();assert_eq!(field(&mut e,"items","a","doubled"),Value::Int(6));
}

#[test]
fn restored_output_cells_keep_preimages_across_rollback_and_table_suspension() {
 for kind in ["int","int ?"] {
  let old=format!("table items:\n  n: int\n  score: {kind}\n  public 'fixture'\n  online only\n");
  let dropped=old.replace(&format!("  score: {kind}\n"),"");let next=old.clone()+"backfill items score(n: int):\n  {score:n * 2}\n";
  let mut e=engine(&old);seed(&mut e,"items",json!({"id":"a","n":3,"score":7}));adopt(&mut e,&dropped,2).unwrap();adopt(&mut e,&next,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(6));
  adopt(&mut e,&old,1).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(7));adopt(&mut e,&next,3).unwrap();
  adopt(&mut e,"query empty():\n  return true\n",4).unwrap();adopt(&mut e,&old,1).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(7));adopt(&mut e,&next,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(6));
 }
}
#[test]
fn replacing_added_output_mappings_restores_each_version_instead_of_a_default() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let twice=old.replace("  n:","  score: int default 0\n  n:")+"backfill items twice(n: int):\n  {score:n * 2}\n";let triple=twice.replace("twice(n:","triple(n:").replace("n * 2","n * 3");
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&twice,2).unwrap();adopt(&mut e,&triple,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(9));
 adopt(&mut e,&twice,2).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(6));adopt(&mut e,&triple,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(9));
}

#[test]
fn partially_hidden_transformed_fields_resume_their_version_and_undo_on_plain_return() {
 let old="table items:\n  n: int\n  score: int\n  other: int\n  public 'fixture'\n  update <- allow\n  online only\n";
 let fill="backfill items pair(n: int):\n  {score:n * 2,other:n * 3}\n";
 let next=old.to_owned()+fill+"mutation edit():\n  update items['a'] {score:11}\n";
 let hidden=old.replace("  score: int\n","");
 for edited in [false,true] {
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3,"score":7,"other":8}));adopt(&mut e,&next,2).unwrap();if edited {write(&mut e,"edit");}
  adopt(&mut e,&hidden,3).unwrap();assert_eq!(field(&mut e,"items","a","other"),Value::Int(8));adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(if edited {11}else{6}));assert_eq!(field(&mut e,"items","a","other"),Value::Int(9));
  adopt(&mut e,&hidden,3).unwrap();
  if edited {adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(11));}
  else {adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(7));}
 }
}
#[test]
fn newly_transformed_reference_cells_keep_binding_when_the_old_row_definition_lacked_them() {
 let parents="table parents:\n  name: text <=10\n  n: int\n  unique name\n  public 'fixture'\n  online only\n";
 let old=parents.to_owned()+"table children:\n  rank: int 0..10\n  public 'fixture'\n  online only\n";
 let link="backfill children link():\n  {link:(parents[name = 'p'] ! else NOT_FOUND).id}\n";
 let narrow=old.replace("  rank:","  link: parents\n  rank:").replace("int 0..10","int 0..5")+link;
 let erased=narrow.replace("  link: parents","  link: id");let wide=erased.replace("int 0..5","int 0..10").replace("  rank:","  copied: int\n  rank:")+"backfill children copy(link: id):\n  {copied:(parents[link] ! else NOT_FOUND).n}\n";
 let mut e=engine(&old);seed(&mut e,"parents",json!({"id":"p","name":"p","n":3}));seed(&mut e,"children",json!({"id":"c","rank":9}));adopt(&mut e,&narrow,2).unwrap();adopt(&mut e,&erased,3).unwrap();adopt(&mut e,&wide,4).unwrap();assert_eq!(field(&mut e,"children","c","copied"),Value::Int(3));
 adopt(&mut e,parents,5).unwrap();let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"p","name":"p","n":77}));
 let error=adopt(&mut e,&wide,4).unwrap_err().to_string();assert!(error.contains("parent lifetime"),"{error}");
}

#[test]
fn inverse_absence_does_not_reuse_a_restored_output_cell_or_its_default() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let first=old.replace("  n:","  score: int default 10\n  n:")+"backfill items first(n: int):\n  {score:n * 2}\n";
 let second=old.replace("  n:","  score: int default 10\n  n:")+"backfill items second(score: int ?):\n  {score:(score ?? 0) + 1}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&first,2).unwrap();adopt(&mut e,old,1).unwrap();adopt(&mut e,&second,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(1));
 let plain=old.replace("  n:","  score: int default 10\n  n:");adopt(&mut e,&plain,4).unwrap();adopt(&mut e,&second,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(1));
 adopt(&mut e,"query empty():\n  return true\n",5).unwrap();adopt(&mut e,&second,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(1));
 adopt(&mut e,&plain,4).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(10));
}
#[test]
fn existing_later_cohorts_see_replayed_earlier_values_after_old_release_writes() {
 let old="table items:\n  n: int\n  public 'fixture'\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {n:4}\n";
 let first=old.replace("  n:","  score: int\n  n:")+"backfill items first(n: int):\n  {score:n * 2}\n";
 let second=first.replace("  n:","  copied: int\n  n:")+"backfill items second(score: int):\n  {copied:score}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&first,2).unwrap();adopt(&mut e,&second,3).unwrap();assert_eq!(field(&mut e,"items","a","copied"),Value::Int(6));
 adopt(&mut e,old,1).unwrap();write(&mut e,"edit");adopt(&mut e,&second,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(8));assert_eq!(field(&mut e,"items","a","copied"),Value::Int(8));
}

#[test]
fn replacement_lookups_share_the_inverse_absence_view_of_direct_arguments() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";
 let first=old.replace("  n:","  score: int default 10\n  n:")+"backfill items first(n: int):\n  {score:n * 2}\n";
 let second=old.replace("  n:","  score: int default 10\n  direct: int\n  copied: int\n  n:")+"backfill items second(score: int ?):\n  {score:1,direct:score ?? 0,copied:(items['a'] ! else NOT_FOUND).score ?? 0}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&first,2).unwrap();adopt(&mut e,&second,3).unwrap();
 assert_eq!(field(&mut e,"items","a","direct"),Value::Int(0));assert_eq!(field(&mut e,"items","a","copied"),Value::Int(0));
}
#[test]
fn pruned_suspended_output_preimages_refuse_plain_reexposure() {
 let old="table items:\n  n: int\n  score: int ?\n  public 'fixture'\n  online only\n";
 let next=old.to_owned()+"backfill items twice(n: int):\n  {score:n * 2}\n";
 let hidden=old.replace("  score: int ?\n","");let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3,"score":7}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,&hidden,3).unwrap();
 e.store_mut().prune_dormant(true,None).unwrap();let generation=e.generation();let error=adopt(&mut e,old,1).unwrap_err().to_string();assert!(error.contains("explicitly pruned"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(e.store().count("items").unwrap(),1);
}

#[test]
fn declaration_names_keep_their_meaning_after_table_or_declaration_gaps() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";let first=old.to_owned()+"backfill items double(n: int):\n  {n:n * 2}\n";let changed=first.replace("n * 2","n * 3");
 for gap in [old,"query empty():\n  return true\n"] {let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&first,2).unwrap();adopt(&mut e,gap,3).unwrap();let generation=e.generation();let error=adopt(&mut e,&changed,4).unwrap_err().to_string();assert!(error.contains("changed historical meaning"),"{error}");assert_eq!(e.generation(),generation);}
}
#[test]
fn reentering_a_same_column_transform_refuses_edits_to_its_reversed_view() {
 let old="table items:\n  n: int\n  score: int default 7\n  public 'fixture'\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {score:11}\n";
 let next=old.to_owned()+"backfill items twice(n: int):\n  {score:n * 2}\n";
 for sparse in [false,true] {let mut e=engine(old);seed(&mut e,"items",if sparse{json!({"id":"a","n":3})}else{json!({"id":"a","n":3,"score":7})});adopt(&mut e,&next,2).unwrap();adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();adopt(&mut e,old,1).unwrap();write(&mut e,"edit");let generation=e.generation();let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("changed while backfill"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(field(&mut e,"items","a","score"),Value::Int(11));}
}

#[test]
fn partial_output_suspension_keeps_original_absence_distinct_from_rollback_default() {
 let old="table items:\n  n: int\n  public 'fixture'\n  online only\n";let plain=old.replace("  n:","  score: int default 10\n  n:");let next=plain.clone()+"backfill items increment(score: int ?):\n  {score:(score ?? 0) + 1}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(1));adopt(&mut e,&plain,3).unwrap();adopt(&mut e,&next,2).unwrap();adopt(&mut e,old,1).unwrap();adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(1));adopt(&mut e,&plain,3).unwrap();assert_eq!(field(&mut e,"items","a","score"),Value::Int(10));
}

#[test]
fn pruned_disjoint_history_does_not_block_an_unchanged_native_output() {
 let plain="table items:\n  n: int\n  a: int\n  b: int\n  public 'fixture'\n  online only\n";
 let g="backfill items g(n: int):\n  {b:n * 2}\n";let f="backfill items f(n: int):\n  {a:n * 3}\n";let mut e=engine(&(plain.to_owned()+g));seed(&mut e,"items",json!({"id":"a","n":3,"a":0,"b":42}));
 adopt(&mut e,&(plain.to_owned()+g+f),2).unwrap();e.store_mut().prune_dormant(true,None).unwrap();adopt(&mut e,&(plain.to_owned()+f),3).unwrap();adopt(&mut e,&(plain.to_owned()+f+g),4).unwrap();assert_eq!(field(&mut e,"items","a","b"),Value::Int(42));assert_eq!(field(&mut e,"items","a","a"),Value::Int(9));
}

#[test]
fn reentry_protects_manual_edits_after_an_absent_preimage_materialized_as_a_default() {
 let old="table items:\n  n: int\n  public 'fixture'\n  update <- allow\n  online only\n";
 for default in ["int default 10","int ?"] {
  let plain=old.replace("  n:",&format!("  score: {default}\n  n:"))+"mutation edit():\n  update items['a'] {score:11,n:4}\n";
  let next=plain.clone()+"backfill items twice(n: int):\n  {score:n * 2}\n";let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":3}));adopt(&mut e,&next,2).unwrap();adopt(&mut e,&plain,3).unwrap();adopt(&mut e,&next,2).unwrap();adopt(&mut e,&plain,3).unwrap();write(&mut e,"edit");let generation=e.generation();let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("changed while backfill"),"{error}");assert_eq!(e.generation(),generation);assert_eq!(field(&mut e,"items","a","score"),Value::Int(11));
 }
}
#[test]
fn activation_admits_complete_reversal_evidence_before_committing_the_migration() {
 let old="table items:\n  source: text <=100000\n  public 'fixture'\n  online only\n";
 let next=old.replace("  source:","  first: text <=100000\n  second: text <=100000\n  source:")+"backfill items copies(source: text <=100000):\n  {first:source,second:source}\n";
 for size in [30000,100000] {let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","source":"x".repeat(size)}));let generation=e.generation();let result=adopt(&mut e,&next,2);
  if size==30000 {result.unwrap();adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","source"),Value::String("x".repeat(size)));}
  else {let error=result.unwrap_err().to_string();assert!(error.contains("evidence")&&error.contains("budget"),"{error}");assert_eq!(e.generation(),generation);assert!(row(&mut e,"items","a").field("first").is_err());assert_ne!((&e.store()).test_support_meta("version").unwrap().as_deref(),Some(super::backfills::VERSION));}
 }
}

#[test]
fn declared_down_projection_restores_only_native_cells_and_refuses_older_edits() {
 let old="table items:\n  reason: text <=40\n  note: int\n  public 'fixture'\n  update <- allow\n  online only\nmutation note():\n  update items['a'] {note:2}\nmutation reason():\n  update items['a'] {reason:'changed'}\n";
 let current="table items:\n  label: text <=40\n  note: int\n  public 'fixture'\n  update <- allow\n  online only\nmutation label():\n  update items['a'] {label:'updated'}\ndown items legacyReason(label: text <=40):\n  {reason:label}\n";
 let mut e=engine(current);seed(&mut e,"items",json!({"id":"a","label":"native","note":1}));
 adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","reason"),Value::String("native".into()));
 write(&mut e,"note");adopt(&mut e,current,2).unwrap();
 assert_eq!(field(&mut e,"items","a","label"),Value::String("native".into()));assert_eq!(field(&mut e,"items","a","note"),Value::Int(2));assert!(row(&mut e,"items","a").field("reason").is_err());
 write(&mut e,"label");adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","reason"),Value::String("updated".into()));
 write(&mut e,"reason");let generation=e.generation();
 let error=adopt(&mut e,current,2).unwrap_err().to_string();assert!(error.contains("changed while the older release"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn declared_down_projection_replaces_retained_null_but_preserves_retained_text() {
 let old="table items:\n  label: text <=40\n  reason: text <=40 ?\n  public 'fixture'\n  online only\n";
 let current="table items:\n  label: text <=40\n  public 'fixture'\n  online only\ndown items legacyReason(label: text <=40):\n  {reason:label}\n";
 let mut e=engine(old);
 seed(&mut e,"items",json!({"id":"null","label":"projected","reason":null}));
 seed(&mut e,"items",json!({"id":"text","label":"ignored","reason":"retained"}));
 adopt(&mut e,current,2).unwrap();adopt(&mut e,old,1).unwrap();
 assert_eq!(field(&mut e,"items","null","reason"),Value::String("projected".into()));
 assert_eq!(field(&mut e,"items","text","reason"),Value::String("retained".into()));
 adopt(&mut e,current,2).unwrap();
 let tx=e.store_mut().transaction().unwrap();let t=tx.with_sqlite(|sqlite| sqlite.num("items")).unwrap();
 let retained_null:bool=(&tx).test_support_conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=?1 AND id='null' AND column_name='reason' AND data=?2)",rusqlite::params![t,crate::value::canonical_json(&Value::Null)],|r|r.get(0)).unwrap();
 assert!(retained_null,"forward restores the physical null preimage before archiving it again");tx.rollback().unwrap();
}

#[test]
fn an_incompatible_down_result_becomes_narrowed_and_forward_restores_its_exact_native_value() {
 let current="table items:\n  count: int 0..1000\n  public 'fixture'\n  online only\ndown items legacyCount(count: int 0..1000):\n  {count:-1}\n";
 let old="table items:\n  count: int 1..1000\n  public 'fixture'\n  online only\n";
 let mut e=engine(current);seed(&mut e,"items",json!({"id":"a","count":10}));
 adopt(&mut e,old,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,current,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(10));
}

#[test]
fn declared_down_projection_does_not_introduce_an_output_absent_from_the_selected_schema() {
 let current="table items:\n  label: text <=40\n  public 'fixture'\n  online only\ndown items legacyReason(label: text <=40):\n  {reason:label}\n";
 let target="table items:\n  label: text <=40\n  public 'fixture'\n  online only\n";
 let mut e=engine(current);seed(&mut e,"items",json!({"id":"a","label":"native"}));
 adopt(&mut e,target,2).unwrap();
 assert_eq!(field(&mut e,"items","a","label"),Value::String("native".into()));
 assert!(row(&mut e,"items","a").field("reason").is_err());
}

#[test]
fn a_multi_output_down_projection_applies_only_the_selected_targets_subset() {
 let current="table items:\n  label: text <=40\n  public 'fixture'\n  online only\ndown items legacy(label: text <=40):\n  {reason:label, legacyNote:label}\n";
 let target="table items:\n  label: text <=40\n  reason: text <=40 ?\n  public 'fixture'\n  online only\n";
 let mut e=engine(current);seed(&mut e,"items",json!({"id":"a","label":"native"}));
 adopt(&mut e,target,2).unwrap();
 assert_eq!(field(&mut e,"items","a","reason"),Value::String("native".into()));
 assert!(row(&mut e,"items","a").field("legacyNote").is_err());
}

#[test]
fn unrelated_forward_receipts_do_not_suppress_a_disjoint_down_projection() {
 let old="table items:\n  label: text <=40\n  n: int\n  reason: text <=40 ?\n  public 'fixture'\n  online only\n";
 let current="table items:\n  label: text <=40\n  n: int\n  score: int\n  public 'fixture'\n  online only\nbackfill items score(n: int):\n  {score:n * 2}\ndown items legacyReason(label: text <=40):\n  {reason:label}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","label":"projected","n":3,"reason":null}));
 adopt(&mut e,current,2).unwrap();adopt(&mut e,old,1).unwrap();
 assert_eq!(field(&mut e,"items","a","reason"),Value::String("projected".into()));
}

#[test]
fn overlapping_down_outputs_are_rejected() {
 let source="table items:\n  label: text <=40\n  public 'fixture'\n  online only\ndown items one(label: text <=40):\n  {reason:label}\ndown items two(label: text <=40):\n  {reason:label}\n";
 let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
 assert!(b.diagnostics.iter().any(|d|d.message.contains("overlap")),"{:?}",b.diagnostics);
}

#[test]
fn identical_type_column_rename_carries_historical_and_native_rows_both_ways() {
 let old="table items:\n  title: text <=40\n  public 'fixture'\n  online only\n";
 let current="table items:\n  name: text <=40 renamed from title\n  public 'fixture'\n  online only\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"old","title":"historical"}));adopt(&mut e,current,2).unwrap();
 assert_eq!(field(&mut e,"items","old","name"),Value::String("historical".into()));
 seed(&mut e,"items",json!({"id":"new","name":"native"}));adopt(&mut e,old,1).unwrap();
 assert_eq!(field(&mut e,"items","old","title"),Value::String("historical".into()));assert_eq!(field(&mut e,"items","new","title"),Value::String("native".into()));
 adopt(&mut e,current,2).unwrap();
 assert_eq!(field(&mut e,"items","old","name"),Value::String("historical".into()));assert_eq!(field(&mut e,"items","new","name"),Value::String("native".into()));
}

#[test]
fn column_rename_refuses_different_declared_types_even_when_present_values_fit_both() {
 let old="table items:\n  title: text <=40\n  public 'fixture'\n  online only\n";
 let current="table items:\n  name: text <=80 renamed from title\n  public 'fixture'\n  online only\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","title":"fits"}));
 let error=adopt(&mut e,current,2).unwrap_err().to_string();assert!(error.contains("identical old and new cell types"),"{error}");
 let mut e=engine(current);seed(&mut e,"items",json!({"id":"a","name":"fits"}));
 let error=adopt(&mut e,old,1).unwrap_err().to_string();assert!(error.contains("identical old and new cell types"),"{error}");
}

#[test]
fn column_rename_rejects_nonasset_collection_types_before_adoption() {
 for declaration in [
  "table items:\n  tags: [text <=20] <=5 renamed from legacyTags\n  public 'fixture'\n  online only\n",
 ] {
  let bound=snapback4_lang::compile(&[("schema.q".into(),declaration.into())]);
  assert!(bound.diagnostics.iter().any(|d|d.message.contains("authoritative scalar")),"{:?}",bound.diagnostics);
  assert!(bound.schema.downfills.is_empty());assert!(bound.schema.backfills.is_empty());
 }
}

#[test]
fn down_reads_the_newer_snapshot_before_forward_preimages_are_reversed(){
 let old="table docs:\n  n: int\n  reason: int ?\n  public\n  online only\ntable sources:\n  m: int\n  public\n  online only\n";
 let new=old.replace("  reason: int ?\n","")+"backfill docs double(n: int): {n:n * 2}\nbackfill sources triple(m: int): {m:m * 3}\ndown docs oldReason(n: int): {reason:n + (sources['s'] ! else MISSING).m}\n";
 let mut e=engine(old);seed(&mut e,"docs",json!({"id":"d","n":3,"reason":null}));seed(&mut e,"sources",json!({"id":"s","m":4}));
 for _ in 0..2 {
  adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"docs","d","n"),Value::Int(6));assert_eq!(field(&mut e,"sources","s","m"),Value::Int(12));
  adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"docs","d","n"),Value::Int(3));assert_eq!(field(&mut e,"sources","s","m"),Value::Int(4));assert_eq!(field(&mut e,"docs","d","reason"),Value::Int(18));
 }
}

#[test]
fn down_outputs_restore_native_inputs_independently_of_declaration_order(){
 let old="table items:\n  count: int\n  other: int\n  public\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {count:8}\n";
 let a="down items first(count: int): {count:count - 1}\n";
 let b="down items second(count: int, other: int): {other:count + other}\n";
 for declarations in [format!("{a}{b}"),format!("{b}{a}")] {
  let current=format!("{old}{declarations}");let mut e=engine(&current);
  seed(&mut e,"items",json!({"id":"a","count":10,"other":20}));
  for _ in 0..2 {
   adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(9));assert_eq!(field(&mut e,"items","a","other"),Value::Int(30));
   adopt(&mut e,&current,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(10));assert_eq!(field(&mut e,"items","a","other"),Value::Int(20));
  }
  adopt(&mut e,old,1).unwrap();write(&mut e,"edit");let generation=e.generation();
  assert!(adopt(&mut e,&current,2).unwrap_err().to_string().contains("changed while the older release"));assert_eq!(generation,e.generation());
 }
}

#[test]
fn first_column_rename_refuses_a_conflicting_present_or_retained_destination(){
 let old="table items:\n  title: text <=40\n  name: text <=40\n  public\n  online only\n";
 let current="table items:\n  name: text <=40 renamed from title\n  public\n  online only\n";
 for dormant in [false,true] {for identical in [false,true] {
  let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","title":"A","name":if identical {"A"}else{"B"}}));
  if dormant {adopt(&mut e,&old.replace("  name: text <=40\n",""),2).unwrap();}
  let generation=e.generation();let outcome=adopt(&mut e,current,3);
  if identical {outcome.unwrap();assert_eq!(field(&mut e,"items","a","name"),Value::String("A".into()));}
  else {let error=outcome.unwrap_err().to_string();assert!(error.contains("rename destination"),"{error}");assert_eq!(generation,e.generation());}
 }}
}

#[test]
fn each_rollback_captures_the_latest_native_write_even_for_a_constant_projection(){
 let old="table items:\n  count: int\n  public\n  update <- allow\n  online only\nmutation edit(value: int):\n  update items['a'] {count:value}\n";
 let current=format!("{old}down items legacy(): {{count:0}}\n");
 let mut e=engine(&current);seed(&mut e,"items",json!({"id":"a","count":10}));
 for expected in [10,20,30] {
  if expected!=10 {let mut context=Context::system();context.args.insert("value".into(),Value::Int(expected));let result=e.mutate("edit",None,context).unwrap();assert!(matches!(result.state,WriteState::Sent{..}),"{result:?}");}
  adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
  adopt(&mut e,&current,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(expected));
 }
}

#[test]
fn forward_down_validation_preserves_absent_optional_null_despite_an_insert_default(){
 let base="table items:\n  count: int\n  public\n  online only\n";
 let old=base.replace("  count: int", "  x: int ? default 7\n  count: int");
 let current=format!("{old}down items legacy(x: int ?): {{count:x ?? 0}}\n");
 let mut e=engine(base);seed(&mut e,"items",json!({"id":"a","count":10}));
 adopt(&mut e,&old,2).unwrap();assert!(row(&mut e,"items","a").field("x").is_err());
 for _ in 0..2 {
  adopt(&mut e,&current,3).unwrap();adopt(&mut e,&old,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
  adopt(&mut e,&current,3).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(10));assert!(row(&mut e,"items","a").field("x").is_err());
 }
}

#[test]
fn already_narrowed_rows_keep_down_patches_and_native_restoration_through_later_narrowing(){
 let a="table items:\n  count: int 0..10\n  public\n  online only\n";
 let b=a.replace("int 0..10","int 1..10")+"down items legacy(): {count:-1}\n";
 let c=b.replace("int 1..10","int 0..10");
 for first_return in [&c,&b] {
  let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","count":0}));
  adopt(&mut e,&b,2).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
  adopt(&mut e,a,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
  adopt(&mut e,first_return,3).unwrap();
  if first_return==&b {assert_eq!(e.store().count("items").unwrap(),0);}
  adopt(&mut e,&c,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
  for _ in 0..2 {adopt(&mut e,a,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);adopt(&mut e,&c,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));}
 }
}

#[test]
fn new_down_declarations_mark_already_narrowed_rows_when_their_owned_images_are_assembled(){
 let a="table items:\n  count: int 0..10\n  public\n  online only\n";
 let b=a.replace("int 0..10","int 1..10");
 let c=format!("{b}down items legacy(): {{count:-1}}\n");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","count":0}));
 adopt(&mut e,&b,2).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&c,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,a,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0,"the declared -1 old view remains dormant instead of exposing the earlier 0");
 let wide=c.replace("int 1..10","int 0..10");adopt(&mut e,&wide,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
}

#[test]
fn same_typed_down_outputs_enter_narrowing_even_without_any_prior_dormant_row(){
 let old="table items:\n  count: int 0..10\n  public\n  online only\n";
 let new=format!("{old}down items legacy(): {{count:-1}}\n");
 let mut e=engine(&new);seed(&mut e,"items",json!({"id":"a","count":5}));
 for _ in 0..2 {adopt(&mut e,old,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);adopt(&mut e,&new,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));}
}

#[test]
fn r8_an_unrestored_down_receipt_keeps_its_native_preimage_when_a_different_column_still_hides_it(){
 let a="table items:\n  count: int 0..10\n  gate: int 0..10\n  public\n  online only\n";
 let b=format!("{a}down items legacy(): {{count:-1}}\n");let c=b.replace("gate: int 0..10","gate: int 1..10");
 let mut e=engine(&b);seed(&mut e,"items",json!({"id":"a","count":5,"gate":0}));
 adopt(&mut e,a,1).unwrap();adopt(&mut e,&c,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,a,1).unwrap();adopt(&mut e,&b,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));
}

#[test]
fn r8_forward_inverse_updates_a_preexisting_narrowed_archive(){
 let a="table items:\n  count: int\n  gate: int 0..10\n  public\n  online only\n";
 let fill="backfill items up(count: int): {count:count + 1}\n";
 let b=a.replace("gate: int 0..10","gate: int 1..10")+fill;
 let c=a.replace("count: int\n","count: int 1..10\n");let d=format!("{a}{fill}");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","count":0,"gate":0}));
 adopt(&mut e,&b,2).unwrap();adopt(&mut e,&c,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&d,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(1));
}

#[test]
fn r8_dormant_cell_overlay_keeps_the_down_result_until_receipt_verification(){
 let a="table items:\n  x: int 0..10 ?\n  gate: int 0..10\n  public\n  online only\n";
 let down="down items legacy(): {x:-1}\n";
 let b=a.replace("  x: int 0..10 ?\n","").replace("gate: int 0..10","gate: int 1..10")+down;
 let c=format!("{a}{down}");let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","x":null,"gate":0}));
 adopt(&mut e,&b,2).unwrap();adopt(&mut e,a,1).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&c,3).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Null);
}

#[test]
fn r8_interacting_down_receipts_interpret_exact_native_absence_as_optional_null(){
 let a="table items:\n  y: int\n  public\n  online only\n";
 let b=a.replace("  y: int","  x: int ?\n  y: int");
 let first="down items first(): {x:1}\n";let second="down items second(x: int ?): {y:x ?? 0}\n";
 for declarations in [format!("{first}{second}"),format!("{second}{first}")] {
  let c=format!("{b}{declarations}");let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","y":10}));adopt(&mut e,&b,2).unwrap();
  for _ in 0..2 {adopt(&mut e,&c,3).unwrap();adopt(&mut e,&b,2).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(1));assert_eq!(field(&mut e,"items","a","y"),Value::Int(0));adopt(&mut e,&c,3).unwrap();assert!(row(&mut e,"items","a").field("x").is_err());assert_eq!(field(&mut e,"items","a","y"),Value::Int(10));}
 }
}

#[test]
fn r8_first_leaving_down_output_can_make_a_previously_narrowed_row_representable(){
 let a="table items:\n  count: int 0..10\n  public\n  online only\n";
 let c=a.replace("int 0..10","int 1..10");let b=format!("{c}down items legacy(): {{count:5}}\n");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","count":0}));adopt(&mut e,&b,2).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&c,3).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));
 let wide=b.replace("int 1..10","int 0..10");adopt(&mut e,&wide,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
}

#[test]
fn r8_a_native_forward_backfill_does_not_conflict_with_its_restored_down_receipt(){
 let a="table items:\n  count: int\n  public\n  online only\n";
 let b=format!("{a}backfill items up(): {{count:1}}\ndown items legacy(): {{count:0}}\n");
 let mut e=engine(&b);seed(&mut e,"items",json!({"id":"a","count":5}));
 for _ in 0..2 {adopt(&mut e,a,1).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));adopt(&mut e,&b,2).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));}
}

#[test]
fn r9_down_native_preimages_require_scalar_custody_at_compiler_and_raw_schema_admission(){
 let prefix="table parents:\n  n: int\n  public\n  online only\n";
 for kind in ["parents","parents ?","image <=1024","[int] <=10"] {
  let source=format!("{prefix}table items:\n  owner: {kind}\n  public\n  online only\ndown items legacy(): {{owner:0}}\n");
  let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
  assert!(b.diagnostics.iter().any(|d|d.message.contains("native preimage")),"{kind}: {:?}",b.diagnostics);
 }
 let (s,_)=compile(&(prefix.to_owned()+"table items:\n  owner: parents\n  public\n  online only\n"));
 let (good,_)=compile("table items:\n  owner: int\n  public\n  online only\ndown items legacy(): {owner:0}\n");
 assert!(good.downfills[0].admit_down(&s).unwrap_err().contains("native preimage"));
}

#[test]
fn r9_down_reference_inputs_keep_private_lifetime_bindings_through_generic_id_views(){
 let parents="table parents:\n  n: int\n  public\n  insert <- allow\n  delete <- allow\n  online only\nmutation remove():\n  delete parents['p']\nmutation replace():\n  return insert parents {id:'p',n:2}\n";
 let newer=format!("{parents}table items:\n  parent: parents\n  count: int\n  public\n  online only\ndown items legacy(parent: id): {{count:0}}\n");
 let older=newer.replace("parent: parents","parent: id").replace("down items legacy(parent: id): {count:0}\n","");
 let mut e=engine(&newer);seed(&mut e,"parents",json!({"id":"p","n":1}));seed(&mut e,"items",json!({"id":"a","parent":"p","count":5}));
 adopt(&mut e,&older,1).unwrap();write(&mut e,"remove");write(&mut e,"replace");let generation=e.generation();
 let error=adopt(&mut e,&newer,2).unwrap_err().to_string();assert!(error.contains("lifetime"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn r9_forward_patches_sync_dormant_cells_before_a_later_widening(){
 let a="table items:\n  x: int\n  gate: int 0..10\n  public\n  online only\n";
 let b=a.replace("  x: int\n","");let fill="backfill items up(x: int): {x:x + 1}\n";
 let c=a.replace("gate: int 0..10","gate: int 1..10")+fill;let d=format!("{a}{fill}");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","x":0,"gate":0}));
 adopt(&mut e,&b,2).unwrap();adopt(&mut e,&c,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,&d,4).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(1));
}

#[test]
fn r9_renarrowing_a_restored_native_absence_uses_the_native_default(){
 let a="table items:\n  gate: int 0..10\n  public\n  online only\nquery one():\n  return items['a']\n";
 let b=a.replace("  gate: int","  x: int default 7\n  gate: int");let c=format!("{b}down items legacy(): {{x:1}}\n");
 let older=b.replace("default 7","default 9");let narrowed=c.replace("gate: int 0..10","gate: int 1..10");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","gate":0}));adopt(&mut e,&b,2).unwrap();assert!(row(&mut e,"items","a").field("x").is_err());
 adopt(&mut e,&c,3).unwrap();adopt(&mut e,&older,1).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(1));
 adopt(&mut e,&narrowed,4).unwrap();assert_eq!(e.store().count("items").unwrap(),0);adopt(&mut e,&c,3).unwrap();
 assert_eq!(e.query("one",Context::new("alice",Default::default())).unwrap().data.field("x").unwrap(),&Value::Int(7));
 assert!(row(&mut e,"items","a").field("x").is_err(),"native physical absence must survive re-narrowing and widening");
 for (index,retired) in [a,"query placeholder():\n  return true\n"].into_iter().enumerate() {
  adopt(&mut e,retired,index as u64+5).unwrap();adopt(&mut e,&c,3).unwrap();
  assert!(row(&mut e,"items","a").field("x").is_err(),"native physical absence must survive column and table retirement");
  assert_eq!(e.query("one",Context::new("alice",Default::default())).unwrap().data.field("x").unwrap(),&Value::Int(7));
 }
 adopt(&mut e,&older,1).unwrap();adopt(&mut e,&narrowed,4).unwrap();
 adopt(&mut e,a,5).unwrap();adopt(&mut e,&c,3).unwrap();
 assert!(row(&mut e,"items","a").field("x").is_err(),"retiring a column while its native row is narrowed must preserve physical absence");
 assert_eq!(e.query("one",Context::new("alice",Default::default())).unwrap().data.field("x").unwrap(),&Value::Int(7));
}

#[test]
fn r9_a_carried_down_declaration_marks_a_newly_returned_native_image(){
 let a="table items:\n  count: int\n  gate: int 0..10\n  public\n  online only\n";
 let b=a.replace("gate: int 0..10","gate: int 1..10");let c=format!("{b}down items legacy(): {{count:7}}\n");let d=format!("{a}down items legacy(): {{count:7}}\n");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","count":5,"gate":0}));
 adopt(&mut e,&b,2).unwrap();adopt(&mut e,&c,3).unwrap();adopt(&mut e,&d,4).unwrap();adopt(&mut e,a,1).unwrap();
 assert_eq!(field(&mut e,"items","a","count"),Value::Int(7));adopt(&mut e,&d,4).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));
}

#[test]
fn r9_retiring_a_projected_column_preserves_physical_receipt_verification(){
 let middle="table items:\n  label: text <=40\n  public\n  online only\n";
 let newer=format!("{middle}down items legacy(label: text <=40): {{reason:label}}\n");
 let older=middle.replace("  label: text <=40","  reason: text <=40 ?\n  label: text <=40");
 let mut e=engine(&newer);seed(&mut e,"items",json!({"id":"a","label":"native"}));
 adopt(&mut e,&older,1).unwrap();assert_eq!(field(&mut e,"items","a","reason"),Value::String("native".into()));
 adopt(&mut e,middle,3).unwrap();adopt(&mut e,&newer,2).unwrap();assert!(row(&mut e,"items","a").field("reason").is_err());
}

#[test]
fn r9_down_point_lookups_rebuild_indexes_for_restored_source_rows(){
 let a="table deps:\n  key: text <=20\n  n: int 0..10\n  unique key\n  public\n  online only\ntable items:\n  count: int\n  public\n  online only\n";
 let b=a.replace("  n: int 0..10","  n: int 1..10")+"down items legacy(): {count:(deps[key = 'k'] ! else MISSING).n}\n";
 let mut e=engine(a);seed(&mut e,"deps",json!({"id":"d","key":"k","n":0}));seed(&mut e,"items",json!({"id":"a","count":5}));
 adopt(&mut e,&b,2).unwrap();assert_eq!(e.store().count("deps").unwrap(),0);adopt(&mut e,a,1).unwrap();assert_eq!(field(&mut e,"items","a","count"),Value::Int(0));
}

#[test]
fn r9_invalid_in_the_destination_is_still_a_conflicting_old_dependency_edit(){
 let newer="table items:\n  n: int 1..10\n  x: int\n  public\n  update <- allow\n  online only\ndown items legacy(n: int 1..10): {x:n}\n";
 let older=newer.replace("n: int 1..10","n: int 0..10").replace("down items legacy(n: int 0..10): {x:n}\n","")+"mutation edit():\n  update items['a'] {n:0}\n";
 let mut e=engine(newer);seed(&mut e,"items",json!({"id":"a","n":5,"x":9}));adopt(&mut e,&older,1).unwrap();write(&mut e,"edit");let generation=e.generation();
 let error=adopt(&mut e,newer,2).unwrap_err().to_string();assert!(error.contains("reverse dependencies"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn no_write_release_walks_restore_the_native_view_across_retirement_narrowing_and_projection(){
 let base="table items:\n  x: int default 7\n  gate: int 0..10\n  public\n  online only\nquery inspectRows():\n  return items first 20 by .id\n";
 let down="down items legacy(): {x:1}\n";let native=format!("{base}{down}");
 let variants=vec![base.to_owned(),base.replace("gate: int 0..10","gate: int 1..10"),native.replace("gate: int 0..10","gate: int 1..10"),base.replace("  x: int default 7\n",""),native.replace("  x: int default 7\n",""),"query placeholder():\n  return true\n".into(),base.replace("x: int default 7","x: int 0..2 default 1"),format!("{native}backfill items up(x: int): {{x:x + 1}}\n")];
 for seed_value in 0u64..64 {
  let mut e=engine(&native);
  for (id,x,gate) in [("a",Some(5),0),("b",Some(0),5),("c",None,0),("d",None,5)] {
   let mut data=json!({"id":id,"gate":gate});if let Some(x)=x {data.as_object_mut().unwrap().insert("x".into(),json!(x));}seed(&mut e,"items",data);
  }
  let expected=e.query("inspectRows",Context::new("alice",Default::default())).unwrap().data;
  let mut state=seed_value+1;let mut path=Vec::new();
  for _ in 0..12 {
   state=state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);let choice=((state>>32) as usize)%variants.len();path.push(choice);
   adopt(&mut e,&variants[choice],choice as u64+2).unwrap_or_else(|error|panic!("seed {seed_value}, path {path:?}: {error}"));
  }
  adopt(&mut e,&native,1).unwrap_or_else(|error|panic!("native return seed {seed_value}, path {path:?}: {error}"));
  let actual=e.query("inspectRows",Context::new("alice",Default::default())).unwrap().data;assert_eq!(actual,expected,"seed {seed_value}, path {path:?}");
 }
}

#[test]
fn r10_unchanged_private_reference_bindings_cannot_be_recaptured_after_native_parent_reuse(){
 let parents="table parents:\n  n: int\n  public\n  insert <- allow\n  delete <- allow\n  online only\nmutation remove():\n  delete parents['p']\nmutation replace():\n  return insert parents {id:'p',n:2}\n";
 let old=format!("{parents}table items:\n  parent: parents on delete keep\n  count: int\n  public\n  online only\n");let new=format!("{old}down items legacy(parent: id): {{count:0}}\n");
 let mut e=engine(&new);seed(&mut e,"parents",json!({"id":"p","n":1}));seed(&mut e,"items",json!({"id":"a","parent":"p","count":5}));
 adopt(&mut e,&old,1).unwrap();adopt(&mut e,&new,2).unwrap();write(&mut e,"remove");write(&mut e,"replace");let generation=e.generation();
 let error=adopt(&mut e,&old,1).unwrap_err().to_string();assert!(error.contains("lifetime"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn r10_retired_down_dependencies_are_compared_against_their_current_provided_cells(){
 let old="table items:\n  n: int\n  x: int\n  public\n  update <- allow\n  online only\nmutation edit():\n  update items['a'] {n:0}\n";
 let new=old.replace("  n: int\n","").replace("mutation edit():\n  update items['a'] {n:0}\n","")+"down items legacy(n: int): {x:n}\n";
 let mut e=engine(old);seed(&mut e,"items",json!({"id":"a","n":5,"x":9}));adopt(&mut e,&new,2).unwrap();adopt(&mut e,old,1).unwrap();write(&mut e,"edit");let generation=e.generation();
 let error=adopt(&mut e,&new,2).unwrap_err().to_string();assert!(error.contains("reverse dependencies"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn r10_a_previously_narrowed_row_cannot_hide_a_conflicting_down_dependency_edit(){
 let newer="table items:\n  n: int 1..10\n  x: int\n  gate: int 0..10\n  public\n  update <- allow\n  online only\ndown items legacy(n: int 1..10): {x:n}\n";
 let old=newer.replace("n: int 1..10","n: int 0..10").replace("down items legacy(n: int 0..10): {x:n}\n","")+"mutation edit():\n  update items['a'] {n:0}\n";
 let middle=old.replace("gate: int 0..10","gate: int 1..10");let mut e=engine(newer);seed(&mut e,"items",json!({"id":"a","n":5,"x":9,"gate":0}));
 adopt(&mut e,&old,1).unwrap();write(&mut e,"edit");adopt(&mut e,&middle,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);let generation=e.generation();
 let error=adopt(&mut e,newer,2).unwrap_err().to_string();assert!(error.contains("reverse dependencies"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn r10_sequence_ordinals_are_not_scalar_migration_custody(){
 let base="table parents:\n  public\n  online only\ntable items:\n  parent: parents\n  ordinal: sequence by parent\n  unique position: parent, ordinal\n  public\n  insert <- allow\n  online only\n";
 for declaration in ["down items legacy(): {ordinal:2}\n","backfill items legacy(): {ordinal:2}\n"] {
  let b=snapback4_lang::compile(&[("schema.q".into(),format!("{base}{declaration}"))]);
  assert!(!b.diagnostics.is_empty(),"engine-owned ordinal was accepted: {declaration}");
 }
}

#[test]
fn r10_an_inapplicable_down_lookup_does_not_enforce_a_retired_unique_index(){
 let a="table deps:\n  key: text <=20\n  n: int 0..10\n  public\n  online only\ntable items:\n  count: int\n  public\n  online only\n";
 let b=a.replace("  n: int 0..10","  n: int 1..10\n  unique key")+"down items legacy(): {legacy:(deps[key = 'k'] ! else MISSING).n}\n";
 let mut e=engine(a);seed(&mut e,"deps",json!({"id":"a","key":"k","n":0}));seed(&mut e,"deps",json!({"id":"b","key":"k","n":1}));seed(&mut e,"items",json!({"id":"a","count":5}));
 adopt(&mut e,&b,2).unwrap();assert_eq!(e.store().count("deps").unwrap(),1);adopt(&mut e,a,1).unwrap();assert_eq!(e.store().count("deps").unwrap(),2);assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));
}

#[test]
fn r10_pruned_native_receipts_do_not_block_unrelated_changes_but_future_reversal_stays_unavailable(){
 for sparse in [false,true] {
  let a="table items:\n  count: int default 7\n  public\n  online only\n";let b=format!("{a}down items legacy(): {{count:0}}\n");let c=b.replace("  count: int","  tag: bool ?\n  count: int");
  let mut e=if sparse {let mut e=engine("table items:\n  public\n  online only\n");seed(&mut e,"items",json!({"id":"a"}));adopt(&mut e,&b,2).unwrap();e}else{let mut e=engine(&b);seed(&mut e,"items",json!({"id":"a","count":5}));e};
  adopt(&mut e,a,1).unwrap();adopt(&mut e,&b,2).unwrap();e.store_mut().prune_dormant(true,None).unwrap();adopt(&mut e,&c,3).unwrap();
  if !sparse {assert_eq!(field(&mut e,"items","a","count"),Value::Int(5));}
  let error=adopt(&mut e,a,1).unwrap_err().to_string();assert!(error.contains("explicitly pruned"),"{error}");
 }
}

#[test]
fn r10_a_pruned_retired_native_cell_cannot_be_reintroduced_as_fabricated_null(){
 let a="table items:\n  count: int ?\n  public\n  online only\n";let b=format!("{a}down items legacy(): {{count:0}}\n");let retired=b.replace("  count: int ?\n","");
 let mut e=engine(&b);seed(&mut e,"items",json!({"id":"a","count":5}));adopt(&mut e,a,1).unwrap();adopt(&mut e,&b,2).unwrap();e.store_mut().prune_dormant(true,None).unwrap();
 adopt(&mut e,&retired,3).unwrap();e.store_mut().prune_dormant(true,None).unwrap();let generation=e.generation();
 let error=adopt(&mut e,&b,2).unwrap_err().to_string();assert!(error.contains("pruned"),"{error}");assert_eq!(generation,e.generation());
}

#[test]
fn r10_raw_schema_validation_checks_down_fragments_names_and_native_custody(){
 let (mut s,_)=compile("table items:\n  count: int\n  public\n  online only\ndown items legacy(): {count:0}\n");
 s.downfills.push(s.downfills[0].clone());assert!(crate::schema::validate(&s).iter().any(|i|i.path.starts_with("downfills")&&i.message.contains("disjoint")));
 s.downfills.pop();s.tables.remove("items");assert!(crate::schema::validate(&s).iter().any(|i|i.path.starts_with("downfills")&&i.message.contains("absent")));
}

#[test]
fn incoming_native_down_preimages_win_over_another_leaving_projection(){
 let base="table deps:\n  key: text <=20\n  n: int 0..10\n  public\n  online only\ntable items:\n  x: int\n  public\n  online only\n";
 let a=format!("{base}down items first(): {{x:0}}\n");
 for lookup in [false,true] {
  let b=if lookup {base.replace("  n: int 0..10","  n: int 1..10\n  unique key")+"down items second(): {x:(deps[key = 'k'] ! else MISSING).n}\n"}else{format!("{base}down items second(): {{x:1}}\n")};
  let mut e=engine(&a);seed(&mut e,"deps",json!({"id":"a","key":"k","n":0}));seed(&mut e,"deps",json!({"id":"b","key":"k","n":1}));seed(&mut e,"items",json!({"id":"a","x":5}));
  for _ in 0..2 {adopt(&mut e,&b,2).unwrap();adopt(&mut e,&a,1).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(5),"exact entering native cells beat another leaving writer");}
 }
}

#[test]
fn r11_down_added_while_a_row_is_narrowed_applies_to_its_retained_native_image(){
 let wide="table items:\n  x: int\n  gate: int 0..10\n  public\n  online only\n";let narrow=wide.replace("gate: int 0..10","gate: int 1..10");let down=format!("{narrow}down items legacy(): {{x:0}}\n");
 let mut e=engine(wide);seed(&mut e,"items",json!({"id":"a","x":5,"gate":0}));adopt(&mut e,&narrow,2).unwrap();adopt(&mut e,&down,3).unwrap();assert_eq!(e.store().count("items").unwrap(),0);
 adopt(&mut e,wide,1).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(0));adopt(&mut e,&down,3).unwrap();adopt(&mut e,&(wide.to_owned()+"down items legacy(): {x:0}\n"),4).unwrap();assert_eq!(field(&mut e,"items","a","x"),Value::Int(5));
}
#[test]
fn r11_retired_reverse_inputs_use_the_retained_native_default(){
 let a="table items:\n  y: int\n  public\n  online only\n";let b=a.replace("  y: int","  n: int default 7\n  y: int");let c=format!("{b}down items native(): {{n:1}}\ndown items legacy(n: int): {{y:n}}\n");let retired=c.replace("  n: int default 7\n","");
 let mut e=engine(a);seed(&mut e,"items",json!({"id":"a","y":5}));adopt(&mut e,&b,2).unwrap();adopt(&mut e,&c,3).unwrap();adopt(&mut e,&b,2).unwrap();adopt(&mut e,&c,3).unwrap();assert!(row(&mut e,"items","a").field("n").is_err());
 adopt(&mut e,&retired,4).unwrap();adopt(&mut e,a,1).unwrap();assert_eq!(field(&mut e,"items","a","y"),Value::Int(7));
}
#[test]
fn r11_raw_existence_fragments_require_declared_plain_indexes(){
 let (s,_)=compile("table items:\n  count: int\n  public\n  online only\ndown items legacy(): {count:1 if exists items where .count >= 0 else 0}\n");
 fn corrupt(v:&mut Json,field:&str){match v {Json::Object(fs)=>{if let Some(Json::Object(scan))=fs.get_mut("Scan"){scan.insert(field.into(),Json::String("missing".into()));}for value in fs.values_mut(){corrupt(value,field);}},Json::Array(vs)=>for v in vs{corrupt(v,field)},_=>()}}
 for field in ["table","index"] {let mut fill=serde_json::to_value(&s.downfills[0]).unwrap();corrupt(&mut fill,field);let mut bad=s.clone();bad.downfills[0]=serde_json::from_value(fill).unwrap();assert!(bad.downfills[0].admit_down(&bad).is_err(),"bad {field} admitted");assert!(crate::schema::validate(&bad).iter().any(|i|i.path.starts_with("downfills")));}
}

#[path="evolution_tests.rs"]
mod evolution_tests;

#[test]
fn edited_in_place_output_uses_declared_down_and_restores_current_native_value() {
    let next=cues()+"down cues oldStatus(status: enum('standby','complete','skipped')): {status:'done' if status != 'standby' else 'standby'}\n";
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"skip");
    for _ in 0..2 {
        adopt(&mut e,CUE,1).unwrap();
        assert_eq!(field(&mut e,"cues","a","status"),Value::String("done".into()));
        adopt(&mut e,&next,2).unwrap();
        assert_eq!(field(&mut e,"cues","a","status"),Value::String("skipped".into()));
    }
}
#[test]
fn edited_in_place_output_survives_a_bridge_that_admits_its_value() {
    let bridge=CUE.replace("enum('standby','done')","enum('standby','done','complete','skipped')");
    let mut e=engine(CUE);seed(&mut e,"cues",json!({"id":"a","status":"done"}));
    adopt(&mut e,&cues(),2).unwrap();write(&mut e,"skip");
    adopt(&mut e,&bridge,3).unwrap();
    assert_eq!(field(&mut e,"cues","a","status"),Value::String("skipped".into()));
    adopt(&mut e,&cues(),2).unwrap();
    assert_eq!(field(&mut e,"cues","a","status"),Value::String("skipped".into()));
}

#[test]
fn reference_rename_preserves_live_cells_and_old_release_writes() {
    let old="table parents:\n  public 'fixture'\n  online only\ntable items:\n  parent: parents on delete restrict\n  public 'fixture'\n  online only\n";
    let next=old.replace("parent: parents on delete restrict","guardian: parents renamed from parent on delete restrict");
    let mut e=engine(old);seed(&mut e,"parents",json!({"id":"p"}));seed(&mut e,"items",json!({"id":"a","parent":"p"}));
    for _ in 0..2 {
        adopt(&mut e,&next,2).unwrap();assert_eq!(field(&mut e,"items","a","guardian"),Value::Id("p".into()));
        adopt(&mut e,old,1).unwrap();assert_eq!(field(&mut e,"items","a","parent"),Value::Id("p".into()));
    }
}

#[test]
fn rollback_view_enforces_null_acknowledgment_and_reference_closure_under_the_writer() {
    let old="table bookings:\n  amount: int 0..100\n  public 'fixture'\n  online only\ntable fees:\n  booking: bookings\n  public 'fixture'\n  online only\n";
    let next=old.replace("amount: int 0..100","amount: int 0..1000 ?");
    for acknowledge in [false,true] {
        let mut e=engine(&next);seed(&mut e,"bookings",json!({"id":"b","amount":null}));seed(&mut e,"fees",json!({"id":"f","booking":"b"}));
        let(s,p)=compile(old);let mut activation=ReleaseActivation::new(3,Some(1));
        activation.visibility=Some(crate::engine::release::VisibilityPolicy{hides:if acknowledge {vec![crate::engine::release::HiddenNull{table:"bookings".into(),column:"amount".into(),reason:"unquoted must not read as free".into()}]}else{vec![]}});
        let before=e.generation();let result=e.adopt_release(s,p,&activation,false);
        if acknowledge {result.unwrap();assert_eq!(e.store().count("bookings").unwrap(),0);assert_eq!(e.store().count("fees").unwrap(),0);}
        else {assert!(result.unwrap_err().to_string().contains("unacknowledged hiding"));assert_eq!(e.generation(),before);assert_eq!(e.store().count("bookings").unwrap(),1);}
    }
    let mut e=engine(&next);seed(&mut e,"bookings",json!({"id":"b","amount":200}));
    let(s,p)=compile(old);let mut activation=ReleaseActivation::new(3,Some(1));activation.visibility=Some(crate::engine::release::VisibilityPolicy{hides:vec![crate::engine::release::HiddenNull{table:"bookings".into(),column:"amount".into(),reason:"only unquoted rows".into()}]});
    assert!(e.adopt_release(s,p,&activation,false).unwrap_err().to_string().contains("unacknowledged hiding"));assert_eq!(field(&mut e,"bookings","b","amount"),Value::Int(200));
}

#[test]
fn edited_output_still_checks_changed_point_dependencies_with_equal_arguments() {
    let old="table factors:\n  n: int\n  public 'fixture'\n  update <- allow\n  online only\ntable items:\n  n: int\n  score: int\n  public 'fixture'\n  update <- allow\n  online only\nmutation changeFactor():\n  update factors['factor'] {n:3}\n";
    let next=old.to_owned()+"backfill items computed(n: int): {score:n * (factors['factor'] ! else NO_FACTOR).n}\nmutation editOutput():\n  update items['a'] {score:42}\n";
    let mut e=engine(old);seed(&mut e,"factors",json!({"id":"factor","n":2}));seed(&mut e,"items",json!({"id":"a","n":5,"score":0}));
    adopt(&mut e,&next,2).unwrap();write(&mut e,"editOutput");adopt(&mut e,old,1).unwrap();write(&mut e,"changeFactor");
    let error=adopt(&mut e,&next,2).unwrap_err().to_string();assert!(error.contains("authored output")&&error.contains("42")&&error.contains("15"),"{error}");assert_eq!(field(&mut e,"items","a","score"),Value::Int(42));
}

#[test]
fn reference_rename_transports_dormant_invalidation_across_parent_id_reuse() {
    let old="table parents:\n  public 'fixture'\n  delete <- allow\n  online only\ntable items:\n  parent: parents\n  public 'fixture'\n  online only\nmutation remove():\n  delete parents['p']\n";
    let next=old.replace("parent: parents\n","guardian: parents renamed from parent\n");
    let hidden=next.replace("  guardian: parents renamed from parent\n","");
    let mut e=engine(old);seed(&mut e,"parents",json!({"id":"p"}));seed(&mut e,"items",json!({"id":"a","parent":"p"}));
    adopt(&mut e,&next,2).unwrap();adopt(&mut e,&hidden,3).unwrap();write(&mut e,"remove");seed(&mut e,"parents",json!({"id":"p"}));
    let before=e.generation();assert!(adopt(&mut e,old,1).is_err());assert_eq!(e.generation(),before);
}

#[test]
fn intentional_hiding_cannot_weaken_negative_policy_or_procedural_guards() {
    use crate::engine::release::{ReleaseActivation,VisibilityPolicy,HiddenNull};
    for policy in 0..5 {
        let guard=if policy==3 {"table access:\n  read <- exists blocks['b']\n  online only\ntable notes:\n  insert <- allow\n  online only\nmutation act():\n  require not exists access['a'] else BLOCKED\n  return insert notes {}\n"}else if policy==4 {"table docs:\n  permit: int ? read <- exists blocks['b']\n  public 'fixture'\n  online only\ntable notes:\n  insert <- allow\n  online only\nmutation act():\n  row = docs['d'] ! else MISSING\n  require row.permit = null else BLOCKED\n  return insert notes {}\n"}else if policy==0 {"table notes:\n  read <- not exists blocks['b']\n  insert <- allow\n  online only\n"}else if policy==2 {"table notes:\n  open: bool\n  read <- .open = true\n  insert <- allow\n  online only\nmutation act():\n  return insert notes {open:count(blocks where true) = 0}\n"}else{"table notes:\n  read <- deny\n  insert <- allow\n  online only\nmutation act():\n  require not exists blocks['b'] else BLOCKED\n  return insert notes {}\n"};
        let new=format!("table blocks:\n  value: int ?\n  public 'fixture'\n  online only\n{guard}");let old=new.replace("value: int ?","value: int");
        let mut e=engine(&new);seed(&mut e,"blocks",json!({"id":"b","value":null}));let before=e.generation();let(s,p)=compile(&old);
        let mut activation=ReleaseActivation::new(2,Some(1));activation.visibility=Some(VisibilityPolicy{hides:vec![HiddenNull{table:"blocks".into(),column:"value".into(),reason:"unconfirmed".into()}]});
        let error=e.adopt_release(s,p,&activation,false).unwrap_err().to_string();assert!(error.contains("lookup population"),"{error}");assert_eq!(e.generation(),before);assert_eq!(e.store().count("blocks").unwrap(),1);
    }
}

#[test]
fn hiding_keeps_positive_point_assertions_as_denials_without_inventing_values() {
    use crate::engine::release::{ReleaseActivation,VisibilityPolicy,HiddenNull};
    let new="table blocks:\n  value: int ?\n  public 'fixture'\n  update <- allow\n  online only\nmutation act(id: blocks):\n  row = blocks[id] ! else MISSING\n  require row.value != null else UNCONFIRMED\n  update blocks[id] {value:1}\n";let old=new.replace("value: int ?","value: int");
    let mut e=engine(new);seed(&mut e,"blocks",json!({"id":"b","value":null}));let(s,p)=compile(&old);let mut activation=ReleaseActivation::new(2,Some(1));activation.visibility=Some(VisibilityPolicy{hides:vec![HiddenNull{table:"blocks".into(),column:"value".into(),reason:"unconfirmed".into()}]});e.adopt_release(s,p,&activation,false).unwrap();assert_eq!(e.store().count("blocks").unwrap(),0);
}
