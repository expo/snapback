use super::*;

fn row(n: i64) -> snapback4_core::value::Value {
    snapback4_core::value::object([("id", snapback4_core::value::Value::Id("item".into())), ("n", snapback4_core::value::Value::Int(n)), ("photo", snapback4_core::value::Value::Null)])
}

#[test]
fn finding_5_reordered_commit_notifications_cannot_report_a_restored_head() {
    let host = Host::new(true);
    let (committed, commit) = mpsc::channel();
    let (notified, notify) = mpsc::channel();
    let first = host.shared.clone();
    let worker = thread::spawn(move || {
        let head = { let mut engine = lock(&first.engine); engine.seed([("items".into(), row(1))]).unwrap(); engine.seq().unwrap() };
        committed.send(()).unwrap();
        notify.recv_timeout(Duration::from_secs(10)).unwrap();
        // Inject the delayed first completion after the second's wake. The
        // counter is deliberately unreliable; the wire must read the store.
        *lock(&first.seq) = head;
        first.committed.notify_all();
    });
    commit.recv_timeout(Duration::from_secs(10)).unwrap();
    let head = { let mut engine = lock(&host.shared.engine); engine.seed([("items".into(), row(2))]).unwrap(); engine.seq().unwrap() };
    *lock(&host.shared.seq) = head;
    host.shared.committed.notify_all();
    notified.send(()).unwrap(); worker.join().unwrap();
    assert_eq!(*lock(&host.shared.seq), 1);
    assert_eq!(head, 2);
    let response = body(&host.request("GET", "/changes?since=2&wait=0", "x-snapback-persona: alice\r\n", ""));
    eprintln!("finding 5 reordered notifications: counter=1, committed=2, reply={response}");
    assert_eq!(response["seq"], 2);
    // A subsequent real commit remains visible through the same endpoint.
    lock(&host.shared.engine).seed([("items".into(), row(3))]).unwrap();
    let response = body(&host.request("GET", "/changes?since=2&wait=0", "x-snapback-persona: alice\r\n", ""));
    assert_eq!(response["seq"], 3); assert_eq!(response["tables"], json!(["items"]));
}

#[test]
fn finding_5_actual_head_does_not_skip_tables_beyond_the_commit_page() {
    let source = format!("{SCHEMA}\ntable audit:\n  read <- allow\n  sync public\n");
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    {
        let mut engine = lock(&host.shared.engine);
        for n in 0..500 { engine.seed([("items".into(), row(n))]).unwrap(); }
        engine.seed([("audit".into(), snapback4_core::value::object([("id", snapback4_core::value::Value::Id("last".into()))]))]).unwrap();
    }
    let page = body(&host.request("GET", "/changes?since=0&wait=0", "x-snapback-persona: alice\r\n", ""));
    assert_eq!(page["seq"], 501); assert_eq!(page["tables"], json!(["audit", "items"]));
    let last = body(&host.request("GET", "/changes?since=500&wait=0", "x-snapback-persona: alice\r\n", ""));
    assert_eq!(last["seq"], 501); assert_eq!(last["tables"], json!(["audit"]));
}

#[test]
fn sqlite_changes_reports_missing_or_unknown_evidence_as_null() {
    for corruption in [
        "DELETE FROM _change_evidence",
        "UPDATE _change_evidence SET footprint='{\"unknown\":true,\"tables\":{}}'",
    ] {
        let host = Host::new(true);
        let since = {
            let mut engine = lock(&host.shared.engine);
            let since = engine.seq().unwrap();
            engine.seed([("items".into(), row(1))]).unwrap();
            since
        };
        let path = format!("/changes?since={since}&wait=0");
        let known = body(&host.request("GET", &path, "x-snapback-persona: alice\r\n", ""));
        assert_eq!(known["preserved"], json!(["items"]));
        (match lock(&host.shared.engine).store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner, #[allow(unreachable_patterns)] _ => unreachable!("SQLite fixture") }).test_support_conn().execute_batch(corruption).unwrap();
        let unknown = body(&host.request("GET", &path, "x-snapback-persona: alice\r\n", ""));
        assert_eq!(unknown["seq"], since + 1);
        assert_eq!(unknown["tables"], json!(["items"]));
        assert_eq!(unknown.get("preserved"), Some(&serde_json::Value::Null), "{corruption}: {unknown}");
        assert!(unknown["changes"].is_null());
    }
}
