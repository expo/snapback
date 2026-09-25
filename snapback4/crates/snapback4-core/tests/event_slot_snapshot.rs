//! Snapshot progress is charged for excluded kinds, independently of output.
use snapback4_core::{RuntimeError, Value, partition::{self, LogSpan, PartitionRows}, rows::{Bounds, Dir, MemoryRows, Rows}, schema::{Index, Table}, store::LogEvent, value::object};
use std::{cell::Cell, collections::{BTreeMap, BTreeSet}};

#[derive(Default)]
struct Counted { rows: MemoryRows, examined: Cell<usize>, requested: Cell<usize>, calls: Cell<usize> }
impl Rows for Counted {
    fn get(&self, t: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.rows.get(t, id) }
    fn lookup(&self, t: &str, n: &str, i: &Index, k: &[Value]) -> Result<Option<Value>, RuntimeError> { self.rows.lookup(t,n,i,k) }
    fn scan(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let rows = self.rows.scan(t,i,p,b,d,limit)?;
        if t == "feedPosts" {
            self.examined.set(self.examined.get()+rows.len()); self.requested.set(self.requested.get()+limit); self.calls.set(self.calls.get()+1);
        }
        Ok(rows)
    }
    fn count_prefix(&self, t: &str, i: &str, p: &[Value], n: u64) -> Result<u64, RuntimeError> { self.rows.count_prefix(t,i,p,n) }
    fn put(&self, n: &str, t: &Table, r: &Value, o: Option<&Value>) -> Result<u64, RuntimeError> { self.rows.put(n,t,r,o) }
    fn delete(&self, n: &str, t: &Table, o: &Value) -> Result<u64, RuntimeError> { self.rows.delete(n,t,o) }
}
impl PartitionRows for Counted {
    fn next_seq(&self) -> Result<u64, RuntimeError> { Ok(2) }
    fn append_log(&self, _: &str, _: u64, _: u32, _: &str, _: &str, _: &str, _: Option<&str>) -> Result<(), RuntimeError> { unreachable!() }
    fn membership_transitions(&self, _: &str, _: u64) -> Result<Vec<LogEvent>, RuntimeError> { Ok(vec![]) }
    fn memberships_before(&self, _: &str, _: u64) -> Result<Vec<LogEvent>, RuntimeError> { Ok(vec![]) }
    fn commit_times(&self, _: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> { Ok(BTreeMap::new()) }
    fn read_log_spans(&self, _: &[LogSpan], _: u64, _: Option<u64>, _: usize) -> Result<Vec<LogEvent>, RuntimeError> { Ok(vec![]) }
}

fn exercise(full_kind: Option<bool>) {
    let source = include_str!("../../snapback4-lang/tests/fixtures/following-view.q")
        .replacen("sync public", if full_kind == Some(false) { "sync public" } else { "sync public last 1 by .at" },1)
        .replace("sync public\n\ntable follows", if full_kind == Some(true) { "sync public\n\ntable follows" } else { "sync public last 1 by .at\n\ntable follows" });
    let bound = snapback4_lang::compile(&[("snapshot.q".into(),source)]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let tx = Counted::default(); let mut want = BTreeSet::new();
    for n in 0..4096 {
        let id = format!("event-{n:05}");
        // A long run of excluded events precedes the readable kind on the
        // horizonless byActorPost walk. Returning no rows must still advance.
        let selected = n < 3;
        let kind = if selected { full_kind.unwrap_or(false) } else { !full_kind.unwrap_or(false) };
        if full_kind == Some(kind) { want.insert(id.clone()); }
        let row = object([("id",Value::Id(id.clone())),("postId",Value::Id(id)),("actorId",Value::Id(if selected {"a"} else {"z"}.into())),
            ("authorId",Value::Id("alice".into())),("at",Value::Int(n)),("repost",Value::Bool(kind))]);
        tx.put("feedPosts",&bound.schema.tables["feedPosts"],&row,None).unwrap();
    }
    let mut cursor = None; let mut got = BTreeSet::new(); let mut total = 0; let mut empty_progress = 0;
    for _ in 0..5000 {
        tx.examined.set(0); tx.requested.set(0); tx.calls.set(0);
        let before = cursor.clone();
        let page = partition::snapshot_page(&tx,&bound.schema,"alice",cursor,7,10000).unwrap();
        assert!(tx.examined.get() <= 7,"{} examined for {} emitted rows",tx.examined.get(),page.events.len());
        assert!(tx.requested.get() <= 7,"fetch request must be bounded independently of returned rows");
        if full_kind.is_none() { assert_eq!(tx.calls.get(),0,"neither kind synced: never open the owned table"); }
        total += tx.examined.get();
        if page.events.is_empty() && tx.examined.get() > 0 { empty_progress += 1; }
        for event in page.events { if event.table == "feedPosts" { assert!(got.insert(event.id),"duplicate event"); } }
        cursor = page.next;
        if cursor.is_none() { break; }
        assert_ne!(serde_json::to_value(&cursor).unwrap(),serde_json::to_value(before).unwrap(),"empty page must advance continuation");
    }
    assert!(cursor.is_none(),"snapshot must terminate");
    assert_eq!(got,want);
    assert_eq!(total,if full_kind.is_some() {4096} else {0},"no skipped row is fetched twice");
    if full_kind.is_some() { assert!(empty_progress > 500,"exercise empty bounded pages"); }
}
#[test] fn neither_kind_opens_no_event_rows() { exercise(None); }
#[test] fn mixed_originals_bound_reads_and_keep_scanned_progress() { exercise(Some(false)); }
#[test] fn mixed_reposts_bound_reads_and_keep_scanned_progress() { exercise(Some(true)); }
