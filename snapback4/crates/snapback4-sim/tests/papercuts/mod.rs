use super::*;
mod cases;
use cases::*;
use serde_json::json;

fn compile(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{}", bound.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n"));
    bound
}

#[test]
fn w9c_emit_only_bounded_lists_record_effects_on_server() {
    for (name, body, count) in LOOPS {
        let bound = compile(&loop_source(body));
        let mut engine = Engine::memory(bound.schema.clone(), bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("batches".into(), snapback4_core::wire::row_from_json(&bound.schema.tables["batches"], &json!({"id":"batch", "recipients":["bob","carol"], "numbers":[1,2,3]})).unwrap())].into_iter().chain(
            ["alice", "bob", "carol"].map(|p| ("members".into(), snapback4_core::value::object([("id", id(p)), ("principal", id(p))]))))).unwrap();
        let result = engine.mutate("send", Some("send"), Context::new("alice", args(&[("batchId", id("batch"))])).at(100)).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }), "{name}: {result:?}");
        let effects = engine.effects(None, 10).unwrap();
        assert_eq!(effects.len(), *count, "{name}");
        let mut recipients: Vec<_> = effects.iter().map(|e| e.payload.field("recipient").unwrap().clone()).collect();
        recipients.sort_by_key(|v| snapback4_core::wire::to_json(v).to_string());
        assert_eq!(recipients, if *name == "scalar_column" { vec![Value::Int(1), Value::Int(2), Value::Int(3)] } else { vec![id("bob"), id("carol")] }, "{name}");
        assert_eq!(result.metered.rows_written, 0);
        // The same id must replay with the same arguments: a differing input is
        // now a terminal id-reuse refusal, not a replay.
        assert!(engine.mutate("send", Some("send"), Context::new("alice", args(&[("batchId", id("batch"))])).at(100)).unwrap().replayed);
        assert_eq!(engine.effects(None, 10).unwrap(), effects);
        println!("server {name}: {count} emissions, 0 rows written, replay adds 0 emissions");
    }
}

#[test]
fn w9c_unique_hook_and_legacy_refusals_on_server() {
    for (hook, code, message) in [
        (" else HANDLE_TAKEN 'That handle is taken.'", "HANDLE_TAKEN", "That handle is taken."),
        (" else HANDLE_TAKEN", "HANDLE_TAKEN", "the program refused with HANDLE_TAKEN"),
        ("", "E_CONSTRAINT", "profiles.byHandle already has a row where handle = 'alice'"),
    ] {
        let bound = compile(&profiles(hook));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let create = |engine: &mut Engine, key: &str, handle: &str| engine.mutate("create", Some(key), Context::new("alice", args(&[("handle", Value::String(handle.into()))])).with_ids([key.into()])).unwrap();
        assert!(matches!(create(&mut engine, "p1", "alice").state, WriteState::Sent { .. }));
        let duplicate = create(&mut engine, "p2", "alice");
        let WriteState::Failed { why, .. } = duplicate.state else { panic!("{duplicate:?}") };
        assert_eq!((why.code.as_str(), why.message.as_str()), (code, message));
        if !hook.is_empty() { assert_eq!(serde_json::to_value(&why).unwrap()["detail"], "profiles.byHandle already has a row where handle = 'alice'"); }
        println!("server refusal: {why}");
        assert_eq!(engine.store().count("profiles").unwrap(), 1);
        assert!(matches!(create(&mut engine, "p3", "bob").state, WriteState::Sent { .. }));
        let rename = engine.mutate("rename", Some("rename"), Context::new("alice", args(&[("profile", id("p3")), ("handle", Value::String("alice".into()))]))).unwrap();
        assert!(matches!(rename.state, WriteState::Failed { ref why, .. } if why.code == code));
        let absent = engine.mutate("tryCreate", Some("try"), Context::new("alice", args(&[("handle", Value::String("alice".into()))])).with_ids(["p4".into()])).unwrap();
        assert!(matches!(absent.state, WriteState::Sent { result: Value::Null, .. }));
    }
}

#[test]
fn w9c_unique_hook_preserves_hidden_collision_refusal() {
    let source = profiles(" else HANDLE_TAKEN 'That handle is taken.'").replace("  public 'profiles'", "  owner: principal default viewer\n  read <- .owner = viewer").replace("  sync\n", "  by byOwner: owner, id\n  sync to .owner\n");
    let bound = compile(&source);
    // The metadata survives the wire/storage schema form.
    let schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let mut engine = Engine::memory(schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let create = |engine: &mut Engine, viewer: &str, key: &str| engine.mutate("create", Some(key), Context::new(viewer, args(&[("handle", Value::String("alice".into()))])).with_ids([key.into()])).unwrap();
    assert!(matches!(create(&mut engine, "alice", "p1").state, WriteState::Sent { .. }));
    let hidden = create(&mut engine, "bob", "p2");
    let WriteState::Failed { why, .. } = hidden.state else { panic!("{hidden:?}") };
    assert_eq!(why.code, "E_RULE");
    assert_eq!(serde_json::to_value(&why).unwrap().get("detail"), None);
    assert!(!why.message.contains("byHandle"));
    assert_eq!(engine.store().count("profiles").unwrap(), 1);
}
