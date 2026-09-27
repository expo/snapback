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
        "skip expired gaps in receipts", "advance delivered prefix over expired messages",
        "resume receipts after messages expire", "move receipt watermark past expired messages",
        "disappearing message receipt", "Bounded unique ordinal probes", "SEQUENCES",
        "what did this member miss", "bounded unique ordinal probes", "expired ordinal holes",
        "mutation page over expiring messages", "prohibited mutation scan over expiring rows", "sequence by"] {
        assert_eq!(guide::card(phrase), guide::card("sequences"), "{phrase}");
    }
    checked(&recipe());
    assert!(guide::explain_code("E_STRUCTURAL_FANOUT").unwrap().contains("sequence by conversationId"));
}

fn refused_gap(keys: &str) -> String {
    let scan_index = if keys.contains("conversation, ordinal") { "" } else { "  by byConversationOrdinal: conversation, ordinal, id\n" };
    format!("table conversations:\n  public\n  online only\ntable messages:\n  conversation: conversations\n  other: conversations\n  ordinal: int\n  externalNumber: int\n  expiresAt: time ?\n{keys}\n{scan_index}  public\n  expire at .expiresAt\n  online only\nmutation gap(conversation: conversations):\n  return first(messages where .conversation = conversation and .ordinal > 0 first 1 by .ordinal)\n")
}

#[test]
fn helper_follows_the_scan_coordinate_regardless_of_key_order_or_other_indexes() {
    for keys in [
        "  unique aExternal: conversation, externalNumber\n  unique zOrdinal: conversation, ordinal",
        "  unique reversed: ordinal, conversation",
        "  unique aOther: other, ordinal\n  unique zOrdinal: conversation, ordinal",
        "  unique aOther: other, externalNumber\n  unique zOrdinal: conversation, ordinal",
    ] {
        let source = refused_gap(keys);
        let b = compile(&[("schema.q".into(), source.clone())]);
        let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
        assert!(d.rewrite.contains("conversation = scope, ordinal = prefix + 1"), "{keys}: {d}");
        let schema = source.split("mutation gap").next().unwrap();
        let repaired = checked(&format!("{schema}\n{}\nmutation gap(conversation: conversations):\n  return skipExpired_messages(conversation, 0, 4)\n", d.rewrite));
        let mut e = Engine::memory(repaired.schema, repaired.programs.into_iter().map(|p| p.program)).unwrap();
        for (name, ordinal, external) in [("one", 1, 100), ("four", 4, 400)] {
            e.seed_at([("messages".into(), snapback4_core::value::object([
                ("id", id(name)), ("conversation", id("chat")), ("other", id("other")),
                ("ordinal", Value::Int(ordinal)), ("externalNumber", Value::Int(external)),
                ("expiresAt", Value::Null),
            ]))], 1).unwrap();
        }
        assert_eq!(write(&mut e, "gap", &[("conversation", id("chat"))], &[], 2), Value::Int(0), "{keys}");
    }
}

#[test]
fn deny_and_read_through_scopes_require_authority_before_using_the_prefix() {
    for read in ["read <- deny", "read through .conversation"] {
        let source = refused_gap("  unique conversation, ordinal")
            .replace("  conversation: conversations\n", "  conversation: conversations\n  immutable conversation\n")
            .replace("  public\n  expire", &format!("  {read}\n  expire"))
            .replace("table conversations:\n  public", "table conversations:\n  read <- deny");
        let b = compile(&[("schema.q".into(), source.clone())]);
        let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
        assert!(d.rewrite.contains("skipExpired"), "{read}: {d}");
        assert!(d.message.contains("prefix justifies advancing a receipt only after the caller's own authority check"), "{read}: {d}");
        let schema = source.split("mutation gap").next().unwrap();
        let b = checked(&format!("{schema}\n{}\nmutation gap(conversation: conversations):\n  anchor = messages[conversation = conversation, ordinal = 3] ! else NOT_FOUND\n  return skipExpired_messages(conversation, 0, 3)\n", d.rewrite));
        let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        use snapback4_core::value::object;
        e.seed_at([("conversations".into(), object([("id", id("chat"))]))], 1).unwrap();
        for occupied in [false, true] {
            if occupied {
                e.seed_at([("messages".into(), object([
                    ("id", id("hidden")), ("conversation", id("chat")), ("other", id("chat")),
                    ("ordinal", Value::Int(3)), ("externalNumber", Value::Int(50)), ("expiresAt", Value::Null),
                ]))], 1).unwrap();
            }
            let r = e.mutate("gap", None, Context::new("alice", [("conversation".into(), id("chat"))].into()).at(2)).unwrap();
            assert!(matches!(r.state, WriteState::Failed { .. }), "{read}, occupied={occupied}: {r:?}");
        }
    }
}

#[test]
fn no_unique_key_covering_the_scan_coordinate_withholds_the_helper() {
    let b = compile(&[("schema.q".into(), refused_gap("  unique aExternal: conversation, externalNumber"))]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(!d.rewrite.contains("skipExpired"), "{d}");
}

#[test]
fn uniform_membership_rule_still_requires_the_callers_authority_check() {
    let source = refused_gap("  unique conversation, ordinal")
        .replace("table messages:", "table members:\n  conversation: conversations\n  principal: principal\n  unique conversation, principal\n  public\n  online only\ntable messages:")
        .replace("  public\n  expire", "  read <- exists members[.conversation, viewer]\n  expire");
    let b = compile(&[("schema.q".into(), source.clone())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.rewrite.contains("skipExpired"), "uniformity alone is not caller authority");
    assert!(d.message.contains("prefix justifies advancing a receipt only after the caller's own authority check"), "{d}");
    assert!(guide::card("sequences").unwrap().contains("prefix justifies advancing a receipt only after the caller's own authority check"));
    // The safe integration explicitly checks membership. No membership means
    // refusal, whether a live hidden row occupies the gap or it is absent.
    let schema = source.split("mutation gap").next().unwrap();
    let b = checked(&format!("{schema}\n{}\nmutation gap(conversation: conversations):\n  require exists members[conversation, viewer] else NOT_MEMBER\n  return skipExpired_messages(conversation, 0, 3)\n", d.rewrite));
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for occupied in [false, true] {
        if occupied {
            e.seed_at([("messages".into(), snapback4_core::value::object([
                ("id", id("hidden")), ("conversation", id("chat")), ("other", id("other")),
                ("ordinal", Value::Int(1)), ("externalNumber", Value::Int(100)), ("expiresAt", Value::Null),
            ]))], 1).unwrap();
        }
        let r = e.mutate("gap", None, Context::new("alice", [("conversation".into(), id("chat"))].into()).at(2)).unwrap();
        assert!(matches!(r.state, WriteState::Failed { .. }), "{r:?}");
    }
}

#[test]
fn expiry_page_refusal_supplies_a_pasteable_helper_for_both_allocators() {
    let source = recipe();
    let helper_start = source.find("fn skipExpired_messages").unwrap();
    let helper_end = source.find("mutation skipExpiredBefore").unwrap();
    let mut source = source[..helper_start].to_owned() + &source[helper_end..];
    source.replace_range(source.find("mutation delivered(").unwrap()..source.find("query whatDidIMiss").unwrap(), "");
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

#[test]
fn integrated_delivered_run_merge_resumes_a_repeated_receipt_in_the_builder() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../benchmarks/runs/2026-09-27-snapback4-clique-astra-0.4.4/astra/source/snapback");
    let mut docs: Vec<_> = std::fs::read_dir(root).unwrap().map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "q")).map(|path| {
        (path.file_name().unwrap().to_str().unwrap().to_owned(), std::fs::read_to_string(path).unwrap())
    }).collect();
    docs.sort_by(|a, b| a.0.cmp(&b.0));
    let card = recipe();
    let helper = card.split("fn skipExpired_messages").nth(1).unwrap().split("mutation skipExpiredBefore").next().unwrap();
    let delivered = card.split("mutation delivered").nth(1).unwrap().split("query whatDidIMiss").next().unwrap();
    let integrated = format!("fn skipExpired_messages{helper}\nmutation delivered{delivered}\n")
        .replace("conversationId", "conversation").replace("joinedAt", "joinedOrdinal");
    let (_, messaging) = docs.iter_mut().find(|(name, _)| name == "messaging.q").unwrap();
    let start = messaging.find("mutation delivered(").unwrap();
    let end = messaging.find("mutation seen(").unwrap();
    messaging.replace_range(start..end, &integrated);
    let b = compile(&docs);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    use snapback4_core::value::object;
    e.seed_at([
        ("conversations".into(), object([("id", id("chat")), ("creatorId", id("alice")), ("kind", Value::String("group".into())), ("lastOrdinal", Value::Int(1030))])),
        ("members".into(), object([("id", id("ma")), ("conversation", id("chat")), ("principal", id("alice")), ("role", Value::String("admin".into())), ("joinedOrdinal", Value::Int(0))])),
    ], 1).unwrap();
    e.seed_at([
        ("messages".into(), object([("id", id("received")), ("conversation", id("chat")), ("sender", id("bob")), ("ordinal", Value::Int(1027)), ("recipients", Value::Int(1)), ("text", Value::String("live anchor".into())), ("at", Value::Int(2))])),
        ("runs".into(), object([("id", id("disjoint")), ("conversation", id("chat")), ("principal", id("alice")), ("fromOrdinal", Value::Int(1030)), ("throughOrdinal", Value::Int(1030))])),
    ], 2).unwrap();
    let args = [("conversation", id("chat")), ("from", Value::Int(1027)), ("through", Value::Int(1027))];
    for (expected, runs) in [(1024, 2), (1027, 1), (1027, 1)] {
        write(&mut e, "messaging.delivered", &args, &[], 3);
        assert_eq!(e.store().rows("members").unwrap()[0].field("deliveredOrdinal").unwrap(), &Value::Int(expected));
        let held = e.store().rows("runs").unwrap();
        assert_eq!(held.len(), runs);
        assert!(held.iter().any(|row| row.field("id").unwrap() == &id("disjoint")));
    }
}
