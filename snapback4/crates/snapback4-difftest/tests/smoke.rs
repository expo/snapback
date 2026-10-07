//! Small fixed-seed campaign plus regression tests for the harness's oracles.
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
