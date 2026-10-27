//! Wave31 042's administrative default was mistaken for the whole population.
use std::{fs,process::Command};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
#[test]
fn wave31_042_data_all_is_a_single_snapshot_and_default_names_its_repair() {
    let dir=std::env::temp_dir().join(format!("dx15-inspection-{}",std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::create_dir_all(dir.join("fixtures")).unwrap();
    fs::write(dir.join("snapback/schema.q"),"use personas alice\ntable rows:\n  title: text 1..80\n  cap 200\n  public 'inspection fixture'\n  online only\n").unwrap();
    let rows=(0..63).map(|n|format!("{{\"id\":\"row-{n:03}\",\"title\":\"Row {n}\"}}\n")).collect::<String>();
    fs::write(dir.join("fixtures/rows.jsonl"),rows).unwrap();
    for args in [vec!["check"],vec!["seed"]] {
        let out=Command::new(BIN).args(args).current_dir(&dir).output().unwrap();
        assert!(out.status.success(),"{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));
    }
    let inspect=|args:&[&str]|Command::new(BIN).args(args).current_dir(&dir).output().unwrap();
    let limited=inspect(&["data","rows","--json"]);
    let v:serde_json::Value=serde_json::from_slice(&limited.stdout).unwrap();
    assert_eq!(v["rows"].as_array().unwrap().len(),50);assert_eq!(v["more"],true);
    assert!(String::from_utf8_lossy(&limited.stderr).contains("data rows --all"));
    let all=inspect(&["data","rows","--all","--json"]);
    assert!(all.status.success(),"{}",String::from_utf8_lossy(&all.stderr));
    let v:serde_json::Value=serde_json::from_slice(&all.stdout).unwrap();
    assert_eq!(v["rows"].as_array().unwrap().len(),63);assert_eq!(v["more"],false);assert!(v["limit"].is_null());
    assert!(!inspect(&["data","rows","--all","--limit","2"]).status.success());
    fs::remove_dir_all(dir).unwrap();
}
