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

const UNIQUE_SOURCE: &str = "table releases:
  team: text <=20
  principal: principal
  opensAt: time
  body: text <=100
  unique byAudience: team, principal
  by byOpening: opensAt
  not before .opensAt
  public 'scheduled releases'
  insert <- allow
  update <- allow
  sync public
query release(id: releases):
  return releases[id]
mutation create(id: id, team: text <=20, principal: principal, opensAt: time, body: text <=100):
  insert releases { id, team, principal, opensAt, body }
  return true
mutation revise(team: text <=20, principal: principal, body: text <=100):
  upsert releases[team = team, principal = principal] { body }
  return true
";

const WITNESS_SOURCE: &str = "table grants:
  ticket: int
  opensAt: time
  unique byTicket: ticket
  by byOpening: opensAt
  not before .opensAt
  public 'scheduled grants'
  sync public
table tasks:
  ticket: int
  visible: bool
  read <- .visible = true or exists grants[ticket = .ticket]
  online only
query firstVisible():
  return tasks first 1 by .id
";

fn membership_source(not_before: Option<&str>) -> String {
    let opening = not_before.map_or(String::new(), |field| format!("  not before .{field}\n"));
    format!("table members:
  room: text <=20
  principal: principal
  opensAt: time ?
  opensAgain: time ?
  unique byRoomPrincipal: room, principal
  by byOpening: opensAt
  by byOpeningAgain: opensAgain
  read <- .principal = viewer
{opening}  sync to .principal
table notes:
  room: text <=20
  body: text <=100
  read <- exists members[.room, viewer]
  sync to members[.room]
")
}

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

fn unique_engine_at(now: i64) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), UNIQUE_SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    Engine::new_at(
        Store::memory().unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        now,
    )
    .unwrap()
}

fn witness_engine_at(now: i64) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), WITNESS_SOURCE.into())]);
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

#[test]
fn a_future_row_reserves_each_non_null_unique_key() {
    let mut engine = unique_engine_at(0);
    let create = |id: &str| Context::new("alice", [
        ("id".into(), Value::Id(id.into())),
        ("team".into(), Value::String("red".into())),
        ("principal".into(), Value::Id("alice".into())),
        ("opensAt".into(), Value::Int(100)),
        ("body".into(), Value::String("hidden".into())),
    ].into()).at(0);

    assert!(matches!(engine.mutate("create", None, create("one")).unwrap().state, WriteState::Sent { .. }));
    let outcome = engine.mutate("create", None, create("two")).unwrap();
    assert!(matches!(&outcome.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{outcome:?}");
    assert_eq!(engine.store().count("releases").unwrap(), 1);
}

#[test]
fn a_natural_unique_upsert_patches_the_future_row_without_inserting() {
    let mut engine = unique_engine_at(0);
    engine.mutate("create", None, Context::new("alice", [
        ("id".into(), Value::Id("one".into())),
        ("team".into(), Value::String("red".into())),
        ("principal".into(), Value::Id("alice".into())),
        ("opensAt".into(), Value::Int(100)),
        ("body".into(), Value::String("first".into())),
    ].into()).at(0)).unwrap();

    engine.mutate("revise", None, Context::new("alice", [
        ("team".into(), Value::String("red".into())),
        ("principal".into(), Value::Id("alice".into())),
        ("body".into(), Value::String("revised".into())),
    ].into()).at(0)).unwrap();
    assert_eq!(engine.store().count("releases").unwrap(), 1);

    let opened = engine.query("release", Context::new("alice", [
        ("id".into(), Value::Id("one".into())),
    ].into()).at(100)).unwrap();
    assert_eq!(opened.data.field("body"), Ok(&Value::String("revised".into())));
}

#[test]
fn future_rule_witnesses_do_not_spend_the_authorization_walk() {
    const HIDDEN: i64 = 4_200;
    let tasks = (0..HIDDEN).map(|ticket| ("tasks".into(), object([
        ("id", Value::Id(format!("a{ticket:04}"))),
        ("ticket", Value::Int(ticket)),
        ("visible", Value::Bool(false)),
    ]))).chain(std::iter::once(("tasks".into(), object([
        ("id", Value::Id("z".into())),
        ("ticket", Value::Int(HIDDEN)),
        ("visible", Value::Bool(true)),
    ])))).collect::<Vec<_>>();

    let mut absent = witness_engine_at(0);
    absent.seed_at(tasks.clone(), 0).unwrap();
    let absent = absent.query("firstVisible", Context::new("alice", Default::default()).at(0)).unwrap();

    let grants = (0..HIDDEN).map(|ticket| ("grants".into(), object([
        ("id", Value::Id(format!("g{ticket:04}"))),
        ("ticket", Value::Int(ticket)),
        ("opensAt", Value::Int(100)),
    ])));
    let mut future = witness_engine_at(0);
    future.seed_at(tasks.into_iter().chain(grants), 0).unwrap();
    let future = future.query("firstVisible", Context::new("alice", Default::default()).at(0)).unwrap();

    assert_eq!(future.data, absent.data);
    assert_eq!(future.metered, absent.metered);
    assert_eq!(future.complete, absent.complete);
    assert_eq!(future.next, absent.next);
    assert_eq!(future.unavailable, absent.unavailable);
}

#[test]
fn an_ordinary_schema_does_not_acquire_the_time_audience_clock_floor() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "query clock():\n  return now\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut engine = Engine::new_at(
        Store::memory().unwrap(),
        bound.schema,
        bound.programs.into_iter().map(|program| program.program),
        100,
    ).unwrap();

    assert_eq!(engine.store().meta("time_audience_clock").unwrap(), None);
    assert_eq!(engine.query("clock", Context::new("alice", Default::default()).at(100)).unwrap().data, Value::Int(100));
    assert_eq!(engine.query("clock", Context::new("alice", Default::default()).at(50)).unwrap().data, Value::Int(50));
}

#[test]
fn adoption_rebuilds_openings_and_group_authority_when_the_lower_lifetime_changes() {
    let compile = |opening| {
        let bound = snapback4_lang::compile(&[("schema.q".into(), membership_source(opening))]);
        assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
        bound
    };
    let plain = compile(None);
    let timed = compile(Some("opensAt"));
    let rebound = compile(Some("opensAgain"));

    for (from, to) in [(&plain.schema, &timed.schema), (&timed.schema, &rebound.schema), (&rebound.schema, &plain.schema)] {
        assert!(snapback4_core::successor::classify(from, to).iter().any(|step| {
            step.path == "tables.members.notBefore"
                && step.change == snapback4_core::successor::Change::RuleChange
        }));
        assert_eq!(snapback4_core::partition::changed_group_audiences(Some(from), to), ["notes"]);
    }

    let mut engine = Engine::new_at(
        Store::memory().unwrap(),
        plain.schema.clone(),
        plain.programs.iter().map(|program| program.program.clone()),
        0,
    ).unwrap();
    engine.seed_at([
        ("members".into(), object([
            ("id", Value::Id("member".into())),
            ("room", Value::String("room".into())),
            ("principal", Value::Id("alice".into())),
            ("opensAt", Value::Int(100)),
            ("opensAgain", Value::Int(200)),
        ])),
        ("notes".into(), object([
            ("id", Value::Id("note".into())),
            ("room", Value::String("room".into())),
            ("body", Value::String("secret".into())),
        ])),
    ], 0).unwrap();
    let (before, _) = engine.snapshot_at("alice", 0).unwrap();
    assert!(before.iter().any(|event| event.table == "notes" && event.id == "note"));

    engine.adopt_at(timed.schema, timed.programs.into_iter().map(|program| program.program), 0).unwrap();
    let pending = engine.store().conn().query_row("SELECT count(*) FROM _time_openings", [], |row| row.get::<_, i64>(0)).unwrap();
    assert_eq!(pending, 1, "adding a lower lifetime rebuilds the pending ledger");
    let (hidden, _) = engine.snapshot_at("alice", 0).unwrap();
    assert!(!hidden.iter().any(|event| event.table == "members" && event.id == "member"), "the future membership row is revoked by the new generation");
    assert!(!hidden.iter().any(|event| event.table == "notes" && event.id == "note"), "a pre-adoption grant cannot survive the audience epoch");

    let watermark = engine.seq().unwrap();
    let opened = engine.stream_at("alice", watermark, 100, 100).unwrap();
    assert!(opened.events.iter().any(|event| event.table == "members" && event.id == "member" && event.kind == "put"), "the opening publishes the membership row");
    assert!(opened.events.iter().any(|event| event.table == "notes" && event.id == "note" && event.kind == "put"), "the opening acquires the membership content");
    assert!(opened.events.iter().any(|event| event.table == "notes" && event.kind == "scope"), "a post-epoch acquisition first clears stale retained authority");

    engine.adopt_at(rebound.schema, rebound.programs.into_iter().map(|program| program.program), 100).unwrap();
    let pending = engine.store().conn().query_row("SELECT count(*) FROM _time_openings", [], |row| row.get::<_, i64>(0)).unwrap();
    assert_eq!(pending, 1, "rebinding the lower lifetime rebuilds the pending ledger");
    let (hidden, _) = engine.snapshot_at("alice", 100).unwrap();
    assert!(!hidden.iter().any(|event| event.table == "notes" && event.id == "note"), "rebinding to a future column revokes the old grant");

    engine.adopt_at(plain.schema, plain.programs.into_iter().map(|program| program.program), 100).unwrap();
    let pending = engine.store().conn().query_row("SELECT count(*) FROM _time_openings", [], |row| row.get::<_, i64>(0)).unwrap();
    assert_eq!(pending, 0, "removing the lower lifetime clears its private ledger");
    let (visible, _) = engine.snapshot_at("alice", 100).unwrap();
    assert!(visible.iter().any(|event| event.table == "notes" && event.id == "note"), "the new generation derives the immediate grant");
}
