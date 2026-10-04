//! Round 6: source classification precedes all device evaluation and charging.
// @ref LLP 3000.022#14.3 — static dependencies and the allocation refusal backstop.
use super::*;

pub(super) fn classified(source: &str, name: &str, reason: &str) -> snapback4_lang::Bound {
    let b = bound(source);
    let fact = &b.schema.operations[name];
    assert_eq!(fact.predicts.as_deref(), Some("never"), "{name}: {fact:?}");
    let notes: Vec<_> = b.notes.iter().filter(|n| n.code == "N_RECEIPT_PREDICTION" && n.message.starts_with(&format!("mutation {name} predicts:"))).collect();
    assert_eq!(notes.len(), 1, "{name}: {:?}", b.notes);
    assert!(notes[0].message.contains(reason), "{}", notes[0]);
    assert!(notes[0].site.line > 0 && notes[0].site.col > 0);
    let why = snapback4_lang::bind::residency::operation_lines(name, fact);
    assert!(why.contains("predicts: never; queued without a row"), "{why}");
    assert!(why.contains(reason) && why.contains(&notes[0].site.to_string()), "{why}");
    b
}

#[test]
fn first_reason_location_assertions_and_transitive_helpers() {
    for (body, reason, line) in [
        ("require m.recipients > 0 else COUNT\n  require m.ordinal > 0 else POSITION", "messages.recipients", 3),
        ("require m != null else MISSING", "whole receipt row messages", 3),
        ("return m", "whole receipt row messages", 3),
        ("return [m]", "whole receipt row messages", 3),
        ("return min(m, m)", "whole receipt row messages", 3),
        ("require true or m.ordinal = 9 else UNUSED", "messages.ordinal", 3),
        ("require receipt(m) != null else RECEIPT", "receipt", 3),
        ("return helper(m)", "messages.recipients", 0),
        ("return whole(m).id", "helper returns whole receipt row messages", 0),
        ("return blockWhole(m).id", "helper returns whole receipt row messages", 0),
    ] {
        let src = source() + "\nfn inner(m: messages): m.recipients\nfn helper(m: messages): inner(m)\nfn whole(m: messages): m\nfn blockWhole(m: messages):\n  return m\n" + &format!("\nmutation staticSend(conversation: conversations):\n  m = insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}\n  {body}\n");
        let b = classified(&src, "staticSend", reason);
        let note = b.notes.iter().find(|n| n.code == "N_RECEIPT_PREDICTION" && n.message.starts_with("mutation staticSend ")).unwrap();
        if line != 0 {
            let declaration = src.lines().position(|s| s.starts_with("mutation staticSend")).unwrap() as u32;
            assert_eq!(note.site.line, declaration + line, "{body}: {note}");
        }
        let asserted = src.replace("mutation staticSend(conversation: conversations):", "mutation staticSend(conversation: conversations) predicts:");
        let refused = snapback4_lang::compile(&[("schema.q".into(), asserted)]);
        let errors: Vec<_> = refused.diagnostics.iter().filter(|d| d.code == "E_NOT_PREDICTABLE").collect();
        assert_eq!(errors.len(), 1, "{:?}", refused.diagnostics);
        assert!(errors[0].message.contains(reason), "{}", errors[0]);
    }
}

#[test]
fn clean_fields_and_helpers_stay_eligible() {
    let src = source() + r#"
fn clean(m: messages): m.text
mutation cleanSend(conversation: conversations) predicts:
  m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }
  require clean(m) = 'checked' else TEXT
  return m.id
"#;
    let b = bound(&src);
    for name in ["send", "add", "createConversation", "cleanSend"] {
        assert_eq!(b.schema.operations[name].predicts.as_deref(), Some("eligible"), "{name}");
        assert!(!b.notes.iter().any(|n| n.code == "N_RECEIPT_PREDICTION" && n.message.starts_with(&format!("mutation {name} "))));
    }
}

fn heap_boundary<H: Host>(host: &mut H) {
    let array = std::iter::repeat_n("m.recipients", 10).collect::<Vec<_>>().join(", ");
    let src = source() + &format!("\nmutation heapSend(conversation: conversations):\n  m = insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}\n  for i in range(0, 8000):\n    xs = [{array}]\n  require m.recipients > 0 else COUNT\n");
    classified(&src, "heapSend", "messages.recipients");
    let (mut e, b) = compile(&src);
    seed(&mut e);
    let mut d = host.open("heap-r6", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = deferred(&mut d, request("heapSend", json!({"conversation":"c"}), 1));
    assert!(d.store().raw_rows("messages").is_empty());
    host.close("heap-r6", d);
    let mut d = host.open("heap-r6", None).unwrap();
    assert_eq!(d.queued().unwrap()[0].id, q.id);
    let outcome = e.mutate(&q.op, Some(&q.id), Context::new("alice", args(&[("conversation", id("c"))])).at(q.now).with_ids(q.new_ids.clone())).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
    eprintln!("ASTRA-HEAP {}: {:?}", host.label(), outcome);
    d.settle(&q.id, Some(seq(&outcome.state))).unwrap();
    publish(&mut e, &mut d, "alice");
    assert_eq!(d.store().raw_rows("messages"), e.store().rows("messages").unwrap());
    assert_eq!(int(&e.store().rows("messages").unwrap()[0], "recipients"), 1);
    assert!(d.queued().unwrap().is_empty());
}
both!(heap_boundary_memory, heap_boundary_sqlite, heap_boundary);

fn allocator_resource_backstop<H: Host>(host: &mut H) {
    let array = std::iter::repeat_n("m.text", 10).collect::<Vec<_>>().join(", ");
    let src = source() + &format!("\nmutation largeSend(conversation: conversations):\n  m = insert messages {{ conversation, sender: viewer, text: '{}', photo: null, at: now }}\n  for i in range(0, 8000):\n    xs = [{array}]\n  return m.id\n", "x".repeat(1000));
    let (mut e, b) = compile(&src);
    assert_eq!(b.schema.operations["largeSend"].predicts.as_deref(), Some("eligible"));
    seed(&mut e);
    let mut d = host.open("allocator-bound", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d.admit(request("largeSend", json!({"conversation":"c"}), 1)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty(), "{q:?}");
    host.close("allocator-bound", d);
    let mut d = host.open("allocator-bound", None).unwrap();
    assert_eq!(d.queued().unwrap()[0].id, q.id);
    let result = e.mutate(&q.op, Some(&q.id), Context::new("alice", args(&[("conversation", id("c"))])).at(q.now).with_ids(q.new_ids)).unwrap();
    assert!(matches!(result.state, WriteState::Failed { .. }), "{result:?}");
    assert!(format!("{result:?}").contains("E_BOUND"), "{result:?}");
    d.settle(&q.id, None).unwrap();
    assert!(d.queued().unwrap().is_empty());
    assert!(e.store().rows("messages").unwrap().is_empty());
}
both!(allocator_bound_memory, allocator_bound_sqlite, allocator_resource_backstop);
