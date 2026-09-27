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
        let ctx = Context::new("alice", args);
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
        e.programs.remove("delivered");
        let replay = e.mutate("delivered", Some("noop"), ctx).unwrap();
        assert!(replay.replayed && replay.receipt_only);
        assert!(matches!(replay.state, WriteState::Sent { seq, .. } if seq == before.0));
        assert_eq!(snapshot(&mut e), before);
    }
}
