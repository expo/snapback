//! Wave31 release regressions, each named for the lane that paid for it.
use serde_json::{json,Value};
use snapback4_core::{Engine,Context,store_port::AnyStore};
use std::{fs,path::PathBuf,process::{Command,Output},collections::BTreeMap};
const BIN:&str=env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App {
    fn new()->Self{let path=std::env::temp_dir().join(format!("rel3-{}-{}",std::process::id(),snapback4_core::ids::seed()));fs::create_dir_all(path.join("snapback")).unwrap();Self(path)}
    fn source(&self,s:&str){fs::write(self.0.join("snapback/schema.q"),s).unwrap();}
    fn run(&self,args:&[&str])->Output{Command::new(BIN).args(args).current_dir(&self.0).output().unwrap()}
    fn ok(&self,args:&[&str])->String{let r=self.run(args);assert!(r.status.success(),"{}{}",String::from_utf8_lossy(&r.stdout),String::from_utf8_lossy(&r.stderr));String::from_utf8(r.stdout).unwrap()}
    fn json(&self,args:&[&str])->Value{let mut args=args.to_vec();args.push("--json");serde_json::from_str(&self.ok(&args)).unwrap()}
    fn engine(&self)->Engine{let store=AnyStore::open(&self.0.join("deploy/store.sqlite")).unwrap();let n=store.release_value().unwrap().unwrap().parse().unwrap();Engine::attach_release_at(store,n,snapback4_core::now_ms()).unwrap()}
    fn seed(&self,source:&str,table:&str,row:Value){let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);let value=snapback4_core::wire::row_from_json(&b.schema.tables[table],&row).unwrap();self.engine().seed([(table.into(),value)]).unwrap();}
    fn edit_stage(&self,stage:&str){let mut e=self.engine();let c=Context::new("service:operator",BTreeMap::from([("trunk".into(),snapback4_core::Value::Id("kept".into())),("stage".into(),snapback4_core::Value::String(stage.into()))]));e.mutate("setStage",None,c).unwrap();}
    fn stage(&self)->Value{self.json(&["data","trunks","--release","deploy"])["rows"][0]["stage"].clone()}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
const OLD:&str=include_str!("fixtures/rel3-wave31-041-v1.q");
const NEW:&str=include_str!("fixtures/rel3-wave31-041-v2.q");
fn rolled()->App{let a=App::new();a.source(OLD);a.ok(&["deploy","deploy"]);a.seed(OLD,"trunks",json!({"id":"kept","label":"a","stage":"wood_repair"}));a.source(NEW);a.ok(&["deploy","deploy"]);a.edit_stage("outer_covering");a.ok(&["rollback","deploy","--to","1"]);a}
#[test]
fn wave31_041_redundant_rollback_records_nothing_and_forward_still_restores_native_edit(){
    let a=rolled();let before=a.json(&["releases","deploy"]);
    assert!(a.ok(&["rollback","deploy","--to","1"]).contains("release 1 is already live"));
    let preview=a.json(&["rollback","deploy","--to","1","--check"]);assert_eq!(preview["visibility"]["hiddenRows"],0);
    assert_eq!(a.json(&["releases","deploy"]),before);
    a.ok(&["rollback","deploy","--to","latest","--exact"]);assert_eq!(a.stage(),"outer_covering");
    let status=a.json(&["releases","deploy"]);for event in status["events"].as_array().unwrap(){assert_ne!(event["release"],event["previous"]);}
    assert!(a.ok(&["rollback","--help"]).contains("idempotent no-op"));
}
#[test]
fn wave31_041_legacy_self_transition_repairs_only_validated_native_preimages(){
    let a=rolled();
    // Exact damaged forward receipt from the 0.4.43 lineage reproduction: the
    // down receipt and its native outer_covering remain untouched.
    let c=rusqlite::Connection::open(a.0.join("deploy/store.sqlite")).unwrap();
    c.execute_batch("UPDATE _backfill_evidence SET after_image='{\"stage\":{\"String\":\"recovering\"}}',reversed_image='{\"stage\":{\"String\":\"recovering\"}}',computed_image='{\"stage\":{\"String\":\"wood_repair\"}}' WHERE definition IN (SELECT digest FROM _backfill_definitions); INSERT OR IGNORE INTO _backfill_absence SELECT t,id,'$authored:'||definition,'stage' FROM _backfill_evidence WHERE definition IN (SELECT digest FROM _backfill_definitions); INSERT INTO _release_events SELECT id+1,at,'rollback',1,1,generation,revision+1,summary FROM _release_events ORDER BY id DESC LIMIT 1; UPDATE _meta SET value=CAST(value AS INTEGER)+1 WHERE key='release_revision';").unwrap();drop(c);
    let preview=a.json(&["rollback","deploy","--to","latest","--exact","--check"]);assert_eq!(preview["visibility"]["hiddenRows"],0);
    a.ok(&["rollback","deploy","--to","latest","--exact"]);assert_eq!(a.stage(),"outer_covering");
    a.ok(&["rollback","deploy","--to","1"]);a.edit_stage("teardown");let out=a.run(&["rollback","deploy","--to","latest","--exact"]);
    let text=format!("{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));assert!(!out.status.success());assert!(text.contains("kept")&&text.contains("forward")&&text.contains("trunks.stage"),"{text}");
}
