//! Expiring keyed writes must not examine their live population (LLP 3000.013).
#[path = "../src/scale.rs"]
mod scale;

use snapback4_core::{Context, Engine, Value, WriteState, wire};
use serde_json::json;
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table conversations:
  lastOrdinal: int default 0
  public
  insert <- allow
  update <- allow
  sync public
table messages:
  conversationId: conversations
  ordinal: int
  expiresAt: time ?
  at: time
  unique byConversationOrdinal: conversationId, ordinal
  cap 200000
  expire at .expiresAt
  public
  insert <- allow
  update <- allow
  delete <- allow
  sync public
mutation sendMessage(messageId: id, conversationId: conversations):
  convo = conversations[conversationId] ! else NOT_FOUND
  ordinal = convo.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  insert messages { id: messageId, conversationId, ordinal, at: now, expiresAt: null }
query message(conversationId: conversations, ordinal: int):
  return messages[conversationId, ordinal]
"#;

fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

fn engine(source: &str, backlog: usize) -> Engine {
    let b = compile(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = vec![("conversations".into(), wire::row_from_json(&e.schema().tables["conversations"],
        &json!({"id":"chat", "lastOrdinal":0})).unwrap())];
    rows.extend((0..backlog).map(|n| ("messages".into(), wire::row_from_json(&e.schema().tables["messages"],
        &json!({"id":format!("expired{n:05}"), "conversationId":"chat", "ordinal":-(n as i64)-1, "at":0, "expiresAt":1})).unwrap())));
    e.load(rows).unwrap();
    e
}

fn send(e: &mut Engine, n: usize) -> snapback4_core::engine::MutationOutcome {
    e.mutate("sendMessage", None, Context::new("alice", BTreeMap::from([
        ("messageId".into(), Value::Id(format!("m{n:05}"))),
        ("conversationId".into(), Value::Id("chat".into())),
    ])).at(100)).unwrap()
}

#[test]
fn nine_thousand_inserts_have_flat_examined_work_with_and_without_backlog() {
    for backlog in [0, 3_000] {
        let b = compile(SOURCE);
        let cert = scale::analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == "sendMessage").unwrap().program);
        assert_eq!(cert.class, scale::Class::Constant, "{cert:?}");
        assert!(cert.line().contains("same full key"));
        assert!(cert.line().contains("1-second tick, at most 2,000 rows per pass"));
        assert!(cert.line().contains("maintained physical count"));
        let mut e = engine(SOURCE, backlog);
        let mut examined = Vec::new();
        for n in 1..=9_000 {
            let outcome = send(&mut e, n);
            assert!(matches!(outcome.state, WriteState::Sent { .. }),
                "backlog={backlog}, insert={n}, first={:?}, last={:?}, outcome={outcome:?}", examined.first(), examined.last());
            assert_eq!(outcome.metered.examined, 1,
                "only the addressed conversation is examined: backlog={backlog}, insert={n}");
            assert!(outcome.metered.examined <= cert.bounds.rows_examined);
            assert!(outcome.metered.rows_written <= cert.bounds.writes);
            examined.push(outcome.metered.examined);
        }
        println!("backlog={backlog}, inserts=9000, examined={}..{}", examined.iter().min().unwrap(), examined.iter().max().unwrap());
        assert!(examined.iter().all(|n| *n == examined[0]));
    }
}

#[test]
fn each_constraint_is_independent_of_unrelated_rows() {
    let mut outcomes = Vec::new();
    for backlog in [0, 3_000] {
        for (label, source) in [("unique+cap", SOURCE.to_owned()),
            ("unique only", SOURCE.replace("  cap 200000\n", "")),
            ("cap only", SOURCE.replace("  unique byConversationOrdinal: conversationId, ordinal\n", "").replace("return messages[conversationId, ordinal]", "return messages where .conversationId = conversationId and .ordinal = ordinal first 1"))] {
            let mut e = engine(&source, backlog);
            let rows: Vec<_> = (0..9_000).map(|n| ("messages".into(), wire::row_from_json(&e.schema().tables["messages"],
                &json!({"id":format!("live{n:05}"), "conversationId":"chat", "ordinal":n+2, "at":0, "expiresAt":null})).unwrap())).collect();
            e.load(rows).unwrap();
            let result = send(&mut e, 1);
            println!("{label}, live=9000, backlog={backlog}: {:?}, examined={}", result.state, result.metered.examined);
            outcomes.push(result);
        }
    }
    for result in outcomes {
        assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
        assert_eq!(result.metered.examined, 1, "{result:?}");
    }
}

#[path = "expiry_writes/constraints.rs"]
mod constraints;
#[path = "expiry_writes/stores.rs"]
mod stores;
#[path = "expiry_writes/devices.rs"]
mod devices;
#[path = "expiry_writes/review.rs"]
mod review;

#[test]
fn cli_certifies_keyed_expiry_writes_with_the_actual_sweep_policy() {
    let dir = std::env::temp_dir().join(format!("sb4-expiry-cost-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("snapback")).unwrap();
    std::fs::write(dir.join("snapback/schema.q"), SOURCE).unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&dir).args(["check", "--cost", "--json"]).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let cert = json["scale"].as_array().unwrap().iter().find(|c| c["operation"] == "sendMessage").unwrap();
    assert_eq!(cert["class"], "constant", "{cert}");
    assert!(cert["per_write"].to_string().contains("same full key"));
    assert!(cert["per_write"].to_string().contains("maintained physical count"));
    std::fs::remove_dir_all(dir).unwrap();
}
