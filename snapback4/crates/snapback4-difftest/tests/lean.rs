//! The engine against the Lean model (LLP 3000.035 §5.2): the emitter covers
//! the generated corpus with named exceptions, the comparison's canonical
//! forms and signatures, and, with the model built, a fixed-seed campaign and
//! the retained findings. Tests that need `quarry-oracle` skip loudly when it
//! is not built; `SNAPBACK4_REQUIRE_LEAN=1` makes its absence a failure.
use serde_json::json;
use snapback4_difftest::{
    campaign, execute,
    lean::{self, Canon},
    oracle::{Oracle, Verdict},
    shrink,
};
use std::collections::BTreeSet;

/// Open signatures, classified in `cases/found/lean--*/DIAGNOSIS.md`: OPEN C2
/// (a filled page's `next`) and OPEN W4 (a hidden clash on an absent upsert's
/// insert arm). A new one fails the fixed-seed run: diagnose it first.
const CLASSIFIED: [&str; 4] = [
    // C2
    "lean--continuation-next--next~no-next",
    "lean--next--next~no-next",
    // W4
    "lean--code--E_RULE~NOT_FOUND",
    "lean--prelude-code--E_RULE~NOT_FOUND",
];
/// Resolved findings kept as regressions: each now replays as a pass.
/// - OPEN C9: a cursorless filled page has no `next` (a model defect, fixed).
/// - OPEN R2: the unnamed update rule judged only the next image, an engine
///   defect (security) fixed 2026-10-08 (`b2036dd821`); the widened shapes
///   reached it under eight more signatures.
/// - OPEN E4: the model refused field access on a null base, a model defect
///   (`why E_FIELD`), fixed 2026-10-08.
/// - OPEN C8: a readable grant decides the page (LLP 3000.036 §12.1); the
///   model gained the arm 2026-10-12, and a stale oracle build showed it
///   again on a merged tree (now refreshed by `lean::refresh`).
const RESOLVED: [&str; 24] = [
    // C9
    "lean--next--no-next~next",
    // R2
    "lean--kind--committed~NOT_FOUND",
    "lean--kind--committed~E_RULE",
    "lean--code--E_CONSTRAINT~NOT_FOUND",
    "lean--code--E_OVERFLOW~NOT_FOUND",
    "lean--code--REQUIRED~NOT_FOUND",
    "lean--prelude-code--E_CONSTRAINT~E_RULE",
    "lean--prelude-code--E_CONSTRAINT~NOT_FOUND",
    "lean--prelude-code--REQUIRED~NOT_FOUND",
    "lean--prelude-kind--committed~E_RULE",
    "lean--prelude-kind--committed~NOT_FOUND",
    // E4
    "lean--code--E_CONSTRAINT~E_MODEL_TYPE",
    "lean--code--E_OVERFLOW~E_MODEL_TYPE",
    "lean--code--E_RULE~E_MODEL_TYPE",
    "lean--code--NOT_FOUND~E_MODEL_TYPE",
    "lean--code--REQUIRED~E_MODEL_TYPE",
    "lean--kind--committed~E_MODEL_TYPE",
    "lean--prelude-code--E_CONSTRAINT~E_MODEL_TYPE",
    "lean--prelude-code--E_OVERFLOW~E_MODEL_TYPE",
    "lean--prelude-code--E_RULE~E_MODEL_TYPE",
    "lean--prelude-code--NOT_FOUND~E_MODEL_TYPE",
    "lean--prelude-code--REQUIRED~E_MODEL_TYPE",
    "lean--prelude-kind--committed~E_MODEL_TYPE",
    // C8
    "lean--complete--complete~incomplete",
];

fn model_built() -> bool {
    // A stale `.lake` build is another model (a merge left one, 2026-10-12).
    lean::refresh().unwrap_or_else(|e| panic!("{e}"));
    let path = lean::oracle_path();
    if path.is_file() {
        return true;
    }
    if std::env::var_os("SNAPBACK4_REQUIRE_LEAN").is_some() {
        panic!("SNAPBACK4_REQUIRE_LEAN is set but {} is missing: cd snapback4/lean && lake build", path.display());
    }
    eprintln!("SKIPPED (Lean oracle not built at {}): cd snapback4/lean && lake build", path.display());
    false
}

fn assert_membership_agreement(source: &str, membership: serde_json::Value) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}\n{source}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().any(|merge| merge.branches()), "{source}");
    let mut engine = snapback4_core::Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    ).unwrap();
    let rows: Vec<(String, serde_json::Value)> = vec![
        ("memberships".into(), membership),
        ("documents".into(), json!({"id":"d1","owner":"bob","parent":"p","at":1})),
        ("documents".into(), json!({"id":"d2","owner":"bob","parent":"other","at":2})),
    ];
    let seeded = rows.iter().map(|(table, value)| {
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
        (table.clone(), row)
    }).collect::<Vec<_>>();
    engine.seed(seeded).unwrap();
    let context = snapback4_core::Context::new(
        "alice",
        [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
    );
    let actual = engine.query("run", context).unwrap();
    let module = lean::module(source).unwrap();
    let case = module.case(
        "run",
        module.store(&rows).unwrap(),
        "alice",
        module.tag_args("run", &json!({"c":null})).unwrap(),
        None,
    ).unwrap();
    let modeled = lean::ask(&case).unwrap();
    assert_eq!(modeled["kind"], "answer", "{modeled}\n{source}");
    assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}\n{source}");
    assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}\n{source}");
    assert_eq!(lean::engine_value(&actual.data),
        json!({"arr":[{"row":{"at":{"int":"1"},"id":{"id":"d1"},"owner":{"id":"bob"},"parent":{"text":"p"}}}]}));
    assert!(actual.complete && actual.next.is_none(), "{actual:?}\n{source}");
}

#[test]
fn the_emitter_covers_the_generated_corpus_with_named_exceptions() {
    let mut supported = 0;
    let mut reasons = BTreeSet::new();
    for seed in 0..3000 {
        let case = lean::generate(seed);
        let source = case.program.source();
        execute::compile(&source).unwrap_or_else(|e| panic!("seed {seed} does not compile: {e}"));
        let module = match lean::module(&source) {
            Ok(m) => m,
            // Only expiry is outside the model at the schema level (the campaign drops int ranges).
            Err(r) => {
                assert_eq!(r, "table-expiry", "seed {seed}");
                reasons.insert(r);
                continue;
            }
        };
        match module.program("run") {
            Ok(_) => {
                supported += 1;
                module.store(&case.rows).unwrap();
                module.tag_args("run", &case.args).unwrap();
                module.program("observe").ok();
            }
            Err(u) => {
                reasons.insert(u.reason);
            }
        }
    }
    // Outside it: the unpaged aggregates, page projections (`shape`), the
    // loop of a prefetch-reachable fold, and expiry, which the model leaves out.
    assert_eq!(reasons, ["call-max", "call-min", "call-sum", "loop", "shape", "table-expiry"].map(String::from).into());
    assert!(supported > 2000, "{supported}");
}

#[test]
fn oversized_membership_keys_stop_before_model_comparison() {
    let source = |probe: &str| format!("table memberships:
  parent: text <=435
  n: int
  principal: principal
  unique parent, principal
  unique n, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=435
  at: int
  read <- .owner = viewer or exists memberships[{probe}]
  online only
query run(c: cursor ?):
  return documents last 2 by .at after c
");
    for probe in [".parent, viewer", "parent = .parent, principal = viewer"] {
        let source = source(probe);
        execute::compile(&source).unwrap();
        let module = lean::module(&source).unwrap();
        assert_eq!(module.program("run").unwrap_err().reason, "page-membership-key-bound", "{probe}");
    }
}

#[test]
fn total_unique_membership_index_elides_the_physical_id_suffix() {
    if !model_built() { return; }
    let source = "table memberships:\n  parent: text <=435\n  principal: principal\n  unique parent, principal\n  unique principal, parent\n  cap 16 by principal\n  read <- .principal = viewer\n  online only\ntable documents:\n  owner: principal\n  parent: text <=435\n  at: int\n  read <- .owner = viewer or exists memberships[.parent, viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 2 by .at after c\n";
    assert_membership_agreement(
        source,
        json!({"id":"m","parent":"p","principal":"alice"}),
    );
}

#[test]
fn membership_indexes_require_the_native_sorted_prefix_order() {
    let parent_column = "p".repeat(480);
    let source = format!("table memberships:\n  {parent_column}: text <=40\n  principal: principal\n  a: int\n  unique pair: {parent_column}, principal\n  unique perm: principal, a, {parent_column}\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[{parent_column} = .parent, principal = viewer, a = 0]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().all(|merge| !merge.branches()));
    assert_eq!(lean::module(&source).unwrap().program("run").unwrap_err().reason,
        "page-membership-key-bound");
}

#[test]
fn ambiguous_membership_physical_indexes_stop_before_the_oracle() {
    let source = "table memberships:\n  parent: text <=40\n  principal: principal\n  unique short: principal, parent\n  by full: principal, parent, id\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[parent = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().all(|merge| !merge.branches()));
    assert_eq!(lean::module(source).unwrap().program("run").unwrap_err().reason,
        "page-membership-index-selection");
}

#[test]
fn fixed_membership_id_is_not_a_physical_prefix() {
    let parent_column = "p".repeat(480);
    let oversized = format!("table memberships:
  {parent_column}: text <=40
  principal: principal
  unique pair: {parent_column}, principal
  by decoy: id, principal, {parent_column}
  cap 16 by principal
  read <- allow
  online only
table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[id = 'm1', {parent_column} = .parent, principal = viewer]
  online only
query run(c: cursor ?):
  return documents last 10 by .at after c
");
    let bound = snapback4_lang::compile(&[("schema.q".into(), oversized.clone())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().all(|merge| !merge.branches()));
    assert_eq!(lean::module(&oversized).unwrap().program("run").unwrap_err().reason,
        "page-membership-key-bound");
}

#[test]
fn membership_discovery_component_limit_stops_before_model_comparison() {
    let source = "table memberships:\n  parent: text <=40\n  principal: principal\n  a: int\n  b: int\n  c: int\n  d: int\n  e: int\n  f: int\n  unique parent, principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[parent = .parent, principal = viewer, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().all(|merge| !merge.branches()));
    assert_eq!(lean::module(source).unwrap().program("run").unwrap_err().reason,
        "page-membership-key-bound");
}

#[test]
fn membership_filter_pins_and_labels_stop_before_model_comparison() {
    let filtered = "table memberships:
  parent: text <=100
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: text <=100
  folder: text <=400
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  online only
query run(folder: text <=400, c: cursor ?):
  return documents where .folder = folder last 2 by .at after c
";
    execute::compile(filtered).unwrap();
    assert_eq!(lean::module(filtered).unwrap().program("run").unwrap_err().reason, "page-membership-key-bound");

    let owner = "o".repeat(480);
    let long_label = format!("table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  online only
table documents:
  {owner}: principal
  parent: text <=40
  at: int
  read <- .{owner} = viewer or exists memberships[.parent, viewer]
  online only
query run(c: cursor ?):
  return documents last 2 by .at after c
");
    execute::compile(&long_label).unwrap();
    assert_eq!(lean::module(&long_label).unwrap().program("run").unwrap_err().reason, "page-membership-key-bound");
}

#[test]
fn reordered_named_membership_key_agrees_with_the_model() {
    if !model_built() { return; }
    let case = (0..2_000)
        .map(lean::generate)
        .find(|case| case.program.membership_named_reordered)
        .expect("named membership-page stream must be reachable");
    let source = case.program.source();
    assert!(source.contains("exists access[principal = viewer, bucket = .bucket]"), "{source}");
    execute::compile(&source).unwrap();
    let checked = lean::compare(&case, &source).unwrap();
    assert!(matches!(checked.verdict, Verdict::Pass), "{:?}\n{source}", checked.verdict);
}

#[test]
fn typed_positional_and_named_membership_keys_agree_with_the_engine() {
    if !model_built() { return; }
    let typed = "table memberships:\n  parent: text <=40\n  n: int\n  principal: principal\n  unique parent, principal\n  unique n, principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[.parent, viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    assert_membership_agreement(
        typed,
        json!({"id":"m","parent":"p","n":7,"principal":"alice"}),
    );

    // The named form remains unambiguous even when two keys have the same types.
    let named = "table memberships:\n  parent: text <=40\n  alias: text <=40\n  principal: principal\n  unique parent, principal\n  unique alias, principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[parent = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    assert_membership_agreement(
        named,
        json!({"id":"m","parent":"p","alias":"other","principal":"alice"}),
    );
}

#[test]
fn fixed_membership_source_id_agrees_with_the_engine() {
    if !model_built() { return; }
    let source = "table memberships:\n  parent: text <=40\n  principal: principal\n  unique parent, principal\n  by decoy: id, principal, parent\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[id = 'm1', parent = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().any(|merge| merge.branches()));
    let mut engine = snapback4_core::Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    ).unwrap();
    let rows: Vec<(String, serde_json::Value)> = vec![
        ("memberships".into(), json!({"id":"m1","parent":"p1","principal":"alice"})),
        ("memberships".into(), json!({"id":"m2","parent":"p2","principal":"alice"})),
        ("documents".into(), json!({"id":"d1","owner":"bob","parent":"p1","at":1})),
        ("documents".into(), json!({"id":"d2","owner":"bob","parent":"p2","at":2})),
    ];
    let seeded = rows.iter().map(|(table, value)| {
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
        (table.clone(), row)
    }).collect::<Vec<_>>();
    engine.seed(seeded).unwrap();
    let actual = engine.query("run", snapback4_core::Context::new(
        "alice",
        [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
    )).unwrap();
    let module = lean::module(source).unwrap();
    let case = module.case(
        "run",
        module.store(&rows).unwrap(),
        "alice",
        module.tag_args("run", &json!({"c":null})).unwrap(),
        None,
    ).unwrap();
    let modeled = lean::ask(&case).unwrap();
    assert_eq!(modeled["kind"], "answer", "{modeled}");
    assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}");
    assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}");
    assert_eq!(lean::engine_value(&actual.data),
        json!({"arr":[{"row":{"at":{"int":"1"},"id":{"id":"d1"},"owner":{"id":"bob"},"parent":{"text":"p1"}}}]}),
        "m2 must not grant d2");
    assert!(actual.complete && actual.next.is_none(), "{actual:?}");
}

#[test]
fn id_caps_and_uncapped_memberships_agree_with_the_model() {
    if !model_built() { return; }
    let check = |cap: &str, filter: &str, complete: bool| {
        let source = format!("table memberships:\n  parent: text <=40\n  principal: principal\n  unique parent, principal\n{cap}  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[id = 'm1', parent = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents{filter} last 10 by .at after c\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
        if cap.contains("by id") {
            assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
                .into_iter().all(|merge| !merge.branches()));
        }
        let mut engine = snapback4_core::Engine::memory(
            bound.schema,
            bound.programs.into_iter().map(|program| program.program),
        ).unwrap();
        let rows: Vec<(String, serde_json::Value)> = vec![
            ("memberships".into(), json!({"id":"m1","parent":"p1","principal":"alice"})),
            ("memberships".into(), json!({"id":"m2","parent":"p2","principal":"alice"})),
            ("documents".into(), json!({"id":"d1","owner":"bob","parent":"p1","at":1})),
            ("documents".into(), json!({"id":"d2","owner":"bob","parent":"p2","at":2})),
        ];
        let seeded = rows.iter().map(|(table, value)| {
            let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
            (table.clone(), row)
        }).collect::<Vec<_>>();
        engine.seed(seeded).unwrap();
        let actual = engine.query("run", snapback4_core::Context::new(
            "alice",
            [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
        )).unwrap();
        let module = lean::module(&source).unwrap();
        let case = module.case(
            "run",
            module.store(&rows).unwrap(),
            "alice",
            module.tag_args("run", &json!({"c":null})).unwrap(),
            None,
        ).unwrap();
        let modeled = lean::ask(&case).unwrap();
        assert_eq!(modeled["kind"], "answer", "{modeled}\n{source}");
        assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}");
        assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}");
        assert_eq!(actual.complete, complete, "{actual:?}");
    };
    check("  cap 1 by id\n", "", false);
    check("", "", false);
    check("", " where .parent = 'p1'", true);
}

#[test]
fn fixed_id_caps_reserve_all_older_page_classifiers() {
    if !model_built() { return; }
    let filters = [
        "",
        " where .bucket = 0",
        " where (.owner = viewer and .bucket = 0) or (.owner = viewer and .bucket = 1)",
    ];
    for filter in filters {
        let source = format!("table memberships:\n  parent: text <=40\n  principal: principal\n  unique parent, principal\n  cap 1 by id\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  bucket: int\n  at: int\n  read <- .owner = viewer or exists memberships[id = 'm1', parent = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents{filter} last 10 by .at after c\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:#?}\n{source}", bound.diagnostics);
        assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
            .into_iter().all(|merge| !merge.branches()), "{source}");
        let mut engine = snapback4_core::Engine::memory(
            bound.schema,
            bound.programs.into_iter().map(|program| program.program),
        ).unwrap();
        let rows: Vec<(String, serde_json::Value)> = vec![
            ("memberships".into(), json!({"id":"m1","parent":"p1","principal":"alice"})),
            ("documents".into(), json!({"id":"d1","owner":"alice","parent":"p0","bucket":0,"at":1})),
            ("documents".into(), json!({"id":"d2","owner":"alice","parent":"p0","bucket":1,"at":2})),
        ];
        let seeded = rows.iter().map(|(table, value)| {
            let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
            (table.clone(), row)
        }).collect::<Vec<_>>();
        engine.seed(seeded).unwrap();
        let actual = engine.query("run", snapback4_core::Context::new(
            "alice",
            [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
        )).unwrap();
        let module = lean::module(&source).unwrap();
        let case = module.case(
            "run",
            module.store(&rows).unwrap(),
            "alice",
            module.tag_args("run", &json!({"c":null})).unwrap(),
            None,
        ).unwrap();
        let modeled = lean::ask(&case).unwrap();
        assert_eq!(modeled["kind"], "answer", "{modeled}\n{source}");
        assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}\n{source}");
        assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}\n{source}");
        assert!(!actual.complete, "{actual:?}\n{source}");
    }
}

#[test]
fn varying_membership_source_id_remains_page_eligible() {
    if !model_built() { return; }
    let source = "table groups:\n  principal: principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: groups\n  at: int\n  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().any(|merge| merge.branches()), "{:#?}\n{:#?}", bound.notes, bound.programs[0].program);
    let mut engine = snapback4_core::Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    ).unwrap();
    let rows: Vec<(String, serde_json::Value)> = vec![
        ("groups".into(), json!({"id":"g1","principal":"alice"})),
        ("groups".into(), json!({"id":"g2","principal":"bob"})),
        ("documents".into(), json!({"id":"d1","owner":"bob","parent":"g1","at":1})),
        ("documents".into(), json!({"id":"d2","owner":"bob","parent":"g2","at":2})),
    ];
    let seeded = rows.iter().map(|(table, value)| {
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
        (table.clone(), row)
    }).collect::<Vec<_>>();
    engine.seed(seeded).unwrap();
    let actual = engine.query("run", snapback4_core::Context::new(
        "alice",
        [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
    )).unwrap();
    let module = lean::module(source).unwrap();
    let case = module.case(
        "run",
        module.store(&rows).unwrap(),
        "alice",
        module.tag_args("run", &json!({"c":null})).unwrap(),
        None,
    ).unwrap();
    let modeled = lean::ask(&case).unwrap();
    assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}");
    assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}");
    assert!(actual.complete && actual.next.is_none(), "{actual:?}");
}

#[test]
fn intrinsic_id_membership_missing_witness_agrees_with_the_model() {
    if !model_built() { return; }
    let source = "table groups:\n  principal: principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: groups\n  at: int\n  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().any(|merge| merge.branches()), "{:#?}", bound.notes);
    let mut engine = snapback4_core::Engine::memory(
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
    ).unwrap();
    let rows: Vec<(String, serde_json::Value)> = vec![
        ("groups".into(), json!({"id":"g0","principal":"bob"})),
        ("documents".into(), json!({"id":"owned","owner":"alice","parent":"g0","at":1})),
        ("documents".into(), json!({"id":"denied","owner":"bob","parent":"g0","at":2})),
    ];
    let seeded = rows.iter().map(|(table, value)| {
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
        (table.clone(), row)
    }).collect::<Vec<_>>();
    engine.seed(seeded).unwrap();
    let actual = engine.query("run", snapback4_core::Context::new(
        "alice",
        [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
    )).unwrap();
    let module = lean::module(source).unwrap();
    let case = module.case("run", module.store(&rows).unwrap(), "alice",
        module.tag_args("run", &json!({"c":null})).unwrap(), None).unwrap();
    let modeled = lean::ask(&case).unwrap();
    assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}");
    assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}");
    assert_eq!(actual.data.as_array().unwrap().len(), 1);
    assert!(actual.complete && actual.next.is_none(), "{actual:?}");
}

#[test]
fn total_unique_varying_source_id_agrees_for_present_and_missing_witnesses() {
    if !model_built() { return; }
    let source = "table groups:\n  principal: principal\n  unique principal\n  cap 16 by principal\n  read <- .principal = viewer\n  online only\ntable documents:\n  owner: principal\n  parent: groups\n  at: int\n  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let check = |include_witness: bool, expected: &[&str]| {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
        assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
            .into_iter().any(|merge| merge.branches()), "{:#?}", bound.notes);
        let mut engine = snapback4_core::Engine::memory(
            bound.schema,
            bound.programs.into_iter().map(|program| program.program),
        ).unwrap();
        let mut rows: Vec<(String, serde_json::Value)> = vec![
            ("groups".into(), json!({"id":"g0","principal":"bob"})),
            ("documents".into(), json!({"id":"owned","owner":"alice","parent":"g0","at":1})),
            ("documents".into(), json!({"id":"denied","owner":"bob","parent":"g0","at":3})),
        ];
        if include_witness {
            rows.extend([
                ("groups".into(), json!({"id":"g1","principal":"alice"})),
                ("documents".into(), json!({"id":"shared","owner":"bob","parent":"g1","at":2})),
            ]);
        }
        let seeded = rows.iter().map(|(table, value)| {
            let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
            (table.clone(), row)
        }).collect::<Vec<_>>();
        engine.seed(seeded).unwrap();
        let actual = engine.query("run", snapback4_core::Context::new(
            "alice",
            [("c".into(), snapback4_core::Value::Null)].into_iter().collect(),
        )).unwrap();
        let module = lean::module(source).unwrap();
        let case = module.case("run", module.store(&rows).unwrap(), "alice",
            module.tag_args("run", &json!({"c":null})).unwrap(), None).unwrap();
        let modeled = lean::ask(&case).unwrap();
        assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}");
        assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}");
        let ids = actual.data.as_array().unwrap().iter().map(|row| match row.field("id").unwrap() {
            snapback4_core::Value::Id(id) => id.as_str(), other => panic!("{other:?}"),
        }).collect::<Vec<_>>();
        assert_eq!(ids, expected);
        assert!(actual.complete && actual.next.is_none(), "{actual:?}");
    };
    check(true, &["shared", "owned"]);
    check(false, &["owned"]);
}

#[test]
fn nullable_unique_varying_source_id_stops_before_the_oracle() {
    let source = "table groups:\n  principal: principal ?\n  unique principal\n  cap 16 by principal\n  read <- .principal = viewer\n  online only\ntable documents:\n  owner: principal\n  parent: groups\n  at: int\n  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().all(|merge| !merge.branches()));
    assert!(bound.schema.tables["documents"].indexes.iter().all(|(name, index)| !name.starts_with("$intent")
        || !matches!(index.columns().as_slice(), [first, ..] if first == "owner" || first == "parent")));
    assert!(!bound.schema.required_capabilities().contains("branch-membership-v1"));
    assert_eq!(lean::module(source).unwrap().program("run").unwrap_err().reason,
        "page-membership-source-unique");
}

#[test]
fn same_typed_positional_membership_keys_are_rejected_before_the_oracle() {
    let source = "table memberships:\n  parent: text <=40\n  alias: text <=40\n  principal: principal\n  unique parent, principal\n  unique alias, principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[.parent, viewer]\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_POSITIONAL_SCAN"),
        "{:#?}", bound.diagnostics);
    assert!(!bound.schema.required_capabilities().contains("branch-membership-v1"));

    let intrinsic_only = source.replace("  unique parent, principal\n  unique alias, principal\n", "");
    let bound = snapback4_lang::compile(&[("schema.q".into(), intrinsic_only)]);
    assert!(bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_POSITIONAL_SCAN"),
        "intrinsic byId must not invent a two-part positional key: {:#?}", bound.diagnostics);
}

#[test]
fn membership_extra_equalities_and_repeated_parties_agree_with_the_model() {
    if !model_built() { return; }
    let check = |source: &str, rows: Vec<(String, serde_json::Value)>| {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:#?}\n{source}", bound.diagnostics);
        let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
        let seeded = rows.iter().map(|(table, value)| {
            let row = snapback4_core::wire::row_from_json(&engine.schema().tables[table], value).unwrap();
            (table.clone(), row)
        }).collect::<Vec<_>>();
        engine.seed(seeded).unwrap();
        let args = json!({"c":null});
        let context = snapback4_core::Context::new("alice", [("c".into(), snapback4_core::Value::Null)].into_iter().collect());
        let actual = engine.query("run", context).unwrap();
        let module = lean::module(source).unwrap();
        let case = module.case("run", module.store(&rows).unwrap(), "alice", module.tag_args("run", &args).unwrap(), None).unwrap();
        let modeled = lean::ask(&case).unwrap();
        assert_eq!(modeled["kind"], "answer", "{modeled}\n{source}");
        assert_eq!(lean::model_value(&modeled["data"]), lean::engine_value(&actual.data), "{modeled}\n{actual:?}\n{source}");
        assert_eq!(modeled["complete"], actual.complete, "{modeled}\n{actual:?}\n{source}");
        assert!(actual.complete && actual.next.is_none(), "{actual:?}\n{source}");
    };
    let rows = vec![
        ("memberships".into(), json!({"id":"m","parent":"p","principal":"alice","role":"member"})),
        ("documents".into(), json!({"id":"d1","owner":"bob","parent":"p","at":1})),
        ("documents".into(), json!({"id":"d2","owner":"bob","parent":"p","at":2})),
    ];
    let extra = "table memberships:\n  parent: text <=40\n  principal: principal\n  role: text <=20\n  unique parent, principal\n  cap 16 by principal\n  read <- allow\n  online only\ntable documents:\n  owner: principal\n  parent: text <=40\n  at: int\n  read <- .owner = viewer or exists memberships[parent = .parent, principal = viewer, role = 'member']\n  online only\nquery run(c: cursor ?):\n  return documents last 10 by .at after c\n";
    check(extra, rows.clone());

    let repeated = extra.replace(" or exists memberships[parent = .parent, principal = viewer, role = 'member']",
        " or .owner = viewer or .owner = viewer or .owner = viewer or .owner = viewer or .owner = viewer or .owner = viewer or exists memberships[parent = .parent, principal = viewer, role = 'member']");
    check(&repeated, rows);
}

#[test]
fn canonical_values_and_signatures() {
    use snapback4_core::Value;
    let row: Value = Value::Row([("id".to_string(), Value::Id("r0".into())), ("n".to_string(), Value::Int(-3)), ("t".to_string(), Value::String("é".into()))].into_iter().collect());
    assert_eq!(
        lean::engine_value(&Value::Array(vec![row, Value::Null, Value::Bool(true)])),
        json!({"arr": [{"row": {"id": {"id": "r0"}, "n": {"int": "-3"}, "t": {"text": "é"}}}, {"null": null}, {"bool": true}]})
    );
    // The model's rows are ordered pairs; the comparison is by field.
    assert_eq!(
        lean::model_value(&json!({"arr": [{"row": [["t", {"text": "é"}], ["id", {"id": "r0"}], ["n", {"int": "-3"}]]}]})),
        json!({"arr": [{"row": {"id": {"id": "r0"}, "n": {"int": "-3"}, "t": {"text": "é"}}}]})
    );
    // An id never equals the same text (OPEN V1).
    assert_ne!(lean::engine_value(&Value::Id("x".into())), lean::model_value(&json!({"text": "x"})));
    let answer = |next| Canon { kind: "answer".into(), code: None, data: Some(json!({"arr": []})), complete: Some(true), next };
    assert_eq!(lean::differ(&answer(true), &answer(true)), None);
    assert_eq!(lean::signature("next", &answer(false), &answer(true)), "lean--next--no-next~next");
    let refused = Canon { kind: "refused".into(), code: Some("E_RULE".into()), data: None, complete: None, next: false };
    let committed = Canon { kind: "committed".into(), code: None, data: Some(json!({"bool": true})), complete: None, next: false };
    assert_eq!(lean::differ(&committed, &refused), Some("kind"));
    assert_eq!(lean::signature("kind", &committed, &refused), "lean--kind--committed~E_RULE");
    let mut other = refused.clone();
    other.code = Some("NOT_FOUND".into());
    assert_eq!(lean::differ(&refused, &other), Some("code"));
    // A model answer the harness cannot read is never a verdict.
    assert_eq!(lean::model_canon(&json!({"kind": "error"})).kind, "error");
}

#[test]
fn fixed_seed_campaign_against_the_model() {
    if !model_built() {
        return;
    }
    let out = std::env::temp_dir().join(format!("quarry-lean-smoke-{}", std::process::id()));
    let report = lean::run_bounded(0, 400, &out, None).unwrap();
    std::fs::remove_dir_all(&out).ok();
    let counts = &report.by_oracle["lean"];
    assert_eq!(counts.attempted, 400);
    assert!(report.generator_errors.is_empty(), "{:?}", report.generator_errors);
    assert!(counts.passed + counts.disagreeing >= 280, "{counts:?}");
    for signature in counts.signatures.keys() {
        assert!(CLASSIFIED.contains(&signature.as_str()), "unclassified Lean disagreement {signature}: shrink, diagnose and record it under cases/found/");
    }
    // Pages continued on both sides' own cursors were compared.
    assert!(report.store_stats["lean-continued-reads"] > 10);
}

#[test]
fn retained_lean_findings_still_reproduce() {
    if !model_built() {
        return;
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("cases/found");
    let mut seen = BTreeSet::new();
    for entry in std::fs::read_dir(&root).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        if !name.starts_with("lean--") {
            continue;
        }
        assert!(path.join("DIAGNOSIS.md").is_file(), "{name} has no DIAGNOSIS.md");
        let artifact: shrink::Artifact = serde_json::from_slice(&std::fs::read(path.join("case.json")).unwrap()).unwrap();
        assert!(matches!(artifact.finding.oracle, Oracle::Lean));
        match shrink::replay(&path).unwrap() {
            Verdict::Pass if RESOLVED.contains(&name.as_str()) => {}
            Verdict::Disagree(f) if CLASSIFIED.contains(&name.as_str()) => assert_eq!(f.signature, name),
            other => panic!("{name} changed ({other:?}): diagnose, update its DIAGNOSIS.md and this test"),
        }
        seen.insert(name);
    }
    assert_eq!(seen, CLASSIFIED.iter().chain(&RESOLVED).map(|s| s.to_string()).collect::<BTreeSet<_>>());
}

#[test]
fn isolated_lean_workers_agree_with_serial_counts() {
    if !model_built() {
        return;
    }
    let root = std::env::temp_dir().join(format!("quarry-lean-workers-{}", std::process::id()));
    let executable = std::path::Path::new(env!("CARGO_BIN_EXE_snapback4-difftest"));
    let mut one = serde_json::to_value(campaign::parallel_command(0, 24, 1, &root.join("one"), executable, "run-lean", None).unwrap()).unwrap();
    let mut two = serde_json::to_value(campaign::parallel_command(0, 24, 3, &root.join("two"), executable, "run-lean", None).unwrap()).unwrap();
    for name in ["seconds", "slowest_case_seconds", "slowest_case_seed"] {
        one.as_object_mut().unwrap().remove(name);
        two.as_object_mut().unwrap().remove(name);
    }
    assert_eq!(one, two);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn narrowing_cut_reference_predicates_keeps_generated_sources_well_typed() {
    for seed in 0..1000 {
        let case = lean::generate(seed);
        execute::compile(&case.program.source()).unwrap_or_else(|e| panic!("seed {seed}: {e:?}"));
    }
}

#[test]
fn live_reference_fields_agree_with_the_model_for_visible_hidden_and_missing_targets() {
    if !model_built() { return; }
    for read in ["allow", "deny"] {
        let source = format!("table tags:\n  rank: int\n  read <- {read}\n  online only\nquery q(t: tags):\n  return t.rank\nfn same(x: tags): x\nquery helper(t: tags):\n  return same(t).rank\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
        let rows = vec![("tags".to_owned(), json!({"id":"t","rank":7}))];
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables["tags"], &rows[0].1).unwrap();
        engine.seed([("tags".into(),row)]).unwrap();
        let module = lean::module(&source).unwrap();
        assert_eq!(module.program("helper").unwrap_err().reason, "member-type");
        for id in ["t", "missing"] {
            let args = json!({"t":id});
            let ctx = || snapback4_core::Context::new("alice", [("t".into(),snapback4_core::Value::Id(id.into()))].into_iter().collect());
            let direct = engine.query("q",ctx()).unwrap();
            let via_helper = engine.query("helper",ctx()).unwrap();
            assert_eq!(direct.data, via_helper.data);
            assert_eq!(direct.data, if read == "allow" && id == "t" { snapback4_core::Value::Int(7) } else { snapback4_core::Value::Null });
            let case = module.case("q",module.store(&rows).unwrap(),"alice",module.tag_args("q",&args).unwrap(),None).unwrap();
            let model = lean::ask(&case).unwrap();
            assert_eq!(model["kind"], "answer", "{model}");
            assert_eq!(lean::model_value(&model["data"]),lean::engine_value(&direct.data), "{read} {id}");
            assert_eq!(model["complete"], direct.complete);
        }
    }
}
