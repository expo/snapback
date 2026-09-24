use super::*;
#[path = "../../../snapback4-device/tests/common/mod.rs"]
mod common;
use common::{Host, Memory, Sqlite};

fn agree<H: Host>(host: &mut H) {
    let source = constraints::source("  cap 1 by conversationId");
    let (mut server, backend) = common::compile(&source);
    let deadline = snapback4_core::now_ms() + 60_000;
    let old = constraints::row(&server, "old", 1, 1, json!(deadline));
    server.load([old]).unwrap();
    let mut device = host.open("expiry", Some(backend)).unwrap();
    for (i, page) in common::snapshot_pages(&mut server, "alice", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("expiry", device);
    let mut device = host.open("expiry", None).unwrap();
    let now = deadline + 1;
    for (ordinal, succeeds) in [(2, false), (1, false)] {
        let args = json!({"messageId":"new", "ordinal":ordinal, "at":20, "expiresAt":null});
        let prediction = device.predict("add", "alice", &args, now, vec![], 1);
        let outcome = server.mutate("add", None, Context::new("alice", constraints::args("new", ordinal, 20)).at(now)).unwrap();
        assert_eq!(prediction.is_ok(), succeeds, "{}: {prediction:?}", host.label());
        assert_eq!(matches!(outcome.state, WriteState::Sent { .. }), succeeds, "{outcome:?}");
        if !succeeds {
            assert_eq!(prediction.unwrap_err().code(), "E_CONSTRAINT");

        }
    }
    let from = device.state().unwrap().0;
    assert_eq!(server.sweep_expired(now, 2_000).unwrap(), 1);
    let page = common::stream_page(&mut server, "alice", from);
    device.apply(&page, false).unwrap();
    let args = json!({"messageId":"new", "ordinal":1, "at":20, "expiresAt":null});
    let predicted = device.predict("add", "alice", &args, now, vec![], 1).unwrap();
    let outcome = server.mutate("add", None, Context::new("alice", constraints::args("new", 1, 20)).at(now)).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }));
    device.withdraw(&predicted.predicted).unwrap();
    assert_eq!(device.query("message", "alice", &json!({"conversationId":"chat","ordinal":1}), now).unwrap().data, Value::Null);
    host.close("expiry", device);
}

#[test]
fn server_and_both_devices_agree_on_expired_caps_and_unique_reuse_after_reopen() {
    agree(&mut Sqlite::new("expiry"));
    agree(&mut Memory::new());
}

fn large<H: Host>(host: &mut H, backlog: usize) {
    let (mut server, backend) = common::compile(SOURCE);
    let deadline = snapback4_core::now_ms() + 60_000;
    let mut rows = vec![("conversations".into(), wire::row_from_json(&server.schema().tables["conversations"],
        &json!({"id":"chat","lastOrdinal":9000})).unwrap())];
    rows.extend((0..9_000).map(|n| constraints::row(&server, &format!("live{n:05}"), n + 1, 0, json!(null))));
    rows.extend((0..backlog).map(|n| constraints::row(&server, &format!("expired{n:05}"), -(n as i64) - 1, 0, json!(deadline))));
    server.load(rows).unwrap();
    let name = format!("large-{backlog}");
    let mut device = host.open(&name, Some(backend)).unwrap();
    for (i, page) in common::snapshot_pages(&mut server, "alice", 1_000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let now = deadline + 1;
    let args = json!({"messageId":"next","conversationId":"chat"});
    let predicted = device.predict("sendMessage", "alice", &args, now, vec![], 1).unwrap();
    let out = server.mutate("sendMessage", None, Context::new("alice", BTreeMap::from([
        ("messageId".into(), Value::Id("next".into())), ("conversationId".into(), Value::Id("chat".into()))])).at(now)).unwrap();
    let WriteState::Sent { result, .. } = out.state else { panic!("{out:?}") };
    assert_eq!(wire::to_json(&result), predicted.result);
    assert_eq!(out.metered.examined, 1);
    host.close(&name, device);
}

#[test]
fn devices_accept_keyed_writes_at_nine_thousand_live_rows_with_both_backlogs() {
    for backlog in [0, 3_000] {
        large(&mut Sqlite::new("expiry-large"), backlog);
        large(&mut Memory::new(), backlog);
    }
}
