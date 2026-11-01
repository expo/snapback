//! check --quick is an iteration verdict: it says what it skipped and leaves full check evidence alone.
use std::{fs,path::PathBuf,process::{Command,Output}};
struct App(PathBuf);
impl App {
 fn new(name:&str,source:&str)->Self {let p=std::env::temp_dir().join(format!("check-quick-{name}-{}",std::process::id()));let _=fs::remove_dir_all(&p);fs::create_dir_all(p.join("snapback")).unwrap();fs::write(p.join("snapback/schema.q"),source).unwrap();Self(p)}
 fn run(&self,args:&[&str])->Output{Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).output().unwrap()}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
const REFUTED:&str="table docs:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs always .photo != null\nmutation add(photo: image <=10000 ?):\n  return insert docs { photo }\n";
#[test]fn a_quick_pass_names_the_skipped_search_and_plain_check_still_refutes(){
 let app=App::new("refuted",REFUTED);
 let quick=app.run(&["check","--quick"]);assert!(quick.status.success(),"{quick:?}");
 let text=String::from_utf8(quick.stdout).unwrap();
 assert!(text.starts_with("check: ok (quick)"),"{text}");assert!(text.contains("security search, server typecheck and native build not run"),"{text}");assert!(text.contains("run snapback4 check before finishing"),"{text}");
 assert!(app.0.join("snapback/generated/api.ts").is_file(),"iteration still needs client types");
 let json=app.run(&["check","--quick","--json"]);assert!(json.status.success(),"{json:?}");
 let json:serde_json::Value=serde_json::from_slice(&json.stdout).unwrap();
 assert_eq!(json["quick"],true);assert_eq!(json["notRun"],serde_json::json!(["securitySearch","serverTypecheck","nativeBuild"]));
 let plain=app.run(&["check"]);assert_eq!(plain.status.code(),Some(1),"{plain:?}");
 assert!(String::from_utf8_lossy(&plain.stdout).contains("security invariant refuted"),"{plain:?}");
}
#[test]fn quick_saves_no_check_evidence(){
 let app=App::new("evidence",REFUTED);
 assert!(app.run(&["check","--quick"]).status.success());
 for path in [".snapback4/check-surface.json","snapback/generated/security-witnesses.json","snapback/generated/residency.json"] { assert!(!app.0.join(path).exists(),"{path}"); }
}
#[test]fn quick_still_refuses_what_does_not_compile(){
 let app=App::new("broken","table docs:\n  photo: nonsense\n");
 let quick=app.run(&["check","--quick"]);assert_eq!(quick.status.code(),Some(1),"{quick:?}");
 assert!(!String::from_utf8_lossy(&quick.stdout).contains("check: ok"),"{quick:?}");
}
#[test]fn quick_refuses_flags_that_need_the_full_check(){
 let app=App::new("flags",REFUTED);
 for flag in ["--review","--verbose","--fix","--ack-notes","--proof-draft","--audit","--cost","--residency"] {
  let refused=app.run(&["check","--quick",flag]);assert_eq!(refused.status.code(),Some(2),"{flag}: {refused:?}");
  assert!(String::from_utf8_lossy(&refused.stderr).contains("check --quick takes only"),"{flag}: {refused:?}");
 }
}
