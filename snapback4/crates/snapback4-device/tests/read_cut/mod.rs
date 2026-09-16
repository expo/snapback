use super::*;
#[path = "../../../snapback4-sim/tests/read_cut/fixture.rs"] mod fixture;
use serde_json::json;

#[test]
fn cut_reasons_cross_both_device_wires() {
    on_both(|host| {
        let (mut engine, backend) = common::compile(fixture::SOURCE);
        engine.seed(fixture::seed(8_200, 0)).unwrap();
        let mut device = host.open("cuts", Some(backend)).unwrap();
        for (n, page) in common::snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let cut = query(&mut *device, "filtered", "dev:alice", json!({"roomId":"readable"}), 10000);
        assert_eq!(cut["complete"], false);
        assert_eq!(cut["cut"], "meter");
        assert!(rows(&cut).is_empty());
        let words = query(&mut *device, "scoped", "dev:alice", json!({"roomId":"words", "q":"cof"}), 10000);
        assert_eq!(words["cut"], "words");
        assert_eq!(words["complete"], false);
        assert!(!rows(&words).is_empty());
        for (term, size) in [("coffee", 10), ("absent", 0)] {
            let page = query(&mut *device, "scoped", "dev:alice", json!({"roomId":"readable", "q":term}), 10000);
            assert_eq!(rows(&page).len(), size);
            assert_eq!(page["complete"], true);
            assert_eq!(page.get("cut"), Some(&serde_json::Value::Null));
        }
    });
}

#[test]
fn held_query_answers_on_both_devices() {
    on_both(|host| {
        let source = fixture::SOURCE.replace("query all(q: text <=100, c: cursor ?):", "query all(q: text <=100, c: cursor ?) held:");
        let (mut engine, backend) = common::compile(&source);
        engine.seed(fixture::seed(20, 40)).unwrap();
        let mut device = host.open("held", Some(backend)).unwrap();
        for (n, page) in common::snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let page = query(&mut *device, "all", "dev:alice", json!({"q":"coffee"}), 10000);
        assert_eq!(rows(&page).len(), 10);
        assert_eq!(page["complete"], true);
        assert_eq!(page.get("cut"), Some(&serde_json::Value::Null));
    });
}
