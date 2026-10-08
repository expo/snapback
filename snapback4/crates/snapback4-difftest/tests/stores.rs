#![cfg(feature = "postgres")]
//! Enabling this target requires a real cluster; absence is a setup failure.
use snapback4_difftest::{
    campaign::{self, Report},
    generate::generate,
    stores,
};

#[test]
fn both_stores_all_public_boundaries_and_write_observations() {
    let mut database = stores::Database::connect()
        .expect("private Postgres cluster required: export SNAPBACK4_EVAL_POSTGRES");
    let mut report = Report::default();
    for seed in 0..32 {
        stores::check(&generate(seed), &mut report, &mut database, |_| {}).unwrap();
    }
    let mut insert = generate(0);
    insert.program.body = snapback4_difftest::ast::Body::Write(
        snapback4_difftest::ast::Write::Insert,
        snapback4_difftest::ast::Expr::Int(1),
    );
    insert.program.tables[0].rule = snapback4_difftest::ast::Rule::Allow;
    insert.args["key"] = serde_json::json!("fresh-id");
    stores::check(&insert, &mut report, &mut database, |_| {}).unwrap();
    assert!(report.generator_errors.is_empty(), "{report:#?}");
    assert!(report.runtime_refused_unexpected.is_empty(), "{report:#?}");
    // Heap is charged identically on both stores (the closed heap-accounting
    // ticket): the fixed corpus has no store signature. A new one needs diagnosis.
    let signatures: std::collections::BTreeSet<String> = report
        .by_oracle
        .values()
        .flat_map(|c| c.signatures.keys().cloned())
        .collect();
    assert!(signatures.is_empty(), "new signatures need diagnosis: {signatures:?}");
    assert_eq!(report.compiled, 33);
    for name in ["store-postgres-on", "store-postgres-off"] {
        assert!(report.by_oracle[name].passed > 32, "{report:#?}");
        assert!(report.by_oracle[name].unsupported.is_empty(), "{report:#?}");
        for dimension in [
            "steps",
            "examined",
            "heap_bytes",
            "output_bytes",
            "rows_written",
        ] {
            assert!(
                report.meter_dimensions[&format!("{name}-{dimension}")].passed > 0,
                "{report:#?}"
            );
        }
    }
}

#[test]
fn isolated_process_workers_agree_with_serial_counts() {
    let root = std::env::temp_dir().join(format!("quarry-store-workers-{}", std::process::id()));
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_snapback4-difftest"));
    let mut one = serde_json::to_value(
        campaign::parallel_mode(0, 4, 1, &root.join("one"), executable, true).unwrap(),
    )
    .unwrap();
    let mut two = serde_json::to_value(
        campaign::parallel_mode(0, 4, 2, &root.join("two"), executable, true).unwrap(),
    )
    .unwrap();
    for name in ["seconds", "slowest_case_seconds", "slowest_case_seed"] {
        one.as_object_mut().unwrap().remove(name);
        two.as_object_mut().unwrap().remove(name);
    }
    assert_eq!(one, two);
    std::fs::remove_dir_all(root).unwrap();
}
