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
fn preview_covers_every_applied_path_and_metadata_including_package_order() {
    for mode in ["--web","--expo"] {
        let app=App::new();app.ok(&["init",mode]);
        let mut pkg:serde_json::Value=serde_json::from_str(&app.read("package.json")).unwrap();
        pkg.as_object_mut().unwrap().remove("snapback4");
        app.write("package.json",&serde_json::to_string(&pkg).unwrap());
        let before=snapshot(&app.0);
        let preview=app.ok(&["init","--adapt"]);
        assert_eq!(snapshot(&app.0),before);
        assert!(preview.contains("extend package.json") && preview.contains("snapback4.starter.day2") && preview.contains("script key ordering"),"{preview}");
        app.ok(&["init","--adapt","--apply"]);
        for (path,bytes) in snapshot(&app.0) {
            if before.get(&path)!=Some(&bytes) {assert!(preview.contains(path.to_str().unwrap()),"unpreviewed {path:?}: {preview}");}
        }
        for path in before.keys().filter(|p|!app.0.join(p).exists()) {assert!(preview.contains(path.to_str().unwrap()),"unpreviewed removal: {path:?}");}
    }
}
#[test]
fn inherited_placeholder_todo_snapshot_and_legacy_difference_are_named() {
    let app=App::new();app.ok(&["init","--web"]);
    app.write("scripts/day2-proof.mjs",include_str!("../src/verbs/init/previous/day2-proof-0.4.30.mjs"));
    app.write("versions/v1/schema.q",&app.read("snapback/schema.q"));
    app.write("versions/v1.q","query old():\n  return true\n");
    let out=app.run(&["check"]);assert!(out.status.success(),"{out:?}");
    let advice=String::from_utf8(out.stdout).unwrap()+&String::from_utf8(out.stderr).unwrap();
    for wanted in ["0.4.30 assert.fail", "todo snapshot", "sha256", "versions/v1.q differs from versions/v1/schema.q"] {assert!(advice.contains(wanted),"{wanted}: {advice}");}
    let saved=app.read("versions/v1/schema.q");
    app.ok(&["init","--adapt","--day2","--apply"]);
    assert_eq!(app.read("versions/v1/schema.q"),saved);
    assert_eq!(app.read("versions/v1.q"),"query old():\n  return true\n");
}
#[test]
fn legacy_flat_sources_differ_from_newly_captured_v1_in_the_preview() {
    let app=App::new();app.ok(&["init","--web"]);
    app.write("versions/v1.q","query legacy():\n  return false\n");
    let text=app.ok(&["init","--adapt","--day2"]);
    assert!(text.contains("versions/v1.q differs from versions/v1/schema.q"),"{text}");
    assert!(!app.0.join("versions/v1").exists());
}
#[test]
fn custom_schema_starters_have_no_todo_proof_or_leftovers_after_adaptation() {
    let schema="use identity\nquery alive():\n  return true\n";
    for mode in ["--web","--expo"] {for first in [true,false] {
        let app=App::new();
        if first {app.ok(&["init",mode]);}
        app.write("snapback/schema.q",schema);
        if first {let preview=app.ok(&["init","--adapt"]);assert!(preview.contains("remove scripts/frontend-proof.mjs"),"{preview}");app.ok(&["init","--adapt","--apply"]);} else {app.ok(&["init",mode]);}
        assert!(!app.0.join("scripts/frontend-proof.mjs").exists());
        assert!(!app.0.join("fixtures/todos.jsonl").exists());
        assert!(!app.0.join("fixtures/test.cases.jsonl").exists());
        let readme=app.read("README.md");assert!(!readme.contains("# Todos") && !readme.contains("npm run frontend:proof"),"{readme}");
        let pkg:serde_json::Value=serde_json::from_str(&app.read("package.json")).unwrap();
        assert!(pkg["scripts"].as_object().unwrap().values().all(|v|v!="node scripts/frontend-proof.mjs"));
        app.ok(&["check"]);
    }}
}

#[test]
fn legacy_comparison_covers_non_schema_and_multi_module_snapshots() {
    let app=App::new();app.ok(&["init","--web"]);
    fs::remove_file(app.0.join("snapback/schema.q")).unwrap();
    let current="query alive():\n  return true\n";
    app.write("snapback/main.q",current);
    app.write("versions/v1.q","query alive():\n  return false\n");
    let preview=app.ok(&["init","--adapt","--day2"]);
    assert!(preview.contains("versions/v1.q differs from versions/v1/main.q"),"{preview}");
    app.ok(&["init","--adapt","--day2","--apply"]);
    let checked=app.ok(&["check"]);
    assert!(checked.contains("versions/v1.q differs from versions/v1/main.q"),"{checked}");
    assert_eq!(app.read("versions/v1/main.q"),current);
    app.write("versions/v1.q",current);
    assert!(!app.ok(&["check"]).contains("versions/v1.q differs"));
    app.write("versions/v1/extra.q","query other():\n  return true\n");
    let multiple=app.ok(&["check"]);
    assert!(multiple.contains("versions/v1.q differs") && multiple.contains("versions/v1/extra.q") && multiple.contains("versions/v1/main.q"),"{multiple}");
}

#[test]
fn recognized_older_native_helper_keeps_age_advice_across_a_sign_in_switch() {
    let app=App::new();app.ok(&["init","--expo"]);
    app.write("snapback/schema.q",&app.read("snapback/schema.q").replace("use identity","use identity password"));
    app.write("src/native-smoke.ts",include_str!("../src/verbs/init/starter/previous/wave14/native-smoke.ts"));
    for command in [&["check"][..],&["init","--adapt"][..]] {
        let text=app.ok(command);
        let line=text.lines().find(|line|line.contains("src/native-smoke.ts:") || line.contains("rewrite src/native-smoke.ts")).unwrap();
        assert!(line.contains("an older starter version") && line.contains("refresh also updates its sign-in mode") && !line.contains("previous schema"),"{text}");
    }
    app.ok(&["init","--adapt","--apply"]);
    assert!(app.read("src/native-smoke.ts").contains("smokeAccount"));
    assert!(!app.ok(&["check"]).contains("src/native-smoke.ts:"));
}
