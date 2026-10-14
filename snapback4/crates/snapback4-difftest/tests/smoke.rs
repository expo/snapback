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

// Match tests/lean.rs: native/compiler coverage remains mandatory without
// the optional model, and a requested Lean qualification never skips it.
fn model_built() -> bool {
    snapback4_difftest::lean::refresh().unwrap_or_else(|error| panic!("{error}"));
    let path = snapback4_difftest::lean::oracle_path();
    if path.is_file() { return true; }
    if std::env::var_os("SNAPBACK4_REQUIRE_LEAN").is_some() {
        panic!("SNAPBACK4_REQUIRE_LEAN is set but {} is missing: cd snapback4/lean && lake build", path.display());
    }
    eprintln!("SKIPPED (Lean oracle not built at {}): cd snapback4/lean && lake build", path.display());
    false
}

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
    // Plant one read and one write from the single-clock lower-lifetime
    // fragment into both device stores. Backlog publication has separate
    // lifecycle coverage; these cases seed at the request clock.
    for mutation in [false, true] {
        let mut timed = (0..5_000).map(generate).find(|case|
            case.program.tables[0].not_before.is_some() && case.program.mutation() == mutation
        ).expect("timed generator must reach reads and writes");
        timed.program.tables[0].rule = Rule::Allow;
        timed.program.tables[0].effects = None;
        timed.program.tables[0].residency = Residency::Public;
        devices::check(&timed, &mut report, &mut files, |_| {}).unwrap();
    }
    for unique in ["insert", "upsert"] {
        let mut timed = (0..20_000).map(generate).find(|case| match unique {
            "insert" => matches!(case.program.body, Body::Write(Write::Insert, _))
                && case.rows.iter().any(|(table, row)| table == "items" && row["tag"] == "tag"
                    && row["opensAt"].as_i64().is_some_and(|at| at > case.clock)),
            "upsert" => case.program.upsert_unique_tag.is_some(),
            _ => unreachable!(),
        }).unwrap_or_else(|| panic!("timed generator must reach future unique {unique}"));
        timed.program.tables[0].residency = Residency::Public;
        devices::check(&timed, &mut report, &mut files, |_| {}).unwrap();
    }
    let membership = (0..10_000).map(generate).find(|case| {
        let read = case.program.tables[0].effects.as_ref().map_or(&case.program.tables[0].rule, |effects| &effects[0]);
        read == &Rule::OwnerOrWitness
            && case.program.tables.iter().find(|table| table.name == "access").is_some_and(|table| table.caps.is_empty())
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. })
    }).expect("uncapped membership generator must be reachable");
    devices::check(&membership, &mut report, &mut files, |_| {}).unwrap();
    let id_membership = (0..10_000).map(generate).find(|case| {
        let read = case.program.tables[0].effects.as_ref().map_or(&case.program.tables[0].rule, |effects| &effects[0]);
        read == &Rule::OwnerOrIdWitness
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. })
    }).expect("by-id membership generator must be reachable");
    devices::check(&id_membership, &mut report, &mut files, |_| {}).unwrap();
    // A predicted insert, its settlement and convergence on both stores.
    let mut insert = generate(0);
    insert.program.body = Body::Write(Write::Insert, Expr::Int(1));
    insert.program.tables[0].rule = Rule::Allow;
    insert.program.tables[0].residency = Residency::Public;
    insert.args["key"] = json!("fresh-id");
    devices::check(&insert, &mut report, &mut files, |_| {}).unwrap();
    assert!(report.generator_errors.is_empty(), "{report:#?}");
    assert!(report.coverage["not-before/exact-boundary"] >= 2, "{report:#?}");
    assert!(report.coverage["not-before/future"] >= 2, "{report:#?}");
    assert!(report.coverage["read/branch-rule-membership-uncapped"] >= 1, "{report:#?}");
    assert!(report.coverage["read/branch-rule-membership-id"] >= 1, "{report:#?}");
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
        if case.program.tables[0].not_before.is_some() {
            dims.push("not-before");
        }
        if case.program.search_term.is_some() {
            dims.push("timed-search");
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
            || matches!(read_rule, snapback4_difftest::ast::Rule::OwnerOrWitness | snapback4_difftest::ast::Rule::OwnerOrIdWitness)
                && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. }) {
            dims.push("branches");
        }
        if matches!(read_rule, Rule::PureIdWitness | Rule::CompoundGrant | Rule::CompoundMembership | Rule::RoleGrant)
            || read_rule == &Rule::Witness && case.program.domain.as_deref() == Some("true") {
            dims.push("page3");
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
        if dims.is_empty() && !snapback4_difftest::lean::features(&case).iter().any(|f| f.starts_with("page4/")) {
            assert_eq!(serde_json::to_value(&case).unwrap(), serde_json::to_value(&plain).unwrap(), "seed {seed}");
        }
        seen.extend(dims);
    }
    assert_eq!(seen.len(), 14, "{seen:?}");
}

#[test]
fn timed_disclosure_generation_covers_edges_reads_and_writes() {
    let mut reads = false;
    let mut writes = false;
    let mut future_targets = std::collections::BTreeSet::new();
    let mut future_unique_insert = false;
    let mut future_unique_upsert = false;
    for seed in 0..100_000 {
        let case = generate(seed);
        if case.program.tables[0].not_before.is_none() { continue }
        assert!(case.seeded_at.is_none() && case.steps.is_empty(), "seed {seed}");
        let values = case.rows.iter().filter(|(table, _)| table == "items")
            .map(|(_, row)| row["opensAt"].clone()).collect::<Vec<_>>();
        for expected in [json!(null), json!(case.clock - 1), json!(case.clock), json!(case.clock + 1)] {
            assert!(values.contains(&expected), "seed {seed}: {values:?}");
        }
        execute::compile(&case.program.source()).unwrap_or_else(|e| panic!("seed {seed}: {e}"));
        if matches!(case.program.body, Body::Write(Write::Insert, _))
            && case.rows.iter().any(|(table, row)| table == "items" && row["tag"] == "tag"
                && row["opensAt"].as_i64().is_some_and(|at| at > case.clock))
        {
            future_unique_insert = true;
            assert!(case.rows.iter().all(|(_, row)| row["id"] != case.args["key"]), "seed {seed}");
            let source = case.program.source();
            let mut engine = execute::seeded(&case, &source).unwrap();
            let outcome = execute::execute(&mut engine, &case, "run", &case.args);
            assert_eq!(outcome.refusal().unwrap()["code"], "E_RULE", "seed {seed}: {outcome:?}");
        }
        if let Some(tag) = &case.program.upsert_unique_tag {
            future_unique_upsert = true;
            let target = case.rows.iter().find(|(table, row)| table == "items" && row["tag"] == tag.as_str()).unwrap();
            assert_eq!(target.1["opensAt"], json!(case.clock + 1), "seed {seed}");
            assert!(case.program.source().contains(&format!("upsert items[tag = {tag:?}]")), "seed {seed}");
            let source = case.program.source();
            let mut engine = execute::seeded(&case, &source).unwrap();
            let outcome = execute::execute(&mut engine, &case, "run", &case.args);
            assert!(outcome.refusal().is_none(), "seed {seed}: {outcome:?}");
            assert_eq!(outcome.data().cloned(), Some(json!("Null")), "future patch must stay hidden: seed {seed}: {outcome:?}");
        }
        if case.program.mutation() {
            writes = true;
            if let Body::Write(kind @ (Write::Update | Write::Upsert | Write::Delete), _) = &case.program.body {
                let key = case.args["key"].as_str().unwrap();
                let target = case.rows.iter().find(|(table, row)| table == "items" && row["id"] == key).unwrap();
                assert_eq!(target.1["opensAt"], json!(case.clock + 1), "seed {seed}");
                future_targets.insert(format!("{kind:?}"));
            }
        } else {
            reads = true;
        }
        if reads && writes && future_targets.len() == 3 && future_unique_insert && future_unique_upsert { break }
    }
    assert!(reads && writes);
    assert_eq!(future_targets, ["Delete", "Update", "Upsert"].map(String::from).into());
    assert!(future_unique_insert && future_unique_upsert);
}

#[test]
fn timed_search_generation_compares_future_word_heads_natively() {
    let cases = (0..400).map(generate).filter(|case| case.program.search_term.is_some() && !snapback4_difftest::lean::features(case).iter().any(|f| f.starts_with("page4/"))).collect::<Vec<_>>();
    assert!(!cases.is_empty(), "the standard 400-case campaign must reach timed search");
    for case in cases {
        let source = case.program.source();
        execute::compile(&source).unwrap_or_else(|e| panic!("seed {}: {e}", case.seed));
        assert!(source.contains("matching \"a\" first 2 by byWords after c"), "seed {}: {source}", case.seed);
        let mut engine = execute::seeded(&case, &source).unwrap();
        let first = execute::execute(&mut engine, &case, "run", &case.args);
        assert_eq!(first.data().and_then(|data| data.get("Array")).and_then(|rows| rows.as_array()).map(Vec::len), Some(2),
            "both shared-word live siblings must be returned: seed {}: {first:?}\n{:?}", case.seed, case.rows);
        assert!(first.next().is_none(), "the online-only nonuniform search must withhold a continuation: seed {}", case.seed);
        let (verdict, pages) = oracle::timed_search_future_absence(&case, &source).unwrap();
        assert!(matches!(verdict, Verdict::Pass), "seed {}: {verdict:?}", case.seed);
        assert_eq!(pages, 2, "the paired first pages must settle without a continuation: seed {}", case.seed);
        let reason = snapback4_difftest::lean::module(&source).unwrap_err();
        assert_eq!(reason, "index-computed-or-words", "Lean must explicitly exclude the words index, seed {}", case.seed);
    }
}

#[test]
fn lean_generator_reaches_an_uncapped_unpinned_membership_page() {
    let case = (0..2_000).map(snapback4_difftest::lean::generate).find(|case| {
        let table = &case.program.tables[0];
        let read = table.effects.as_ref().map_or(&table.rule, |effects| &effects[0]);
        read == &Rule::OwnerOrWitness
            && case.program.domain.as_deref() == Some("true")
            && case.program.membership_named_reordered
            && case.program.tables.iter().find(|table| table.name == "access").is_some_and(|table| table.caps.is_empty())
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. })
    }).expect("membership-page stream must be reachable");
    let access = case.program.tables.iter().find(|table| table.name == "access").unwrap();
    assert!(access.caps.is_empty());
    assert!(access.keys.iter().any(|(_, columns, unique)| !unique && columns.iter().map(String::as_str).eq(["principal", "bucket"])));
    let features = snapback4_difftest::lean::features(&case);
    assert!(features.iter().any(|feature| feature == "branch-rule-membership"), "{features:?}\n{}", case.program.source());
    assert!(features.iter().any(|feature| feature == "branch-rule-membership-uncapped"), "{features:?}\n{}", case.program.source());
    assert!(features.iter().any(|feature| feature == "branch-rule-membership-named-reordered"), "{features:?}\n{}", case.program.source());
    assert!(features.iter().any(|feature| feature == "branch-merged"), "{features:?}\n{}", case.program.source());
    let coverage = snapback4_difftest::coverage::features(&case);
    assert!(coverage.contains("read/branch-rule-membership-named-reordered"), "{coverage:?}");
    assert!(coverage.contains("read/branch-rule-membership-uncapped"), "{coverage:?}");
    assert!(case.program.source().contains("exists access[principal = viewer, bucket = .bucket]"));
}

#[test]
fn native_and_lean_generators_reach_fully_pinned_membership_discovery() {
    let generated = |lean: bool| (0..10_000).map(|seed| if lean {
        snapback4_difftest::lean::generate(seed)
    } else { generate(seed) }).find(|case| {
        let source = case.program.source();
        source.contains("bucket: int ?")
            && source.contains("unique byPrincipalOnly: principal")
            && source.contains("exists access[.bucket, viewer]")
            && !source.contains("cap 16 by principal")
    }).expect("fully pinned membership discovery stream must be reachable");
    let native = generated(false);
    let lean = generated(true);
    for case in [&native, &lean] {
        let source = case.program.source();
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:#?}\n{source}", bound.diagnostics);
        assert!(snapback4_core::ir::body_merges(&bound.programs.iter().find(|program| program.program.name == "run").unwrap().program.body)
            .into_iter().any(|merge| merge.branches()), "{:#?}\n{source}", bound.notes);
        let coverage = snapback4_difftest::coverage::features(case);
        assert!(coverage.contains("read/branch-rule-membership-discovery-unique"), "{coverage:?}\n{source}");
    }
    let mut report = Report::default();
    campaign::check(&native, &mut report, |_| {});
    assert!(!report.failed(), "{report:#?}\n{}", native.program.source());
    if model_built() {
        let mut lean_report = Report::default();
        snapback4_difftest::lean::check(&lean, &mut lean_report, |_| {}).unwrap();
        assert!(!lean_report.failed(), "{lean_report:#?}\n{}", lean.program.source());
    }
    assert!(snapback4_difftest::lean::features(&lean).iter()
        .any(|feature| feature == "branch-rule-membership-discovery-unique"));
}

#[test]
fn native_and_lean_generators_reach_by_id_membership_pages() {
    let generated = |lean: bool| (0..10_000).map(|seed| if lean {
        snapback4_difftest::lean::generate(seed)
    } else { generate(seed) }).find(|case| {
        let table = &case.program.tables[0];
        let read = table.effects.as_ref().map_or(&table.rule, |effects| &effects[0]);
        read == &Rule::OwnerOrIdWitness
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, .. })
    }).expect("by-id membership stream must be reachable");
    let native = generated(false);
    let lean = generated(true);
    for case in [&native, &lean] {
        let source = case.program.source();
        assert!(source.contains(".owner = viewer or exists access[.id, viewer]"), "{source}");
        let access = case.program.tables.iter().find(|table| table.name == "access").unwrap();
        assert!(access.keys.iter().any(|(_, columns, unique)| *unique
            && columns.iter().map(String::as_str).eq(["item", "principal"])));
        assert!(access.keys.iter().any(|(_, columns, unique)| *unique
            && columns.iter().map(String::as_str).eq(["bucket", "principal"])),
            "by-id generation must retain a competing positional unique\n{source}");
        let coverage = snapback4_difftest::coverage::features(&case);
        assert!(coverage.contains("read/branch-rule-membership-id"), "{coverage:?}\n{source}");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(snapback4_core::ir::body_merges(&bound.programs.iter().find(|program| program.program.name == "run").unwrap().program.body)
            .into_iter().any(|merge| merge.branches()), "{:#?}\n{source}", bound.notes);
    }
    let mut report = Report::default();
    campaign::check(&native, &mut report, |_| {});
    assert!(!report.failed(), "{report:#?}");
    if model_built() {
        let mut lean_report = Report::default();
        snapback4_difftest::lean::check(&lean, &mut lean_report, |_| {}).unwrap();
        assert!(!lean_report.failed(), "{lean_report:#?}\n{}", lean.program.source());
    }
}

#[test]
fn lean_generator_reaches_a_normalized_boolean_grant_page() {
    let case = (0..2_000).map(snapback4_difftest::lean::generate)
        .find(|case| case.program.boolean_grant_normalized)
        .expect("Boolean grant stream must be reachable");
    assert_eq!(case.program.domain.as_deref(), Some(".flag = false"));
    assert!(case.program.source().contains("not .flag and exists access[0, viewer]"));
    let features = snapback4_difftest::lean::features(&case);
    assert!(features.iter().any(|feature| feature == "branch-rule-boolean-grant"), "{features:?}");
    assert!(features.iter().any(|feature| feature == "branch-merged"), "{features:?}\n{}", case.program.source());
    let coverage = snapback4_difftest::coverage::features(&case);
    assert!(coverage.contains("read/branch-rule-boolean-grant"), "{coverage:?}");
    assert!(coverage.contains("read/branch-merged"), "{coverage:?}\n{}", case.program.source());
}

#[test]
fn native_generator_exercises_uncapped_named_membership_pages() {
    let case = (0..10_000).map(generate).find(|case| {
        let table = &case.program.tables[0];
        let read = table.effects.as_ref().map_or(&table.rule, |effects| &effects[0]);
        read == &Rule::OwnerOrWitness
            && case.program.domain.as_deref() == Some("true")
            && case.program.membership_named_reordered
            && case.program.tables.iter().find(|table| table.name == "access").is_some_and(|table| table.caps.is_empty())
            && matches!(case.program.body, Body::Read { kind: Read::Page | Read::Bounded, owner: false, project: None, .. })
    }).expect("native membership-page stream must be reachable");
    let access = case.program.tables.iter().find(|table| table.name == "access").unwrap();
    assert!(access.caps.is_empty());
    assert!(access.keys.iter().any(|(_, columns, unique)| !unique && columns.iter().map(String::as_str).eq(["principal", "bucket"])));
    let coverage = snapback4_difftest::coverage::features(&case);
    assert!(coverage.contains("read/branch-rule-membership-named-reordered"), "{coverage:?}");
    assert!(coverage.contains("read/branch-rule-membership-uncapped"), "{coverage:?}");
    assert!(coverage.contains("read/branch-merged"), "{coverage:?}\n{}", case.program.source());
    let mut report = Report::default();
    campaign::check(&case, &mut report, |_| {});
    assert!(!report.failed(), "{report:#?}\n{}", case.program.source());
    assert!(report.by_oracle["repeat"].passed > 0, "{report:#?}");
    assert!(report.by_oracle["rewrite-declarations"].passed > 0, "{report:#?}");
    assert!(report.by_oracle["meter"].passed > 0, "{report:#?}");
    assert!(report.rewrite_coverage["read/branch-rule-membership"] > 0, "{report:#?}");
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

#[test]
fn wave10_generator_preserves_id_membership_uniqueness_and_timed_sync_rules() {
    for seed in [4923, 13618, 19533] {
        let case = generate(seed);
        let source = case.program.source();
        execute::engine(&case, &source).unwrap_or_else(|error| panic!("seed {seed}: {error}\n{source}"));
    }
}

#[test]
fn lean_id_membership_residuals_stay_in_the_admitted_fragment() {
    for seed in [9414, 17329] {
        let case = snapback4_difftest::lean::generate(seed);
        let source = case.program.source();
        execute::engine(&case, &source).unwrap_or_else(|error| panic!("seed {seed}: {error}\n{source}"));
    }
}

#[test]
fn let_rewrite_compares_static_predicate_pages_through_each_plans_cursor() {
    let case = generate(17849);
    let (verdict, executions) = oracle::rewrite(&case, &Rewrite::Let, &case.program.source()).unwrap();
    assert!(matches!(verdict, Verdict::Pass), "{verdict:?}");
    assert!(executions > 2, "the distinct plans must actually continue: {executions}");
}

#[test]
fn let_rewrite_continuation_counts_rows_created_by_the_prelude() {
    let mut case = generate(17849);
    case.rows.clear();
    case.steps.clear();
    case.program.prelude.clear();
    if let Body::Read { take, .. } = &mut case.program.body { *take = 1; }
    for i in 0..3 {
        case.program.prelude.push(Block {
            stmts: vec![Stmt::Write { kind: Write::Upsert, target: Key::Key,
                value: Expr::Int(0), tag: format!("t{i}"), ttl: None }],
            ret: Expr::Bool(true),
        });
        let mut args = case.args.clone();
        args["key"] = json!(format!("r{i}"));
        args["k2"] = json!("unused");
        args["a"] = json!(0);
        args["b"] = json!(0);
        case.steps.push(snapback4_difftest::generate::Step { args, at: case.clock, viewer: None, sweep: false });
    }
    case.args["k2"] = json!("unused");
    let (verdict, executions) = oracle::rewrite(&case, &Rewrite::Let, &case.program.source()).unwrap();
    assert!(matches!(verdict, Verdict::Pass), "{verdict:?}");
    assert_eq!(executions, 6, "both plans must execute all three one-row pages");
}

#[test]
fn let_rewrite_still_detects_missing_cursors_semantic_changes_and_bad_resumption() {
    let case = generate(17849);
    for changed in ["next", "data", "complete", "refusal", "bad-cursor"] {
        let (mut engine, prelude) = execute::world(&case, &case.program.source()).unwrap();
        let mut first = execute::execute(&mut engine, &case, "run", &case.args);
        match changed {
            "next" => { first.value.as_object_mut().unwrap().remove("next"); }
            "bad-cursor" => first.value["next"] = json!("invalid-token"),
            field => first.value[field] = json!("different"),
        }
        let (verdict, _) = oracle::rewrite_against(&case, &Rewrite::Let, &mut engine, &prelude, &first).unwrap();
        let Verdict::Disagree(finding) = verdict else { panic!("{changed}: {verdict:?}"); };
        assert_eq!(finding.field, if changed == "bad-cursor" { "continuation-data" } else { changed });
    }
}

#[test]
fn page3_generation_compares_every_new_family_natively_and_in_lean() {
    use snapback4_difftest::lean;
    let have_model = model_built();
    let mut seen = std::collections::BTreeSet::new();
    for seed in 0..20_000 {
        let case = lean::generate(seed);
        let rule = &case.program.tables[0].rule;
        let family = match rule {
            Rule::PureIdWitness => "pure-id",
            Rule::Witness if case.program.domain.as_deref() == Some("true") => "pure-group",
            Rule::CompoundGrant => "compound-grant",
            Rule::CompoundMembership => "compound-membership",
            Rule::RoleGrant => "role-literal",
            Rule::OwnerOrGrant if case.program.domain.as_deref().is_some_and(|d| d.contains("exists access")) => "static-predicate",
            _ => continue,
        };
        if seen.contains(family) { continue; }
        let source = case.program.source();
        if have_model {
            let checked = lean::compare(&case, &source).unwrap();
            if matches!(checked.verdict, Verdict::Unsupported(_)) { continue; }
            assert!(matches!(checked.verdict, Verdict::Pass), "{family} seed {seed}: {:?}\n{source}", checked.verdict);
        }
        let mut report = Report::default();
        campaign::check(&case, &mut report, |_| {});
        assert!(!report.failed(), "{family} seed {seed}: {report:?}");
        seen.insert(family);
        if seen.len() == 6 { break; }
    }
    assert_eq!(seen.len(), 6, "{seen:?}");
}

#[test]
fn page4_generated_families_compare_and_search_is_explicitly_unsupported_in_lean() {
    use snapback4_difftest::lean;
    let have_model=model_built();let mut seen=std::collections::BTreeSet::new();
    for seed in 0..20_000 {
        let case=lean::generate(seed);
        let family=lean::features(&case).into_iter().find(|f|f.starts_with("page4/"));
        let Some(family)=family else {continue}; if seen.contains(&family) {continue;}
        let source=case.program.source();
        if have_model {
            let checked=lean::compare(&case,&source).unwrap();
            if family.ends_with("search") {assert!(matches!(checked.verdict,Verdict::Unsupported(_)));assert_eq!(checked.executed,0);}
            else {
                if matches!(checked.verdict,Verdict::Unsupported(_)) {continue;}
                assert!(matches!(checked.verdict,Verdict::Pass),"{family} seed {seed}: {:?}\n{source}",checked.verdict);
            }
        }
        let mut report=Report::default();campaign::check(&case,&mut report, |_| {});
        assert!(!report.failed(),"{family} seed {seed}: {report:?}\n{source}");
        seen.insert(family);if seen.len()==9 {break;}
    }
    assert_eq!(seen.len(),9,"{seen:?}");
}
