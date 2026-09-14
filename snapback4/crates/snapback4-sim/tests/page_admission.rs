//! Compiler-observation exception: check-time refusals have no runtime body or receipt; compare diagnostics, never a hidden population.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
#[path = "common/write_observation.rs"]
mod observation;

const SOURCE: &str = r#"
table items:
  owner: principal
  amount: int
  text: text <=100
  expiresAt: time ?
  by byOwner: owner, id
  by byWords: owner, words(text), id
  by byExpiry: expiresAt
  read <- .owner = viewer
  update <- allow
  sync to .owner last 20 by byOwner
query page(owner: principal):
  return items[owner] first 10 by byOwner
"#;
fn compile(source: &str) -> snapback4_lang::Bound { snapback4_lang::compile(&[("schema.q".into(), source.into())]) }
fn world(source: &str, hidden: usize, expired: bool) -> Engine {
    let b = compile(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = (0..hidden).map(|n| json!({"id":format!("hidden{n:05}"),"owner":"alice","amount":0,"text":format!("word{n:05}"),"expiresAt":if expired {json!(1)} else {json!(null)}}))
        .chain([json!({"id":"own","owner":"bob","amount":0,"text":"visible","expiresAt":null})])
        .map(|r| ("items".into(), wire::row_from_json(e.schema().table("items").unwrap(), &r).unwrap())).collect::<Vec<_>>();
    e.seed(rows).unwrap();
    e
}
fn refused_pair(base: &str, operation: &str, population: usize, expired: bool, code: &str, reason: &str) {
    let mut observations = Vec::new();
    for hidden in [0, population] {
        let mut e = world(base, hidden, expired);
        assert_eq!(e.store().rows("items").unwrap().len(), hidden + 1);
        let before = e.store().rows("items").unwrap();
        let b = compile(&format!("{base}\n{operation}"));
        let errors = b.diagnostics.iter().map(|d| json!({"code":d.code,"message":d.message,"rewrite":d.rewrite,"site":d.site.to_string()})).collect::<Vec<_>>();
        assert!(b.diagnostics.iter().any(|d| d.code == code && d.message.contains(reason)), "{:?}", b.diagnostics);
        assert!(!b.programs.iter().any(|p| p.program.name == "pass"));
        assert_eq!(e.store().rows("items").unwrap(), before);
        assert!(e.effects(None, 10).unwrap().is_empty());
        observations.push(json!({"check":errors,"readable":wire::to_json(&e.query("page", Context::new("bob", [("owner".into(), Value::Id("bob".into()))].into()).at(1000)).unwrap().data)}));
    }
    assert_eq!(observations[0], observations[1]);
}

#[test]
fn w2_hidden_word_expansion_and_expired_populations_are_refused_at_check() {
    refused_pair(SOURCE, "mutation pass(): server\n  for r in items['alice'] matching 'word' first 10 by byWords:\n    update items[r] {amount: 1}\n", 40, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    refused_pair(SOURCE, "mutation pass(): server\n  rows = items['alice'] matching 'word' first 10 by byWords\n  return count(rows)\n", 40, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    let expires = SOURCE.replace("  read <-", "  expire at .expiresAt\n  read <-");
    refused_pair(&expires, "mutation pass(): server\n  for r in items['alice'] first 10 by byOwner:\n    update items[r] {amount: 1}\n", 9000, true, "E_STRUCTURAL_FANOUT", "expiry");
    refused_pair(&expires, "mutation pass(): server\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n", 9000, true, "E_STRUCTURAL_FANOUT", "expiry");
    refused_pair(SOURCE, "mutation pass(): server\n  rows = merge items first 10 by byOwner:\n    ['alice']\n    ['bob']\n  for r in rows:\n    update items[r] {amount: 1}\n", 40, false, "E_STRUCTURAL_FANOUT", "merge");
}

#[test]
fn w2_a_mutation_binding_a_nonuniform_page_is_refused_with_zero_or_ten_thousand_hidden_rows() {
    refused_pair(SOURCE, "mutation pass(): server\n  rows = items[] first 10 by byOwner\n  return count(rows)\n", 10_000, false, "E_STRUCTURAL_FANOUT", "read it in a query, or pin the deciding columns");
}

#[test]
fn w2_a_uniform_hidden_page_after_metered_work_has_the_same_complete_observation() {
    for budget in ["steps", "examined", "probes"] {
        let base = if budget == "probes" { SOURCE.replace("read <- .owner = viewer", "read <- exists grants[.owner, viewer]").replace("  sync to .owner last 20 by byOwner\n", "") } else { SOURCE.into() };
        let grants = "\ntable grants:\n  owner: principal\n  reader: principal\n  unique byPair: owner, reader\n  read <- allow\n";
        let work = if budget == "steps" { "  n = 0\n  for i in range(0, 100):\n    n = n + 1\n" } else { "  n = 0\n  for i in range(0, 8192):\n    r = items[id = 'own']\n    n = n + 1\n" };
        let source = format!("{base}{grants}\nmutation pass(): server\n{work}  rows = items['alice'] first 10 by byOwner\n  return n + count(rows)\n");
        let mut observations = Vec::new();
        for hidden in [0, 1, 10_000] {
            let mut e = world(&source, hidden, false);
            let grant = wire::row_from_json(e.schema().table("grants").unwrap(), &json!({"id":"grant","owner":"bob","reader":"bob"})).unwrap();
            e.seed([("grants".into(), grant)]).unwrap();
            let (result, observation) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("page", json!({"owner":"bob"})));
            assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == if budget == "steps" {100} else {8192}), "{budget}: {:?}", result.state);
            if budget != "steps" { assert_eq!(result.metered.examined, 8192); }
            assert_eq!(result.metered.rule_probes, if budget == "probes" {8192} else {0});
            assert_eq!(result.metered.rows_written, 0);
            observations.push(observation);
        }
        for pair in observations.windows(2) { pair[0].assert_same(&pair[1]); }
    }
}

#[test]
fn w3_uniform_page_with_expiring_rule_probe_has_no_population_oracle() {
    let source = format!("{}\ntable grants:\n  owner: principal\n  expiresAt: time\n  by byOwner: owner\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  read <- deny\nmutation pass(): server\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n", SOURCE.replace("read <- .owner = viewer", "read <- exists grants[.owner]").replace("  sync to .owner last 20 by byOwner\n", ""));
    for admitted in [false, true] {
        let mut observations = Vec::new();
        for expired in [0, 9000] {
            let mut e = world(&source, 1, false);
            let rows = (0..expired).map(|n| json!({"id":format!("g{n:05}"),"owner":"alice","expiresAt":1}))
                .chain([json!({"id":"live-or-decoy","owner":if admitted {"alice"} else {"nobody"},"expiresAt":2000})])
                .map(|r| ("grants".into(), wire::row_from_json(e.schema().table("grants").unwrap(), &r).unwrap())).collect::<Vec<_>>();
            e.seed(rows).unwrap();
            let (result, observation) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("page", json!({"owner":"bob"})));
            assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == i64::from(admitted)));
            assert_eq!((result.metered.examined, result.metered.rule_probes), if admitted {(1, 1)} else {(0, 0)});
            observations.push(observation);
        }
        observations[0].assert_same(&observations[1]);
    }
}

#[test]
fn w3_serialized_nonlooping_merge_without_merge_site_is_refused() {
    use snapback4_core::ir::*;
    let bound = compile(SOURCE);
    let mut program = bound.programs.iter().find(|p| p.program.name == "page").unwrap().program.clone();
    let mut scan = scans(&program)[0].clone(); scan.merge_site = None;
    program.kind = ProgramKind::Mutation;
    program.body = vec![Stmt::Let { name: "rows".into(), value: Expr::Merge(Merge { site: "structural".into(), lanes: vec![MergeLane { setup: vec![], scan: scan.clone(), source: None, binding: "r".into() }] }) }, Stmt::Return(Expr::Literal(Value::Null))];
    let serialized: Program = serde_json::from_str(&serde_json::to_string(&program).unwrap()).unwrap();
    let why = snapback4_core::engine::admission::check(&bound.schema, &serialized).unwrap_err().refusal();
    assert_eq!(why.code, "E_STRUCTURAL_FANOUT");
    assert!(why.message.contains("merge"));
    // The same merely-bound plain prefix is a positive structural control.
    program.body[0] = Stmt::Let { name: "rows".into(), value: Expr::Scan(scan) };
    snapback4_core::engine::admission::check(&bound.schema, &program).unwrap();
}

#[test]
fn w3_predicting_bound_word_page_is_refused_independently_of_hidden_population() {
    refused_pair(SOURCE, "mutation pass():\n  rows = items['alice'] matching 'word' first 10 by byWords\n  return count(rows)\n", 8193, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    let positive = compile(&format!("{SOURCE}\nmutation pass():\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n"));
    assert!(positive.diagnostics.is_empty(), "{:?}", positive.diagnostics);
    assert_ne!(positive.schema.operations["pass"].predicts.as_deref(), Some("never"));
}

#[test]
fn w3_upsert_condition_is_one_compiler_refusal_and_update_condition_is_admitted() {
    let operation = "mutation pass(key: items):\n  upsert items[key] {amount: 0} if .amount = 7\n";
    refused_pair(SOURCE, operation, 10_000, false, "E_QUARRY_UNKNOWN", "upsert cannot take a condition");
    let b = compile(&format!("{SOURCE}\n{operation}"));
    assert_eq!(b.diagnostics.len(), 1);
    assert_eq!(b.diagnostics[0].rewrite, "a condition belongs on update; an upsert inserts or patches");
    assert!(compile(&format!("{SOURCE}\n{}", operation.replace("upsert", "update"))).diagnostics.is_empty());
}
