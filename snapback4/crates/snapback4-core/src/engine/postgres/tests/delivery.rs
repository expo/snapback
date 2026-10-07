//! The Postgres adapter must have the same receipt-only boundary as SQLite.
use super::super::*;
const SOURCE: &str = include_str!("../../../../../snapback4-lang/tests/delivery/schema.q");
fn snapshot(e: &mut PostgresEngine) -> (u64, Vec<i64>) {
    let tx = e.store.transaction(None).unwrap();
    let head = tx.next_seq().unwrap() - 1;
    let counts = [
        "SELECT COUNT(*) FROM _commits",
        "SELECT COUNT(*) FROM _log",
        "SELECT COUNT(*) FROM _outbox",
    ]
    .map(|sql| tx.query(sql, &[]).unwrap()[0].get::<_, i64>(0));
    tx.rollback().unwrap();
    (head, counts.into())
}

fn reporter(mode: WriteMode) -> PostgresEngine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let client = Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private database"),
        postgres::NoTls,
    ).unwrap();
    let mut engine = PostgresEngine::create(
        client,
        &format!("sb4_eval_delivery_{:x}", crate::ids::seed()),
        serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap(),
        bound.programs.into_iter().map(|p| {
            serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()
        }),
    ).unwrap();
    engine.set_write_mode(mode);
    engine.load([("messages".into(), crate::value::object([
        ("id", Value::Id("m1".into())),
        ("chat", Value::Id("c1".into())),
        ("ordinal", Value::Int(1)),
        ("text", Value::String("message".into())),
        ("owner", Value::Id("alice".into())),
        ("quote", Value::Null),
    ]))]).unwrap();
    engine
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn delivery_manifest_survives_round_tripped_adoption() {
    for mode in [WriteMode::Serialized, WriteMode::Serializable] {
        let mut engine = reporter(mode);
        let before = engine.query("raw", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(serde_json::to_value(&before.delivery).unwrap()[0]["rows"], serde_json::json!([["c1", 1]]));
        let next = serde_json::from_str(&serde_json::to_string(engine.schema()).unwrap()).unwrap();
        let programs = engine.programs().values().cloned().collect::<Vec<_>>();
        engine.adopt_at(next, programs, 100).unwrap();
        let after = engine.query("raw", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(after.data, before.data);
        assert_eq!(serde_json::to_value(after.delivery).unwrap()[0]["rows"], serde_json::json!([["c1", 1]]), "{mode:?}");
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn removed_reporter_pays_nothing_after_adopting_a_warmed_clone() {
    for mode in [WriteMode::Serialized, WriteMode::Serializable] {
        let mut engine = reporter(mode);
        let before = engine.query("raw", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(serde_json::to_value(&before.delivery).unwrap()[0]["rows"], serde_json::json!([["c1", 1]]));
        // The clone shares the installed schema's prepared membership and warm index.
        let mut next = engine.schema().clone();
        next.delivery.clear();
        let programs = engine.programs().values().cloned().collect::<Vec<_>>();
        engine.adopt_at(next, programs, 100).unwrap();
        let after = engine.query("raw", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(after.data, before.data);
        assert_eq!(after.metered, before.metered);
        assert_eq!(after.complete, before.complete);
        assert_eq!(after.cut, before.cut);
        assert_eq!(after.capped_at, before.capped_at);
        assert!(after.delivery.is_none(), "removed reporter must not emit partial: {mode:?}: {after:?}");
        assert!(after.delivery_meter.is_none(), "removed reporter must not pay: {mode:?}: {after:?}");
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn delivery_noop_records_only_receipt_and_replay_does_not_lookup_program() {
    for mode in [WriteMode::Serialized, WriteMode::Serializable] {
        let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let client = Client::connect(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private database"),
            postgres::NoTls,
        )
        .unwrap();
        let mut e = PostgresEngine::create(
            client,
            &format!("sb4_eval_delivery_{:x}", crate::ids::seed()),
            serde_json::from_str(&serde_json::to_string(&b.schema).unwrap()).unwrap(),
            b.programs.into_iter().map(|p| {
                serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()
            }),
        )
        .unwrap();
        e.set_write_mode(mode);
        // A real preceding commit makes using the unallocated sequence detectable.
        e.mutate("ordinary", None, Context::new("alice", BTreeMap::new()))
            .unwrap();
        e.load([(
            "messages".into(),
            crate::value::object([
                ("id", Value::Id("m1".into())),
                ("chat", Value::Id("c1".into())),
                ("ordinal", Value::Int(1)),
                ("text", Value::String("message".into())),
                ("owner", Value::Id("alice".into())),
                ("quote", Value::Null),
            ]),
        )])
        .unwrap();
        let read = e
            .query("raw", Context::new("alice", BTreeMap::new()))
            .unwrap();
        assert_eq!(
            serde_json::to_value(read.delivery).unwrap()[0]["rows"],
            serde_json::json!([["c1", 1]])
        );
        let before = snapshot(&mut e);
        let args = [
            ("group".into(), Value::Id("c1".into())),
            ("low".into(), Value::Int(1)),
            ("high".into(), Value::Int(1)),
        ]
        .into();
        let mut ctx = Context::new("alice", args);
        ctx.delivery_fingerprint = Some(e.schema.delivery[0].fingerprint.clone());
        let out = e.mutate("delivered", Some("noop"), ctx.clone()).unwrap();
        assert!(matches!(out.state, WriteState::Sent { seq, .. } if seq == before.0));
        assert!(out.receipt_only && !out.replayed);
        assert_eq!(snapshot(&mut e), before);
        let tx = e.store.transaction(None).unwrap();
        let receipt = tx.query("SELECT seq,outcome,name,args_digest FROM _ops WHERE principal='alice' AND id='noop'", &[]).unwrap();
        assert_eq!(receipt.len(), 1);
        assert_eq!(receipt[0].get::<_, i64>(0) as u64, before.0);
        let wire: serde_json::Value = serde_json::from_str(receipt[0].get(1)).unwrap();
        assert_eq!(wire["seq"], before.0);
        assert_eq!(receipt[0].get::<_, &str>(2), "delivered");
        assert!(!receipt[0].get::<_, &str>(3).is_empty());
        tx.rollback().unwrap();
        // Rebinding is checked under each adapter's writer before the body.
        e.schema.delivery[0].fingerprint = "changed".into();
        let refused = e.mutate("delivered", Some("stale"), ctx.clone()).unwrap_err().refusal();
        assert_eq!(refused.code, "E_DELIVERY_BINDING");
        assert!(!refused.retryable);
        assert_eq!(snapshot(&mut e), before);
        e.schema.delivery.clear();
        e.programs.get_mut("delivered").unwrap().kind = ProgramKind::Query;
        assert_eq!(e.mutate("delivered", Some("now-query"), ctx.clone()).unwrap_err().code(), "E_DELIVERY_BINDING");
        e.programs.remove("delivered");
        assert_eq!(e.mutate("delivered", Some("removed"), ctx.clone()).unwrap_err().code(), "E_DELIVERY_BINDING");
        let replay = e.mutate("delivered", Some("noop"), ctx).unwrap();
        assert!(replay.replayed && replay.receipt_only);
        assert!(matches!(replay.state, WriteState::Sent { seq, .. } if seq == before.0));
        assert_eq!(snapshot(&mut e), before);
    }
}

// @ref LLP 3000.033#3 — Skip refuses construction, not only serialization.
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn read_queries_skip_manifest_construction_on_postgres() {
    use crate::engine::{DeliveryManifest, delivery::manifest_constructions};
    let mut engine = reporter(WriteMode::Serialized);
    for skip in [true, false, true, false] {
        let before = manifest_constructions();
        let result = engine.query_with_delivery("raw", Context::new("alice", BTreeMap::new()),
            if skip { DeliveryManifest::Skip } else { DeliveryManifest::Build }).unwrap();
        assert_eq!(manifest_constructions() - before, u64::from(!skip));
        assert_eq!(result.delivery.is_none(), skip);
        assert_eq!(result.delivery_meter.is_none(), skip);
    }
}
