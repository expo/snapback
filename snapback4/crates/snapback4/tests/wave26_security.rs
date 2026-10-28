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
 let out=app.ok(&["test","--explain"]);assert!(out.contains("no authored business cases")&&out.contains("trusted-fixture campaign only"),"{out}");
 app.ok(&["deploy","deployment"]);
}
#[test]fn password_cases_can_name_an_actual_principal_without_personas(){
 let app=App::new(PASSWORD);app.write("fixtures/notes.jsonl","{\"id\":\"note-a\",\"owner\":\"user:alice\",\"body\":\"private\"}\n");
 app.write("fixtures/test.cases.jsonl","{\"op\":\"note\",\"as\":\"user:alice\",\"args\":{\"id\":\"note-a\"},\"match\":{\"body\":\"private\"}}\n");
 let out=app.ok(&["test","--explain"]);assert!(out.contains("cases: 1 passed, 0 failed"),"{out}");
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
 assert!(!line.contains("slow")&&!line.contains("performance"),"{text}");assert!(text.contains("invariant notes always .body = null or .body != null")&&text.contains("prose cannot close this gate"),"{text}");
 assert_eq!(text.matches("N_PRESENCE_LOOSENING").count(),1,"a gate is one decision: {text}");
 assert!(text.lines().find(|l|l.starts_with("check: failed")).unwrap().contains("gates pending"));
}

#[test]fn deliberate_authored_read_design_names_the_exact_replacement_line(){
 let source=PASSWORD.replace("read <- .owner = viewer","read <- allow");let app=App::new(&source);
 let tested=app.run(&["test"]);assert_eq!(tested.status.code(),Some(1),"{tested:?}");
 let refused=app.run(&["deploy","deployment"]);assert_eq!(refused.status.code(),Some(1));let text=format!("{}{}",String::from_utf8_lossy(&refused.stdout),String::from_utf8_lossy(&refused.stderr));
 assert!(text.contains("invariant notes.read only allow")&&text.contains("authored specification change"),"{text}");
 app.write("snapback/schema.q",&source.replace("invariant notes.read only .owner = viewer","invariant notes.read only allow"));app.ok(&["test"]);app.ok(&["deploy","deployment"]);
}

#[test]fn inherited_read_intent_repair_is_authorable_and_preserves_parent_custody(){
 let source="use personas alice,bob\ntable seats:\n  owner: principal\n  reader: principal\n  unique byOwnerReader: owner, reader\n  public 'routing fixture'\n  online only\ntable boxes:\n  owner: principal\n  label: text <=80\n  until: time ?\n  immutable owner, label, until\n  expire at .until\n  read <- .owner = viewer and .label = 'plan $tier' and exists seats[owner = .owner, reader = viewer] by byOwnerReader\n  insert <- .owner = viewer\n  online only\ntable notes:\n  box: boxes\n  body: text <=80\n  until: time ?\n  immutable box, until\n  expire at .until\n  read through .box\n  insert <- allow\n  online only\nquery note(id: notes):\n  return notes[id]\ninvariant notes.read only deny\n";
 let app=App::new(source);app.write("fixtures/seats.jsonl","{\"id\":\"seat-a\",\"owner\":\"dev:alice\",\"reader\":\"dev:alice\"}\n");app.write("fixtures/boxes.jsonl","{\"id\":\"box-a\",\"owner\":\"dev:alice\",\"label\":\"plan $tier\",\"until\":1900000000000}\n");app.write("fixtures/notes.jsonl","{\"id\":\"note-a\",\"box\":\"box-a\",\"body\":\"private\",\"until\":1900000000000}\n");
 let refused=app.run(&["deploy","deployment"]);assert_eq!(refused.status.code(),Some(1),"{refused:?}");let text=format!("{}{}",String::from_utf8_lossy(&refused.stdout),String::from_utf8_lossy(&refused.stderr));
 assert!(!text.contains("$readThrough")&&!text.contains(".$box"),"{text}");
 assert!(text.contains("preserve `read through .box`")&&text.contains("parent lifetime/authority"),"{text}");
 let replacement=text.split("replace this assertion with `").nth(1).and_then(|s|s.split('`').next()).expect(&text);
 assert!(replacement.starts_with("invariant notes.read only ")&&replacement.contains(".box.label = 'plan $tier'")&&replacement.contains("by byOwnerReader"),"{text}");
 let changed=source.replace("invariant notes.read only deny",replacement);
 let before=snapback4_lang::compile(&[("schema.q".into(),source.into())]);let after=snapback4_lang::compile(&[("schema.q".into(),changed.clone())]);assert!(after.diagnostics.is_empty(),"{:?}",after.diagnostics);
 for table in ["boxes","notes"] {let a=&before.schema.tables[table];let b=&after.schema.tables[table];assert_eq!(a.through,b.through);assert_eq!(a.rules.read,b.rules.read);assert_eq!(a.expire,b.expire);assert!(b.is_expiring());}
 app.write("snapback/schema.q",&changed);app.ok(&["test"]);app.ok(&["deploy","deployment"]);
}

#[test]fn private_http_test_keeps_unreachable_media_advisory_without_a_blind_gate(){
 let source="use identity password\ntable docs:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- deny\n  online only\ninvariant docs always .photo != null\nmutation add(photo: image <=10000 ?):\n  return insert docs {photo}\n";
 let app=App::new(source);let checked:serde_json::Value=serde_json::from_str(&app.ok(&["check","--json"])).unwrap();assert!(!checked["securityReviews"].as_array().unwrap().iter().any(|d|d["gated"]==true));
 let tested=app.ok(&["test","--explain"]);assert!(tested.contains("security unauthenticated serve HTTP")&&tested.contains("no authored business cases"),"{tested}");
 app.write("versions/v1/schema.q",source);app.write("snapback/schema.q",&source.replace("10000","20000"));app.ok(&["test","--source","versions/v1"]);app.ok(&["test"]);
}

#[test]fn inherited_read_repair_omits_a_generated_maintained_index(){
 let source="use personas alice\ntable entries:\n  bucket: text <=20 ?\n  public 'count input'\n  online only\nview totals: count entries by .bucket\n  read <- allow\n  online only\ntable boxes:\n  bucket: text <=20 ?\n  immutable bucket\n  read <- exists totals[bucket = .bucket, value = 1]\n  insert <- allow\n  online only\ntable notes:\n  box: boxes\n  body: text <=80\n  immutable box\n  read through .box\n  insert <- allow\n  online only\nquery note(id: notes):\n  return notes[id]\ninvariant notes.read only deny\n";
 let app=App::new(source);for(file,data)in[("entries","{\"id\":\"entry-a\",\"bucket\":null}\n"),("boxes","{\"id\":\"box-a\",\"bucket\":null}\n"),("notes","{\"id\":\"note-a\",\"box\":\"box-a\",\"body\":\"private\"}\n")]{app.write(&format!("fixtures/{file}.jsonl"),data);}
 let refused=app.run(&["deploy","deployment"]);assert_eq!(refused.status.code(),Some(1),"{refused:?}");let text=format!("{}{}",String::from_utf8_lossy(&refused.stdout),String::from_utf8_lossy(&refused.stderr));
 let replacement=text.split("replace this assertion with `").nth(1).and_then(|s|s.split('`').next()).expect(&text);
 assert!(replacement.starts_with("invariant notes.read only "),"{text}");assert!(!replacement.contains("$intent:")&&!replacement.contains("by $"),"{text}");
 app.write("snapback/schema.q",&source.replace("invariant notes.read only deny",replacement));app.ok(&["test"]);app.ok(&["deploy","deployment"]);
}

#[test]fn dx9_check_summary_carries_decisions_and_measured_enforcement() {
 let app=App::new(PASSWORD);
 let text=app.ok(&["check"]);
 let summary=text.lines().find(|line|line.starts_with("check: ok")).unwrap();
 assert!(summary.contains("advisories (don't block)")&&summary.contains("check --review")&&summary.contains("0 gates pending"),"{text}");
 assert!(text.contains("check: enforced by the language — 0 typed upload columns with owner-bound placement; 0 column audiences; 0 possible self-assignable role paths detected (bounded analysis)"),"{text}");
 assert!(!text.contains("0 self-assignable roles")&&!text.contains("all security proved"));
 let checked:serde_json::Value=serde_json::from_str(&app.ok(&["check","--json"])).unwrap();
 let family=checked["securityReviews"].as_array().unwrap().iter().find_map(|d|d["family"].as_str()).unwrap();
 let reviewed=app.ok(&["check","--ack-security",family,"--reason","The product specification intentionally admits this owner's audience"]);
 assert!(reviewed.contains("security reviewed"));
}

// @ref LLP 3000.037.000#1-default-verdict — an enforced derived witness cannot also be a nonblocking question.
#[test]fn enforced_derived_witness_is_only_in_the_blocking_tier(){
 let app=App::new(include_str!("../../snapback4-lang/tests/security/wave27/018.q"));
 let output=app.run(&["deploy","deployment","--json"]);
 assert!(!output.status.success(),"the calibrated sibling bypass must still refuse");
 let value:serde_json::Value=serde_json::from_slice(&output.stdout).unwrap();
 let security=value["security"].as_str().map(|s|serde_json::from_str::<serde_json::Value>(s).unwrap()).unwrap_or_else(||value["security"].clone());
 let reviews=security["securityReviews"].as_array().unwrap();
 let blockers=reviews.iter().filter(|d|d["code"]=="N_DERIVED_WRITE_AUTHORITY"&&d["gated"]==true&&!d["acknowledged"].as_bool().unwrap()).collect::<Vec<_>>();
 assert!(!blockers.is_empty(),"{security}");
 let notice=security["notice"].as_str().unwrap();
 for blocker in blockers {assert!(!notice.lines().any(|line|line.starts_with("fix question N_DERIVED_WRITE_AUTHORITY")&&line.contains(blocker["site"].as_str().unwrap())),"{notice}");}
}
