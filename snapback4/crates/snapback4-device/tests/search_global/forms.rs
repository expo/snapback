use super::{fixture, compile, snapshot_pages, Host, Memory, Sqlite};
use snapback4_core::{Value, engine::QueryOutcome};

fn fixture_on<H: Host>(mut host: H, source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
    let (mut engine, backend) = compile(source);
    engine.seed(rows).unwrap();
    let mut device = host.open("search-forms", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("search-forms", device);
    let mut device = host.open("search-forms", None).unwrap();
    println!("W13e store={}", host.label());
    check(&mut |op, cursor, term| {
        let page = device.query(op, "dev:alice", &serde_json::json!({"q":term, "c":cursor}), 2000).unwrap();
        if page.complete {
            let server = engine.query(op, snapback4_core::Context::new("dev:alice", [
                ("q".into(),Value::String(term.into())),
                ("c".into(),cursor.map(Value::String).unwrap_or(Value::Null)),
            ].into()).at(2000)).unwrap();
            assert!(server.complete);
            assert_eq!(page.data,server.data,"{op}: device/server data");
            assert_eq!(page.next,server.next,"{op}: device/server cursor");
        }
        if source.contains("last 10 by .at") { assert!(!page.complete, "a horizon cannot claim full history"); }
        page
    });
    host.close("search-forms", device);
}

mod memory {
    use super::*;
    const COMPACT_MEMBERSHIPS: bool = false;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
        fixture_on(Memory::new(), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/search_global/forms.rs"); }
}

mod sqlite {
    use super::*;
    const COMPACT_MEMBERSHIPS: bool = false;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
        fixture_on(Sqlite::new("w13e"), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/search_global/forms.rs"); }
}
