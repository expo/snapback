use super::{fixture, compile, snapshot_pages, Host, Memory, Sqlite};
use snapback4_core::{Value, engine::QueryOutcome};

fn fixture_on<H: Host>(mut host: H, source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
    let (mut engine, backend) = compile(source);
    engine.seed(rows).unwrap();
    let mut device = host.open("lazy-matching", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 4000).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("lazy-matching", device);
    let mut device = host.open("lazy-matching", None).unwrap();
    check(&mut |op, cursor, term| device.query(op, "dev:alice", &serde_json::json!({"q":term, "c":cursor}), 2000).unwrap());
    host.close("lazy-matching", device);
}

mod memory {
    use super::*;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
        fixture_on(Memory::new(), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/search_global/lazy.rs"); }
}

mod sqlite {
    use super::*;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut dyn FnMut(&str, Option<String>, &str) -> QueryOutcome)) {
        fixture_on(Sqlite::new("w13f"), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/search_global/lazy.rs"); }
}
