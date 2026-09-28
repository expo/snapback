//! Pin physical delivery work rather than a shared host's wall-clock speed.
use snapback4_core::{RuntimeError, Value, partition::{self, LogSpan, PartitionRows}, rows::{Bounds, Dir, MemoryRows, Rows},
    schema::{Index, Table}, store::LogEvent, value::object};
use std::{cell::Cell, collections::BTreeMap};

#[derive(Default)]
struct Counted { rows: MemoryRows, source_rows: Cell<usize>, source_heads: Cell<usize>, log: Vec<LogEvent> }
impl Rows for Counted {
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.rows.get(t, id) }
    fn lookup(&self, t: &str, n: &str, i: &Index, k: &[Value]) -> Result<Option<Value>, RuntimeError> { self.rows.lookup(t, n, i, k) }
    fn scan(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let rows = self.rows.scan(t, i, p, b, d, limit)?;
        if t == "messages" { self.source_rows.set(self.source_rows.get() + rows.len()); }
        Ok(rows)
    }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], n: u64) -> Result<u64, RuntimeError> { self.rows.count_prefix(t, i, p, n) }
    fn index_head(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        if t == "messages" { self.source_heads.set(self.source_heads.get() + 1); }
        self.rows.index_head(t, i, p, b, d)
    }
    fn scan_metered(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, limit: usize, scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let rows = self.rows.scan_metered(t, i, p, b, d, limit, scope, meter)?;
        if t == "messages" { self.source_rows.set(self.source_rows.get() + rows.len()); }
        Ok(rows)
    }
    fn put(&self, n: &str, t: &Table, r: &Value, o: Option<&Value>) -> Result<u64, RuntimeError> { self.rows.put(n, t, r, o) }
    fn delete(&self, n: &str, t: &Table, o: &Value) -> Result<u64, RuntimeError> { self.rows.delete(n, t, o) }
}
impl PartitionRows for Counted {
    fn next_seq(&self) -> Result<u64, RuntimeError> { Ok(3) }
    fn append_log(&self, _: &str, _: u64, _: u32, _: &str, _: &str, _: &str, _: Option<&str>) -> Result<(), RuntimeError> { unreachable!() }
    fn membership_transitions(&self, _: &str, _: u64) -> Result<Vec<LogEvent>, RuntimeError> { Ok(vec![]) }
    fn memberships_before(&self, _: &str, _: u64) -> Result<Vec<LogEvent>, RuntimeError> { Ok(vec![]) }
    fn commit_times(&self, _: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> { Ok(BTreeMap::new()) }
    fn read_log_spans(&self, _: &[LogSpan], after: u64, only: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> {
        Ok(self.log.iter().filter(|e| e.seq > after && only.is_none_or(|seq| e.seq == seq)).take(limit).cloned().collect())
    }
}

#[test]
fn cold_snapshot_and_repeated_live_puts_walk_one_basis_per_batch() {
    let source = include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q");
    let b = snapback4_lang::compile(&[("sync.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut tx = Counted::default();
    for n in 0..50 {
        let id = format!("member-{n:03}");
        let member = object([("id", Value::Id(id.clone())), ("conversationId", Value::Id("busy".into())),
            ("principal", Value::Id(format!("principal-{n:03}"))), ("readUpTo", Value::Int(n)), ("joinedAt", Value::Int(0))]);
        tx.put("members", &b.schema.tables["members"], &member, None).unwrap();
        let view = object([("id", Value::Id(id.clone())), ("member", Value::Id(id.clone())),
            ("value", Value::Int(0)), ("recountPending", Value::Bool(n % 2 == 0))]);
        tx.put("unread", &b.schema.tables["unread"], &view, None).unwrap();
        // Five sends pending since the last sync: all events carry today's image.
        for _ in 0..5 {
            tx.log.push(LogEvent { seq: 2, ord: tx.log.len() as u32, table: "unread".into(), kind: "put".into(), id: id.clone(), data: Some(view.clone()) });
        }
    }
    for n in 1..=1002 {
        tx.put("messages", &b.schema.tables["messages"], &object([
            ("id", Value::Id(format!("m{n:04}"))), ("conversationId", Value::Id("busy".into())),
            ("ordinal", Value::Int(n)), ("senderId", Value::Id(if n == 1002 { "principal-000" } else { "sender" }.into())),
            ("until", Value::Null), ("tombstone", Value::Bool(n == 1001)),
        ]), None).unwrap();
    }
    let snapshot = partition::snapshot_page(&tx, &b.schema, "reader", None, 4000, 10).unwrap();
    assert!(snapshot.next.is_none());
    let counts: BTreeMap<_, _> = snapshot.events.iter().filter(|e| e.table == "unread")
        .map(|e| (e.id.clone(), e.data.clone().unwrap())).collect();
    assert_eq!(counts.len(), 50);
    assert!(tx.source_rows.get() <= 2004, "snapshot repeated its source basis: {}", tx.source_rows.get());
    assert!(tx.source_heads.get() <= 65, "a large range abandons its probe before walking history");
    for (n, row) in counts.values().enumerate() {
        assert_eq!(row.field("value"), Ok(&Value::Int(1000 - n as i64 + i64::from(n != 0))));
        assert_eq!(row.field("recountPending"), Ok(&Value::Bool(false)));
    }
    tx.source_rows.set(0);
    tx.source_heads.set(0);
    let stream = partition::stream(&tx, &b.schema, "reader", 1, 4000, 10).unwrap();
    assert_eq!(stream.events.len(), 250);
    assert!(!stream.more);
    assert_eq!(stream.watermark, 2);
    assert_eq!(tx.source_rows.get(), 1002, "repeated current puts must share their certification");
    assert!(tx.source_heads.get() <= 65);
    for event in stream.events { assert_eq!(event.data.as_ref(), counts.get(&event.id)); }
    // A query point read uses scalar live certification, independently of the
    // snapshot and stream batch path (including each member's self-send rule).
    let program = &b.programs.iter().find(|p| p.program.name.ends_with("unreadFor")).unwrap().program;
    tx.source_rows.set(0);
    for (id, image) in &counts {
        let context = snapback4_core::Context::new("reader", BTreeMap::from([("member".into(), Value::Id(id.clone()))])).at(10);
        let mut scalar = snapback4_core::engine::runner::Runner::new(&tx, &b.schema, context,
            snapback4_core::meter::Meter::new(snapback4_core::meter::Ceilings::unbounded(), snapback4_core::meter::Cut::Abort), 0);
        assert_eq!(&scalar.run(program).unwrap(), image.field("value").unwrap());
    }
    assert_eq!(tx.source_rows.get(), 50100, "scalar control performs fifty independent walks");
}
