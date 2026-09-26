use snapback4_core::engine::ephemeral::{Hub, Limits};
use snapback4_core::{
    Context, Engine, RuntimeError, Value, rows::Rows, store::Store, value::object,
};
use std::sync::Arc;
const SOURCE: &str = include_str!("ephemeral/schema.q");
fn bind(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = bind(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value {
    Value::Id(s.into())
}
fn ctx(who: &str, now: i64, fields: &[(&str, Value)]) -> Context {
    Context::new(
        who,
        fields
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn args(room: &str) -> Vec<(&'static str, Value)> {
    vec![("roomId", id(room)), ("payload", Value::String("".into()))]
}
fn seed(e: &mut Engine) {
    e.seed_at(
        [
            (
                "rooms".into(),
                object([("id", id("r")), ("title", Value::String("Room".into()))]),
            ),
            (
                "members".into(),
                object([
                    ("id", id("a")),
                    ("roomId", id("r")),
                    ("principal", id("alice")),
                ]),
            ),
            (
                "members".into(),
                object([
                    ("id", id("b")),
                    ("roomId", id("r")),
                    ("principal", id("bob")),
                ]),
            ),
        ],
        1000,
    )
    .unwrap();
}
fn page(e: &mut Engine, who: &str, now: i64) -> snapback4_core::QueryOutcome {
    e.query("typingIn", ctx(who, now, &[("roomId", id("r"))]))
        .unwrap()
}
fn limits(e: &mut Engine, l: Limits) {
    let h = Arc::new(Hub::with_limits(
        e.store().meta("store_id").unwrap().unwrap(),
        e.generation(),
        e.schema(),
        l,
    ));
    e.share_ephemeral_hub(h).unwrap();
}
fn counts(e: &Engine) -> Vec<i64> {
    ["_commits", "_log", "_outbox", "_ops", "r", "i"]
        .iter()
        .map(|t| {
            e.store()
                .conn()
                .query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
                .unwrap()
        })
        .collect()
}

#[test]
fn expiry_joins_and_hidden_deadlines_with_no_durable_records_or_replay() {
    let mut e = engine(SOURCE);
    seed(&mut e);
    let before = counts(&e);
    let out = e
        .mutate_ephemeral(
            "setTyping",
            ctx("alice", 1000, &args("r")).with_ids(["client-id".into()]),
        )
        .unwrap();
    assert!(out.result.field("$deadline").is_err());
    assert_ne!(
        out.result.field("id").unwrap().as_str().unwrap(),
        "client-id"
    );
    assert_eq!(out.ephemeral.epoch, 1);
    assert_eq!(out.ephemeral.tables, ["typing"]);
    let read = page(&mut e, "bob", 1001);
    assert_eq!(read.data.as_array().unwrap().len(), 1);
    assert_eq!(read.next_expiry, Some(5000));
    assert_eq!(read.ephemeral.unwrap().epoch, 1);
    assert!(read.data.as_array().unwrap()[0].field("$deadline").is_err());
    let point = e
        .query(
            "typingOne",
            ctx("bob", 1001, &[("roomId", id("r")), ("who", id("alice"))]),
        )
        .unwrap();
    assert!(point.data.field("$deadline").is_err());
    let names = e
        .query("names", ctx("bob", 1001, &[("roomId", id("r"))]))
        .unwrap();
    assert_eq!(
        names.data.as_array().unwrap()[0].field("title").unwrap(),
        &Value::String("Room".into())
    );
    assert!(
        e.query("durable", ctx("bob", 1001, &[]))
            .unwrap()
            .ephemeral
            .is_none()
    );
    assert_eq!(page(&mut e, "bob", 5000).data, Value::Array(vec![]));
    assert_eq!(counts(&e), before);
    // Even direct Engine::mutate calls with a repeated id run again, with no durable receipt.
    e.mutate("setTyping", Some("same"), ctx("alice", 6000, &args("r")))
        .unwrap();
    e.mutate("setTyping", Some("same"), ctx("alice", 6500, &args("r")))
        .unwrap();
    assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 3);
    assert_eq!(counts(&e), before);
}
#[test]
fn renewal_requires_insert_authority_and_revocation_affects_reads() {
    let mut e = engine(SOURCE);
    seed(&mut e);
    e.mutate_ephemeral("setTyping", ctx("alice", 1000, &args("r")))
        .unwrap();
    e.mutate(
        "removeMember",
        None,
        ctx("bob", 1100, &[("roomId", id("r")), ("who", id("alice"))]),
    )
    .unwrap();
    assert_eq!(page(&mut e, "alice", 1101).data, Value::Array(vec![]));
    let err = e
        .mutate_ephemeral("setTyping", ctx("alice", 1200, &args("r")))
        .err()
        .unwrap();
    assert!(
        matches!(err.code().as_str(), "E_RULE" | "NOT_FOUND"),
        "{err}"
    );
    assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 1);
    assert_eq!(page(&mut e, "bob", 5100).data, Value::Array(vec![]));
}
#[test]
fn failures_after_a_write_undo_every_row_and_epoch() {
    for (name, body, code) in [
        (
            "rule",
            "upsert typing['r', viewer] {}\n  upsert typing['r', 'someone'] {}",
            "NOT_FOUND",
        ),
        (
            "unique",
            "insert typing { roomId: 'r', principal: viewer }\n  insert typing { roomId: 'r', principal: viewer }",
            "E_CONSTRAINT",
        ),
        (
            "cap",
            "upsert typing['r', viewer] {}\n  upsert typing['r', 'bob'] {}",
            "E_CONSTRAINT",
        ),
        (
            "require",
            "upsert typing['r', viewer] {}\n  require false else STOP",
            "STOP",
        ),
    ] {
        let source = if name == "cap" {
            SOURCE.replace("cap 50", "cap 1").replace(
                "insert <- .principal = viewer and exists",
                "insert <- exists",
            )
        } else {
            SOURCE.into()
        };
        let mut e = engine(&format!("{source}\nmutation bad():\n  {body}\n"));
        seed(&mut e);
        let err = e
            .mutate_ephemeral("bad", ctx("alice", 1000, &[]))
            .err()
            .expect(name);
        assert_eq!(err.code(), code, "{name}: {err}");
        assert_eq!(page(&mut e, "bob", 1001).data, Value::Array(vec![]));
        assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 0);
    }
}
#[test]
fn capacity_refusals_restore_rows_and_sweep_before_admission() {
    for l in [
        Limits {
            principal_rows: 1,
            ..Limits::default()
        },
        Limits {
            principal_bytes: 1,
            ..Limits::default()
        },
        Limits {
            rows: 1,
            ..Limits::default()
        },
        Limits {
            bytes: 1,
            ..Limits::default()
        },
    ] {
        let mut e = engine(SOURCE);
        seed(&mut e);
        limits(&mut e, l);
        let first = e.mutate_ephemeral("setTyping", ctx("alice", 1000, &args("r")));
        if l.principal_bytes == 1 || l.bytes == 1 {
            assert_eq!(first.err().unwrap().code(), "E_EPHEMERAL_FULL");
            assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 0);
            assert_eq!(page(&mut e, "bob", 1001).data, Value::Array(vec![]));
            continue;
        }
        first.unwrap();
        let who = if l.rows == 1 { "bob" } else { "alice" };
        e.seed_at(
            [(
                "members".into(),
                object([
                    ("id", id("ar2")),
                    ("roomId", id("r2")),
                    ("principal", id(who)),
                ]),
            )],
            1001,
        )
        .unwrap();
        let err = e
            .mutate_ephemeral("setTyping", ctx(who, 1002, &args("r2")))
            .err()
            .unwrap();
        assert_eq!(err.code(), "E_EPHEMERAL_FULL");
        assert!(err.refusal().retryable);
        assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 1);
        e.mutate_ephemeral("setTyping", ctx(who, 5000, &args("r2")))
            .unwrap();
        assert_eq!(e.ephemeral_hub().snapshot().unwrap().version.epoch, 2);
    }
}
#[test]
fn paired_world_capacity_depends_on_declared_size_not_private_payload() {
    fn world(payload: &str) -> (String, u64) {
        let mut e = engine(SOURCE);
        seed(&mut e);
        let size = snapback4_core::engine::ephemeral::declared_size(&e.schema().tables["typing"]);
        limits(
            &mut e,
            Limits {
                bytes: size + 1,
                ..Limits::default()
            },
        );
        e.mutate_ephemeral(
            "setTyping",
            ctx(
                "alice",
                1000,
                &[
                    ("roomId", id("r")),
                    ("payload", Value::String(payload.into())),
                ],
            ),
        )
        .unwrap();
        let code = e
            .mutate_ephemeral("setTyping", ctx("bob", 1001, &args("r")))
            .err()
            .unwrap()
            .code();
        (code, e.ephemeral_hub().snapshot().unwrap().version.epoch)
    }
    assert_eq!(world(""), world(&"x".repeat(100)));
    assert_eq!(world("").0, "E_EPHEMERAL_FULL");
}
#[test]
fn generation_admission_rechecks_life_clauses_and_effect_facts() {
    let b = bind(SOURCE);
    let programs: Vec<_> = b.programs.into_iter().map(|p| p.program).collect();
    for change in 0..6 {
        let mut schema = b.schema.clone();
        match change {
            0 => {
                schema
                    .tables
                    .get_mut("typing")
                    .unwrap()
                    .ephemeral
                    .as_mut()
                    .unwrap()
                    .life_ms = 999
            }
            1 => {
                schema
                    .tables
                    .get_mut("typing")
                    .unwrap()
                    .residency
                    .online_only = true
            }
            2 => schema.operations.get_mut("setTyping").unwrap().ephemeral = false,
            3 => schema.operations.get_mut("setTyping").unwrap().runs = Some("device".into()),
            4 => {
                schema
                    .operations
                    .get_mut("durable")
                    .unwrap()
                    .ephemeral_reads = vec!["typing".into()]
            }
            _ => schema.operations.get_mut("durable").unwrap().ephemeral = true,
        }
        assert!(Engine::memory(schema, programs.clone()).is_err());
    }
}
#[test]
fn durable_to_ephemeral_activation_deletes_rows_and_indexes() {
    let source = SOURCE.replace("  ephemeral 4s\n", "");
    let mut e = engine(&source);
    seed(&mut e);
    e.mutate("setTyping", None, ctx("alice", 1000, &args("r")))
        .unwrap();
    let before = e
        .store()
        .conn()
        .query_row(
            "SELECT count(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name='typing')",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(before, 1);
    let b = bind(SOURCE);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 1001)
        .unwrap();
    let sql = "SELECT (SELECT count(*) FROM r WHERE t=(SELECT num FROM _catalog WHERE name='typing')) + (SELECT count(*) FROM i WHERE ti IN (SELECT num FROM _catalog WHERE name LIKE 'typing.%'))";
    assert_eq!(
        e.store()
            .conn()
            .query_row(sql, [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(page(&mut e, "bob", 1002).data, Value::Array(vec![]));
}
#[test]
fn seed_and_load_refuse_ephemeral_tables() {
    let mut e = engine(SOURCE);
    seed(&mut e);
    let row = object([
        ("id", id("t")),
        ("roomId", id("r")),
        ("principal", id("alice")),
    ]);
    assert_eq!(
        e.seed_at([("typing".into(), row.clone())], 1000)
            .unwrap_err()
            .code(),
        "E_QUARRY_EPHEMERAL"
    );
    assert_eq!(
        e.load([("typing".into(), row)]).unwrap_err().code(),
        "E_QUARRY_EPHEMERAL"
    );
}

#[path = "ephemeral/generation.rs"]
mod generation;
#[path = "ephemeral/layered.rs"]
mod layered;

#[test]
fn expired_points_skip_rules_and_durable_queries_do_not_lock_the_hub() {
    // A non-uniform witness cannot be decided from the public lookup key.
    // The meter may reserve probes; corrupting this test's durable witness
    // proves the expired row never actually evaluates the read rule.
    let source = SOURCE.replace("table typing:", "table typing:\n  lookupRoom: rooms default 'r'").replace("read <- exists members[.roomId, viewer]", "read <- exists members[.lookupRoom, viewer]");
    let mut e = engine(&source);
    seed(&mut e);
    e.mutate_ephemeral("setTyping", ctx("alice", 1000, &args("r"))).unwrap();
    e.store().conn().execute("UPDATE r SET data = 'invalid witness' WHERE t = (SELECT num FROM _catalog WHERE name = 'members')", []).unwrap();
    assert!(e.query("typingOne", ctx("bob", 4999, &[("roomId", id("r")), ("who", id("alice"))])).is_err());
    let expired = e.query("typingOne", ctx("bob", 5000, &[("roomId", id("r")), ("who", id("alice"))])).unwrap();
    assert_eq!(expired.data, Value::Null);
    let hub = e.ephemeral_hub();
    let _held = hub.lock().unwrap();
    assert!(e.query("durable", ctx("bob", 5001, &[])).unwrap().ephemeral.is_none());
}
