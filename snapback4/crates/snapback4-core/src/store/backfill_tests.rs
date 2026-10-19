//! Business-state regressions for declarative day-two adoption.
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
    let(s,p)=compile(source);let previous=e.store().meta("release").unwrap().map(|s|s.parse().unwrap());
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
 assert!(e.store().adoption_report.backfills.iter().any(|s|s.contains("transformed 3 rows")));
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
 assert_ne!(e.store().meta("version").unwrap().as_deref(),Some(super::backfills::VERSION));
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
fn saved_reference_inputs_keep_their_own_lifetime_after_live_retargeting() {
 for kind in ["parents","id"] {
 let parents="table parents:\n  n: int\n  public 'fixture'\n  online only\n";
 let mutation="mutation retarget():\n  update children['c'] {parent:'q'}\n";
 let old=parents.to_owned()+"table children:\n  parent: parents on delete keep\n  public 'fixture'\n  update <- allow\n  online only\n"+mutation;
 let fill=format!("backfill children copy(parent: {kind}):\n  {{copied:(parents[parent] ! else NOT_FOUND).n}}\n");
 let next=old.replace("  parent: parents","  copied: int\n  parent: parents")+&fill;
 let dropped=next.replace("  parent: parents on delete keep\n","").replace(mutation,"");
 let mut e=engine(&old);for(id,n)in[("p",3),("q",9)]{seed(&mut e,"parents",json!({"id":id,"n":n}));}seed(&mut e,"children",json!({"id":"c","parent":"p"}));adopt(&mut e,&next,2).unwrap();write(&mut e,"retarget");adopt(&mut e,&dropped,3).unwrap();
 let table=e.schema().tables["parents"].clone();{let tx=e.store_mut().transaction().unwrap();let r=tx.get("parents","p").unwrap().unwrap();tx.delete("parents",&table,&r).unwrap();tx.commit().unwrap();}seed(&mut e,"parents",json!({"id":"p","n":77}));
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
   let tx=e.store_mut().transaction().unwrap();let t=tx.num("children").unwrap();
   let saved:Option<String>=tx.conn().query_row("SELECT data FROM _dormant_rows WHERE t=?1 AND id='c'",[t],|r|r.get(0)).optional().unwrap();
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
