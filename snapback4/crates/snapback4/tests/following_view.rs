//! The exact target compiles through the CLI and reports truthful feed costs.
use std::{fs, process::Command};
const SOURCE: &str = include_str!("../../snapback4-sim/tests/fixtures/intent-clique.q");
#[test]
fn full_target_check_cost_reports_one_inbox_and_meter_bounded_residuals() {
    let dir=std::env::temp_dir().join(format!("sb4-following-view-cost-{}-{}",std::process::id(),snapback4_core::now_ms()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"),SOURCE).unwrap();
    let run=|args:&[&str]|Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&dir).output().unwrap();
    let text=run(&["check","--cost"]);
    assert!(text.status.success(),"{}",String::from_utf8_lossy(&text.stderr));
    let text=String::from_utf8(text.stdout).unwrap();
    assert!(text.contains("query home:"),"{text}");
    assert!(text.contains("followingFeed.byReaderTime last 20"),"{text}");
    let json=run(&["check","--cost","--json"]);assert!(json.status.success());
    let json:serde_json::Value=serde_json::from_slice(&json.stdout).unwrap();
    let home=json["scale"].as_array().unwrap().iter().find(|c|c["operation"]=="home").unwrap();
    // Stale/tombstoned candidates can consume the meter. A page size cannot
    // certify a population-independent number of skipped rows.
    assert_eq!(home["class"],"grows");
    assert_eq!(home["bounds"]["lanes"],0,"one direct inbox scan, no author merge lanes");
    assert!(home["growth_sites"].as_array().unwrap().iter().any(|g|g["reason"].as_str().unwrap().contains("Following `following`")));
    println!("MEASURE target home scale={home}");
    fs::remove_dir_all(dir).unwrap();
}
