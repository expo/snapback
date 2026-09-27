// Copy to crates/snapback4-lang/tests/delivery_replay_conversion.rs, then:
// cargo test -p snapback4-lang --test delivery_replay_conversion -- --nocapture
// This counterexample should fail under the existing ephemeral routing.
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
    let context = Context::new("alice", [
        ("group".into(), Value::Id("c1".into())),
        ("low".into(), Value::Int(1)),
        ("high".into(), Value::Int(1)),
    ].into()).at(100);
    let first = engine.mutate("delivered", Some("delivery-id"), context.clone()).unwrap();
    assert!(first.receipt_only && matches!(first.state, WriteState::Sent { .. }));
    let changed = source
        .replace("\n  reports delivery of messages by .chat, .ordinal:", ":")
        .replacen("  return null\nmutation ordinary", "  insert signals {principal: viewer, n: low}\n  return null\nmutation ordinary", 1);
    let new = snapback4_lang::compile(&[("schema.q".into(), changed)]);
    assert!(new.diagnostics.is_empty(), "{:?}", new.diagnostics);
    assert!(new.schema.operations["delivered"].ephemeral);
    engine.adopt(new.schema, new.programs.into_iter().map(|p| p.program)).unwrap();
    let replay = engine.mutate("delivered", Some("delivery-id"), context).unwrap();
    assert!(replay.replayed && replay.receipt_only, "new generation executed instead of replaying: {replay:?}");
}
