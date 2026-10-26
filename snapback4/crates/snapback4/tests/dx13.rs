use std::{fs,path::PathBuf,process::Command};
struct Scratch(PathBuf);
impl Drop for Scratch {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn scratch(name:&str)->Scratch {let p=std::env::temp_dir().join(format!("dx13-{name}-{}",std::process::id()));fs::create_dir_all(p.join("snapback")).unwrap();Scratch(p)}
fn run(p:&Scratch,args:&[&str])->std::process::Output {Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&p.0).args(args).output().unwrap()}
#[test]
fn cold_default_check_and_deploy_show_concrete_witnesses_without_review() {
 let p=scratch("witness");fs::write(p.0.join("snapback/schema.q"),include_str!("fixtures/dx11/011.q")).unwrap();
 for args in [vec!["check"],vec!["deploy","release"]] {
  let out=run(&p,&args);let text=format!("{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));
  assert!(text.contains("Witness:")&&text.contains("indoorApproved")&&text.contains("is this intended?"),"{text}");
  assert!(text.contains("don't block"),"{text}");
 }
}
#[test]
fn actionable_notes_are_default_visible_but_do_not_fail_compilation() {
 let p=scratch("actionable");fs::write(p.0.join("snapback/schema.q"),"table docs:\n  read <- allow\n  insert <- deny\n  online only\nmutation add():\n  return insert docs {}\n").unwrap();
 let out=run(&p,&["check"]);let text=String::from_utf8_lossy(&out.stdout);
 assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));assert!(text.contains("N_WRITE_DENIED")&&text.contains("fix:"),"{text}");
}
#[test]
fn password_online_starters_have_no_guest_device_or_fixture_residue() {
 for platform in ["--web","--expo"] {
 let p=scratch(if platform=="--web"{"web"}else{"expo"});fs::remove_dir_all(p.0.join("snapback")).unwrap();
 let out=run(&p,&["init",".",platform,"--online","--password"]);assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));
 let schema=fs::read_to_string(p.0.join("snapback/schema.q")).unwrap();assert!(schema.contains("use identity password")&&schema.contains("mutation provision"));assert!(!schema.contains("personas")&&!schema.contains("todos")&&!schema.contains("sync to"));
 assert!(!p.0.join("fixtures/todos.jsonl").exists());let client=fs::read_to_string(p.0.join("src/client.ts")).unwrap();assert!(!client.contains("webDevice")&&!client.contains("nativeDevice"),"{client}");assert!(client.contains("registerWebWitness"));
 let proof=fs::read_to_string(p.0.join("scripts/frontend-proof.mjs")).unwrap();assert!(proof.contains("startStaging")&&proof.contains("beginForm")&&!proof.contains("E_FRONTEND_SCENARIO"));
 let out=run(&p,&["check"]);let text=String::from_utf8_lossy(&out.stdout);assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));assert!(!text.contains("React setup"),"{text}");
 }
}
