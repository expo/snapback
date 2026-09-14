#[path = "lowering/cases.rs"] mod cases;
#[path = "lowering/snapshot.rs"] mod snapshot;
#[test]
fn generate() {
    let mut inputs = cases::generated();
    for (name, source) in &inputs {
        let bound = snapback4_lang::compile(source);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
    }
    let generated = inputs.len();
    inputs.extend(cases::census());
    let records = snapshot::snapshot(inputs, snapshot::baseline, false);
    assert_eq!(records.keys().filter(|name| name.starts_with("generated-") || name.starts_with("gpt-pick:")).count(), generated, "every generated program must compile");
    let output: String = records.iter().map(|record| format!("{}\n", serde_json::to_string(&record).unwrap())).collect();
    std::fs::write(std::env::var("R2P_GOLDEN_OUT").expect("explicit scratch output path"), output).unwrap();
    println!("golden: {generated} generated bundles; {} programs", records.len());
}
