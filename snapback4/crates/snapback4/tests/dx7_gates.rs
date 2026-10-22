use std::{fs,path::PathBuf,process::Command};
use serde_json::Value;
struct Scratch(PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn scratch()->Scratch{let p=std::env::temp_dir().join(format!("sb4-dx7-gates-{}",std::process::id()));fs::create_dir_all(p.join("snapback")).unwrap();Scratch(p)}
const SOURCE:&str="table docs:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ninvariant docs always .photo != null\nmutation add(photo: image <=10000 ?):\n  return insert docs {photo}\n";
fn run(p:&Scratch,args:&[&str])->std::process::Output{Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&p.0).output().unwrap()}
#[test]
fn upgrade_delta_reports_gates_and_refuted_acknowledgments_are_explicit(){
 let p=scratch();fs::write(p.0.join("snapback/schema.q"),SOURCE).unwrap();
 let first=run(&p,&["check","--json"]);assert_eq!(first.status.code(),Some(1));
 let path=p.0.join(".snapback4/check-surface.json");let mut old:Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();old["version"]="0.4.35".into();old["notes"]=serde_json::json!({});old.as_object_mut().unwrap().remove("pending_gates");fs::write(&path,serde_json::to_vec(&old).unwrap()).unwrap();
 let delta=run(&p,&["check"]);let output=String::from_utf8_lossy(&delta.stdout);
 assert_eq!(delta.status.code(),Some(1));assert!(output.contains("pending security review gates: N_OPTIONAL_UPLOAD_CREATE: 1"),"{output}");assert!(output.contains("N_OPTIONAL_UPLOAD_CREATE +1"),"{output}");assert!(!output.contains("new refusals: none"));assert!(output.contains("--ack-security"));
 fs::write(p.0.join("snapback/schema.q"),format!("{SOURCE}\ntable exposed:\n  owner: principal\n  read <- allow\n  online only\ninvariant exposed.read only .owner = viewer\n")).unwrap();
 fs::create_dir_all(p.0.join("fixtures")).unwrap();fs::write(p.0.join("fixtures/exposed.jsonl"),"{\"id\":\"one\",\"owner\":\"dev:other\"}\n").unwrap();
 let campaign=run(&p,&["test","--fixture-only"]);assert_eq!(campaign.status.code(),Some(1),"{}",String::from_utf8_lossy(&campaign.stdout));
 let checked=run(&p,&["check","--json"]);let facts:Value=serde_json::from_slice(&checked.stdout).unwrap();let id=facts["securityReviews"].as_array().unwrap().iter().find(|d|d["gated"]==true).unwrap()["id"].as_str().unwrap();
 let result=run(&p,&["check","--json","--ack-security",id,"--reason","cannot override refutation"]);assert_eq!(result.status.code(),Some(1));let facts:Value=serde_json::from_slice(&result.stdout).unwrap();assert!(facts["acknowledgmentNotApplied"].as_str().unwrap().contains("cannot override a concrete counterexample"));assert!(!p.0.join("snapback/security-reviews.json").exists());
}
