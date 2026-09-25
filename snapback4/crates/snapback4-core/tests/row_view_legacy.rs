use serde_json::json;
use snapback4_core::{Context, Engine, Value, wire};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q");
#[test]
fn legacy_source_default_adoption_then_expiry_sweep() {
    let source = SOURCE.replace("  ordinal: int", "  ordinal: int default 1");
    let before = source
        .split("view unread:")
        .next()
        .unwrap()
        .replace("  ordinal: int default 1\n", "");
    let b = snapback4_lang::compile(&[("schema.q".into(), before)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, []).unwrap();
    let rows = [("members",json!({"id":"b","conversationId":"c","principal":"bob","readUpTo":0,"joinedAt":0})),
                ("messages",json!({"id":"legacy","conversationId":"c","senderId":"alice","tombstone":false,"until":10}))]
        .into_iter().map(|(t,r)|(t.into(),wire::row_from_json(&e.schema().tables[t],&r).unwrap())).collect::<Vec<_>>();
    e.seed(rows).unwrap();
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 9)
        .unwrap();
    while e.run_view_chunk(9).unwrap().is_some() {}
    // Adoption materializes the default without rewriting the legacy row.
    assert!(
        e.store().rows("messages").unwrap()[0]
            .field("ordinal")
            .is_err()
    );
    let query = |e: &mut Engine, now| {
        e.query(
            "unreadFor",
            Context::new(
                "bob",
                std::collections::BTreeMap::from([("member".into(), Value::Id("b".into()))]),
            )
            .at(now),
        )
        .unwrap()
    };
    assert_eq!(query(&mut e, 9).data, Value::Int(1));
    assert_eq!(query(&mut e, 11).data, Value::Int(0));
    e.sweep_expired(11, 100).unwrap();
    let r = query(&mut e, 11);
    assert!(r.complete);
    assert_eq!(r.data, Value::Int(0));
    assert_eq!(
        e.store().rows("unread").unwrap()[0].field("value"),
        Ok(&Value::Int(0))
    );
}
