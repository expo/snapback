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
fn commuting_a_refused_operand_preserves_semantics_without_equal_cost() {
    let artifact: shrink::Artifact = serde_json::from_str(include_str!(
        "../cases/found/rewrite-commute--metered--E_OVERFLOW/case.json"
    )).unwrap();
    let mut case = artifact.case;
    for swap in [false, true] {
        if swap { case.program = Rewrite::Commute.apply(&case.program).unwrap(); }
        let source = case.program.source();
        let mut engine = execute::engine(&case, &source).unwrap();
        let outcome = execute::execute(&mut engine, &case, "run", &case.args);
        assert_eq!(outcome.refusal().unwrap()["code"], "E_OVERFLOW");
        assert!(Rewrite::Commute.costs_for(&case.program, &outcome));
        assert!(matches!(oracle::rewrite(&case, &Rewrite::Commute, &source).unwrap().0, Verdict::Pass));
    }
    // A successful expression still compares the full meter record.
    case.args["b"] = json!(1);
    let source = case.program.source();
    let mut engine = execute::engine(&case, &source).unwrap();
    let outcome = execute::execute(&mut engine, &case, "run", &case.args);
    assert!(outcome.refusal().is_none());
    assert!(!Rewrite::Commute.costs_for(&case.program, &outcome));
    assert!(matches!(oracle::rewrite(&case, &Rewrite::Commute, &source).unwrap().0, Verdict::Pass));
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
        assert!(read.passed >= 15 && read.disagreeing == 0, "{report:#?}");
        // Only residency withholds a read in this corpus; never a pass.
        assert!(read.unsupported.keys().all(|k| k.starts_with("online-only-")), "{report:#?}");
        assert!(report.by_oracle[&format!("device-{store}-cut")].passed > 200, "{report:#?}");
        // Most corpus writes are online only; the planted insert predicts.
        let write = &report.by_oracle[&format!("device-{store}-write")];
        assert!(write.passed >= 1 && write.disagreeing == 0, "{report:#?}");
        assert!(report.by_oracle[&format!("device-{store}-converge")].passed >= 2, "{report:#?}");
        assert!(report.store_stats[&format!("device-{store}-write-insert-predicted")] >= 1);
        // Widened writes: blocks reach the device's admission.
        assert!(report.store_stats.keys().any(|k| k.starts_with(&format!("device-{store}-write-block-"))), "{report:#?}");
        assert!(report.store_stats[&format!("device-{store}-snapshot-pages")] > 40);
    }
}

/// Widening (`widen.rs`) draws from its own stream: a seed it leaves alone is
/// the base case byte for byte, and every widened case compiles and carries
/// one of the new dimensions.
#[test]
fn widening_keeps_unwidened_seeds_and_every_dimension_compiles() {
    use snapback4_difftest::generate::base;
    let mut seen = std::collections::BTreeSet::new();
    for seed in 0..600 {
        let case = generate(seed);
        let plain = base(seed);
        let source = case.program.source();
        execute::compile(&source).unwrap_or_else(|e| panic!("seed {seed}: {e}\n{source}"));
        let mut dims = vec![];
        if case.program.tables.iter().any(|t| t.name == "tags") {
            dims.push("prefetch-read");
        }
        if matches!(case.program.body, Body::Block(_)) {
            dims.push("block");
        }
        if !case.program.prelude.is_empty() {
            dims.push("prelude");
        }
        if case.program.tables[0].expire.is_some() {
            dims.push("expiry");
        }
        // LLP 3000.040 §5: calendar bodies and bounded `score`, from their own stream.
        if case.program.time_arg {
            dims.push("calendar");
        }
        if case.program.tables[0].columns.iter().any(|c| matches!(c.ty, snapback4_difftest::ast::Type::IntRange(..))) {
            dims.push("bounded");
        }
        if case.program.arg_bound.is_some() {
            dims.push("bounded-arg");
        }
        // LLP 3000.036.001: branch pages, from their own stream.
        let read_rule = case.program.tables[0].effects.as_ref().map_or(&case.program.tables[0].rule, |effects| &effects[0]);
        if case.program.domain.as_deref().is_some_and(|domain| domain.contains(" or "))
            || read_rule == &snapback4_difftest::ast::Rule::TwoParty
            || read_rule == &snapback4_difftest::ast::Rule::OwnerOrWitness
                && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. }) {
            dims.push("branches");
        }
        if case.program.kids.is_some() {
            dims.push("references");
        }
        if case.program.residual.as_deref().is_some_and(|r| r.contains(".tag.rank")) {
            dims.push("reference-predicate");
        }
        if matches!(case.program.tables[0].residency, Residency::Group) {
            dims.push("group-pages");
        }
        if dims.is_empty() {
            assert_eq!(serde_json::to_value(&case).unwrap(), serde_json::to_value(&plain).unwrap(), "seed {seed}");
        }
        seen.extend(dims);
    }
    assert_eq!(seen.len(), 11, "{seen:?}");
}

#[test]
fn lean_generator_reaches_a_capped_unpinned_membership_page() {
    let case = (0..2_000).map(snapback4_difftest::lean::generate).find(|case| {
        let table = &case.program.tables[0];
        let read = table.effects.as_ref().map_or(&table.rule, |effects| &effects[0]);
        read == &Rule::OwnerOrWitness
            && case.program.domain.as_deref() == Some("true")
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. })
    }).expect("membership-page stream must be reachable");
    let access = case.program.tables.iter().find(|table| table.name == "access").unwrap();
    assert_eq!(access.caps, vec![(16, vec!["principal".into()])]);
    assert!(access.keys.iter().any(|(_, columns, unique)| !unique && columns.iter().map(String::as_str).eq(["principal", "bucket"])));
    let features = snapback4_difftest::lean::features(&case);
    assert!(features.iter().any(|feature| feature == "branch-rule-membership"), "{features:?}\n{}", case.program.source());
    assert!(features.iter().any(|feature| feature == "branch-merged"), "{features:?}\n{}", case.program.source());
}

/// The shrinker reduces the new shapes structurally: a planted predicate
/// that holds while any `upsert` remains keeps exactly one statement and
/// drops the projection, the other prelude steps, expiry and sweeps.
#[test]
fn shrinking_reduces_blocks_preludes_projections_and_expiry() {
    let case = (0..)
        .map(generate)
        .find(|c| {
            !c.program.prelude.is_empty()
                && c.program.tables[0].expire.is_some()
                && c.program.prelude.len() > 1
                && c.program.prelude.iter().chain(match &c.program.body {
                    Body::Block(b) => Some(b),
                    _ => None,
                })
                .flat_map(|b| b.all())
                .filter(|s| matches!(s, Stmt::Write { .. }))
                .count()
                    > 2
                && c.program.source().contains("upsert items[")
        })
        .unwrap();
    let planted = |c: &snapback4_difftest::generate::Case, source: &str, o: &oracle::Oracle| -> Result<Verdict, String> {
        let hit = source.contains("upsert items[");
        let out = execute::Outcome { kind: "query".into(), value: json!({}) };
        Ok(if hit { oracle::disagreement(o, "planted", out.clone(), out, vec![]) } else { Verdict::Pass })
            .map(|v| {
                let _ = c;
                v
            })
    };
    let Verdict::Disagree(finding) = planted(&case, &case.program.source(), &oracle::Oracle::Repeat).unwrap() else { unreachable!() };
    let artifact = shrink::shrink_with(case.clone(), finding, planted);
    let small = &artifact.case;
    let writes: Vec<_> = small
        .program
        .prelude
        .iter()
        .chain(match &small.program.body {
            Body::Block(b) => Some(b),
            _ => None,
        })
        .flat_map(|b| b.all())
        .filter(|s| matches!(s, Stmt::Write { .. }))
        .collect();
    assert!(writes.len() <= 1, "{}", small.program.source());
    assert!(small.program.prelude.len() <= 1, "{}", small.program.source());
    assert!(small.program.tables.iter().all(|t| t.expire.is_none()), "{}", small.program.source());
    assert!(small.seeded_at.is_none() && !small.sweep && small.steps.iter().all(|s| !s.sweep && s.viewer.is_none()));
    assert!(small.rows.is_empty(), "{:?}", small.rows);
    assert!(small.program.source().contains("upsert items["));
}

// @ref LLP 3000.007#20.24.1 — the generated reference predicate must be checked by continuation, not just compile.
#[test]
fn generated_reference_predicate_is_reached_by_the_meter_oracle() {
    let mut case = (0..600).map(generate).find(|c| c.program.residual.as_deref() == Some(".tag.rank = 1")).unwrap();
    case.program.tables[0].rule = Rule::Allow;
    case.program.tables[0].residency = Residency::Public;
    case.program.tables[0].expire = None;
    case.program.tables[0].keys.retain(|(name, _, _)| name != "byTag");
    case.program.tables.iter_mut().find(|t| t.name == "tags").unwrap().expire = None;
    case.program.body = Body::Read { kind: Read::Page, take: 2, descending: true, filter: false, owner: false, project: None };
    case.program.order = Some(vec!["score".into()]);
    case.program.domain = None;
    case.program.prelude.clear(); case.steps.clear();
    case.args["bucket"] = json!(0);
    case.rows.clear();
    for (id, score) in [("t1", 10), ("t2", 5)] {
        case.rows.push(("items".into(), json!({"id":id,"owner":"alice","bucket":0,"score":score,"label":"","flag":true,"maybe":null,"tag":"m1"})));
    }
    case.rows.push(("tags".into(), json!({"id":"m1","owner":"alice","rank":1,"name":"target"})));
    let mut report = Report::default();
    campaign::check(&case, &mut report, |_| {});
    assert!(!report.failed(), "{report:#?}");
    assert!(report.pages_with_resumable_cut > 0);
    assert_eq!(report.coverage["read/reference-predicate"], 1);
}
