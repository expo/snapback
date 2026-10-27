//! Wave-32 reading and waiting paths, through the actual CLI and starter.
use std::{fs, path::PathBuf, process::{Command, Output}};
struct Project(PathBuf);
impl Project { fn new(name: &str) -> Self { let p=std::env::temp_dir().join(format!("tok1-{}-{name}",std::process::id()));let _=fs::remove_dir_all(&p);fs::create_dir_all(p.join("snapback")).unwrap(); Self(p) }
fn cli(&self,args:&[&str])->Output { Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&self.0).env("SNAPBACK4_INIT_INSTALL","0").output().unwrap() } }
impl Drop for Project { fn drop(&mut self){let _=fs::remove_dir_all(&self.0);} }
#[test]
fn wave32_codex_001_025_and_muse_019_028_first_schema_deltas_and_signatures() {
    let p=Project::new("read");
    let first=p.cli(&["guide","start"]);assert!(first.status.success());assert!(first.stdout.len()<=8001);
    let second=p.cli(&["guide","start"]);let delta=String::from_utf8_lossy(&second.stdout);assert!(delta.contains("new: 0 blocks"),"{delta}");
    assert_eq!(p.cli(&["guide","start","--repeat"]).stdout,first.stdout);
    let start=snapback4_lang::guide::card("start").unwrap();let source=snapback4_lang::guide::quarry(start).remove(0);
    fs::write(p.0.join("snapback/schema.q"),source).unwrap();
    let checked=p.cli(&["check"]);assert!(checked.status.success(),"{}",String::from_utf8_lossy(&checked.stderr));
    let generated=p.cli(&["guide","api","generated"]);assert!(generated.status.success());let index=String::from_utf8_lossy(&generated.stdout);
    assert!(index.contains("openRequest(")&&index.contains("photo:"));assert!(index.len()<3000);
    for module in ["client","proof","auth"] { let out=p.cli(&["guide","api",module]);assert!(out.status.success());assert!(String::from_utf8_lossy(&out.stdout).contains("Declaration fingerprint")); }
}
#[test]
fn wave32_muse_028_starter_prints_a_custody_map_and_every_script_names_signature_digests() {
    let p=Project::new("init");fs::remove_dir(p.0.join("snapback")).unwrap();
    let out=p.cli(&["init","--web","--online","--password","--no-install"]);
    assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));let text=String::from_utf8_lossy(&out.stdout);
    assert!(text.starts_with("# Start:"));assert!(text.contains("Starter map"));assert!(text.contains("verify with `npm run probe:check`"));
    for file in fs::read_dir(p.0.join("scripts")).unwrap().flatten() {
        if file.path().extension().is_some_and(|s|s=="mjs") { let text=fs::read_to_string(file.path()).unwrap();assert!(text.lines().take(3).any(|line|line.contains("guide api proof")),"{}",file.path().display()); }
    }
    let probe=fs::read_to_string(p.0.join("scripts/probe-serve.mjs")).unwrap();
    assert!(probe.find("probeServeGuard();").unwrap()<probe.find("await startStaging").unwrap());
}

#[test]
fn wave32_codex_025_and_muse_019_028_feature_routes_are_unambiguous() {
    let p=Project::new("routes");
    for (name, section) in [("rules", "Column read rules"), ("security", "Reference"), ("uploads", "Copy the same image"), ("time", "Values"), ("jobs", "Operations")] {
        let out=p.cli(&["guide",name,"--section",section,"--repeat"]);
        assert!(out.status.success(),"{name}: {}",String::from_utf8_lossy(&out.stdout));
        assert!(!out.stdout.is_empty());
    }
}

#[test]
fn failed_init_restores_preexisting_package_before_any_history_or_install() {
    let p=Project::new("rollback");
    let original = r#"{"name":"kept","private":true}"#;
    fs::write(p.0.join("package.json"),original).unwrap();
    fs::create_dir_all(p.0.join("snapback/generated/package.json")).unwrap();
    let out=p.cli(&["init","--web","--online","--password","--no-install"]);
    assert!(!out.status.success());
    assert_eq!(fs::read_to_string(p.0.join("package.json")).unwrap(), original);
    assert!(!p.0.join(".snapback4").exists());
}
