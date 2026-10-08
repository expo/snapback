//! The metered tokenizer keeps the index tokenizer's complete contract.
use crate as snapback4_core;
use crate::{cursor, engine, meter, rows, schema, value, words};
use super as accounting;

#[test]
fn metered_tokenization_matches_index_tokens_across_columns_and_unicode() {
    let long = "𐐨".repeat(100);
    let many = (0..600).map(|n| format!("w{n} ")).collect::<String>();
    for fields in [vec!["Coffee coffee, CAROL", "coffers car"], vec!["cafe\u{301} CAFÉ İ ﬃ", "ᾂ Å Å"],
        vec![long.as_str(), "𐐀"], vec!["w0 w1 w2", many.as_str()], vec!["", "  _! "]] {
        let mut meter = meter::Meter::new(Default::default(), meter::Cut::Cap);
        let actual = accounting::tokenize(&mut meter, fields.iter().copied()).unwrap();
        assert_eq!(actual, words::row_tokens(fields));
        assert!(meter.capped_at.is_none());
    }
}

#[test]
fn a_tokenizer_allocation_is_refused_before_fold_or_token_growth() {
    let mut meter = meter::Meter::new(meter::Ceilings { heap_bytes: 1, ..Default::default() }, meter::Cut::Cap);
    assert!(accounting::tokenize(&mut meter, ["coffee"]).is_err());
    assert_eq!(meter.used.heap_bytes, 8, "the minimum folded allocation is charged first");
    let mut meter = meter::Meter::new(Default::default(), meter::Cut::Cap);
    assert_eq!(accounting::tokenize(&mut meter, ["coffee"]).unwrap(), ["coffee"]);
}

struct CountingAllocator;
thread_local! { static ALLOCATED: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) }; }
unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        ALLOCATED.with(|n| if let Some(total) = n.get() { n.set(Some(total + layout.size())); });
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) { unsafe { std::alloc::System.dealloc(ptr, layout) } }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        ALLOCATED.with(|n| if let Some(total) = n.get() { n.set(Some(total + size)); });
        unsafe { std::alloc::System.realloc(ptr, layout, size) }
    }
}
#[global_allocator] static ALLOCATOR: CountingAllocator = CountingAllocator;
pub(crate) fn measured<T>(f: impl FnOnce() -> T) -> (T, u64) {
    ALLOCATED.with(|n| n.set(Some(0)));
    let value = f();
    let bytes = ALLOCATED.with(|n| n.replace(None).unwrap());
    (value, bytes as u64)
}

// Keep test-only decoder custody visible to the source census as well as the
// enclosing external module's cfg gate.
#[cfg(test)]
#[test]
fn stored_row_bound_covers_decoder_growth_and_btree_splits() {
    use value::{Value, object, canonical_json};
    for fields in [0, 1, 4, 11, 12, 31, 32, 33, 100, 1000] {
        let row = object((0..fields).map(|n| (format!("f{n}"), Value::String("long \\ \" café 𐐨".repeat(n % 31)))));
        let json = canonical_json(&row);
        let (decoded, actual) = measured(|| serde_json::from_str::<Value>(&json).unwrap());
        assert_eq!(decoded, row);
        assert!(actual <= stored_price(&json), "fields={fields} actual={actual} bound={}", stored_price(&json));
    }
    for depth in [1, 8, 16] {
        let mut row = Value::Array((0..33).map(|n| Value::String("x".repeat(n))).collect());
        for _ in 0..depth { row = object([("nested", row)]); }
        let json = canonical_json(&row);
        let (_, actual) = measured(|| serde_json::from_str::<Value>(&json).unwrap());
        assert!(actual <= stored_price(&json), "depth={depth} actual={actual}");
    }
}

#[cfg(test)]
fn declared_private_decode_reservation_covers_utf8_and_escaping() {
    use snapback4_core::{Engine, Value, wire};
    configure_sqlite_probe();
    for (label, text) in [("empty", String::new()), ("ascii", "x".repeat(1_000_000)),
        ("escaped", "\n".repeat(1_000_000)), ("utf8", "𐐨".repeat(1_000_000))] {
        let b = snapback4_lang::compile(&[("schema.q".into(), "table records:\n  owner: principal\n  secret: text <=1000000 default '' written by .owner\n  extra: int ?\n  public\n  sync public\n".into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let schema: schema::Schema = serde_json::from_value(serde_json::to_value(&b.schema).unwrap()).unwrap();
        let reservation = rows::disclosed::decode_reservation(&schema.tables["records"]);
        let mut e = Engine::memory(schema, vec![]).unwrap();
        let row = wire::row_from_json(&e.schema().tables["records"], &serde_json::json!({"id":"row","owner":"bob","secret":text})).unwrap();
        e.seed([("records".into(), row)]).unwrap();
        let tx = e.store_mut().read_transaction().unwrap();
        let json_bytes = value::canonical_json(&tx.get("records", "row").unwrap().unwrap()).len();
        let (found, rust, native, _) = measured_sqlite(json_bytes, || tx.scan("records", "byId", &[Value::Id("row".into())], &rows::Bounds::default(), rows::Dir::Asc, 1).unwrap());
        assert_eq!(found.len(), 1);
        assert!(rust + native as u64 <= reservation, "{label}: rust={rust}, native={native}, reservation={reservation}");
        eprintln!("private decoder {label}: rust={rust}, native={native}, reservation={reservation}");
    }
}

#[test]
fn dedup_node_and_split_measurements_fit_the_preinsert_bound() {
    let mut tree = std::collections::BTreeSet::<String>::new();
    let mut maximum = 0;
    for n in 0..4096 {
        let id = format!("{n:08}");
        let (_, bytes) = measured(|| tree.insert(id));
        maximum = maximum.max(bytes);
        assert!(bytes <= accounting::insertion::<String, ()>(n), "insert {n}: {bytes}");
    }
    println!("W14A BTreeSet<String> inserts=4096 maximum_insert_allocation={maximum} bound_at_4095={}", accounting::insertion::<String, ()>(4095));
}

#[test]
fn exact_growth_and_query_token_cap_are_charged_before_growth() {
    let mut meter = meter::Meter::new(Default::default(), meter::Cut::Cap);
    let mut values = Vec::<value::Value>::new();
    for n in 0..33 {
        let before = meter.used.heap_bytes;
        let capacity = values.capacity();
        accounting::push(&mut meter, &mut values, value::Value::Int(n)).unwrap();
        assert_eq!(meter.used.heap_bytes - before, if n as usize == capacity { accounting::slots::<value::Value>((capacity * 2).max(1)) } else { 0 });
    }
    assert_eq!(values.capacity(), 64);
    let input = (0..512).map(|n| format!("w{n} ")).collect::<String>();
    let mut meter = meter::Meter::new(Default::default(), meter::Cut::Cap);
    let terms = accounting::tokenize_limit(&mut meter, [input.as_str()], words::MAX_TERMS).unwrap();
    assert_eq!(terms, words::terms(&input)); assert_eq!(terms.len(), 8);
    assert_eq!(meter.used.heap_bytes, accounting::text(&input) + 8 * 8 + accounting::slots::<String>(1 + 2 + 4 + 8));
    let mut meter = meter::Meter::new(meter::Ceilings { heap_bytes: 1, ..Default::default() }, meter::Cut::Cap);
    let (_, allocated) = measured(|| assert!(physical(&mut meter, |meter,_| {
        let mut guard = accounting::StoreGuard::open(meter, "test", u64::MAX);
        accounting::scan_entry(meter, &mut guard, 0, 0, "null", b"long-key")
    }).is_err()));
    assert_eq!(allocated, 0, "the failing allowance precedes key/vector allocation");
}

#[test]
fn cursor_decode_and_canonical_reencode_fit_the_preparse_allowance() {
    use cursor::{CursorColumn, CursorPosition, decode_cursor, encode_cursor};
    use schema::{ColumnType, Schema};
    use value::Value;
    for bytes in [1, 64, 1024] {
        let position = CursorPosition { table: "messages".into(), index: "byWords".into(), order: snapback4_core::ir::Order::Desc,
            suffix: vec![CursorColumn { name: "id".into(), kind: ColumnType::Id }], values: vec![Value::Id("x".repeat(bytes))], inclusive: false, scope: None };
        let token = encode_cursor(&Schema::default(), &position).unwrap();
        let (decoded, allocated) = measured(|| decode_cursor(&Schema::default(), &token).unwrap());
        assert_eq!(decoded.values, position.values);
        assert!(allocated <= accounting::cursor_decode(&token), "token bytes={} actual={allocated}", token.len());
    }
}

#[path = "../../../tests/common/meter.rs"]
mod fixture;
#[path = "../../../tests/word_heap/cal18_projection.rs"]
mod cal18_projection;

const PREFLIGHT: &str = "SELECT octet_length(r.data), length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT ?5";
const SQL: &str = "SELECT r.data, i.k FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT ?5";

type SqliteMalloc = unsafe extern "C" fn(i32) -> *mut std::ffi::c_void;
type SqliteRealloc = unsafe extern "C" fn(*mut std::ffi::c_void, i32) -> *mut std::ffi::c_void;
type SqliteFree = unsafe extern "C" fn(*mut std::ffi::c_void);
static SQLITE_ALLOCATORS: std::sync::OnceLock<(SqliteMalloc, SqliteRealloc, SqliteFree)> = std::sync::OnceLock::new();
const SQLITE_HEADER: usize = std::mem::size_of::<usize>();
thread_local! { static SQLITE_ALLOCATED: std::cell::Cell<Option<(usize, usize, usize, usize)>> = const { std::cell::Cell::new(None) }; }
#[derive(Clone, Copy, Default)]
struct SqliteLive { allocated: usize, freed: usize, live: isize, peak: usize }
thread_local! { static SQLITE_LIVE: std::cell::Cell<Option<SqliteLive>> = const { std::cell::Cell::new(None) }; }

fn record_sqlite_live(allocated: usize, freed: usize) {
    SQLITE_LIVE.with(|n| if let Some(mut counts) = n.get() {
        counts.allocated += allocated;
        counts.freed += freed;
        counts.live += allocated as isize;
        // Conservatively include both buffers at a successful realloc.
        counts.peak = counts.peak.max(counts.live.max(0) as usize);
        counts.live -= freed as isize;
        n.set(Some(counts));
    });
}

fn record_sqlite_alloc(bytes: i32) {
    SQLITE_ALLOCATED.with(|n| if let Some((total, payload, min, max)) = n.get() {
        let bytes = bytes as usize;
        n.set(Some((total + bytes + SQLITE_HEADER, payload + usize::from((min..=max).contains(&bytes)) * bytes, min, max)));
    });
}

unsafe extern "C" fn sqlite_malloc(bytes: i32) -> *mut std::ffi::c_void {
    record_sqlite_alloc(bytes);
    unsafe {
        let base = (SQLITE_ALLOCATORS.get().unwrap().0)(bytes + SQLITE_HEADER as i32).cast::<usize>();
        if base.is_null() { return base.cast(); }
        base.write(bytes as usize);
        record_sqlite_live(bytes as usize + SQLITE_HEADER, 0);
        base.add(1).cast()
    }
}

unsafe extern "C" fn sqlite_realloc(ptr: *mut std::ffi::c_void, bytes: i32) -> *mut std::ffi::c_void {
    record_sqlite_alloc(bytes);
    unsafe {
        let old = if ptr.is_null() { 0 } else { ptr.cast::<usize>().sub(1).read() + SQLITE_HEADER };
        let base = if ptr.is_null() { ptr } else { ptr.cast::<usize>().sub(1).cast() };
        let base = (SQLITE_ALLOCATORS.get().unwrap().1)(base, bytes + SQLITE_HEADER as i32).cast::<usize>();
        if base.is_null() { return base.cast(); }
        base.write(bytes as usize);
        record_sqlite_live(bytes as usize + SQLITE_HEADER, old);
        base.add(1).cast()
    }
}

unsafe extern "C" fn sqlite_free(ptr: *mut std::ffi::c_void) {
    if !ptr.is_null() { unsafe {
        let base = ptr.cast::<usize>().sub(1);
        record_sqlite_live(0, base.read() + SQLITE_HEADER);
        (SQLITE_ALLOCATORS.get().unwrap().2)(base.cast());
    } }
}

unsafe extern "C" fn sqlite_size(ptr: *mut std::ffi::c_void) -> i32 {
    unsafe { ptr.cast::<usize>().sub(1).read() as i32 }
}

fn configure_sqlite_probe() {
    // Only these probes use SQLite in this test binary. Install before its
    // first initialization. Forward to the bundled native allocator with a size
    // header: report requested capacity, not platform malloc_size slack, so every
    // eight-byte resident growth exercises MemGrow. Count the header bytes too.
    static CONFIGURE: std::sync::Once = std::sync::Once::new();
    CONFIGURE.call_once(|| unsafe {
        use rusqlite::ffi::*;
        let mut methods: sqlite3_mem_methods = std::mem::zeroed();
        assert_eq!(sqlite3_config(SQLITE_CONFIG_GETMALLOC, &mut methods), SQLITE_OK);
        SQLITE_ALLOCATORS.set((methods.xMalloc.unwrap(), methods.xRealloc.unwrap(), methods.xFree.unwrap())).unwrap();
        methods.xMalloc = Some(sqlite_malloc); methods.xRealloc = Some(sqlite_realloc);
        methods.xFree = Some(sqlite_free); methods.xSize = Some(sqlite_size);
        assert_eq!(sqlite3_config(SQLITE_CONFIG_MALLOC, &methods), SQLITE_OK);
        // Make small column copies visible instead of using the shared pool.
        assert_eq!(sqlite3_config(SQLITE_CONFIG_LOOKASIDE, 0, 0), SQLITE_OK);
    });
}

fn measured_sqlite<T>(json_bytes: usize, f: impl FnOnce() -> T) -> (T, u64, usize, usize) {
    measured_sqlite_range(json_bytes, json_bytes, f)
}

fn measured_sqlite_range<T>(min_json: usize, max_json: usize, f: impl FnOnce() -> T) -> (T, u64, usize, usize) {
    // SQLite's native allocator rounds the column's len+2 to eight bytes.
    SQLITE_ALLOCATED.with(|n| n.set(Some((0, 0, (min_json + 2 + 7) & !7, (max_json + 2 + 7) & !7))));
    let (value, rust) = measured(f);
    let (native, payload, _, _) = SQLITE_ALLOCATED.with(|n| n.replace(None).unwrap());
    (value, rust, native, payload)
}

fn sqlite_empty_scan_statement_storage_is_pinned_and_transient() {
    use rows::{Bounds, Dir, Rows};
    use rusqlite::StatementStatus::Run;
    configure_sqlite_probe();
    let mut engine = fixture::engine(vec![], 0);
    let tx = engine.store_mut().read_transaction().unwrap();
    let page_size = tx.conn().query_row("PRAGMA page_size", [], |r| r.get::<_, i64>(0)).unwrap() as u64;
    let prefix = [value::Value::Int(0)];
    let bounds = Bounds::default();
    assert!(rows::scan_range(&prefix, &bounds, Dir::Asc).is_some(), "valid empty range, not a short circuit");
    let scan = |meter: &mut meter::Meter| physical(meter, |meter, scope| Rows::scan_metered(&tx, "messages", "byBucket", &prefix, &bounds, Dir::Asc, 1, scope, meter));
    assert!(scan(&mut meter::Meter::new(Default::default(), meter::Cut::Cap)).unwrap().is_empty());
    let names = range_price(&prefix, &bounds) + accounting::allocation("messages.byBucket".len());
    assert_eq!(names, 105);
    // @ref LLP 3000.007#20.24.1 — execution storage is measured and pinned, outside the payload ledger.
    const PIN: usize = 2_048; // Retain the original two-statement envelope; only the preflight now executes.
    for scans in [1, 1_000] {
        let initial_runs = [PREFLIGHT, SQL].map(|sql| tx.conn().prepare_cached(sql).unwrap().get_status(Run));
        let mut meter = meter::Meter::new(Default::default(), meter::Cut::Cap);
        SQLITE_LIVE.with(|n| n.set(Some(SqliteLive::default())));
        let (maximum, _, native, _) = measured_sqlite(0, || {
            let mut maximum = 0;
            for n in 0..scans {
                let before = SQLITE_LIVE.with(|n| n.get().unwrap().allocated);
                assert!(scan(&mut meter).unwrap().is_empty());
                let counts = SQLITE_LIVE.with(|n| n.get().unwrap());
                let native_per_execution = counts.allocated - before;
                assert!(native_per_execution <= PIN, "scan {n}: {native_per_execution} native bytes > {PIN}");
                assert_eq!(counts.live, 0, "statement reset releases all measured storage after scan {n}");
                maximum = maximum.max(native_per_execution);
                // @ref LLP 3000.007#20.24.3 — the column scratch is the store guard's, every scan; the public charge is logical.
                assert_eq!(meter.used.heap_bytes, (n + 1) as u64 * names);
                assert_eq!(meter.scratch, (n + 1) as u64 * 2 * page_size);
            }
            maximum
        });
        let counts = SQLITE_LIVE.with(|n| n.replace(None).unwrap());
        assert_eq!(counts.allocated, native);
        assert_eq!(counts.freed, native);
        assert!(counts.peak <= PIN * 2, "peak live {} > {}", counts.peak, PIN * 2);
        for ((sql, expected), initial) in [(PREFLIGHT, scans), (SQL, 0)].into_iter().zip(initial_runs) {
            assert_eq!(tx.conn().prepare_cached(sql).unwrap().get_status(Run) - initial, expected);
        }
        assert!(meter.capped_at.is_none());
        println!("W14A empty scans={scans} statements={} native_allocated={native} native_per_scan={} maximum_per_scan={maximum} pin={PIN} peak_live={} native_freed={} end_live={} charged={}",
            scans, native / scans as usize, counts.peak, counts.freed, counts.live, meter.used.heap_bytes);
    }
}

fn sqlite_increasing_resident_preflight_charges_before_the_next_row() {
    use rows::{Bounds, Dir, Rows};
    use rusqlite::StatementStatus::Run;
    use value::{Value, object};
    configure_sqlite_probe();
    let mut engine = fixture::engine(vec![], 0);
    let seed: Vec<_> = (0..22).map(|n| ("messages".into(), object([("id", Value::Id(format!("m{n:05}"))),
        ("bucket", Value::Int(0)), ("body", Value::String("x".repeat(650 + 8 * n)))]))).collect();
    let jsons: Vec<_> = seed.iter().map(|(_, row)| value::canonical_json(row)).collect();
    let keys: Vec<_> = seed.iter().enumerate().map(|(n, (_, row))| rows::index_key(&fixture::schema().tables["messages"].indexes["byBucket"], row, &format!("m{n:05}"))).collect();
    let (min_json, max_json) = (jsons[0].len(), jsons[21].len());
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().read_transaction().unwrap();
    let page_size = tx.conn().query_row("PRAGMA page_size", [], |r| r.get::<_, i64>(0)).unwrap() as u64;
    assert_eq!((min_json, max_json, page_size), (720, 888, 4096));
    tx.conn().prepare_cached(PREFLIGHT).unwrap();
    tx.conn().prepare_cached(SQL).unwrap();
    let prefix = [Value::Int(0)];
    let bounds = Bounds::default();
    let scan = |meter: &mut meter::Meter| physical(meter, |meter, scope| Rows::scan_metered(&tx, "messages", "byBucket", &prefix, &bounds, Dir::Asc, 22, scope, meter));
    // @ref LLP 3000.007#20.24.3 — the public charge is each entry's logical image; physical copies are guarded.
    // The preflight stops at the first entry whose four-bytes-per-JSON-byte floor
    // cannot fit, and the payload statement fetches no entry past it.
    let opened = range_price(&prefix, &bounds) + accounting::allocation("messages.byBucket".len());
    let floor = |n: usize| 4 * accounting::allocation(jsons[n].len()) + accounting::allocation(keys[n].len());
    let stop = (1..=22).find(|&n| opened + (0..n).map(floor).sum::<u64>() > 9_000).unwrap();
    assert!(stop < 22);
    let runs = tx.conn().prepare_cached(SQL).unwrap().get_status(Run);
    let mut low = meter::Meter::new(meter::Ceilings { heap_bytes: 9_000, ..Default::default() }, meter::Cut::Cap);
    let (result, rust, native, payload) = measured_sqlite_range(min_json, max_json, || scan(&mut low));
    assert!(matches!(result, Err(crate::error::RuntimeError::Bound { kind: crate::error::MeterKind::HeapBytes, .. })));
    println!("W14A increasing rows=22 limit=22 ceiling=9000 page_size={page_size} rust_allocated={rust} native_allocated={native} payload_allocated={payload} attempted={} guarded={}", low.used.heap_bytes, low.scratch);
    assert_eq!(tx.conn().prepare_cached(SQL).unwrap().get_status(Run), runs + 1);
    let fetched = (0..stop).map(|n| (jsons[n].len() + 2 + 7) & !7).sum::<usize>();
    assert!(payload <= 2 * fetched, "only the preflight and payload copies of entries up to the cut: {payload} > 2 x {fetched}");
    assert!(rust + native as u64 <= low.used.heap_bytes + low.scratch, "public charge plus guard covers every allocation");
    let mut ample = meter::Meter::new(Default::default(), meter::Cut::Cap);
    let (rows, rust, native, _) = measured_sqlite_range(min_json, max_json, || scan(&mut ample).unwrap());
    assert_eq!(rows.len(), 22);
    for (n, (row, _)) in rows.iter().enumerate() {
        assert_eq!(row.field("id").unwrap().as_str().unwrap(), format!("m{n:05}"));
        assert_eq!(row.field("body").unwrap().as_str().unwrap().len(), 650 + 8 * n);
    }
    assert!(rust + native as u64 <= ample.used.heap_bytes + ample.scratch);
    println!("W14A increasing positive_rows=22 rust_allocated={rust} native_allocated={native} charged={} guarded={}", ample.used.heap_bytes, ample.scratch);
}

fn sqlite_resident_payload_is_prepaid_before_preflight() {
    sqlite_payload_probe("resident", 650);
}

fn sqlite_overflow_payload_is_prepaid_before_preflight() {
    sqlite_payload_probe("overflow", 4000);
}

fn sqlite_scratch_uses_the_open_connections_actual_page_size() {
    use rows::{Bounds, Dir, Rows};
    configure_sqlite_probe();
    let dir = std::env::temp_dir().join(format!("snapback4-word-scratch-{}-{}", std::process::id(), snapback4_core::ids::mint(snapback4_core::now_ms(), &mut 0).unwrap()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA page_size=8192; VACUUM;").unwrap();
    drop(conn);
    let mut store = snapback4_core::Store::open(&path).unwrap();
    store.install(&fixture::schema()).unwrap();
    let reader = store.reader().unwrap();
    let read_only = snapback4_core::Store::open_read_only(&path).unwrap();
    for mut store in [store, reader, read_only] {
        let tx = store.read_transaction().unwrap();
        assert_eq!(tx.conn().query_row("PRAGMA page_size", [], |r| r.get::<_, i64>(0)).unwrap(), 8192);
        let scan = |meter: &mut meter::Meter| physical(meter, |meter, scope| Rows::scan_metered(&tx, "messages", "byBucket", &[value::Value::Int(0)], &Bounds::default(), Dir::Asc, 1, scope, meter));
        // @ref LLP 3000.007#20.24.3 — an 8 KiB page's 16 KiB column scratch is guarded, never public.
        let mut low = meter::Meter::new(meter::Ceilings { heap_bytes: 10_000, ..Default::default() }, meter::Cut::Cap);
        assert!(scan(&mut low).unwrap().is_empty());
        assert_eq!(low.scratch, 16_384);
        assert_eq!(low.used.heap_bytes, range_price(&[value::Value::Int(0)], &Bounds::default()) + accounting::allocation("messages.byBucket".len()));
        assert!(scan(&mut low).unwrap().is_empty());
        assert_eq!(low.scratch, 2 * 16_384, "each scan reserves its own guard");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

fn sqlite_payload_probe(storage: &str, body_bytes: usize) {
    use rows::{Bounds, Dir, Rows};
    use rusqlite::StatementStatus::{Run, MemUsed};
    // Prepare without running: isolate register growth from the shared VM image.
    // The Rust allocator probe cannot see SQLite's C malloc; wrap that too,
    // since reset can release scratch before MemUsed observes the statement.
    configure_sqlite_probe();
    let mut engine = fixture::engine(vec![], 0);
    let row = value::object([("id", value::Value::Id("m00000".into())), ("bucket", value::Value::Int(0)), ("body", value::Value::String("x".repeat(body_bytes)))]);
    let json_bytes = value::canonical_json(&row).len();
    engine.seed(vec![("messages".into(), row)]).unwrap();
    let tx = engine.store_mut().read_transaction().unwrap();
    let page_size = tx.conn().query_row("PRAGMA page_size", [], |r| r.get::<_, i64>(0)).unwrap() as u64;
    let initial_runs = tx.conn().prepare_cached(SQL).unwrap().get_status(Run);
    let initial_preflight_runs = tx.conn().prepare_cached(PREFLIGHT).unwrap().get_status(Run);
    let initial_memory = tx.conn().prepare_cached(PREFLIGHT).unwrap().get_status(MemUsed);
    let scan = |meter: &mut meter::Meter| physical(meter, |meter, scope| Rows::scan_metered(&tx, "messages", "byBucket", &[value::Value::Int(0)], &Bounds::default(), Dir::Asc, 1, scope, meter));
    // @ref LLP 3000.007#20.24.3 — the column scratch and preflight copy are guarded; the public meter
    // refuses on the entry's logical image, after the one-entry payload fetch that prices it.
    let mut low = meter::Meter::new(meter::Ceilings { heap_bytes: 500, ..Default::default() }, meter::Cut::Cap);
    let (result, rust_bytes, native_allocated, payload_allocated) = measured_sqlite(json_bytes, || scan(&mut low));
    assert!(matches!(result, Err(crate::error::RuntimeError::Bound { kind: crate::error::MeterKind::HeapBytes, .. })));
    let preflight_runs = tx.conn().prepare_cached(PREFLIGHT).unwrap().get_status(Run) - initial_preflight_runs;
    let native_bytes = tx.conn().prepare_cached(PREFLIGHT).unwrap().get_status(MemUsed) - initial_memory;
    println!("W14A {storage} json_bytes={json_bytes} page_size={page_size} ceiling=500 rust_allocated={rust_bytes} native_allocated={native_allocated} payload_allocated={payload_allocated} native_retained={native_bytes} preflight_runs={preflight_runs} charged={} guarded={}", low.used.heap_bytes, low.scratch);
    assert_eq!(preflight_runs, 1);
    assert!(native_bytes as u64 <= 2 * page_size);
    assert_eq!(tx.conn().prepare_cached(SQL).unwrap().get_status(Run), initial_runs + 1, "the payload fetch stops at the refused entry");
    assert!(rust_bytes + native_allocated as u64 <= low.used.heap_bytes + low.scratch, "public charge plus guard covers every allocation");
    assert!(payload_allocated <= 2 * ((json_bytes + 2 + 7) & !7));
    // Inspect the actual cached preflight, not a separately copied SQL spelling.
    // A normal Column (P5=0), even inside length(CAST(...)), loads the payload.
    let preflight = unsafe {
        let db = tx.conn().handle();
        let mut statement = rusqlite::ffi::sqlite3_next_stmt(db, std::ptr::null_mut());
        let mut found = None;
        while !statement.is_null() {
            let sql = std::ffi::CStr::from_ptr(rusqlite::ffi::sqlite3_sql(statement)).to_str().unwrap();
            if sql.starts_with("SELECT octet_length(r.data)") { found = Some(sql.to_owned()); }
            statement = rusqlite::ffi::sqlite3_next_stmt(db, statement);
        }
        found.expect("the metered scan ran its size preflight")
    };
    let conn = tx.conn();
    let root: i64 = conn.query_row("SELECT rootpage FROM sqlite_schema WHERE name = 'r'", [], |r| r.get(0)).unwrap();
    let mut explain = conn.prepare(&format!("EXPLAIN {preflight}")).unwrap();
    let ops = explain.query_map(rusqlite::params![0, 0, Vec::<u8>::new(), vec![255u8], 1], |r| {
        Ok((r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(6)?))
    }).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
    let data_cursor = ops.iter().find(|(op, _, p2, _)| op == "OpenRead" && *p2 == root).unwrap().1;
    let flags: Vec<_> = ops.iter().filter(|(op, p1, p2, _)| op == "Column" && *p1 == data_cursor && *p2 == 2).map(|op| op.3).collect();
    println!("SQLite {} preflight data Column P5={flags:?}", rusqlite::version());
    assert_eq!(flags, [0xc0], "octet_length's OPFLAG_BYTELENARG must keep oversized JSON unloaded before its allowance");
    assert!(ops.iter().any(|(op, p1, p2, p5)| op == "Column" && *p1 != data_cursor && *p2 == 1 && *p5 == 0x40), "length(i.k) keeps OPFLAG_LENGTHARG on the BLOB key");
    let mut ample = meter::Meter::new(Default::default(), meter::Cut::Cap);
    let (rows, rust_bytes, first_native, first_payload) = measured_sqlite(json_bytes, || scan(&mut ample).unwrap());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0.field("body").unwrap().as_str().unwrap().len(), body_bytes);
    assert!(rust_bytes <= ample.used.heap_bytes);
    assert!(rust_bytes + first_native as u64 <= ample.used.heap_bytes + ample.scratch);
    assert_eq!(tx.conn().prepare_cached(SQL).unwrap().get_status(Run), initial_runs + 2);
    let (first, first_guard) = (ample.used.heap_bytes, ample.scratch);
    let (_, next_rust, next_native, next_payload) = measured_sqlite(json_bytes, || scan(&mut ample).unwrap());
    assert_eq!(ample.used.heap_bytes - first, first, "every fetch pays the same logical charge");
    assert_eq!(ample.scratch - first_guard, first_guard, "every fetch reserves its own guard");
    assert_eq!(next_payload, first_payload, "reset frees the register buffers; the next fetch allocates afresh");
    assert!(next_rust + next_native as u64 <= ample.used.heap_bytes - first + first_guard);
    assert!(rust_bytes + next_rust + (first_native + next_native) as u64 <= ample.used.heap_bytes + ample.scratch);
    let mut next_read = meter::Meter::new(Default::default(), meter::Cut::Cap);
    let (_, read_rust, read_native, read_payload) = measured_sqlite(json_bytes, || scan(&mut next_read).unwrap());
    assert_eq!(next_read.used.heap_bytes, first, "a warm cached statement does not waive the next read's allowance");
    assert_eq!(read_payload, first_payload);
    assert!(read_rust + read_native as u64 <= next_read.used.heap_bytes + next_read.scratch);
    println!("W14A {storage} positive_rows=1 rust_allocated={rust_bytes} first_native={first_native} next_fetch_native={next_native} next_read_native={read_native} cumulative_fetch_native={} first_charge={first} next_fetch_charge={} next_read_charge={}", first_native + next_native, ample.used.heap_bytes - first, next_read.used.heap_bytes);
}

fn physical<T>(meter: &mut meter::Meter, work: impl FnOnce(&mut engine::InternalMeter<'_>,&engine::Authorization) -> T) -> T {
    meter::InternalLedger::with_meter(meter, work)
}
fn stored_price(json: &str) -> u64 {
    let mut meter = meter::Meter::new(meter::Ceilings::unbounded(), meter::Cut::Abort);
    physical(&mut meter, |meter,scope| accounting::stored_row(json,scope).charge(meter,scope)).unwrap();
    meter.used.heap_bytes
}
fn range_price(prefix: &[value::Value], bounds: &rows::Bounds) -> u64 {
    let mut meter = meter::Meter::new(meter::Ceilings::unbounded(), meter::Cut::Abort);
    physical(&mut meter, |meter,scope| accounting::range(prefix,bounds,scope).charge(meter,scope)).unwrap();
    meter.used.heap_bytes
}

// These allocation probes need private ledger access and must configure SQLite
// before any other test initializes it. Run them together in a fresh process.
#[test]
fn sqlite_allocation_probes() {
    const CHILD: &str = "SNAPBACK4_SQLITE_ALLOCATION_PROBES";
    if std::env::var_os(CHILD).is_none() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "rows::word_heap::tests::sqlite_allocation_probes", "--nocapture"])
            .env(CHILD, "1").status().unwrap();
        assert!(status.success(), "isolated SQLite allocation probes: {status}");
        return;
    }
    declared_private_decode_reservation_covers_utf8_and_escaping();
    sqlite_empty_scan_statement_storage_is_pinned_and_transient();
    sqlite_increasing_resident_preflight_charges_before_the_next_row();
    sqlite_resident_payload_is_prepaid_before_preflight();
    sqlite_overflow_payload_is_prepaid_before_preflight();
    sqlite_scratch_uses_the_open_connections_actual_page_size();
}
