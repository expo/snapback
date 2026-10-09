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

/// Prefetch-reachable reads (`widen.rs`): a page projecting `tags[.tag]` and
/// `tags[name = .label]`, or a loop reading `tags[row.tag]`, makes the batch
/// planner mark, transfer and consume rows (the closed coverage-gap ticket).
/// Consumption shows as fewer database calls with prefetch on.
#[test]
fn widened_reads_fill_and_consume_the_prefetch_cache() {
    use snapback4_difftest::ast::{Body, Proj, Read};
    let mut database = stores::Database::connect()
        .expect("private Postgres cluster required: export SNAPBACK4_EVAL_POSTGRES");
    let mut report = Report::default();
    let reachable = |c: &snapback4_difftest::generate::Case| match &c.program.body {
        Body::Read { kind: Read::Fold, .. } => true,
        Body::Read { project: Some(f), .. } => f.iter().any(|f| *f != Proj::Score),
        _ => false,
    };
    let cases: Vec<_> = (0..).map(generate).filter(reachable).take(12).collect();
    for case in &cases {
        stores::check(case, &mut report, &mut database, |f| panic!("seed {}: {}", case.seed, f.signature)).unwrap();
    }
    let stat = |k: &str| report.store_stats.get(k).copied().unwrap_or(0);
    assert!(stat("store-postgres-on-prefetch_marked_reads") > 0, "{report:#?}");
    assert!(stat("store-postgres-on-prefetch_rows_transferred") > 0, "{report:#?}");
    assert_eq!(stat("store-postgres-off-prefetch_marked_reads"), 0);
    assert!(stat("prefetch_consumption_witness_probes") > 0, "{report:#?}");
    assert!(stat("prefetch_cases_with_transfer") > 0, "{report:#?}");
}
