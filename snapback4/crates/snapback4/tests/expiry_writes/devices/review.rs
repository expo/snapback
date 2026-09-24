use super::*;

fn same_id<H: Host>(host: &mut H) {
    for cap in ["  cap 1", "  cap 1 by conversationId"] {
        for op in ["add", "quiet", "put", "putId"] {
            let source = constraints::source(cap);
            let deadline = snapback4_core::now_ms() + 60_000;
            let now = deadline + 1;
            let mut previous_snapshot = None;
            let mut previous_entry = None;
            // A retains the predecessor; C swept it and refilled its capacity.
            // Neither server change in C has reached the device.
            for refill in [false, true] {
                let (mut server, backend) = common::compile(&source);
                let old = constraints::row(&server, "old", 1, 1, json!(deadline));
                server.load([old]).unwrap();
                let pages = common::snapshot_pages(&mut server, "alice", 100);
                let snapshot = serde_json::to_value(&pages).unwrap();
                if let Some(previous) = previous_snapshot.replace(snapshot.clone()) { assert_eq!(snapshot, previous); }
                let name = format!("same-id-{op}-{refill}-{}", cap.len());
                let mut device = host.open(&name, Some(backend)).unwrap();
                for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
                let held = device.store().raw_rows("messages");
                assert_eq!(held.len(), 1);
                if refill {
                    assert_eq!(server.sweep_expired(now, 2_000).unwrap(), 1);
                    let fill = server.mutate("add", None, Context::new("alice", constraints::args("filler", 2, 30)).at(now)).unwrap();
                    assert!(matches!(fill.state, WriteState::Sent { .. }), "{fill:?}");
                }
                let args = json!({"messageId":"old", "ordinal":1, "at":20, "expiresAt":null});
                let mut intent = queued(op, "replace", args, now);
                intent.new_ids = vec!["old".into()];
                let entry = device.admit(intent).unwrap();
                assert!(!entry.predictable && entry.predicted.is_empty(), "{} {op} refill={refill}: {entry:?}", host.label());
                if let Some(previous) = previous_entry.replace(entry.clone()) { assert_eq!(entry, previous); }
                assert_eq!(device.store().raw_rows("messages"), held, "deferred cleanup rolls back");
                host.close(&name, device);
                device = host.open(&name, None).unwrap();
                assert_eq!(device.queued().unwrap(), vec![entry]);
                assert_eq!(device.store().raw_rows("messages"), held);
                let out = server.mutate(op, Some("replace"), Context::new("alice", constraints::args("old", 1, 20)).at(now).with_ids(["old".into()])).unwrap();
                let seq = if refill {
                    assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_CONSTRAINT"), "{out:?}");
                    None
                } else {
                    let WriteState::Sent { seq, .. } = out.state else { panic!("{out:?}") };
                    Some(seq)
                };
                device.settle("replace", seq).unwrap();
                let from = device.state().unwrap().0;
                device.apply(&common::stream_page(&mut server, "alice", from), false).unwrap();
                let rows = device.store().raw_rows("messages");
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].field("id"), Ok(&Value::Id(if refill { "filler" } else { "old" }.into())));
                assert_eq!(rows[0].field("at"), Ok(&Value::Int(if refill { 30 } else { 20 })));
                assert_eq!(rows[0].field("expiresAt"), Ok(&Value::Null));
                assert!(device.queued().unwrap().is_empty());
                host.close(&name, device);
            }
        }
    }
}

#[test]
fn same_id_expiry_replacements_queue_across_an_undelivered_sweep_and_refill() {
    same_id(&mut Sqlite::new("expiry-same-id"));
    same_id(&mut Memory::new());
}

fn delete_absence<H: Host>(host: &mut H) {
    for coverage in ["complete", "horizon", "online", "unacquired"] {
        let source = format!("{}\nmutation erase():\n  delete messages[conversationId = 'chat', ordinal = 999]\n", constraints::source("  cap 1"));
        let source = match coverage {
            "horizon" => source.replace("  sync public", "  sync public last 1 by .id"),
            "online" => source.replace("  sync public", "  online only"),
            _ => source,
        };
        let (mut server, backend) = common::compile(&source);
        let name = format!("delete-{coverage}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        if coverage != "unacquired" {
            for (i, page) in common::snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        }
        let result = device.admit(queued("erase", "missing", json!({}), snapback4_core::now_ms()));
        if coverage == "complete" {
            assert!(matches!(result, Err(snapback4_core::RuntimeError::Require { ref code, .. }) if code == "NOT_FOUND"), "{} {coverage}: {result:?}", host.label());
            assert!(device.queued().unwrap().is_empty());
        } else {
            let entry = result.unwrap();
            assert!(!entry.predictable && entry.predicted.is_empty(), "{coverage}: {entry:?}");
            assert_eq!(device.queued().unwrap(), vec![entry]);
        }
        let queued = device.queued().unwrap();
        host.close(&name, device);
        let mut device = host.open(&name, None).unwrap();
        assert_eq!(device.queued().unwrap(), queued, "{coverage}: outbox survives reopen only for unproved absence");
        assert!(device.store().raw_rows("messages").is_empty());
        host.close(&name, device);
    }
}

#[test]
fn alternate_delete_refuses_proven_absence_and_queues_unknown_absence() {
    delete_absence(&mut Sqlite::new("expiry-delete-absence"));
    delete_absence(&mut Memory::new());
}
