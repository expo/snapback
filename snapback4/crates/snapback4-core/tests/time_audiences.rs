use snapback4_core::{Context, Engine, Value, WriteState, store::Store, value::object};

const SOURCE: &str = "table announcements:
  opensAt: time ?
  closesAt: time ?
  body: text <=100
  by byOpening: opensAt
  by byExpiry: closesAt
  not before .opensAt
  expire at .closesAt
  public 'scheduled announcements'
  insert <- allow
  update <- allow
  delete <- allow
  sync public
query one(id: announcements):
  return announcements[id]
mutation move(id: announcements, opensAt: time ?):
  update announcements[id] { opensAt }
  return true
";

fn engine_at(now: i64) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    Engine::new_at(
        Store::memory().unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        now,
    )
    .unwrap()
}

fn announcement(id: &str, opens: i64, closes: i64, body: &str) -> (String, Value) {
    (
        "announcements".into(),
        object([
            ("id", Value::Id(id.into())),
            ("opensAt", Value::Int(opens)),
            ("closesAt", Value::Int(closes)),
            ("body", Value::String(body.into())),
        ]),
    )
}

fn one(engine: &mut Engine, id: &str, now: i64) -> snapback4_core::QueryOutcome {
    engine
        .query(
            "one",
            Context::new("alice", [("id".into(), Value::Id(id.into()))].into()).at(now),
        )
        .unwrap()
}

#[test]
fn lower_lifetime_withholds_payload_until_the_exact_monotonic_server_boundary() {
    let mut engine = engine_at(0);
    engine
        .seed_at([announcement("a", 100, 200, "secret")], 0)
        .unwrap();
    let watermark = engine.seq().unwrap();

    let before = one(&mut engine, "a", 99);
    assert_eq!(before.data, Value::Null);
    assert_eq!(
        before.next_expiry, None,
        "a future opening is not a public clock oracle"
    );
    let (snapshot, _) = engine.snapshot_at("alice", 99).unwrap();
    assert!(
        snapshot.is_empty(),
        "the snapshot must not serialize the future payload"
    );
    assert!(
        engine
            .stream_at("alice", watermark, 100, 99)
            .unwrap()
            .events
            .is_empty()
    );

    // A rewound request clock cannot move the durable server floor backwards.
    assert_eq!(one(&mut engine, "a", 50).data, Value::Null);
    let opened = one(&mut engine, "a", 100);
    assert_eq!(
        opened.data.field("body"),
        Ok(&Value::String("secret".into()))
    );
    let page = engine.stream_at("alice", watermark, 100, 100).unwrap();
    assert!(page.events.iter().any(|event| event.kind == "put"
        && event.id == "a"
        && event.data.as_ref().and_then(|row| row.field("body").ok())
            == Some(&Value::String("secret".into()))));
    assert_eq!(
        one(&mut engine, "a", 10).data.field("body"),
        Ok(&Value::String("secret".into())),
        "clock rollback cannot hide or re-authorize the row"
    );
}

#[test]
fn an_overdue_pending_update_publishes_its_missing_transition() {
    let mut engine = engine_at(0);
    engine
        .seed_at(
            [
                announcement("a", 100, 500, "first"),
                announcement("b", 100, 500, "second"),
            ],
            0,
        )
        .unwrap();
    let watermark = engine.seq().unwrap();

    // Advancing one bounded prefix publishes `a`; `b` remains overdue and
    // pending when the mutation starts.
    assert_eq!(
        one(&mut engine, "a", 100).data.field("body"),
        Ok(&Value::String("first".into()))
    );
    let outcome = engine
        .mutate(
            "move",
            None,
            Context::new(
                "alice",
                [
                    ("id".into(), Value::Id("b".into())),
                    ("opensAt".into(), Value::Int(90)),
                ]
                .into(),
            )
            .at(100),
        )
        .unwrap();
    assert!(
        matches!(outcome.state, WriteState::Sent { .. }),
        "{outcome:?}"
    );

    let page = engine.stream_at("alice", watermark, 100, 100).unwrap();
    let puts: Vec<_> = page
        .events
        .iter()
        .filter(|event| event.kind == "put")
        .map(|event| event.id.as_str())
        .collect();
    assert!(puts.contains(&"a") && puts.contains(&"b"), "{page:?}");
}

#[test]
fn an_overdue_row_stays_unavailable_until_its_own_opening_is_published() {
    let mut engine = engine_at(0);
    engine
        .seed_at(
            [
                announcement("a", 100, 500, "first"),
                announcement("b", 100, 500, "second"),
            ],
            0,
        )
        .unwrap();

    // One request publishes the first ordered entry only. Reaching the same
    // clock is not enough to expose the second row before its partition put.
    let pending = one(&mut engine, "b", 100);
    assert!(pending.unavailable, "{pending:?}");
    assert_eq!(pending.data, Value::Null);

    let opened = one(&mut engine, "b", 100);
    assert!(!opened.unavailable, "{opened:?}");
    assert_eq!(
        opened.data.field("body"),
        Ok(&Value::String("second".into()))
    );
}

#[test]
fn a_snapshot_omits_due_rows_that_are_still_in_the_publication_ledger() {
    let mut engine = engine_at(0);
    engine
        .seed_at(
            [
                announcement("a", 100, 500, "first"),
                announcement("b", 100, 500, "second"),
            ],
            0,
        )
        .unwrap();

    let (first, _) = engine.snapshot_at("alice", 100).unwrap();
    let first_ids: Vec<_> = first
        .iter()
        .filter(|event| event.kind.word() == "put")
        .map(|event| event.id.as_str())
        .collect();
    assert_eq!(first_ids, ["a"], "{first:?}");

    let (second, _) = engine.snapshot_at("alice", 100).unwrap();
    let mut second_ids: Vec<_> = second
        .iter()
        .filter(|event| event.kind.word() == "put")
        .map(|event| event.id.as_str())
        .collect();
    second_ids.sort_unstable();
    assert_eq!(second_ids, ["a", "b"], "{second:?}");
}

#[test]
fn never_live_rows_make_no_boundary_commit_and_future_unexpired_rows_are_not_swept() {
    let mut engine = engine_at(0);
    engine
        .seed_at(
            [
                announcement("never", 299, 250, "never disclose"),
                announcement("later", 300, 400, "still stored"),
            ],
            0,
        )
        .unwrap();
    let head = engine.seq().unwrap();

    assert_eq!(engine.sweep_expired(200, 10).unwrap(), 0);
    assert_eq!(engine.store().count("announcements").unwrap(), 2);
    assert_eq!(one(&mut engine, "never", 299).data, Value::Null);
    assert_eq!(
        engine.seq().unwrap(),
        head,
        "retiring never-live pending metadata creates no public commit"
    );
    assert_eq!(
        engine.store().count("announcements").unwrap(),
        2,
        "opening does not physically delete an expired row"
    );
    assert_eq!(engine.sweep_expired(300, 10).unwrap(), 1);
    assert_eq!(engine.store().count("announcements").unwrap(), 1);
    assert_eq!(
        one(&mut engine, "later", 300).data.field("body"),
        Ok(&Value::String("still stored".into()))
    );
}

#[test]
fn a_hidden_future_payload_does_not_change_the_public_query_meter() {
    let mut hidden = engine_at(0);
    hidden
        .seed_at([announcement("a", 100, 200, &"x".repeat(100))], 0)
        .unwrap();
    let mut absent = engine_at(0);

    let hidden = one(&mut hidden, "a", 50);
    let absent = one(&mut absent, "a", 50);
    assert_eq!(hidden.data, absent.data);
    assert_eq!(hidden.metered, absent.metered);
    assert_eq!(hidden.complete, absent.complete);
    assert_eq!(hidden.next, absent.next);
    assert_eq!(hidden.next_expiry, absent.next_expiry);
}
