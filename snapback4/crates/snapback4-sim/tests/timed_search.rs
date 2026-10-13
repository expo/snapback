use snapback4_core::{Context, Engine, QueryOutcome, Store, Value, value::object};
use std::collections::BTreeMap;

const SOURCE: &str = r#"table documents:
  opensAt: time
  visible: bool
  body: text <=100
  by byOpening: opensAt
  by byWords: words(body), id
  not before .opensAt
  read <- .visible = true
  online only
query search(c: cursor ?):
  return documents matching 'a' first 2 by byWords after c
"#;

const MEMBERSHIP_SOURCE: &str = r#"table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: id
  opensAt: time
  body: text <=100
  at: time
  by byOpening: opensAt
  search body
  not before .opensAt
  read <- exists members[.room, viewer]
  sync to members[.room] last 10 by .at
query search(c: cursor ?):
  return messages matching 'a' first 1 by .at after c
"#;

fn row(id: &str, opens_at: i64, visible: bool, body: &str) -> (String, Value) {
    ("documents".into(), object([
        ("id", Value::Id(id.into())),
        ("opensAt", Value::Int(opens_at)),
        ("visible", Value::Bool(visible)),
        ("body", Value::String(body.into())),
    ]))
}

fn world(future: bool) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema,
        bound.programs.into_iter().map(|program| program.program), 0).unwrap();
    let mut rows = vec![
        row("b-live", 0, true, "ashared"),
        row("c-live", 0, true, "ashared"),
    ];
    if future {
        rows.extend([
            row("a-head", 100, false, "ashared"),
            row("future-word", 100, false, "a000"),
        ]);
    }
    engine.seed_at(rows, 0).unwrap();
    engine
}

fn page(engine: &mut Engine, cursor: Option<String>) -> Result<QueryOutcome, snapback4_core::Refusal> {
    engine.query("search", Context::new("alice", BTreeMap::from([(
        "c".into(), cursor.map(Value::String).unwrap_or(Value::Null),
    )])).at(50))
}

fn id(outcome: &QueryOutcome) -> &str {
    outcome.data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap()
}

fn membership_world(future: bool) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), MEMBERSHIP_SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new_at(Store::memory().unwrap(), bound.schema,
        bound.programs.into_iter().map(|program| program.program), 0).unwrap();
    let mut rows = vec![
        ("members".into(), object([
            ("id", Value::Id("member".into())),
            ("room", Value::Id("room".into())),
            ("principal", Value::Id("alice".into())),
        ])),
        ("messages".into(), object([
            ("id", Value::Id("b-live".into())), ("room", Value::Id("room".into())),
            ("opensAt", Value::Int(0)), ("body", Value::String("ashared".into())), ("at", Value::Int(1)),
        ])),
        ("messages".into(), object([
            ("id", Value::Id("c-live".into())), ("room", Value::Id("room".into())),
            ("opensAt", Value::Int(0)), ("body", Value::String("ashared".into())), ("at", Value::Int(2)),
        ])),
    ];
    if future {
        rows.push(("messages".into(), object([
            ("id", Value::Id("a-head".into())), ("room", Value::Id("room".into())),
            ("opensAt", Value::Int(100)), ("body", Value::String("ashared".into())), ("at", Value::Int(0)),
        ])));
    }
    engine.seed_at(rows, 0).unwrap();
    engine
}

#[test]
fn future_word_heads_leave_live_siblings_and_continuations_unchanged() {
    let (mut absent, mut present) = (world(false), world(true));
    let first_absent = page(&mut absent, None).expect("the absent world must not refuse");
    let first_present = page(&mut present, None).expect("future heads must not refuse");
    let ids = |outcome: &QueryOutcome| outcome.data.as_array().unwrap().iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(ids(&first_absent), ["b-live", "c-live"]);
    assert_eq!(ids(&first_present), ["b-live", "c-live"], "a future head must not skip either live sibling sharing its word");
    assert!(first_absent.next.is_none() && first_present.next.is_none(), "online-only nonuniform search withholds its continuation");
    assert_eq!(first_absent, first_present, "future heads changed data, meter, completion, or continuation");
}

#[test]
fn future_membership_scope_head_keeps_the_shared_word_live() {
    let (mut absent, mut present) = (membership_world(false), membership_world(true));
    let first_absent = page(&mut absent, None).expect("the absent membership world must not refuse");
    let first_present = page(&mut present, None).expect("the timed membership world must not refuse");
    assert_eq!(id(&first_absent), "b-live");
    assert_eq!(id(&first_present), "b-live", "the future scope head must not hide a live sibling of the same word");
    assert!(first_absent.next.is_some() && first_present.next.is_some());
    assert_eq!(first_absent, first_present, "the future membership scope head changed the first page");
    let second_absent = page(&mut absent, first_absent.next).unwrap();
    let second_present = page(&mut present, first_present.next).unwrap();
    assert_eq!(id(&second_absent), "c-live");
    assert_eq!(id(&second_present), "c-live");
    assert!(second_absent.next.is_none() && second_present.next.is_none());
    assert_eq!(second_absent, second_present, "the future membership scope head changed the continuation");
}
