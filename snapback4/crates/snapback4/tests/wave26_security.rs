//! Password-only campaign and individual review UX regressions.
use std::{fs,path::PathBuf,process::{Command,Output},sync::atomic::{AtomicUsize,Ordering}};
struct App(PathBuf);
impl App {
 fn new(source:&str)->Self {static NEXT:AtomicUsize=AtomicUsize::new(0);let root=std::env::temp_dir().join(format!("sb4-wave26-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));fs::create_dir_all(root.join("snapback")).unwrap();fs::write(root.join("snapback/schema.q"),source).unwrap();Self(root)}
 fn run(&self,args:&[&str])->Output {Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).env_remove("PORT_LO").env_remove("PORT_HI").output().unwrap()}
 fn ok(&self,args:&[&str])->String {let out=self.run(args);assert!(out.status.success(),"{args:?}: {out:?}");String::from_utf8(out.stdout).unwrap()}
 fn write(&self,file:&str,text:&str){let path=self.0.join(file);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,text).unwrap();}
}
impl Drop for App{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
const PASSWORD:&str="use identity password\ntable notes:\n  owner: principal\n  body: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add(body: text <=80):\n  return insert notes {owner:viewer,body}\nquery note(id: notes):\n  return notes[id]\ninvariant notes.read only .owner = viewer\n";
#[test]fn clean_password_campaign_passes_with_populated_fixtures_and_no_authored_cases(){
 let app=App::new(PASSWORD);app.write("fixtures/notes.jsonl","{\"id\":\"note-a\",\"owner\":\"user:alice\",\"body\":\"private\"}\n");
 let out=app.ok(&["test"]);assert!(out.contains("no authored business cases")&&out.contains("trusted-fixture campaign only"),"{out}");
 app.ok(&["deploy","deployment"]);
}
#[test]fn password_cases_can_name_an_actual_principal_without_personas(){
 let app=App::new(PASSWORD);app.write("fixtures/notes.jsonl","{\"id\":\"note-a\",\"owner\":\"user:alice\",\"body\":\"private\"}\n");
 app.write("fixtures/test.cases.jsonl","{\"op\":\"note\",\"as\":\"user:alice\",\"args\":{\"id\":\"note-a\"},\"match\":{\"body\":\"private\"}}\n");
 let out=app.ok(&["test"]);assert!(out.contains("cases: 1 passed, 0 failed"),"{out}");
}
#[test]fn an_existing_case_skipped_by_saved_source_selection_still_refuses(){
 let app=App::new(PASSWORD);app.write("fixtures/test.cases.jsonl","{\"op\":\"add\",\"as\":\"user:alice\",\"args\":{\"body\":\"case\"}}\n");
 app.write("versions/v1/schema.q","query old():\n  return true\n");
 let out=app.run(&["test","--source","versions/v1"]);assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("no business cases executed"),"{out:?}");
}
#[test]fn presence_gate_human_output_requires_review_not_performance_tuning(){
 let source=PASSWORD.replace("body: text <=80","body: text <=80");let app=App::new(&source);app.ok(&["check"]);
 app.write("snapback/schema.q",&source.replacen("body: text <=80","body: text <=80 ?",1));
 let out=app.run(&["check"]);assert_eq!(out.status.code(),Some(1));let text=String::from_utf8(out.stdout).unwrap();
 let line=text.lines().find(|line|line.contains("N_PRESENCE_LOOSENING")).expect(&text);
 assert!(!line.contains("slow")&&!line.contains("performance"),"{text}");assert!(text.contains("--ack-security"),"{text}");
}

#[test]fn deliberate_authored_read_design_names_the_exact_replacement_line(){
 let source=PASSWORD.replace("read <- .owner = viewer","read <- allow");let app=App::new(&source);
 let tested=app.run(&["test"]);assert_eq!(tested.status.code(),Some(1),"{tested:?}");
 let refused=app.run(&["deploy","deployment"]);assert_eq!(refused.status.code(),Some(1));let text=format!("{}{}",String::from_utf8_lossy(&refused.stdout),String::from_utf8_lossy(&refused.stderr));
 assert!(text.contains("invariant notes.read only allow")&&text.contains("authored specification change"),"{text}");
 app.write("snapback/schema.q",&source.replace("invariant notes.read only .owner = viewer","invariant notes.read only allow"));app.ok(&["test"]);app.ok(&["deploy","deployment"]);
}

#[test]fn inherited_read_intent_repair_is_authorable_and_preserves_parent_custody(){
 let source="use personas alice,bob\ntable boxes:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ntable notes:\n  box: boxes\n  body: text <=80\n  immutable box\n  read through .box\n  insert <- allow\n  online only\nquery note(id: notes):\n  return notes[id]\ninvariant notes.read only deny\n";
 let app=App::new(source);app.write("fixtures/boxes.jsonl","{\"id\":\"box-a\",\"owner\":\"dev:alice\"}\n");app.write("fixtures/notes.jsonl","{\"id\":\"note-a\",\"box\":\"box-a\",\"body\":\"private\"}\n");
 let refused=app.run(&["deploy","deployment"]);assert_eq!(refused.status.code(),Some(1),"{refused:?}");let text=format!("{}{}",String::from_utf8_lossy(&refused.stdout),String::from_utf8_lossy(&refused.stderr));
 assert!(!text.contains("$readThrough")&&!text.contains(".$box"),"{text}");
 assert!(text.contains("preserve `read through .box`")&&text.contains("parent lifetime/authority"),"{text}");
 let replacement="invariant notes.read only (.box.owner = viewer)";assert!(text.contains(replacement),"{text}");
 app.write("snapback/schema.q",&source.replace("invariant notes.read only deny",replacement));app.ok(&["test"]);app.ok(&["deploy","deployment"]);
}
