//! Wave 15 starter custody and deployment evidence, through the public CLI.
use std::{collections::BTreeMap, fs, path::{Path,PathBuf}, process::{Command,Output}, sync::atomic::{AtomicUsize,Ordering}};
const BIN: &str=env!("CARGO_BIN_EXE_snapback4");
struct App(PathBuf);
impl App {
    fn new() -> Self {
        static NEXT: AtomicUsize=AtomicUsize::new(0);
        let root=std::env::temp_dir().join(format!("sb4-day5-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir(&root).unwrap(); Self(root)
    }
    fn run(&self,args:&[&str])->Output {Command::new(BIN).args(args).current_dir(&self.0).env_remove("PORT_LO").env_remove("PORT_HI").output().unwrap()}
    fn ok(&self,args:&[&str])->String {let out=self.run(args);assert!(out.status.success(),"{args:?}: {out:?}");String::from_utf8(out.stdout).unwrap()}
    fn write(&self,name:&str,text:&str){let path=self.0.join(name);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,text).unwrap();}
    fn read(&self,name:&str)->String {fs::read_to_string(self.0.join(name)).unwrap()}
}
impl Drop for App {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn snapshot(root:&Path)->BTreeMap<PathBuf,Vec<u8>> {
    fn walk(root:&Path,dir:&Path,out:&mut BTreeMap<PathBuf,Vec<u8>>){for entry in fs::read_dir(dir).unwrap(){let entry=entry.unwrap();if entry.file_type().unwrap().is_dir(){walk(root,&entry.path(),out);}else {out.insert(entry.path().strip_prefix(root).unwrap().to_owned(),fs::read(entry.path()).unwrap());}}}
    let mut out=BTreeMap::new();walk(root,root,&mut out);out
}
#[test]
fn generated_campaigns_cover_default_test_but_saved_fixtures_require_business_cases() {
    let app=App::new();app.write("snapback/schema.q","use personas alice\nquery alive():\n  return true\n");
    app.write("versions/v1/schema.q",&app.read("snapback/schema.q"));app.write("versions/v1/fixtures/.gitkeep","");
    let generated=app.ok(&["test"]);
    assert!(generated.contains("no authored business cases") && generated.contains("generated-fixture only"), "{generated}");
    for args in [vec!["test","--source","versions/v1"]] {
        let out=app.run(&args);assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("no business cases executed"),"{out:?}");
        let mut allowed=args;allowed.push("--fixture-only");app.ok(&allowed);
    }
    app.ok(&["test","--fixture","versions/v1/fixtures"]);
    app.write("fixtures/test.cases.jsonl", "{\"op\":\"alive\",\"as\":\"alice\",\"data\":true}\n");
    assert!(!app.ok(&["test","--fixture","fixtures"]).contains("no authored business cases"));
}
#[test]
fn save_version_captures_selected_modules_fixtures_and_the_actual_release_label() {
    let app=App::new();app.write("snapback/schema.q","use personas alice\nquery alive():\n  return true\n");
    app.write("snapback/other.q","query answer():\n  return 42\n");
    app.write("fixtures/test.cases.jsonl","{\"op\":\"alive\",\"as\":\"alice\",\"data\":true}\n");
    app.ok(&["deploy","deployment","--save-version","versions/v1"]);
    for file in ["schema.q","other.q"] {assert_eq!(app.read(&format!("versions/v1/{file}")),app.read(&format!("snapback/{file}")));}
    assert_eq!(app.read("versions/v1/fixtures/test.cases.jsonl"),app.read("fixtures/test.cases.jsonl"));
    let label:serde_json::Value=serde_json::from_str(&app.read("versions/v1/release.json")).unwrap();assert_eq!(label["release"],1);
    assert!(app.read("versions/v1/generated/api.ts").contains("alive"));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&app.read("versions/v1/generated/package.json")).unwrap()["type"],"module");
    app.ok(&["test","--source","versions/v1"]);
    fs::remove_file(app.0.join("versions/v1/release.json")).unwrap();fs::remove_dir_all(app.0.join("versions/v1/generated")).unwrap();
    let refreshed=app.run(&["deploy","deployment","--save-version","versions/v1"]);assert!(refreshed.status.success(),"{refreshed:?}");assert!(String::from_utf8_lossy(&refreshed.stderr).contains("refreshed release 1"));
    assert!(app.read("versions/v1/generated/api.ts").contains("alive"));assert_eq!(serde_json::from_str::<serde_json::Value>(&app.read("versions/v1/release.json")).unwrap()["release"],1);
    app.write("snapback/schema.q","use personas alice\nquery alive():\n  return false\n");
    let mismatch=app.run(&["deploy","deployment","--save-version","versions/v1"]);assert!(!mismatch.status.success());assert!(String::from_utf8_lossy(&mismatch.stderr).contains("selected source differs"));
    app.write("snapback/schema.q","use personas alice\nquery alive():\n  return true\n");
    app.ok(&["deploy","deployment","--save-version","versions/v2"]);
    let label:serde_json::Value=serde_json::from_str(&app.read("versions/v2/release.json")).unwrap();assert_eq!(label["release"],1,"unchanged deploy saves its actual label");
    app.write("fixtures/test.cases.jsonl","working fixture must not leak into saved-source capture");
    app.ok(&["deploy","deployment","--schema","versions/v1","--save-version","versions/v3"]);
    assert_eq!(app.read("versions/v3/fixtures/test.cases.jsonl"),app.read("versions/v1/fixtures/test.cases.jsonl"));
}

#[test]
fn an_empty_saved_flat_source_is_unsaved_and_cannot_be_deployed_or_tested() {
    let app=App::new();app.write("snapback/schema.q","query alive():\n  return true\n");
    app.write("versions/v1.q"," \n");
    for args in [vec!["test","--source","versions/v1.q","--fixture-only"],vec!["deploy","deployment","--schema","versions/v1.q","--save-version","versions/v2"]] {
        let out=app.run(&args);assert!(!out.status.success(),"{out:?}");
        assert!(String::from_utf8_lossy(&out.stderr).contains("not saved yet"),"{out:?}");
        assert!(!app.0.join("versions/v2").exists());
    }
}

#[test]
fn residency_without_executing_cases_requires_fixture_only_too() {
    let app=App::new();app.write("snapback/schema.q","use personas alice\nquery alive():\n  return true\n");
    let refused=app.run(&["test","--residency"]);
    assert!(!refused.status.success());assert!(String::from_utf8_lossy(&refused.stderr).contains("--fixture-only"));
    app.ok(&["test","--residency","--fixture-only"]);
}

#[test]
fn failed_deploy_discards_only_its_new_snapshot_and_deployed_source_cannot_save_into_itself() {
    let app=App::new();app.write("snapback/schema.q","query alive():\n  return true\n");app.ok(&["deploy","deployment"]);
    app.write("snapback/schema.q","query alive():\n  return true\njob missing(): native\n");
    let failed=app.run(&["deploy","deployment","--save-version","versions/v2"]);
    assert!(!failed.status.success());assert!(!app.0.join("versions/v2").exists());
    let immutable=app.0.join("deployment/releases/1");
    let out=Command::new(BIN).current_dir(&immutable).args(["deploy",app.0.join("deployment").to_str().unwrap(),"--save-version","versions/v3"]).output().unwrap();
    assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("deployment custody"),"{out:?}");
    assert!(!immutable.join("versions").exists());
}

#[test]
fn missing_saved_directory_and_empty_working_snapshot_are_not_saved_yet() {
    let app=App::new();app.write("snapback/schema.q"," \n");
    let missing=app.run(&["test","--source","versions/v7","--fixture-only"]);
    assert!(!missing.status.success());assert!(String::from_utf8_lossy(&missing.stderr).contains("not saved yet"),"{missing:?}");
    let empty=app.run(&["deploy","deployment","--save-version","versions/v1"]);
    assert!(!empty.status.success());assert!(String::from_utf8_lossy(&empty.stderr).contains("not saved yet"),"{empty:?}");
    assert!(!app.0.join("versions/v1").exists());
}

#[test]
fn generated_password_campaign_prepares_live_read_through_without_a_dev_store() {
    let app=App::new();
    app.write("snapback/schema.q", "use identity password\ntable parents:\n  owner: principal\n  read <- .owner = viewer\n  online only\ntable children:\n  parent: parents\n  immutable parent\n  cap 20 by parent\n  read through live .parent\n  online only\nquery parents():\n  return parents first 10 by .id\n");
    let text=app.ok(&["test"]);
    assert!(text.contains("security unauthenticated serve HTTP"),"{text}");
    assert!(!app.0.join(".snapback4/store.sqlite").exists());
}
