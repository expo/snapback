//! Wave33 REL4: lane source is frozen verbatim; only reconstructed failures are edited.
use serde_json::{json,Value};
use snapback4_core::{Engine,Context,store_port::AnyStore};
use std::{fs,path::PathBuf,process::{Command,Output},collections::BTreeMap};
const BIN:&str=env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App {
 fn new()->Self{let p=std::env::temp_dir().join(format!("rel4-{}-{}",std::process::id(),snapback4_core::ids::seed()));fs::create_dir_all(p.join("snapback")).unwrap();Self(p)}
 fn source(&self,s:&str){fs::write(self.0.join("snapback/schema.q"),s).unwrap();}
 fn run(&self,args:&[&str])->Output{Command::new(BIN).args(args).current_dir(&self.0).output().unwrap()}
 fn ok(&self,args:&[&str])->String{let o=self.run(args);assert!(o.status.success(),"{}",text(&o));String::from_utf8(o.stdout).unwrap()}
 fn json(&self,args:&[&str])->Value{let mut a=args.to_vec();a.push("--json");serde_json::from_str(&self.ok(&a)).unwrap()}
 fn engine(&self)->Engine{let s=AnyStore::open(&self.0.join("deploy/store.sqlite")).unwrap();let n=s.release_value().unwrap().unwrap().parse().unwrap();Engine::attach_release_at(s,n,snapback4_core::now_ms()).unwrap()}
 fn seed(&self,source:&str,table:&str,row:Value){let b=compile(source);let row=snapback4_core::wire::row_from_json(&b.schema.tables[table],&row).unwrap();self.engine().seed([(table.into(),row)]).unwrap();}
 fn count(&self,table:&str)->usize{self.json(&["data",table,"--release","deploy"])["rows"].as_array().unwrap().len()}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn text(o:&Output)->String{format!("{}{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr))}
fn compile(source:&str)->snapback4_lang::Bound{snapback4_lang::compile(&[("schema.q".into(),source.into())])}
const L033_OLD:&str=include_str!("fixtures/rel4/033-v1.q");
const L033_NEW:&str=include_str!("fixtures/rel4/033-v2.q");
const L024_OLD:&str=include_str!("fixtures/rel4/024-v1.q");
const L024_NEW:&str=include_str!("fixtures/rel4/024-v2.q");
const L037_OLD:&str=include_str!("fixtures/rel4/037-v1.q");
const L037_NEW:&str=include_str!("fixtures/rel4/037-v2.q");
#[test]
fn wave33_033_invariants_and_hidden_null_writes_compose_in_current_workflow(){
 let a=App::new();a.source(L033_OLD);a.ok(&["deploy","deploy","--staging"]);
 a.seed(L033_OLD,"jobs",json!({"id":"v1","customer":"customer","address":"kept","detail":null,"priceCents":100,"status":"quoted","quotedAt":1,"acceptedAt":null,"curedAt":null,"signedOffAt":null}));
 let source=format!("{L033_NEW}\ninvariant jobs always .priceCents = null or .priceCents != null\ninvariant jobs.priceCents update only exists roles[viewer, role = 'owner']\ninvariant roles.role write only viewer = 'service:operator'\nrollback 1 hides jobs where priceCents = null because 'Unquoted jobs are pending, never free.'\n");
 assert!(compile(&source).diagnostics.is_empty(),"{:?}",compile(&source).diagnostics);
 a.source(&source);a.ok(&["deploy","deploy","--check","--staging"]);a.ok(&["deploy","deploy","--staging"]);
 a.seed(&source,"jobs",json!({"id":"pending","customer":"customer","address":"pending","detail":null,"priceCents":null,"status":"quoted","quotedAt":1,"acceptedAt":null,"curedAt":null,"signedOffAt":null}));
 a.source(&format!("{source}query rel4Version():\n  return 4\n"));
 let forward=a.json(&["deploy","deploy","--check","--staging"]);assert!(forward.get("unchanged").is_some()||forward["preview"]==true,"{forward}");
 a.ok(&["deploy","deploy","--staging"]);a.ok(&["rollback","deploy","--to","latest","--exact"]);
 let exact=a.json(&["rollback","deploy","--to","1","--exact","--check"]);assert_eq!(exact["visibility"]["hiddenRows"],1,"{exact}");
 a.ok(&["rollback","deploy","--to","1","--exact"]);a.ok(&["rollback","deploy","--to","latest","--exact"]);assert_eq!(a.count("jobs"),2);
 // A guard-population refusal is exposed by deploy preview without bricking
 // forward. Removing intentional hiding registers the visible safe variant.
 let visible=source.lines().filter(|line|!line.starts_with("rollback 1 hides")).collect::<Vec<_>>().join("\n")+"\n";
 a.source(&visible);let p=a.json(&["deploy","deploy","--check","--staging"]);assert!(p["rollbackViewEffects"].as_array().unwrap().iter().all(|v|v["ready"]==true),"{p}");
 a.ok(&["deploy","deploy","--staging"]);for _ in 0..2{a.ok(&["rollback","deploy","--to","1"]);assert_eq!(a.count("jobs"),2);a.ok(&["rollback","deploy","--to","latest"]);}
}
#[test]
fn wave33_033_safe_hiding_cycles_refuse_only_null_writes_and_preserve_invariants(){
 let a=App::new();let old="table jobs:\n  price: int 1..100\n  public\n  insert <- allow\n  online only\nquery list():\n  return jobs first 20 by .id\nmutation add(price: int 1..100):\n  return insert jobs {price}\n";
 a.source(old);a.ok(&["deploy","deploy"]);a.seed(old,"jobs",json!({"id":"v1","price":1}));
 let new=old.replace("price: int 1..100","price: int 1..100 ?")+"invariant jobs always .price = null or .price != null\nrollback 1 hides jobs where price = null because 'Pending price.'\n";
 a.source(&new);a.ok(&["deploy","deploy","--check"]);a.ok(&["deploy","deploy"]);a.seed(&new,"jobs",json!({"id":"null","price":null}));
 for _ in 0..2{
 let p=a.json(&["rollback","deploy","--to","1","--check"]);assert_eq!(p["visibility"]["hiddenRows"],1,"{p}");a.ok(&["rollback","deploy","--to","1"]);assert_eq!(a.count("jobs"),1);
 let mut e=a.engine();let r=e.mutate("add",None,Context::new("alice",BTreeMap::from([("price".into(),snapback4_core::Value::Null)]))).unwrap();assert!(serde_json::to_string(&r).unwrap().contains("ROLLBACK_NULL"),"{r:?}");drop(e);
 a.ok(&["rollback","deploy","--to","latest"]);assert_eq!(a.count("jobs"),2);
 }
}
#[test]
fn wave33_024_legacy_global_cap_survives_view_generation(){
 let a=App::new();a.source(L024_OLD);a.ok(&["deploy","deploy","--staging"]);
 // Only widen a retained required scalar: preserve the actual lane's global
 // caps and all original guards/operations, without its later workaround.
 let new=L024_OLD.replace("wiringNotes: text 1..1000","wiringNotes: text 1..2000");a.source(&new);a.ok(&["deploy","deploy","--check","--staging"]);a.ok(&["deploy","deploy","--staging"]);a.ok(&["rollback","deploy","--to","1"]);
 a.source(L024_NEW);a.ok(&["check"]);
}
#[test]
fn wave33_037_default_now_extraction_refuses_at_check_and_names_fix(){
 assert!(compile(L037_OLD).diagnostics.is_empty());assert!(compile(L037_NEW).diagnostics.is_empty());
 let bad=L037_NEW.replace("table tracingSets:\n","table tracingSets:\n  createdAt: time default now\n");let a=App::new();a.source(&bad);
 let out=a.run(&["check"]);assert!(!out.status.success());let message=text(&out);for term in ["tracingSets.createdAt","default now","literal default","optional"]{assert!(message.contains(term),"{message}");}
 a.source(L037_NEW);a.ok(&["check"]);
}
#[test]
fn wave33_024_retired_required_column_names_missing_down_at_preview(){
 let a=App::new();a.source(L024_OLD);a.ok(&["deploy","deploy","--staging"]);
 let bad=L024_OLD.replace("  wiringNotes: text 1..1000\n","").replace(", wiringNotes: text 1..1000","").replace(", wiringNotes","").replace("wiringNotes, ","");
 // Use the actual table/policies, but omit the removed-field writer so source
 // compilation does not mask the rollback mapping failure.
 let b=compile(&bad);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);a.source(&bad);
 let out=a.run(&["deploy","deploy","--check","--staging"]);let message=text(&out);assert!(!out.status.success());assert!(message.contains("installs.wiringNotes")&&message.contains("down"),"{message}");
 a.source(L024_OLD);a.ok(&["deploy","deploy","--check","--staging"]);
}
#[test]
fn wave33_033_adoption_precedes_security_gate(){
 let a=App::new();a.source(L024_OLD);a.ok(&["deploy","deploy","--staging"]);
 let bad=L024_OLD.replace("  wiringNotes: text 1..1000\n","").replace(", wiringNotes: text 1..1000","").replace(", wiringNotes","").replace("wiringNotes, ","").replace("priceCents: int 1..100000000","priceCents: int 1..100000000 ?");a.source(&bad);
 let out=a.run(&["deploy","deploy","--check"]);let message=text(&out);assert!(!out.status.success());assert!(message.contains("down")&&message.contains("adoption preflight")&&!message.contains("production deploy requires individual security review"),"{message}");
}

#[test]
fn wave33_033_ready_adoption_labels_security_as_second_failure(){
 let a=App::new();a.source(L033_OLD);a.ok(&["deploy","deploy","--staging"]);a.source(L033_NEW);
 let out=a.run(&["deploy","deploy","--check"]);let message=text(&out);assert!(!out.status.success(),"{message}");
 assert!(message.contains("E_SECURITY_REVIEW")&&message.contains("adoption preflight: READY (first)")&&message.contains("security gate (second)"),"{message}");
 let staged=a.json(&["deploy","deploy","--check","--staging"]);assert_eq!(staged["preflight"]["adoption"],"ready");assert_eq!(a.json(&["releases","deploy"])["current"],1);
}

#[test]
fn row_variable_hiding_wraps_the_resolved_table_and_keeps_refusal_atomic(){
 let a=App::new();let old="table jobs:\n  price: int 1..100\n  public\n  update <- allow\n  online only\nmutation edit(id: jobs, price: int 1..100):\n  j = jobs[id] ! else MISSING\n  update j {price}\n  return null\n";
 a.source(old);a.ok(&["deploy","deploy"]);a.seed(old,"jobs",json!({"id":"kept","price":10}));
 let new=old.replace("price: int 1..100","price: int 1..100 ?")+"invariant jobs always .price = null or .price != null\nrollback 1 hides jobs where price = null because 'Pending.'\n";a.source(&new);a.ok(&["deploy","deploy","--check"]);a.ok(&["deploy","deploy"]);a.ok(&["rollback","deploy","--to","1"]);
 let mut e=a.engine();let r=e.mutate("edit",None,Context::new("alice",BTreeMap::from([("id".into(),snapback4_core::Value::Id("kept".into())),("price".into(),snapback4_core::Value::Null)]))).unwrap();assert!(serde_json::to_string(&r).unwrap().contains("ROLLBACK_NULL"));drop(e);
 assert_eq!(a.json(&["data","jobs","--release","deploy"])["rows"][0]["price"],10);
}
#[test]
fn hiding_migration_identity_changes_refuse_before_activation_with_named_column(){
 let a=App::new();let old="table tasks:\n  state: enum('queued', 'done')\n  n: int 0..10\n  public\n  online only\n";a.source(old);a.ok(&["deploy","deploy","--staging"]);
 let new=old.replace("enum('queued', 'done')","enum('queued', 'ready') ?").replace("n: int 0..10","n: int 0..20")+"alias tasks.state 'done' = 'ready'\ninvariant tasks always .state = null or .state != null\nrollback 1 hides tasks where state = null because 'Pending.'\n";
 a.source(&new);let o=a.run(&["deploy","deploy","--check","--staging"]);assert!(!o.status.success());let t=text(&o);assert!(t.contains("tasks.state")&&t.contains("migration")&&t.contains("visible optional view"),"{t}");assert_eq!(a.json(&["releases","deploy"])["current"],1);
 a.source(&new.lines().filter(|l|!l.starts_with("rollback 1 hides")).collect::<Vec<_>>().join("\n"));a.ok(&["deploy","deploy","--check","--staging"]);
}
#[test]
fn hiding_named_explicit_field_can_compose_with_unrelated_spread(){
 let old="table jobs:\n  price: int 1..100\n  label: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(price: int 1..100):\n  rest = {label:'kept'}\n  return insert jobs {price, ...rest}\n";
 let new=old.replace("price: int 1..100","price: int 1..100 ?")+"invariant jobs always .price = null or .price != null\nrollback 1 hides jobs where price = null because 'Pending.'\n";
 let a=App::new();a.source(old);a.ok(&["deploy","deploy"]);a.source(&new);a.ok(&["deploy","deploy","--check"]);a.ok(&["deploy","deploy"]);
}
#[test]
fn hiding_spread_supplied_field_is_named_in_preview_refusal(){
 let old="table jobs:\n  price: int 1..100\n  public\n  insert <- allow\n  online only\nmutation add(price: int 1..100):\n  data = {price}\n  return insert jobs {...data}\n";
 let new=old.replace("price: int 1..100","price: int 1..100 ?")+"invariant jobs always .price = null or .price != null\nrollback 1 hides jobs where price = null because 'Pending.'\n";
 let a=App::new();a.source(old);a.ok(&["deploy","deploy"]);a.source(&new);let o=a.run(&["deploy","deploy","--check"]);assert!(!o.status.success());let t=text(&o);assert!(t.contains("jobs.price")&&t.contains("spread")&&t.contains("--exact --check"),"{t}");
}
#[test]
fn unchanged_strict_deploy_does_not_skip_current_security_gates(){
 let a=App::new();let source="table docs:\n  owner: principal\n  read <- allow\n  online only\nquery one(id: docs):\n  return docs[id]\ninvariant docs.read only .owner = viewer\n";a.source(source);
 fs::create_dir_all(a.0.join("fixtures")).unwrap();fs::write(a.0.join("fixtures/docs.jsonl"),"{\"id\":\"kept\",\"owner\":\"dev:other\"}\n").unwrap();
 assert!(!a.run(&["test","--fixture-only"]).status.success());a.ok(&["deploy","deploy","--staging"]);
 let before=a.json(&["releases","deploy"]);
 for args in [&["deploy","deploy","--staging","--strict"][..],&["deploy","deploy","--staging","--strict","--check"][..]] {
  let o=a.run(args);assert!(!o.status.success());assert!(text(&o).contains("E_SECURITY_REVIEW"),"{}",text(&o));
  assert_eq!(a.json(&["releases","deploy"]),before);
 }
}
