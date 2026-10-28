//! Promotion preserves persistent identities and history, not staging authority.
use serde_json::{json,Value};
use snapback4_core::{Engine,identity,store_port::AnyStore};
use std::{fs,path::PathBuf,process::{Command,Output}};
const BIN:&str=env!("CARGO_BIN_EXE_snapback4");
const OLD:&str="use identity password\ntable notes:\n  owner: principal\n  body: text <=100\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nquery list():\n  return notes where .owner = viewer first 20 by .id\nmutation add(body: text <=100):\n  return insert notes {owner:viewer,body}\n";
struct App(PathBuf);
impl App {
 fn new()->Self{let p=std::env::temp_dir().join(format!("promote-{}-{}",std::process::id(),snapback4_core::ids::seed()));fs::create_dir_all(p.join("snapback")).unwrap();fs::write(p.join("snapback/schema.q"),OLD).unwrap();Self(p)}
 fn run(&self,args:&[&str])->Output{Command::new(BIN).args(args).current_dir(&self.0).output().unwrap()}
 fn ok(&self,args:&[&str])->String{let r=self.run(args);assert!(r.status.success(),"{}",text(&r));String::from_utf8(r.stdout).unwrap()}
 fn json(&self,args:&[&str])->Value{let mut args=args.to_vec();args.push("--json");serde_json::from_str(&self.ok(&args)).unwrap()}
 fn store(&self,dir:&str)->AnyStore{AnyStore::open(&self.0.join(dir).join("store.sqlite")).unwrap()}
 fn staging(&self){self.ok(&["deploy","staging","--staging"]);}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn text(r:&Output)->String{format!("{}{}",String::from_utf8_lossy(&r.stdout),String::from_utf8_lossy(&r.stderr))}
#[test]
fn stopped_snapshot_retains_accounts_rows_and_release_cycles_with_new_authority(){
 let a=App::new();a.staging();let store=a.store("staging");let now=snapback4_core::now_ms();
 let account=identity::signup(&store,"promote@example.test","real-password-123",now,&mut snapback4_core::ids::Mint::default()).unwrap();let operator=identity::service_session(&store,"operator",now,1).unwrap();let original_id=store.store_id().unwrap();
 let mut e=Engine::attach_release_at(store,1,now).unwrap();let b=snapback4_lang::compile(&[("schema.q".into(),OLD.into())]);e.seed([("notes".into(),snapback4_core::wire::row_from_json(&b.schema.tables["notes"],&json!({"id":"kept","owner":account.principal,"body":"persistent"})).unwrap())]).unwrap();drop(e);
 fs::write(a.0.join("snapback/schema.q"),OLD.replace("body: text <=100","body: text <=200")).unwrap();a.ok(&["deploy","staging","--staging"]);
 let before=a.json(&["releases","staging"]);let preview=a.json(&["promote","staging","production","--check"]);assert_eq!(preview["preview"],true);assert!(!a.0.join("production").exists());assert_eq!(a.json(&["releases","staging"]),before);
 let promoted=a.json(&["promote","staging","production"]);assert_eq!(promoted["promotion"]["sourceStore"],original_id);assert_eq!(promoted["promotion"]["revokedSessions"],2);
 let prod=a.store("production");assert_eq!(prod.deployment_environment().unwrap().as_deref(),Some("production"));assert_ne!(prod.store_id().unwrap(),original_id);
 for token in [&account.token,&operator.token]{assert!(identity::resolve(&prod,token,now+1000).unwrap().is_none());assert!(identity::rotate_session(&prod,token,now+1000).unwrap().is_none());}
 assert_eq!(identity::login(&prod,"promote@example.test","real-password-123",now+1000).unwrap().principal,account.principal);drop(prod);
 let after=a.json(&["releases","production"]);for k in ["current","latest","generation","revision","events"]{assert_eq!(before[k],after[k],"{k}");}
 assert_eq!(a.json(&["data","notes","--release","production"])["rows"][0]["body"],"persistent");
 for _ in 0..2{a.ok(&["rollback","production","--to","1"]);a.ok(&["rollback","production","--to","latest"]);assert_eq!(a.json(&["data","notes","--release","production"])["rows"].as_array().unwrap().len(),1);}
 let source=a.store("staging");assert_eq!(source.store_id().unwrap(),original_id);assert!(identity::resolve(&source,&operator.token,now+1000).unwrap().is_some());drop(source);
 assert_eq!(a.json(&["releases","staging"]),before);assert!(a.0.join("production/promotion.json").is_file());
}
#[test]
fn existing_nested_production_and_clock_sources_refuse_without_publication(){
 let a=App::new();a.staging();fs::create_dir(a.0.join("existing")).unwrap();
 for target in ["existing","staging/nested","staging"]{let r=a.run(&["promote","staging",target,"--check"]);assert!(!r.status.success(),"{}",text(&r));}
 let store=a.store("staging");let now=snapback4_core::now_ms();store.set_dev_value(snapback4_core::metadata::DevMetadata::StagingClock,&json!({"now":now+60000,"offset":60000,"paused":false}).to_string()).unwrap();drop(store);
 let r=a.run(&["promote","staging","future","--check"]);assert!(!r.status.success());assert!(text(&r).contains("clock"),"{}",text(&r));assert!(!a.0.join("future").exists());
 let store=a.store("staging");store.set_dev_value(snapback4_core::metadata::DevMetadata::StagingClock,&json!({"now":now,"offset":0,"paused":true}).to_string()).unwrap();drop(store);
 let r=a.run(&["promote","staging","paused"]);assert!(!r.status.success());assert!(text(&r).contains("paused"));assert!(!a.0.join("paused").exists());
 a.ok(&["deploy","ordinary"]);let r=a.run(&["promote","ordinary","clone"]);assert!(!r.status.success());assert!(text(&r).contains("staging"));assert!(!a.0.join("clone").exists());
}
#[test]
fn copied_security_refutation_still_blocks_production(){
 let a=App::new();let source=OLD.replace("read <- .owner = viewer","read <- allow")+"query inspect(id: notes):\n  return notes[id]\ninvariant notes.read only .owner = viewer\n";
 fs::write(a.0.join("snapback/schema.q"),source).unwrap();fs::create_dir_all(a.0.join("fixtures")).unwrap();fs::write(a.0.join("fixtures/notes.jsonl"),"{\"id\":\"private\",\"owner\":\"dev:other\",\"body\":\"not public\"}\n").unwrap();a.staging();
 let r=a.run(&["promote","staging","blocked","--check"]);assert!(!r.status.success(),"{}",text(&r));assert!(text(&r).contains("E_SECURITY_REVIEW"),"{}",text(&r));assert!(!a.0.join("blocked").exists());
}
#[test]
fn mismatched_captured_source_refuses_in_preview_and_publication(){
 let a=App::new();a.staging();let path=a.0.join("staging/releases/1/snapback/schema.q");let old=fs::read(&path).unwrap();
 fs::write(&path,OLD.replace("body: text <=100","body: text <=200")).unwrap();
 for check in [true,false]{let mut args=vec!["promote","staging","mismatch"];if check{args.push("--check");}let r=a.run(&args);assert!(!r.status.success(),"{}",text(&r));assert!(text(&r).contains("differs from its activated backend"),"{}",text(&r));assert!(!a.0.join("mismatch").exists());}
 fs::write(path,old).unwrap();a.ok(&["promote","staging","mismatch","--check"]);
}
#[cfg(unix)]
#[test]
fn external_sqlite_alias_copies_its_actual_asset_root_and_refuses_recursion(){
 let a=App::new();let external=a.0.join("external");snapback4_core::private_fs::directory(&external).unwrap();
 let prepared=AnyStore::open(&external.join("store.sqlite")).unwrap();prepared.set_deployment_environment("staging").unwrap();drop(prepared);
 a.ok(&["deploy","staging","--staging","--store","external/store.sqlite"]);
 let now=snapback4_core::now_ms();let mut mint=snapback4_core::ids::Mint::default();
 let asset_id=snapback4_core::ids::mint(now,&mut mint).unwrap();let store=a.store("staging");let owner=identity::signup(&store,"alias@example.test","real-password-123",now,&mut mint).unwrap();
 let asset=snapback4_core::assets::Asset{id:asset_id.clone(),owner:owner.principal,kind:snapback4_core::assets::AssetKind::File,content_type:"text/plain".into(),bytes:4,width:None,height:None,duration:None,created_at:now,home:None,released_at:None,name:Some("retained.txt".into())};store.record_asset(&asset).unwrap();drop(store);
 fs::write(external.join("assets").join(&asset_id),b"good").unwrap();
 fs::create_dir_all(a.0.join("staging/assets")).unwrap();fs::write(a.0.join("staging/assets").join(&asset_id),b"evil").unwrap();
 let nested=a.run(&["promote","staging","external/assets/nested","--check"]);assert!(!nested.status.success());assert!(text(&nested).contains("asset tree"),"{}",text(&nested));
 a.ok(&["promote","staging","production"]);assert_eq!(fs::read(a.0.join("production/assets").join(&asset_id)).unwrap(),b"good");assert_eq!(a.store("production").asset(&asset_id).unwrap(),Some(asset));assert_eq!(fs::read(external.join("assets").join(&asset_id)).unwrap(),b"good");assert_eq!(fs::read(a.0.join("staging/assets").join(&asset_id)).unwrap(),b"evil");
}
