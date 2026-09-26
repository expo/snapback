mod common;
use common::*;
use serde_json::json;
use snapback4_device::device::Queued;

fn scenario<H: Host>(host: &mut H) {
    let (_, backend) = compile(include_str!(
        "../../snapback4-core/tests/ephemeral/schema.q"
    ));
    let mut device = host.open("ephemeral", Some(backend)).unwrap();
    let answer = device
        .query("typingIn", "alice", &json!({"roomId":"r"}), 1000)
        .unwrap();
    assert!(
        !answer.complete,
        "a device must report unknown without a sync declaration"
    );
    for replay in [false, true] {
        let entry = Queued {
            id: "signal".into(),
            seq: 1,
            op: "setTyping".into(),
            args: json!({"roomId":"r","payload":""}),
            viewer: "alice".into(),
            now: 1000,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
        };
        let refused = device.admit_with_replay(entry, replay).unwrap_err();
        assert_eq!(refused.code(), "E_QUARRY_EPHEMERAL");
        assert!(device.queued().unwrap().is_empty());
    }
}
#[test]
fn sqlite_guard_and_unknown_read() {
    scenario(&mut Sqlite::new("ephemeral"));
}
#[test]
fn memory_guard_and_unknown_read() {
    scenario(&mut Memory::new());
}
