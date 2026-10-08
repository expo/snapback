//! Small fixed-seed campaigns (engine oracles and the server-against-device
//! oracle) plus regression tests for the harness's oracles.
use serde_json::json;
use snapback4_difftest::{
    ast::*,
    campaign::{self, Report},
    execute,
    generate::generate,
    oracle::{self, Rewrite, Verdict},
    shrink,
};

#[test]
fn fixed_seeds_compile_execute_and_continue() {
    let mut report = Report::default();
    for seed in 0..32 {
        campaign::check(&generate(seed), &mut report, |_| {});
    }
    assert!(!report.failed(), "{report:#?}");
    assert_eq!(report.compiled, 32);
    assert!(report.executed > 32);
    assert!(
        report.pages_with_resumable_cut * 2 > report.pageable_reads,
        "{report:#?}"
    );
    for name in [
        "rewrite-identity",
        "rewrite-lazy-or",
        "rewrite-lazy-and",
        "repeat",
    ] {
        assert!(report.by_oracle[name].passed > 0, "{report:#?}");
    }
}

#[test]
fn helper_calls_have_distinct_arguments_and_skipped_assertions_do_not_run() {
    let mut case = generate(0);
    case.program.tables.clear();
    case.rows.clear();
    case.program.lets.clear();
    case.args["n"] = json!(null);
    let add = Expr::Binary(Bin::Add, Box::new(Expr::Int(1)), Box::new(Expr::Int(2)));
    case.program.body = Body::Scalar(add);
    let rewritten = Rewrite::Identity.apply(&case.program).unwrap();
    let mut engine = execute::engine(&case, &rewritten.source()).unwrap();
    assert_eq!(
        execute::execute(&mut engine, &case, "run", &case.args).data(),
        Some(&json!({"Int":3}))
    );
    for (rewrite, expected) in [(Rewrite::LazyOr, true), (Rewrite::LazyAnd, false)] {
        case.program.body = Body::Scalar(Expr::Bool(expected));
        let source = rewrite.apply(&case.program).unwrap().source();
        let mut engine = execute::engine(&case, &source).unwrap();
        let out = execute::execute(&mut engine, &case, "run", &case.args);
        assert_eq!(out.data(), Some(&json!({"Bool":expected})), "{out:?}");
        assert!(out.refusal().is_none());
    }
    case.program.body = Body::Scalar(Expr::Assert(Box::new(Expr::Arg(
        "n".into(),
        Type::Nullable(Box::new(Type::Int)),
    ))));
    let mut engine = execute::engine(&case, &case.program.source()).unwrap();
    assert_eq!(
        execute::execute(&mut engine, &case, "run", &case.args)
            .refusal()
            .unwrap()["code"],
        "NULL_ASSERT"
    );
}

#[test]
fn site_address_changes_replay_as_equivalent() {
    for signature in [
        "rewrite-identity--why--NOT_FOUND",
        "rewrite-let--refusal--NULL_ASSERT",
    ] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("cases/found")
            .join(signature);
        assert!(
            matches!(shrink::replay(&path).unwrap(), Verdict::Pass),
            "{signature}"
        );
    }
}

#[test]
fn semantic_checks_still_run_when_meter_fields_are_omitted() {
    let a = execute::Outcome {
        kind: "query".into(),
        value: json!({"data":{"Int":3},"complete":true,"cut":null,"capped_at":null,"next":"cursor","metered":{"steps":1},"tables":["items"],"next_expiry":100,"refusal":{"code":"X","site":"run:1"}}),
    };
    let mut b = a.clone();
    b.value["metered"]["steps"] = json!(2);
    assert_eq!(oracle::field(&a, &b, true), None);
    assert_eq!(oracle::field(&a, &b, false).as_deref(), Some("metered"));
    for key in [
        "data",
        "complete",
        "cut",
        "capped_at",
        "next",
        "tables",
        "next_expiry",
        "refusal",
    ] {
        let mut changed = b.clone();
        changed.value[key] = json!("different");
        assert!(oracle::field(&a, &changed, true).is_some(), "{key}");
    }
    b.value["refusal"]["site"] = json!("unrelated:1");
    assert_eq!(oracle::field(&a, &b, true).as_deref(), Some("refusal"));
}

#[test]
fn parallel_workers_preserve_seed_counts() {
    let root = std::env::temp_dir().join(format!("quarry-difftest-workers-{}", std::process::id()));
    let one = campaign::run(0, 8, &root.join("one")).unwrap();
    let two = campaign::parallel(
        0,
        8,
        2,
        &root.join("two"),
        std::path::Path::new(env!("CARGO_BIN_EXE_snapback4-difftest")),
    )
    .unwrap();
    let mut one = serde_json::to_value(one).unwrap();
    let mut two = serde_json::to_value(two).unwrap();
    one.as_object_mut().unwrap().remove("seconds");
    two.as_object_mut().unwrap().remove("seconds");
    assert_eq!(one, two);
    std::fs::remove_dir_all(root).unwrap();
}

/// Server and device agree on every meter field, heap included, since the
/// uniform heap charge (the closed heap-accounting ticket). A new signature
/// needs diagnosis.
const DEVICE_KNOWN: [&str; 0] = [];

#[test]
fn device_oracle_fixed_seeds_on_both_device_stores() {
    use snapback4_difftest::devices;
    let mut report = Report::default();
    let mut files = devices::Files::new().unwrap();
    for seed in 0..40 {
        devices::check(&generate(seed), &mut report, &mut files, |_| {}).unwrap();
    }
    // A predicted insert, its settlement and convergence on both stores.
    let mut insert = generate(0);
    insert.program.body = Body::Write(Write::Insert, Expr::Int(1));
    insert.program.tables[0].rule = Rule::Allow;
    insert.program.tables[0].residency = Residency::Public;
    insert.args["key"] = json!("fresh-id");
    devices::check(&insert, &mut report, &mut files, |_| {}).unwrap();
    assert!(report.generator_errors.is_empty(), "{report:#?}");
    let signatures: std::collections::BTreeSet<_> = report.by_oracle.values().flat_map(|c| c.signatures.keys().cloned()).collect();
    assert_eq!(signatures, DEVICE_KNOWN.iter().map(|s| s.to_string()).collect(), "new or missing signatures need diagnosis");
    for store in devices::STORES {
        let read = &report.by_oracle[&format!("device-{store}-read")];
        assert!(read.passed >= 20 && read.disagreeing == 0, "{report:#?}");
        // Only residency withholds a read in this corpus; never a pass.
        assert!(read.unsupported.keys().all(|k| k.starts_with("online-only-")), "{report:#?}");
        assert!(report.by_oracle[&format!("device-{store}-cut")].passed > 200, "{report:#?}");
        // The corpus writes are online only; the planted insert predicts.
        assert_eq!(report.by_oracle[&format!("device-{store}-write")].passed, 1, "{report:#?}");
        assert_eq!(report.by_oracle[&format!("device-{store}-converge")].passed, 2, "{report:#?}");
        assert_eq!(report.store_stats[&format!("device-{store}-write-insert-predicted")], 1);
        assert!(report.store_stats[&format!("device-{store}-snapshot-pages")] > 40);
    }
}
