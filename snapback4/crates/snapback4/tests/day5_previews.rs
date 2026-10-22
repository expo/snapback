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
fn trailing_new_column_guard_tightens_and_rollback_leads_with_its_code() {
    let app=App::new();
    let v1="use personas alice\ntable plans:\n  owner: principal\n  public\n  online only\nmutation book(plan: plans):\n  p = plans[plan]! else MISSING\n  require p.owner = viewer else NOT_OWNER\n  return true\n";
    let v2=v1.replace("  owner: principal","  owner: principal\n  available: bool default true").replace("  return true", "  require p.available = true else UNAVAILABLE 'inspection required'\n  return true");
    app.write("snapback/schema.q",v1);app.ok(&["deploy","deployment"]);
    app.write("snapback/schema.q",&v2);
    let preview=app.ok(&["deploy","deployment","--check","--json"]);
    let json:serde_json::Value=serde_json::from_str(&preview).unwrap();
    assert!(json["notes"].as_array().unwrap().iter().any(|v|v.as_str().unwrap().contains("tightens book.require")),"{preview}");
    assert!(json["hazards"].as_array().unwrap().iter().all(|v|!v.as_str().unwrap().contains("book.require")),"{preview}");
    app.ok(&["deploy","deployment"]);
    let text=app.ok(&["rollback","deployment","--to","1","--check","--bridge","bridge"]);
    let first=text.lines().find(|line|line.contains("WARNING")).unwrap();assert!(first.contains("book.require") && first.contains("UNAVAILABLE"),"{text}");
    let bridge=app.read("bridge/schema.q");
    assert!(bridge.contains("mutation book(plan: plans)")&&bridge.contains("NOT_OWNER")&&bridge.contains("UNAVAILABLE")&&bridge.contains("available: bool default true"),"generated source must compile with the carried current guard: {bridge}");
    assert!(app.read("bridge/ROLLBACK-CHECKLIST.md").contains("carried current safety guards"));
    assert!(app.read("bridge/ROLLBACK-CHECKLIST.md").contains("UNAVAILABLE"));
    app.ok(&["deploy","deployment","--schema","bridge","--check"]);
    let out=app.run(&["rollback","deployment","--to","1","--check","--bridge","bridge"]);assert!(!out.status.success());
    app.write("snapback/schema.q",&v2.replace("NOT_OWNER","DIFFERENT"));
    let changed=app.ok(&["deploy","deployment","--check","--json"]);assert!(changed.contains("DIFFERENT"));
    let changed:serde_json::Value=serde_json::from_str(&changed).unwrap();
    assert!(changed["hazards"].as_array().unwrap().iter().any(|v|v.as_str().unwrap().contains("book.require")));
    assert!(changed["notes"].as_array().unwrap().iter().all(|v|!v.as_str().unwrap().contains("tightens book.require")));
}

#[test]
fn normal_preview_keeps_every_column_change_and_hides_only_index_internals() {
    let app=App::new();
    let v1="use personas alice\ntable followups:\n  dueAt: time\n  title: text <=80\n  obsolete: text <=20\n  public\n  online only\nquery all():\n  return followups first 10 by .id\n";
    let v2=v1.replace("  obsolete: text <=20\n","").replace("  title: text <=80","  title: text <=160\n  label: text <=20 default 'new'")+"query due():\n  return followups first 10 by .dueAt\n";
    app.write("snapback/schema.q",v1);app.ok(&["deploy","deployment"]);
    app.write("snapback/schema.q",&v2);
    let text=app.ok(&["deploy","deployment","--check"]);
    for column in ["followups.title","followups.label","followups.obsolete"] {assert!(text.contains(column),"{column}: {text}");}
    assert!(!text.contains("$intent:") && !text.contains(".indexes."),"{text}");
    let verbose=app.ok(&["deploy","deployment","--check","--verbose"]);
    assert!(verbose.contains(".indexes."),"{verbose}");
    app.ok(&["deploy","deployment"]);
    let rollback=app.ok(&["rollback","deployment","--to","1","--check"]);
    assert!(!rollback.contains("$intent:") && !rollback.contains(".indexes."),"{rollback}");
}

#[test]
fn bridge_rejects_immutable_deployment_custody_including_symlink_aliases() {
    let app=App::new();app.write("snapback/schema.q","query alive():\n  return true\n");app.ok(&["deploy","deployment"]);
    let release=app.0.join("deployment/releases/1");let before=snapshot(&release);
    let out=app.run(&["rollback","deployment","--to","1","--check","--bridge","deployment/releases/1/bridge"]);
    assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("deployment custody"),"{out:?}");
    #[cfg(unix)] {
        std::os::unix::fs::symlink(app.0.join("deployment"),app.0.join("alias")).unwrap();
        let out=app.run(&["rollback","deployment","--to","1","--check","--bridge","alias/releases/1/bridge"]);
        assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("deployment custody"),"{out:?}");
    }
    assert_eq!(snapshot(&release),before);
    let text=app.ok(&["deploy","deployment"]);assert!(text.contains("unchanged"),"{text}");
}
#[test]
fn grouped_rollback_keeps_all_quotas_and_confidentiality_loss() {
    let app=App::new();
    let v1="use personas alice\ntable plans:\n  owner: principal\n  team: text <=20\n  cap 10 by owner\n  cap 20 by team\n  public\n  online only\n";
    let v2=v1.replace("cap 10 by owner","cap 12 by owner").replace("cap 20 by team","cap 24 by team").replace("  public","  read <- .owner = viewer");
    app.write("snapback/schema.q",v1);app.ok(&["deploy","deployment"]);
    app.write("snapback/schema.q",&v2);app.ok(&["deploy","deployment"]);
    let text=app.ok(&["rollback","deployment","--to","1","--check"]);
    for fact in ["cap 12 by owner; cap 24 by team", "cap 10 by owner; cap 20 by team", "confidentiality"] {assert!(text.contains(fact),"{fact}: {text}");}
}

#[test]
fn a_table_named_indexes_keeps_its_column_changes() {
    let app=App::new();
    let v1="table indexes:\n  title: text <=80\n  public\n  online only\nquery all():\n  return indexes first 10 by .id\n";
    app.write("snapback/schema.q",v1);app.ok(&["deploy","deployment"]);
    app.write("snapback/schema.q",&v1.replace("  title: text <=80","  title: text <=80\n  label: text <=20 default 'new'"));
    let text=app.ok(&["deploy","deployment","--check"]);
    assert!(text.contains("indexes.label"),"{text}");
}

#[test]
fn missing_owner_sidecar_refuses_preview_until_canonical_ownership_is_reestablished() {
 for staging in [false,true] {
    let app=App::new();app.write("snapback/schema.q","use identity password\nquery alive():\n  return true\n");
    app.ok(if staging {&["deploy","deployment","--staging"]}else{&["deploy","deployment"]});
    let database=app.0.join("deployment/store.sqlite").canonicalize().unwrap();let owner=snapback4_core::private_fs::owner_path(&database);fs::remove_file(&owner).unwrap();
    app.write("snapback/schema.q","use identity password\nquery alive():\n  return false\n");
    let out=app.run(&["deploy","deployment","--check"]);assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("missing owner sidecar"),"{out:?}");assert!(!owner.exists());
    let out=app.run(&["check","--store","deployment/store.sqlite","--release","1"]);assert!(!out.status.success());assert!(String::from_utf8_lossy(&out.stderr).contains("missing owner sidecar"),"{out:?}");assert!(!owner.exists());
    // Rollback owns the canonical command guard already; preview reuses it.
    app.ok(&["rollback","deployment","--to","1","--check"]);assert!(owner.exists());app.ok(&["deploy","deployment","--check"]);
 }
}

#[test]
fn an_old_operation_routing_new_writes_into_a_new_table_names_the_old_read_gap() {
    let app=App::new();
    let old="table notes:\n  text: text <=40\n  public\n  online only\nmutation add(text: text <=40):\n  return insert notes {text}\nquery oldRead():\n  return notes first 10 by .id\n";
    app.write("snapback/schema.q",old);app.ok(&["deploy","deployment"]);
    let new=old.replace("insert notes {text}","insert observations {text}")+"table observations:\n  text: text <=40\n  public\n  online only\n";
    app.write("snapback/schema.q",&new);
    let preview=app.ok(&["deploy","deployment","--check","--json"]);
    let json:serde_json::Value=serde_json::from_str(&preview).unwrap();
    assert!(json["hazards"].as_array().unwrap().iter().any(|h|h.as_str().unwrap().contains("operation add remains callable by old clients but now writes newer-only table observations")),"{preview}");
    assert_eq!(json["visibility"]["hiddenRows"],0);
}
