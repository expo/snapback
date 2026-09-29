"""Apply/remove measurement-only instrumentation; never changes SQLite write policy."""
import pathlib,sys
root=pathlib.Path(__file__).resolve().parents[4]
base=root/'snapback4/crates'
edits={
 base/'snapback4-core/src/store.rs': [
 ('        let page_size = conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))? as u64;', '''        // SQ measurement only: applies to CLI/server read-only connections.
        if let Ok(kib) = std::env::var("SQ_CACHE_KIB") { conn.pragma_update(None, "cache_size", -kib.parse::<i64>().unwrap())?; }
        if let Ok(bytes) = std::env::var("SQ_MMAP_BYTES") { conn.pragma_update(None, "mmap_size", bytes.parse::<i64>().unwrap())?; }
        let page_size = conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))? as u64;''')],
 base/'snapback4/src/main.rs': [('mod assets;', 'mod sq_diagnostic;\nmod assets;')],
 base/'snapback4/src/serve.rs': [
 ('                        let (outcome, cut, current) = reader.query_search_at(&op, context, retained.as_deref());', '''                        let sq = crate::sq_diagnostic::begin(reader.store(), &op);
                        let (outcome, cut, current) = reader.query_search_at(&op, context, retained.as_deref());
                        crate::sq_diagnostic::end(reader.store(), &op, sq);''')],
 base/'snapback4/src/latency.rs': [
 ('    pub fn run(mut self, handle: impl FnOnce()) {', '''    pub fn run(mut self, handle: impl FnOnce()) {
        if std::env::var_os("SQ_DIAGNOSTIC").is_some() && self.path.starts_with("/q/") {
            eprintln!("SQ_QUEUE {}", serde_json::json!({"op":self.path,"us":self.accepted.elapsed().as_micros(),"at":snapback4_core::now_ms()}));
        }''')]
}
remove='--remove' in sys.argv
for p,pairs in edits.items():
 s=p.read_text()
 for a,b in pairs:
  if remove:a,b=b,a
  if a not in s:raise RuntimeError(f'missing edit in {p}')
  s=s.replace(a,b)
 p.write_text(s)
p=base/'snapback4/src/sq_diagnostic.rs'
if remove:p.unlink()
else:p.write_text(r'''//! Temporary local measurement only. No counters are put on the wire.
use snapback4_core::Store;
use std::time::Instant;
fn counters(store: &Store) -> [i32; 3] {
    let mut out = [0; 3];
    for (i, op) in [rusqlite::ffi::SQLITE_DBSTATUS_CACHE_HIT, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_MISS, rusqlite::ffi::SQLITE_DBSTATUS_CACHE_USED].into_iter().enumerate() {
        let mut high = 0;
        assert_eq!(unsafe {rusqlite::ffi::sqlite3_db_status(store.conn().handle(),op,&mut out[i],&mut high,0)},0);
    }
    out
}
fn tid() -> u64 { #[cfg(target_os="linux")] { unsafe {libc::syscall(libc::SYS_gettid) as u64} } #[cfg(not(target_os="linux"))] {0} }
fn at() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() }
pub fn begin(store: &Store, op: &str) -> Option<(Instant,[i32;3],f64)> {
    if std::env::var_os("SQ_DIAGNOSTIC").is_none() { return None; }
    let before=counters(store); let timestamp=at();
    eprintln!("SQ_BEGIN {}",serde_json::json!({"op":op,"tid":tid(),"at":timestamp}));
    Some((Instant::now(),before,timestamp))
}
pub fn end(store: &Store,op: &str, start: Option<(Instant,[i32;3],f64)>) {
    if let Some((start,before,timestamp))=start {
        let ms=start.elapsed().as_secs_f64()*1000.; let end=at(); let after=counters(store);
        eprintln!("SQ_END {}",serde_json::json!({"op":op,"tid":tid(),"start":timestamp,"end":end,"ms":ms,"hits":after[0]-before[0],"misses":after[1]-before[1],"used":after[2]}));
    }
}
''')
