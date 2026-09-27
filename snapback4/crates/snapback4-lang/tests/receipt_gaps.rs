//! Calibration 23: the expiry refusal leads to a compiled receipt-gap recipe.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use snapback4_lang::{compile, guide};

fn recipe() -> String {
    guide::quarry(guide::card("sequences").unwrap()).into_iter()
        .find(|s| s.contains("mutation skipExpiredBefore")).unwrap()
}
fn checked(s: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), s.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    b
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn write(e: &mut Engine, op: &str, args: &[(&str, Value)], ids: &[&str], now: i64) -> Value {
    let ctx = Context::new("alice", args.iter().map(|(k,v)| (k.to_string(), v.clone())).collect())
        .with_ids(ids.iter().map(|s| s.to_string())).at(now);
    match e.mutate(op, None, ctx).unwrap().state {
        WriteState::Sent { result, .. } => result,
        state => panic!("{op}: {state:?}"),
    }
}

#[test]
fn diary_and_run_log_intents_reach_the_recipe_directly() {
    for phrase in ["receipt gap expiring messages", "receipt gap", "receipt gaps", "expiring messages",
        "what did this member miss", "bounded unique ordinal probes", "expired ordinal holes",
        "mutation page over expiring messages", "prohibited mutation scan over expiring rows", "sequence by"] {
        assert_eq!(guide::card(phrase), guide::card("sequences"), "{phrase}");
    }
    checked(&recipe());
    assert!(guide::explain_code("E_STRUCTURAL_FANOUT").unwrap().contains("sequence by conversationId"));
}

#[test]
fn expiry_page_refusal_supplies_a_pasteable_helper_for_both_allocators() {
    let source = recipe();
    let helper_start = source.find("fn skipExpired_messages").unwrap();
    let helper_end = source.find("mutation skipExpiredBefore").unwrap();
    let source = source[..helper_start].to_owned() + &source[helper_end..];
    for manual in [false, true] {
        for (parent, ordinal) in [("conversationId", "ordinal"), ("room", "position")] {
            let source = source.replace("conversationId", parent).replace("ordinal", ordinal);
            let source = if manual { source.replace(&format!("{ordinal}: sequence by {parent}"), &format!("{ordinal}: int\n  immutable {parent}, {ordinal}"))
                .replace("sender: viewer, expiresAt", &format!("sender: viewer, {ordinal}: 1, expiresAt")) } else { source };
            // Minimal reproduction of the recorded first-live-message gap scan;
            // the supplied artifact copy does not contain the builder's rejected source.
            let refused = source.replace(&format!("prefix = skipExpired_messages(message.{parent}, prefix, message.{ordinal})"),
                &format!("gap = first(messages where .{parent} = message.{parent} and .{ordinal} > prefix first 1 by .{ordinal})"));
            let b = compile(&[("schema.q".into(), refused.clone())]);
            assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
            let d = &b.diagnostics[0];
            assert_eq!(d.code, "E_STRUCTURAL_FANOUT");
            assert_eq!(d.guide, "sequences");
            assert!(!d.mechanical);
            assert!(d.message.contains(&format!("{ordinal}: sequence by {parent}")), "{d}");
            assert!(d.rewrite.contains(&format!("exists messages[{parent} = scope, {ordinal} = prefix + 1]")), "{d}");
            assert!(d.rewrite.contains("range(0, 1024)"));
            let repaired = format!("{source}\n{}\n", d.rewrite);
            checked(&repaired);
        }
    }
}

#[test]
fn recipe_skips_expired_positions_but_never_live_messages_on_memory_and_sqlite() {
    for disk in [false, true] {
        let dir = std::env::temp_dir().join(format!("receipt-gaps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let store = if disk { Store::open(&path).unwrap() } else { Store::memory().unwrap() };
        let b = checked(&recipe());
        let mut e = Engine::new(store, b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        write(&mut e, "createConversation", &[], &["chat", "member"], 1);
        assert_eq!(e.store().rows("members").unwrap()[0].field("joinedAt").unwrap(), &Value::Int(1));
        for (name, expiry) in [("gone", Value::Int(10)), ("live", Value::Null), ("later", Value::Null)] {
            write(&mut e, "send", &[("conversationId", id("chat")), ("expiresAt", expiry)], &[name], 2);
        }
        assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("later"))], &[], 9), Value::Int(1));
        assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("later"))], &[], 10), Value::Int(2));
        assert_eq!(e.store().rows("messages").unwrap().len(), 3, "expiry works before physical sweep");
        assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("live"))], &[], 10), Value::Int(2));
        // A second member shares the same counter. Seed is a trusted fixture import.
        e.seed([("members".into(), snapback4_core::value::object([
            ("id", id("bob-member")), ("conversationId", id("chat")), ("principal", id("bob")),
            ("deliveredOrdinal", Value::Int(0)),
        ]))]).unwrap();
        write(&mut e, "send", &[("conversationId", id("chat")), ("expiresAt", Value::Int(20))], &["new"], 11);
        let count = |e: &mut Engine, now| e.query("whatDidIMiss", Context::new("bob", [("member".into(), id("bob-member"))].into()).at(now)).unwrap();
        let before = count(&mut e, 19);
        let after = count(&mut e, 20);
        assert!(before.complete && after.complete);
        assert_eq!(before.data, Value::Int(1));
        assert_eq!(after.data, Value::Int(0));
        drop(e);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn a_uniform_sender_page_does_not_justify_treating_other_senders_as_holes() {
    let source = "table conversations:\n  public\n  online only\ntable messages:\n  conversation: conversations\n  ordinal: int\n  sender: principal\n  expiresAt: time ?\n  unique conversation, ordinal\n  read <- .sender = viewer\n  expire at .expiresAt\n  online only\nmutation gap(conversation: conversations):\n  return first(messages where .conversation = conversation and .sender = viewer first 1 by .ordinal)\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").expect("expiry page refused");
    assert!(!d.rewrite.contains("skipExpired"), "a hidden message is not an expired hole: {d}");
    assert!(d.rewrite.contains("query"), "{d}");
}

#[test]
fn bounded_gap_progress_resumes_without_jumping_to_the_claimed_run() {
    let b = checked(&recipe());
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    write(&mut e, "createConversation", &[], &["chat", "member"], 1);
    for n in 0..1026 {
        write(&mut e, "send", &[("conversationId", id("chat")), ("expiresAt", Value::Int(10))], &[&format!("gone-{n}")], 2);
    }
    write(&mut e, "send", &[("conversationId", id("chat")), ("expiresAt", Value::Null)], &["next"], 2);
    assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("next"))], &[], 10), Value::Int(1025));
    assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("next"))], &[], 10), Value::Int(1027));
    assert_eq!(write(&mut e, "skipExpiredBefore", &[("next", id("next"))], &[], 10), Value::Int(1027));
}
