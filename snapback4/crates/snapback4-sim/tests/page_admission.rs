//! §17's check-time refusals depend on the program, never on a hidden population.
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
    let source = format!("{SOURCE}\nmutation pass(): server\n  n = 0\n  for i in range(0, 100):\n    n = n + 1\n  rows = items['alice'] first 10 by byOwner\n  for r in rows:\n    update items[r] {{amount: 1}}\n  return n + count(rows)\n");
    let mut observations = Vec::new();
    for hidden in [0, 10_000] {
        let mut e = world(&source, hidden, false);
        let (result, observation) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("page", json!({"owner":"bob"})));
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(100), .. }));
        assert!(result.metered.steps >= 100);
        assert_eq!(result.metered.rows_written, 0);
        observations.push(observation);
    }
    observations[0].assert_same(&observations[1]);
}
