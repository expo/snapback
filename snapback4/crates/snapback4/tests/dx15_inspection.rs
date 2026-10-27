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
    fs::write(dir.join("fixtures/rows.jsonl"),&rows).unwrap();
    // Prepare the store directly; the seed CLI correctly requires a running dev host.
    let source=fs::read_to_string(dir.join("snapback/schema.q")).unwrap();
    let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let table=bound.schema.table("rows").unwrap().clone();
    fs::create_dir_all(dir.join(".snapback4")).unwrap();
    let mut engine=snapback4_core::Engine::new(snapback4_core::Store::open(&dir.join(".snapback4/store.sqlite")).unwrap(),bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let rows=rows.lines().map(|line| ("rows".to_owned(),snapback4_core::wire::row_from_json(&table,&serde_json::from_str(line).unwrap()).unwrap())).collect::<Vec<_>>();
    engine.seed(rows).unwrap();drop(engine);
    let inspect=|args:&[&str]|Command::new(BIN).args(args).current_dir(&dir).output().unwrap();
    let limited=inspect(&["data","rows","--json"]);
    assert!(limited.status.success(),"{}{}",String::from_utf8_lossy(&limited.stdout),String::from_utf8_lossy(&limited.stderr));
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
