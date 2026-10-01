//! Round-four review reproductions, including both directions of share disagreement.
// @ref LLP 3000.022#14.3 — compound builtin outcomes consume value taint.
use super::*;
fn complete_source() -> String {
    source().replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    )
}
fn composites<H: Host>(host: &mut H) {
    let mut failures = Vec::new();
    for (name, body) in [
        (
            "min-row",
            "  n = min(m, m)\n  require n.id != m.id else ACCOUNTING\n",
        ),
        (
            "max-row",
            "  n = max(m, m)\n  require n.id != m.id else ACCOUNTING\n",
        ),
        (
            "min-list",
            "  n = first(min([m], [m])) ! else MISSING\n  require n.id != m.id else ACCOUNTING\n",
        ),
        (
            "group-nested",
            "  g = group([{ saved: m }], 'saved')\n  require count(g) = 0 else ACCOUNTING\n",
        ),
        (
            "sort-nested",
            "  g = sort([{ saved: m }], 'saved')\n  require count(g) = 0 else ACCOUNTING\n",
        ),
        (
            "share-row",
            "  n = share(1, [m], m)\n  require n = 0 else ACCOUNTING\n",
        ),
        (
            "min-shape",
            "  n = min(m { *, ordinal: 1 }, m { * })\n  require n.ordinal = 2 else ACCOUNTING\n",
        ),
    ] {
        let source = complete_source()
            + "\nmutation compositeSend(conversation: conversations):\n  m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }\n"
            + body;
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
        assert!(
            bound.diagnostics.is_empty(),
            "{name}: {:?}",
            bound.diagnostics
        );
        let (mut e, b) = compile(&source);
        seed(&mut e);
        let mut d = host.open(name, Some(b)).unwrap();
        publish(&mut e, &mut d, "alice");
        assert_eq!(d.schema().operations["compositeSend"].predicts.as_deref(), Some("never"));
        let q = d.admit(request("compositeSend", json!({"conversation":"c"}), 1)).unwrap();
        if q.predictable || !q.predicted.is_empty() { failures.push(name); }
        assert_eq!(d.queued().unwrap().len(), 1);
        let remote = e.mutate(&q.op, Some(&q.id), Context::new("alice", args(&[("conversation", id("c"))])).at(q.now).with_ids(q.new_ids.clone())).unwrap();
        assert!(matches!(&remote.state, WriteState::Failed { why, .. } if why.code == "ACCOUNTING" || why.code == "E_INPUT"), "{name}: {remote:?}");
        d.settle(&q.id, None).unwrap();
        publish(&mut e, &mut d, "alice");
        assert_eq!(d.store().raw_rows("messages"), e.store().rows("messages").unwrap());
        assert!(d.queued().unwrap().is_empty());
    }
    assert!(
        failures.is_empty(),
        "composite receipt consumers escaped: {failures:?}"
    );
}
#[test]
fn review_composites_memory() {
    composites(&mut Memory::new());
}
#[test]
fn review_composites_sqlite() {
    composites(&mut Sqlite::new("composite"));
}

fn share_consumer<H: Host>(host: &mut H) {
    let mut failures = Vec::new();
    for horizon in [false, true] {
        for count in [0, 1] {
            let source = (if horizon { source() } else { complete_source() })
                + &format!(
                    r#"
mutation shareSend(conversation: conversations):
  m = insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}
  n = share(1, [m], {{ id: m.id, conversation, sender: viewer, text: 'checked', photo: null, at: now, ordinal: 1, recipients: {count} }})
  require n = 1 else ACCOUNTING
"#
                );
            let (mut e, b) = compile(&source);
            seed(&mut e);
            let name = format!("share-consumer-{horizon}-{count}");
            let mut d = host.open(&name, Some(b)).unwrap();
            publish(&mut e, &mut d, "alice");
            let mut q = request("shareSend", json!({"conversation":"c"}), 1);
            q.new_ids = vec!["new-message".into()];
            assert_eq!(d.schema().operations["shareSend"].predicts.as_deref(), Some("never"));
            let local = d.admit(q.clone());
            let remote = e
                .mutate(
                    &q.op,
                    Some(&q.id),
                    Context::new("alice", args(&[("conversation", id("c"))]))
                        .at(NOW)
                        .with_ids(q.new_ids.clone()),
                )
                .unwrap();
            eprintln!(
                "SHARE-CONSUMER {} horizon={horizon} count={count}: local={local:?}; outbox={}; remote={:?}; rows={:?}",
                host.label(),
                d.queued().unwrap().len(),
                remote.state,
                e.store().rows("messages").unwrap()
            );
            if !matches!(&local,Ok(q) if !q.predictable && q.predicted.is_empty()) {
                failures.push((horizon, count));
            }
            assert_eq!(d.queued().unwrap().len(), 1);
            match &remote.state {
                WriteState::Sent { seq, .. } => {
                    assert_eq!(count, 1);
                    d.settle(&q.id, Some(*seq)).unwrap();
                }
                WriteState::Failed { why, .. } => {
                    assert_eq!(count, 0);
                    assert_eq!(why.code, "E_INPUT");
                    d.settle(&q.id, None).unwrap();
                }
            }
            publish(&mut e, &mut d, "alice");
            assert_eq!(
                d.store().raw_rows("messages"),
                e.store().rows("messages").unwrap()
            );
            assert!(d.queued().unwrap().is_empty());
        }
    }
    assert!(
        failures.is_empty(),
        "share compared clause-owned fields without deferring {failures:?}"
    );
}
#[test]
fn review_share_consumer_memory() {
    share_consumer(&mut Memory::new());
}
#[test]
fn review_share_consumer_sqlite() {
    share_consumer(&mut Sqlite::new("share-consumer"));
}
