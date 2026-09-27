use snapback4_core::{Context, Engine, Value, WriteState};

#[test]
fn a_delivery_receipt_must_survive_conversion_of_the_name_to_ephemeral() {
    let source = format!(
        "table signals:\n  principal: principal\n  n: int\n  insert <- .principal = viewer\n  read <- allow\n  ephemeral 4s\n{}",
        include_str!("delivery/schema.q")
    );
    let old = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(old.diagnostics.is_empty(), "{:?}", old.diagnostics);
    let mut engine = Engine::memory(old.schema, old.programs.into_iter().map(|p| p.program)).unwrap();
    let mut context = Context::new("alice", [
        ("group".into(), Value::Id("c1".into())),
        ("low".into(), Value::Int(1)),
        ("high".into(), Value::Int(1)),
    ].into()).at(100);
    context.delivery_fingerprint = Some(engine.schema().delivery[0].fingerprint.clone());
    let first = engine.mutate("delivered", Some("delivery-id"), context.clone()).unwrap();
    assert!(first.receipt_only && matches!(first.state, WriteState::Sent { .. }));
    let changed = source
        .replace("\n  reports delivery of messages by .chat, .ordinal:", ":")
        .replacen("  return null\nmutation ordinary", "  insert signals {principal: viewer, n: low}\n  return null\nmutation ordinary", 1);
    let new = snapback4_lang::compile(&[("schema.q".into(), changed)]);
    assert!(new.diagnostics.is_empty(), "{:?}", new.diagnostics);
    assert!(new.schema.operations["delivered"].ephemeral);
    engine.adopt(new.schema, new.programs.into_iter().map(|p| p.program)).unwrap();
    let replay = engine.mutate("delivered", Some("delivery-id"), context.clone()).unwrap();
    assert!(replay.replayed && replay.receipt_only, "new generation executed instead of replaying: {replay:?}");
    let refused = engine.mutate("delivered", Some("new-report"), context.clone()).unwrap_err();
    assert_eq!(refused.code(), "E_DELIVERY_BINDING");
    context.delivery_fingerprint = None;
    for _ in 0..2 {
        let fresh = engine.mutate("delivered", Some("fresh-signal"), context.clone()).unwrap();
        assert!(!fresh.replayed && fresh.metered.rows_written == 1);
    }
}

#[test]
fn stale_fingerprints_refuse_removed_or_rebound_reporters_before_body() {
    let source = include_str!("delivery/schema.q");
    for change in ["removed", "rebound", "renamed", "arguments"] {
        let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        let fingerprint = b.schema.delivery[0].fingerprint.clone();
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let mut ctx = Context::new("alice", [("group".into(),Value::Id("c1".into())),("low".into(),Value::Int(1)),("high".into(),Value::Int(1))].into());
        ctx.delivery_fingerprint = Some(fingerprint);
        let success = e.mutate("delivered", Some("recorded"), ctx.clone()).unwrap();
        assert!(success.receipt_only);
        let altered = match change {
            "removed" => source.replace("\n  reports delivery of messages by .chat, .ordinal:", ":"),
            "rebound" => source.replace("messages", "notes"),
            "renamed" => source.replace("mutation delivered", "mutation newDelivery"),
            _ => source.replace("low", "first"),
        }.replace("  return null\nmutation ordinary", "  require false else BODY_RAN\n  return null\nmutation ordinary");
        let new = snapback4_lang::compile(&[("schema.q".into(), altered)]);
        assert!(new.diagnostics.is_empty(), "{:?}",new.diagnostics);
        e.adopt(new.schema, new.programs.into_iter().map(|p|p.program)).unwrap();
        let refusal = e.mutate("delivered", Some("fresh"), ctx.clone()).unwrap_err().refusal();
        assert_eq!(refusal.code, "E_DELIVERY_BINDING", "{change}");
        assert!(!refusal.retryable);
        assert_eq!(refusal.site.as_deref(), Some("delivery.fingerprint"));
        assert!(e.store().applied_outcome("alice", "fresh").unwrap().is_none());
        let replay = e.mutate("delivered", Some("recorded"),ctx).unwrap();
        assert!(replay.replayed && replay.receipt_only, "{change}");
    }
}

#[test]
#[ignore = "measurement: run explicitly with --ignored --nocapture"]
fn measure_ephemeral_receipt_lookup_cost() {
    use std::time::Instant;
    let b = snapback4_lang::compile(&[("schema.q".into(), "table signals:\n  principal: principal\n  n: int\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  ephemeral 4s\nmutation pulse():\n  upsert signals[principal = viewer] {n: 1}\n".into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    let mut baseline = Vec::new(); let mut checked = Vec::new(); let mut lookup = Vec::new();
    for round in 0..11 {
        for path in [round % 2, 1 - round % 2] {
            let start = Instant::now();
            for _ in 0..5000 {
                let ctx = Context::new("alice", Default::default()).at(100);
                if path == 0 { e.mutate_ephemeral("pulse",ctx).unwrap(); }
                else { e.mutate("pulse",Some("correlation"),ctx).unwrap(); }
            }
            if round != 0 { if path == 0 { baseline.push(start.elapsed().as_nanos()/5000); } else { checked.push(start.elapsed().as_nanos()/5000); } }
        }
        let start = Instant::now();
        for _ in 0..5000 { assert!(e.replay_mutation("alice", "correlation", "pulse", &serde_json::json!({})).unwrap().is_none()); }
        if round != 0 { lookup.push(start.elapsed().as_nanos()/5000); }
    }
    baseline.sort(); checked.sort(); lookup.sort();
    println!("ephemeral median ns/write: before={} with_receipt_lookup={} delta={} lookup_only={} (10 x 5000, alternating order, warm in-memory SQLite, optimized test profile)",baseline[5],checked[5],checked[5] as i128-baseline[5] as i128,lookup[5]);
}
