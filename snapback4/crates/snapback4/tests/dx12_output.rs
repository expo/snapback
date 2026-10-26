//! DX12 changes presentation only; full evidence and refusal status survive.
use std::{fs,path::PathBuf,process::{Command,Output}};
struct App(PathBuf);
impl App {
 fn new()->Self {let p=std::env::temp_dir().join(format!("dx12-output-{}-{}",std::process::id(),{static N:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);N.fetch_add(1,std::sync::atomic::Ordering::Relaxed)}));fs::create_dir_all(p.join("snapback")).unwrap();Self(p)}
 fn write(&self,text:&str){fs::write(self.0.join("snapback/schema.q"),text).unwrap();}
 fn run(&self,args:&[&str])->Output{Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).output().unwrap()}
 fn ok(&self,args:&[&str])->String{let r=self.run(args);assert!(r.status.success(),"{args:?}: {r:?}");String::from_utf8(r.stdout).unwrap()}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
const SOURCE:&str="table notes:\n  title: text <=80\n  public 'fixture'\nquery list():\n  return notes first 20 by .id\n";
#[test]fn deploy_rollback_and_releases_lead_with_verdict_and_keep_live_identity(){
 let app=App::new();app.write(SOURCE);
 let initial=app.run(&["deploy","production"]);assert!(initial.status.success(),"{initial:?}");
 let first=String::from_utf8(initial.stdout).unwrap();let diagnostics=String::from_utf8(initial.stderr).unwrap();
 let verdict=first.lines().next().unwrap();assert!(verdict.contains("0 gates")&&verdict.contains("0 witnessed questions")&&verdict.contains("advisories (don't block)"),"{verdict}");
 assert!(first.lines().count()+diagnostics.lines().count()<=5,"{first}{diagnostics}");assert!(first.starts_with("deploy verdict: READY"),"{first}");assert!(first.lines().nth(1).unwrap().starts_with("live:"),"{first}");assert!(!first.contains("decision "),"{first}");
 app.write(&SOURCE.replace("<=80","<=160"));let second=app.ok(&["deploy","production"]);assert!(!second.contains("preview:"),"{second}");
 let rolled=app.ok(&["rollback","production","--to","1"]);assert!(rolled.starts_with("rollback verdict: READY"),"{rolled}");assert!(rolled.lines().nth(1).unwrap().starts_with("live:"),"{rolled}");
 let short=app.ok(&["releases","production"]);assert!(short.starts_with("releases verdict: READY"),"{short}");assert!(short.lines().count()<=4,"{short}");
 let json:serde_json::Value=serde_json::from_str(&app.ok(&["releases","production","--json"])).unwrap();assert!(json["live"].is_object());assert!(json["events"].is_array());
 let review=app.run(&["deploy","other","--review"]);assert!(review.status.success(),"{review:?}");let full=format!("{}{}",String::from_utf8_lossy(&review.stdout),String::from_utf8_lossy(&review.stderr));assert!(full.contains("decision ")||full.contains("REVIEW"),"{full}");
}
#[test]fn gates_remain_explicit_and_blocking_with_next_steps(){
 let app=App::new();app.write("table docs:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ninvariant docs always .photo != null\nmutation add(photo: image <=10000 ?):\n  return insert docs {photo}\n");
 // SEC10 does not gate an unreachable insertion. Use the explicit prior
 // required-presence contract so this remains a real blocking-gate control.
 let optional=fs::read_to_string(app.0.join("snapback/schema.q")).unwrap().replace("invariant docs always .photo != null\n", "");
 app.write(&optional.replace("image <=10000 ?","image <=10000"));app.ok(&["check"]);
 app.write(&optional);
 let r=app.run(&["deploy","production"]);assert!(!r.status.success());let err=String::from_utf8_lossy(&r.stderr);assert!(err.contains("deploy verdict: REFUSED")&&err.contains("N_PRESENCE_LOOSENING")&&err.contains("Intended:")&&err.contains("Repair:"),"{err}");
 let json:serde_json::Value=serde_json::from_slice(&app.run(&["deploy","production","--json"]).stdout).unwrap();assert_eq!(json["ok"],false);assert!(json["security"]["securityReviews"].as_array().unwrap().iter().any(|d|d["gated"]==true&&d["acknowledged"]==false));
}
