//! RT6 review regressions, exercised through authorized serving entry points.
use super::*;
use std::collections::BTreeMap;

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_read_shapes_match_sqlite() {
    let source = r#"use identity
table notes:
  at: int
  label: text <=20
  unique label
  by byAt: at, id
  read <- viewer = 'alice'
  online only
query point(key: id):
  return notes[key]
query lookup(label: text <=20):
  return notes[label = label]
query existsPoint():
  return exists notes[id = 'a']
query existsLookup():
  return exists notes[label = 'c']
query firstId():
  return notes first 2 by .id
query lastId():
  return notes last 2 by .id
query firstAt():
  return notes first 2 by .at, .id
query lastAt():
  return notes last 2 by .at, .id
query cursorId(c: cursor ?):
  return notes first 2 by .id after c
query cursorIdLast(c: cursor ?):
  return notes last 2 by .id after c
query cursorAt(c: cursor ?):
  return notes last 2 by .at, .id after c
query cursorAtFirst(c: cursor ?):
  return notes first 2 by .at, .id after c
query pointAndRange():
  point = notes[id = 'a']
  page = notes first 2 by .id
  return point
"#;
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: crate::Schema =
        serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    let name = format!("rt6_shapes_{:x}", crate::ids::seed());
    let mut pg = Engine::new_at(
        AnyStore::create_postgres(&url(), &name).unwrap(),
        schema.clone(),
        programs.clone(),
        1000,
    )
    .unwrap();
    let mut sqlite = Engine::new_at(AnyStore::memory().unwrap(), schema, programs, 1000).unwrap();
    let mut digests = Vec::new();
    for e in [&mut sqlite, &mut pg] {
        let mut ds = Vec::new();
        for viewer in ["alice", "bob"] {
            ds.push(identity::session_digest(
                &identity::open_session(e.store(), viewer, "guest", 1000)
                    .unwrap()
                    .token,
            ));
        }
        digests.push(ds);
    }
    let query = |e: &mut Engine, d: &str, viewer: &str, op: &str, args: BTreeMap<String, Value>| {
        e.query_materialized_search_with_request(
            op,
            Context::new(viewer, args)
                .at(1000)
                .with_request_credential("guest"),
            None,
            DeliveryManifest::Skip,
            d,
            |s, _| {
                assert!(s.request_authority(d, sample())?.capability.is_some());
                Ok(())
            },
        )
        .0
    };
    let mut mismatches = Vec::new();
    // Empty and populated tables, allowed and denied readers, exact outcomes
    // including logical meters, continuation keys, completeness and cuts.
    for populated in [false, true] {
        if populated {
            for e in [&mut sqlite, &mut pg] {
                e.seed(
                    [("a", 3), ("b", 1), ("c", 1), ("d", 2), ("e", 4)].map(|(id, at)| {
                        (
                            "notes".into(),
                            crate::value::object([
                                ("id", Value::Id(id.into())),
                                ("at", Value::Int(at)),
                                ("label", Value::String(id.into())),
                            ]),
                        )
                    }),
                )
                .unwrap();
            }
        }
        for (v, viewer) in ["alice", "bob"].into_iter().enumerate() {
            for (op, args, planned) in [
                (
                    "point",
                    [("key".into(), Value::Id("c".into()))].into(),
                    true,
                ),
                (
                    "point",
                    [("key".into(), Value::Id("missing".into()))].into(),
                    true,
                ),
                (
                    "lookup",
                    [("label".into(), Value::String("c".into()))].into(),
                    true,
                ),
                (
                    "lookup",
                    [("label".into(), Value::String("missing".into()))].into(),
                    true,
                ),
                ("existsPoint", BTreeMap::new(), true),
                ("existsLookup", BTreeMap::new(), true),
                ("pointAndRange", BTreeMap::new(), true),
                ("firstId", BTreeMap::new(), true),
                ("lastId", BTreeMap::new(), true),
                ("firstAt", BTreeMap::new(), true),
                ("lastAt", BTreeMap::new(), true),
                ("cursorId", [("c".into(), Value::Null)].into(), false),
                ("cursorAt", [("c".into(), Value::Null)].into(), false),
                ("cursorIdLast", [("c".into(), Value::Null)].into(), false),
                ("cursorAtFirst", [("c".into(), Value::Null)].into(), false),
            ] {
                let program = pg.programs.values().find(|p| p.name == op).unwrap();
                let ctx = Context::new(viewer, args.clone()).with_request_credential("guest");
                assert_eq!(
                    super::super::super::read_plan::Plan::new(pg.schema(), program, &ctx).is_some(),
                    planned,
                    "{op} plan/fallback coverage"
                );
                let left = query(&mut sqlite, &digests[0][v], viewer, op, args.clone());
                let right = query(&mut pg, &digests[1][v], viewer, op, args);
                if left != right {
                    mismatches.push(format!(
                        "populated={populated} {viewer} {op}: sqlite={left:?}, postgres={right:?}"
                    ));
                }
                if populated
                    && viewer == "alice"
                    && let Ok(out) = &left
                {
                    let expected: Vec<&str> = match op {
                        "firstId" | "cursorId" => vec!["a", "b"],
                        "lastId" | "cursorIdLast" => vec!["e", "d"],
                        "firstAt" | "cursorAtFirst" => vec!["b", "c"],
                        "lastAt" | "cursorAt" => vec!["e", "a"],
                        _ => vec![],
                    };
                    if !expected.is_empty() {
                        assert_eq!(
                            out.data
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|r| r.field("id").unwrap().as_str().unwrap())
                                .collect::<Vec<_>>(),
                            expected
                        );
                    }
                }
            }
        }
        // Walk actual opaque cursors independently on each store: planned
        // ranges and ordinary continuation fallback must return identical pages.
        for op in ["cursorId", "cursorIdLast", "cursorAt", "cursorAtFirst"] {
            let mut cursors = [Value::Null, Value::Null];
            for page in 0..4 {
                let left = query(
                    &mut sqlite,
                    &digests[0][0],
                    "alice",
                    op,
                    [("c".into(), cursors[0].clone())].into(),
                )
                .unwrap();
                let right = query(
                    &mut pg,
                    &digests[1][0],
                    "alice",
                    op,
                    [("c".into(), cursors[1].clone())].into(),
                )
                .unwrap();
                if left != right {
                    mismatches.push(format!(
                        "populated={populated} {op} page={page}: {left:?} != {right:?}"
                    ));
                }
                cursors = [
                    left.next.clone().map(Value::String).unwrap_or(Value::Null),
                    right.next.clone().map(Value::String).unwrap_or(Value::Null),
                ];
                if left.next.is_none() && right.next.is_none() {
                    break;
                }
                assert!(page < 3, "cursor did not exhaust");
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_bpchar_uses_binary_fallback() {
    use postgres::types::Type;
    assert!(!super::super::super::flight::text_type(&Type::BPCHAR));
    assert!(!super::super::super::flight::text_type(&Type::BPCHAR_ARRAY));
    let (mut e, _, _, _) = fixture();
    let owner = e.store_mut().read_transaction().unwrap();
    let tx = owner.test_postgres_tx();
    assert!(matches!(
        tx.query("SELECT 'a'::pg_catalog.bpchar(4)", &[]).unwrap()[0],
        super::super::super::flight::Row::Bind(_)
    ));
    assert_eq!(
        tx.query("SELECT 'a'::pg_catalog.bpchar(4)", &[]).unwrap()[0].get::<_, String>(0),
        "a   "
    );
    owner.rollback().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_settings_drift_refuses_next_flight() {
    let (mut e, mut observer, _, _) = fixture();
    let mut failures = Vec::new();
    for setting in [
        "SET LOCAL client_encoding='SQL_ASCII'",
        "SET LOCAL extra_float_digits=0",
        "SET LOCAL bytea_output='escape'",
    ] {
        for flush in [false, true] {
            let before = census(&mut observer);
            let owner = e.store_mut().transaction().unwrap();
            let tx = owner.test_postgres_tx();
            tx.execute("UPDATE r SET data=data WHERE t='counters'", &[])
                .unwrap();
            tx.batch(setting).unwrap();
            let result = if flush {
                tx.defer_control("SELECT nextval('_rt6_after_failure')")
                    .unwrap();
                tx.query("SELECT 1::pg_catalog.numeric", &[]).map(|_| ())
            } else {
                tx.query("SELECT nextval('_rt6_after_failure')", &[])
                    .map(|_| ())
            };
            if result.is_ok() {
                failures.push(format!("accepted {setting}, flush={flush}"));
                owner.rollback().unwrap();
            } else {
                assert!(
                    owner.commit().is_err(),
                    "caught settings refusal must still prevent COMMIT"
                );
            }
            assert_eq!(census(&mut observer), before);
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    no_later(&mut observer);
}

#[test]
fn rt6_fix1_fault_index_out_of_range_panics() {
    let result = std::panic::catch_unwind(|| {
        fail(0, 3, || {
            let mut sql = "BEGIN;SELECT 1;".to_owned();
            inject(&mut sql);
        })
    });
    assert!(
        result.is_err(),
        "out-of-range fault silently tested the last boundary"
    );
}

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_nul_receipt_lookup_is_absent_before_callback() {
    let (e, _, _, digest) = fixture();
    for ordinary in [false, true] {
        for (principal, id) in [("alice", "nul\0id"), ("nul\0principal", "valid-id")] {
            let result = identity::with_request_preflight(
                e.store(),
                &digest,
                sample(),
                ordinary,
                Some((principal, id)),
                |s| {
                    assert_eq!(s.capability.as_ref().unwrap().0, "alice");
                    s.replay_bound(
                        principal,
                        id,
                        "increment",
                        &serde_json::json!({"counter":"c0000"}),
                    )
                },
            );
            assert!(
                matches!(result, Ok(Ok(None))),
                "ordinary={ordinary}: {result:?}"
            );
        }
    }
}

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_settings_guard_preserves_sql_error_savepoint_recovery() {
    let (mut e, _, _, _) = fixture();
    let owner = e.store_mut().read_transaction().unwrap();
    let tx = owner.test_postgres_tx();
    tx.batch("SAVEPOINT settings_recovery").unwrap();
    assert!(tx.query("SELECT 1 / 0", &[]).is_err());
    tx.rollback_named("settings_recovery").unwrap();
    assert_eq!(
        tx.query("SELECT 7::pg_catalog.int4", &[]).unwrap()[0].get::<_, i32>(0),
        7
    );
    owner.rollback().unwrap();
}

#[test]
#[ignore = "private PG16"]
fn rt6_fix1_reused_connection_settings_drift_refuses_opening() {
    let (_, _, name, _) = fixture();
    let mut client = Client::connect(&url(), NoTls).unwrap();
    client
        .batch_execute(&format!("SET search_path={name},pg_catalog"))
        .unwrap();
    let mut store = super::super::super::store::Store::new(client);
    store.transaction(None).unwrap().rollback().unwrap();
    let mut accepted = Vec::new();
    for setting in [
        "SET client_encoding='SQL_ASCII'",
        "SET extra_float_digits=0",
        "SET bytea_output='escape'",
    ] {
        store.client.batch_execute(setting).unwrap();
        if let Ok(tx) = store.transaction(None) {
            accepted.push(setting);
            tx.rollback().unwrap();
        }
        super::super::super::literal::configure(&mut store.client).unwrap();
    }
    assert!(
        accepted.is_empty(),
        "reused connection accepted drift: {accepted:?}"
    );
}
