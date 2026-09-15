//! Shared, deterministic fixture for the executable evaluation and its tests.
use postgres::{Client, NoTls};
use snapback4_core::{Context, Program, Schema, Value, value::object};
use std::collections::BTreeMap;

pub fn connect() -> Client {
    let url =
        std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("set SNAPBACK4_EVAL_POSTGRES to an isolated local test database (see README)");
    Client::connect(&url, NoTls).expect("connect to evaluation Postgres; this harness only supports local NoTls")
}

pub fn namespace(label: &str) -> String {
    format!("sb4_eval_{label}_{}_{:x}", std::process::id(), snapback4_core::ids::seed())
}

pub fn compiled() -> (Schema, Vec<Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../fixture.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (bound.schema, bound.programs.into_iter().map(|p| p.program).collect())
}

pub fn id(text: impl Into<String>) -> Value {
    Value::Id(text.into())
}
pub fn string(text: impl Into<String>) -> Value {
    Value::String(text.into())
}
pub fn context(viewer: &str, pairs: &[(&str, Value)]) -> Context {
    Context::new(viewer, pairs.iter().map(|(k, v)| ((*k).into(), v.clone())).collect::<BTreeMap<_, _>>()).at(1_000)
}

pub fn fixture(rooms: usize, items: usize) -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    for r in 0..rooms {
        let room = format!("r{r:03}");
        for viewer in ["alice", "bob"] {
            rows.push((
                "memberships".into(),
                object([
                    ("id", id(format!("{room}-{viewer}"))),
                    ("room", id(&room)),
                    ("principal", id(viewer)),
                    ("role", string(if viewer == "alice" { "admin" } else { "member" })),
                ]),
            ));
        }
        for i in 0..items {
            rows.push((
                "items".into(),
                object([
                    ("id", id(format!("{room}-i{i:04}"))),
                    ("room", id(&room)),
                    ("owner", id("alice")),
                    ("title", string(format!("item-{i:04}"))),
                    ("amount", Value::Int(i as i64)),
                    ("at", Value::Int(i as i64)),
                ]),
            ));
        }
    }
    for i in 0..8 {
        rows.push(("counters".into(), object([("id", id(format!("c{i}"))), ("value", Value::Int(0))])));
    }
    rows
}

pub fn sent(outcome: &snapback4_core::engine::MutationOutcome) -> u64 {
    let snapback4_core::WriteState::Sent { seq, .. } = outcome.state else { panic!("expected sent: {outcome:?}") };
    seq
}
