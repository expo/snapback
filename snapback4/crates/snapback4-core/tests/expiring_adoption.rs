//! Lane Q review regressions: legacy cap validation and preallocated page bounds.
use snapback4_core::{Ceilings, Schema, Store, Value, schema::IndexComponent, value::object};
use std::cell::Cell;
use snapback4_core::rows::Rows;

struct Allocator;
thread_local! {
    static LIVE: Cell<Option<i64>> = const { Cell::new(None) };
    static PEAK: Cell<i64> = const { Cell::new(0) };
}
fn allocation(delta: i64) {
    let _ = LIVE.try_with(|live| if let Some(n) = live.get() {
        live.set(Some(n + delta));
        PEAK.with(|peak| peak.set(peak.get().max(n + delta)));
    });
}
unsafe impl std::alloc::GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let ptr = unsafe { std::alloc::System.alloc(layout) };
        if !ptr.is_null() { allocation(layout.size() as i64); }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        allocation(-(layout.size() as i64));
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        let next = unsafe { std::alloc::System.realloc(ptr, layout, size) };
        if !next.is_null() { allocation(size as i64 - layout.size() as i64); }
        next
    }
}
#[global_allocator] static ALLOCATOR: Allocator = Allocator;

fn schemas(cap: &str) -> (Schema, Schema) {
    let source = format!("table receipts:\n  principal: principal\n  expiresAt: time ?\n  payload: text <=65536\n  expire at .expiresAt\n{cap}  read <- .principal = viewer\nview counts: count receipts by .principal\n");
    schemas_from(source)
}

fn schemas_from(source: String) -> (Schema, Schema) {
    let compiled = snapback4_lang::compile(&[("adoption.q".into(), source)]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let modern = compiled.schema;
    let mut legacy = modern.clone();
    for table in legacy.tables.values_mut() {
        for index in table.indexes.values_mut() {
            if matches!(index.components.first(), Some(IndexComponent::Contribution(_))) {
                index.components.truncate(1);
            }
        }
    }
    (legacy, modern)
}

#[test]
fn sixty_three_views_adopt_within_the_examination_and_step_page_budgets() {
    for comparisons in [0, 20] {
        let mut source = "table receipts:\n  principal: principal\n  expiresAt: time ?\n  payload: text <=65536\n  expire at .expiresAt\n  read <- .principal = viewer\n".to_owned();
        let filter = if comparisons == 0 { String::new() } else {
            format!(" where {}", vec![".payload = ''"; comparisons].join(" and "))
        };
        for n in 0..63 { source.push_str(&format!("view c{n}: count receipts{filter} by .principal\n")); }
        let (legacy, modern) = schemas_from(source);
        let mut store = Store::memory().unwrap();
        store.install(&legacy).unwrap();
        seed(&mut store, &legacy, 256, 0);
        store.install(&modern).unwrap_or_else(|error| panic!("comparisons={comparisons}: {error:?}"));
        let tx = store.transaction().unwrap();
        for maintain in &modern.maintains {
            assert_eq!(tx.count_prefix("receipts", &maintain.contribution_index(), &[], 300).unwrap(), 256);
        }
        tx.rollback().unwrap();
        let adopted = stored_digest(&store);
        store.install(&modern).unwrap();
        assert_eq!(stored_digest(&store), adopted);
        println!("ADOPTION views=63 rows=256 comparisons={comparisons} indexes=63 reopen=stable");
    }
}

fn seed(store: &mut Store, schema: &Schema, count: usize, payload: usize) {
    let tx = store.transaction().unwrap();
    for n in 0..count {
        let row = object([
            ("id", Value::Id(format!("r{n:04}"))), ("principal", Value::Id("alice".into())),
            ("expiresAt", Value::Int((n as i64 + 1) * 1000)),
            ("payload", Value::String("x".repeat(payload))),
        ]);
        tx.put("receipts", &schema.tables["receipts"], &row, None).unwrap();
    }
    tx.commit().unwrap();
}

#[test]
fn legacy_expiry_cap_uses_a_plain_index() {
    let (legacy, modern) = schemas("  cap 1 by expiresAt\n");
    let mut store = Store::memory().unwrap();
    store.install(&legacy).unwrap();
    seed(&mut store, &legacy, 2, 0);
    store.install(&modern).unwrap();
    assert_eq!(store.rows("receipts").unwrap().len(), 2);
    let tx = store.transaction().unwrap();
    for expiry in [1000, 2000] {
        assert_eq!(tx.cap_count("receipts", &["expiresAt".into()], &[Value::Int(expiry)]).unwrap(), 1);
    }
    tx.rollback().unwrap();
}

#[test]
fn fitting_large_rows_adopt_without_retrying_the_same_oversized_page() {
    // The 1280 KiB case still needs a smaller page after fixing the stacked
    // decoder charge; five 512 KiB images alone no longer exercise that cut.
    for (count, bytes) in [(1, 1_000_000), (1, 1 << 20), (5, 512 << 10), (5, 1280 << 10)] {
        let (mut legacy, mut modern) = schemas("");
        for schema in [&mut legacy, &mut modern] {
            schema.tables.get_mut("receipts").unwrap().columns.insert("payload".into(),
                snapback4_core::schema::ColumnType::Text { max: 2 << 20 });
        }
        let mut store = Store::memory().unwrap();
        store.install(&legacy).unwrap();
        seed(&mut store, &legacy, count, bytes);
        PEAK.with(|p| p.set(0));
        LIVE.with(|live| live.set(Some(0)));
        let result = store.install(&modern);
        LIVE.with(|live| live.set(None));
        let peak = PEAK.with(Cell::get) as u64;
        assert!(result.is_ok(), "rows={count} payload={bytes}: {result:?}");
        assert!(peak <= Ceilings::job().heap_bytes, "peak Rust allocation {peak} exceeds the job heap");
        assert_eq!(store.rows("receipts").unwrap().len(), count);
        let before = stored_digest(&store);
        store.install(&modern).unwrap();
        assert_eq!(stored_digest(&store), before, "successful adoption does not retry");
        println!("ADOPTION rows={count} payload={bytes} peak_rust_bytes={peak} ceiling={}", Ceilings::job().heap_bytes);
    }
}

#[test]
fn large_legacy_pages_stay_inside_the_job_heap() {
    let (legacy, modern) = schemas("");
    let mut store = Store::memory().unwrap();
    store.install(&legacy).unwrap();
    seed(&mut store, &legacy, 600, 65_536);
    PEAK.with(|p| p.set(0));
    LIVE.with(|live| live.set(Some(0)));
    let result = store.install(&modern);
    LIVE.with(|live| live.set(None));
    let peak = PEAK.with(Cell::get) as u64;
    assert!(result.is_ok(), "{result:?}");
    println!("ADOPTION rows=600 payload=65536 peak_rust_bytes={peak} ceiling={}", Ceilings::job().heap_bytes);
    assert!(peak <= Ceilings::job().heap_bytes, "peak Rust allocation {peak} exceeds the job heap");
    assert_eq!(store.rows("receipts").unwrap().len(), 600);
}

fn stored_digest(store: &Store) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    for query in ["SELECT key,value FROM _meta ORDER BY key", "SELECT name,num FROM _catalog ORDER BY name",
        "SELECT t,id,data FROM r ORDER BY t,id", "SELECT ti,k,id FROM i ORDER BY ti,k",
        "SELECT t,k,n FROM _cap_counts ORDER BY t,k"] {
        let mut statement = store.conn().prepare(query).unwrap();
        let columns = statement.column_count();
        let mut rows = statement.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            for column in 0..columns {
                match row.get_ref(column).unwrap() {
                    rusqlite::types::ValueRef::Integer(n) => digest.update(n.to_le_bytes()),
                    rusqlite::types::ValueRef::Text(bytes) | rusqlite::types::ValueRef::Blob(bytes) => digest.update(bytes),
                    other => panic!("unexpected stored field {other:?}"),
                }
                digest.update([0]);
            }
        }
    }
    digest.finalize().to_vec()
}

#[test]
fn a_row_that_cannot_fit_refuses_after_prior_pages_without_publishing() {
    let (mut legacy, mut modern) = schemas("");
    for schema in [&mut legacy, &mut modern] {
        schema.tables.get_mut("receipts").unwrap().columns.insert("payload".into(),
            snapback4_core::schema::ColumnType::Text { max: 2 << 20 });
    }
    let mut store = Store::memory().unwrap();
    store.install(&legacy).unwrap();
    seed(&mut store, &legacy, 300, 65_536);
    let tx = store.transaction().unwrap();
    tx.put("receipts", &legacy.tables["receipts"], &object([
        ("id", Value::Id("z-last".into())), ("principal", Value::Id("alice".into())),
        ("expiresAt", Value::Null), ("payload", Value::String("x".repeat(2 << 20))),
    ]), None).unwrap();
    tx.commit().unwrap();
    let before = stored_digest(&store);
    PEAK.with(|p| p.set(0));
    LIVE.with(|live| live.set(Some(0)));
    let error = store.install(&modern).unwrap_err();
    LIVE.with(|live| live.set(None));
    let peak = PEAK.with(Cell::get) as u64;
    assert!(matches!(error, snapback4_core::error::RuntimeError::Bound {
        kind: snapback4_core::error::MeterKind::HeapBytes, ceiling: 16_777_216, ..
    }), "{error:?}");
    assert!(peak <= Ceilings::job().heap_bytes, "refusal must precede oversized allocation: {peak}");
    assert_eq!(stored_digest(&store), before, "rows, indexes, caps, catalog and metadata roll back together");
    println!("ADOPTION_REFUSAL prior_rows=300 peak_rust_bytes={peak} ceiling={}", Ceilings::job().heap_bytes);
}
