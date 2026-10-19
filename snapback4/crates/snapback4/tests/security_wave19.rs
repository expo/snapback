//! Coordinator wave-19 acceptance at the real CLI boundary.
use std::{fs,path::PathBuf,process::{Command,Output},sync::atomic::{AtomicUsize,Ordering}};
const BIN:&str=env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App{
 fn new()->Self{static NEXT:AtomicUsize=AtomicUsize::new(0);let p=std::env::temp_dir().join(format!("sb4-wave19-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));fs::create_dir_all(p.join("snapback")).unwrap();Self(p)}
 fn write(&self,name:&str,text:&str){let path=self.0.join(name);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,text).unwrap();}
 fn run(&self,args:&[&str])->Output{Command::new(BIN).args(args).current_dir(&self.0).env_remove("PORT_LO").env_remove("PORT_HI").output().unwrap()}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn text(o:&Output)->String{format!("{}\n{}",String::from_utf8_lossy(&o.stdout),String::from_utf8_lossy(&o.stderr))}
#[test]
fn empty_and_absent_fixture_directories_both_generate_and_record_test_refutations(){
 let app=App::new();app.write("snapback/schema.q","use identity password\ntable roles:\n  principal: principal\n  role: enum('doctor','volunteer')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\ntable docs:\n  scan: image <=5000\n  read <- exists roles[viewer]\n  insert <- exists roles[viewer,role = 'doctor']\n  online only\nmutation add(scan: image <=5000):\n  return insert docs {scan}\nquery board():\n  return docs first 50 by .id\ninvariant docs.scan read only exists roles[viewer,role = 'doctor']\n");
 for empty in [false,true]{
  if empty{fs::create_dir_all(app.0.join("fixtures")).unwrap();}
  let test=app.run(&["test"]);assert_eq!(test.status.code(),Some(1),"{}",text(&test));assert!(text(&test).contains("generated-fixture-trace"),"{}",text(&test));
  let record:serde_json::Value=serde_json::from_slice(&fs::read(app.0.join("snapback/generated/security-test.json")).unwrap()).unwrap();assert!(!record["violations"].as_array().unwrap().is_empty());
  let check=app.run(&["check"]);assert_eq!(check.status.code(),Some(1),"{}",text(&check));assert!(text(&check).contains("FAIL docs.scan read"),"{}",text(&check));
 }
}
#[test]
fn check_invalidates_positive_test_evidence_when_source_or_fixture_changes(){
 let app=App::new();let source="table docs:\n  status: enum('safe','unsafe')\n  read <- allow\n  online only\ninvariant docs.read only .status = 'safe'\n";app.write("snapback/schema.q",source);app.write("fixtures/docs.jsonl","{\"id\":\"doc\",\"status\":\"unsafe\"}\n");
 let test=app.run(&["test","--fixture-only"]);assert_eq!(test.status.code(),Some(1),"{}",text(&test));assert_eq!(app.run(&["check"]).status.code(),Some(1));
 app.write("fixtures/docs.jsonl","{\"id\":\"doc\",\"status\":\"safe\"}\n");let check=app.run(&["check"]);assert!(check.status.success(),"{}",text(&check));
 app.write("fixtures/docs.jsonl","{\"id\":\"doc\",\"status\":\"unsafe\"}\n");app.write("snapback/schema.q",&source.replace("read <- allow","read <- deny"));let check=app.run(&["check"]);assert!(check.status.success(),"{}",text(&check));
}
#[test]
fn rule_changing_deploy_preview_demands_a_campaign_and_prints_exposure(){
 let app=App::new();let source="table docs:\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery alive():\n  return true\n";app.write("snapback/schema.q",source);let out=app.run(&["deploy","deployment"]);assert!(out.status.success(),"{}",text(&out));
 app.write("snapback/schema.q",&source.replace("read <- .owner = viewer","read <- allow"));let preview=app.run(&["deploy","deployment","--check"]);assert!(preview.status.success(),"{}",text(&preview));let body=text(&preview);assert!(body.contains("security rules changed: run `snapback4 test`"),"{body}");assert!(body.contains("security exposure:"),"{body}");
 let test=app.run(&["test"]);assert!(test.status.success(),"{}",text(&test));let preview=app.run(&["deploy","deployment","--check"]);assert!(text(&preview).contains("matching test campaign recorded"),"{}",text(&preview));
 // A second source change invalidates the record, including a newly added table.
 app.write("snapback/schema.q",&format!("{source}table extra:\n  read <- allow\n  online only\n"));let preview=app.run(&["deploy","deployment","--check"]);assert!(text(&preview).contains("security rules changed: run `snapback4 test`"),"{}",text(&preview));
}

#[test]
fn all_escalation_locations_survive_the_default_five_note_cap(){
 let app=App::new();let mut source=String::new();
 for n in 0..7{source.push_str(&format!("table roles{n}:\n  principal: principal\n  role: enum('manager','guard')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets{n}:\n  read <- exists roles{n}[viewer,role = 'manager']\n  online only\nmutation register{n}(role: enum('manager','guard')):\n  return insert roles{n} {{principal: viewer,role}}\n"));}
 app.write("snapback/schema.q",&source);let check=app.run(&["check"]);let body=text(&check);assert!(check.status.success(),"{body}");for n in 0..7{assert!(body.contains(&format!("register{n}: roles{n}")),"{body}");}assert!(body.contains("'manager'"),"{body}");
}

#[cfg(unix)]
#[test]
fn followed_fixture_symlink_target_changes_invalidate_refutations(){
 let app=App::new();app.write("snapback/schema.q","table docs:\n  status: enum('safe','unsafe')\n  read <- allow\n  online only\ninvariant docs.read only .status = 'safe'\n");
 app.write("rows.jsonl","{\"id\":\"doc\",\"status\":\"unsafe\"}\n");fs::create_dir_all(app.0.join("fixtures")).unwrap();std::os::unix::fs::symlink(app.0.join("rows.jsonl"),app.0.join("fixtures/docs.jsonl")).unwrap();
 let test=app.run(&["test","--fixture-only"]);assert_eq!(test.status.code(),Some(1),"{}",text(&test));assert_eq!(app.run(&["check"]).status.code(),Some(1));
 app.write("rows.jsonl","{\"id\":\"doc\",\"status\":\"safe\"}\n");let check=app.run(&["check"]);assert!(check.status.success(),"{}",text(&check));
}
#[test]
fn a_source_edit_after_fixture_loading_cannot_publish_refutations_for_the_new_source(){
 use std::io::{BufRead,Read};use std::process::Stdio;
 struct Owned(std::process::Child);impl Drop for Owned{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
 let app=App::new();let source="table docs:\n  status: enum('safe','unsafe')\n  read <- allow\n  online only\ninvariant docs.read only .status = 'safe'\n";app.write("snapback/schema.q",source);app.write("fixtures/docs.jsonl","{\"id\":\"doc\",\"status\":\"unsafe\"}\n");
 let mut child=Owned(Command::new(BIN).args(["test","--fixture-only"]).current_dir(&app.0).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap());
 let mut stdout=std::io::BufReader::new(child.0.stdout.take().unwrap());let mut line=String::new();let mut changed=false;
 while stdout.read_line(&mut line).unwrap()!=0{if line.contains("test: loaded 1 rows"){app.write("snapback/schema.q",&source.replace("only .status = 'safe'","only allow"));changed=true;break;}line.clear();}
 assert!(changed,"test must actually reach the captured fixture");let mut remaining=String::new();stdout.read_to_string(&mut remaining).unwrap();let status=child.0.wait().unwrap();let mut stderr=String::new();child.0.stderr.take().unwrap().read_to_string(&mut stderr).unwrap();
 assert_eq!(status.code(),Some(1),"{remaining} {stderr}");assert!(stderr.contains("source or fixtures changed during test"),"{stderr}");assert!(!app.0.join("snapback/generated/security-test.json").exists());let check=app.run(&["check"]);assert!(check.status.success(),"{}",text(&check));
}

#[test]
fn populated_seed_failures_persist_without_quadratic_snapshot_duplication(){
 let app=App::new();app.write("snapback/schema.q","table docs:\n  owner: principal\n  body: text <=400\n  read <- allow\n  online only\ninvariant docs.read only .owner = viewer\n");
 let rows=(0..600).map(|n|serde_json::json!({"id":format!("doc-{n}"),"owner":"dev:owner","body":"x".repeat(300)}).to_string()+"\n").collect::<String>();app.write("fixtures/docs.jsonl",&rows);
 let test=app.run(&["test","--fixture-only"]);assert_eq!(test.status.code(),Some(1),"{}",text(&test));
 let bytes=fs::read(app.0.join("snapback/generated/security-test.json")).unwrap();assert!(bytes.len()<1_000_000,"duplicate initial worlds must not turn 200KB inputs into a 137MB record: {}",bytes.len());
 let record:serde_json::Value=serde_json::from_slice(&bytes).unwrap();assert_eq!(record["violations"].as_array().unwrap().len(),1);assert_eq!(record["violations"][0]["supporting_rows"]["docs"].as_array().unwrap().len(),600);
 let check=app.run(&["check"]);assert_eq!(check.status.code(),Some(1),"{}",text(&check));assert!(text(&check).contains("1 refuted"),"{}",text(&check));
}
