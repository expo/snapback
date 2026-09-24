//! The count-retention experiment: cal15's recipient-heavy rows and large bodies.
//! @ref LLP 3000.011.001.000#5 — a count optimization must remove actual allocations.
use snapback4_core::{Context, Engine, Value, wire};
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{Bounds, Dir};
use std::{alloc::{GlobalAlloc, Layout, System}, cell::Cell, collections::BTreeMap, time::Instant};
use serde_json::json;

struct Allocator;
thread_local! { static ALLOCATED: Cell<Option<usize>> = const { Cell::new(None) }; }
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED.with(|n| if let Some(bytes) = n.get() { n.set(Some(bytes + layout.size())); });
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) { unsafe { System.dealloc(ptr, layout) } }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATED.with(|n| if let Some(bytes) = n.get() { n.set(Some(bytes + size)); });
        unsafe { System.realloc(ptr, layout, size) }
    }
}
#[global_allocator] static ALLOCATOR: Allocator = Allocator;
fn measured<T>(f: impl FnOnce() -> T) -> (T, usize, u128) {
    let start = Instant::now();
    ALLOCATED.with(|n| n.set(Some(0)));
    let result = f();
    let bytes = ALLOCATED.with(|n| n.replace(None).unwrap());
    (result, bytes, start.elapsed().as_micros())
}

// The original cal15 count expression and message columns, stripped of unrelated
// application operations. Rows are readable; the exact period also has 100 own messages.
const SOURCE: &str = include_str!("digest_count.q");

#[test]
fn dropping_count_results_does_not_remove_sqlite_decode_allocations() {
    for (quiet, rows, body, recipients) in [(0, 1000, 6, 2), (0, 1000, 2000, 2), (0, 10_000, 6, 2), (0, 10_000, 2000, 2),
        (999, 0, 6, 2), (999, 10_000, 2000, 2), (0, 1000, 31, 50), (0, 5000, 31, 50), (0, 10_000, 31, 50), (999, 10_000, 31, 50)] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.set_ceilings(Ceilings::job());
        let chat = if recipients == 50 { "chat0" } else { "chat" };
        let principal = if recipients == 50 { "a".repeat(31) } else { "alice".into() };
        let mut seed = vec![("conversations".into(), wire::row_from_json(engine.schema().table("conversations").unwrap(), &json!({"id":chat,"title":"chat"})).unwrap())];
        seed.extend((0..quiet).map(|n| ("conversations".into(), wire::row_from_json(engine.schema().table("conversations").unwrap(), &json!({"id":format!("aquiet{n:04}"),"title":"quiet"})).unwrap())));
        seed.extend((0..rows).map(|n| {
            let mut row = json!({"id":format!("m{n:05}"),"conversationId":chat,"senderId":"bob","body":"x".repeat(body),
                "photo":null,"oncePhoto":null,"expiresAt":null,"video":null,"edited":false,"tombstone":false,
                "replyTo":null,"recipients":["alice","bob"],"at":15_000});
            if recipients == 50 {
                // Read-only measurement of the actual sixth cal15 chat: 12-byte
                // IDs, 5-byte chat, 31-byte sender/recipient IDs, 50 recipients,
                // ~31-byte body, and omitted nullable media columns in storage.
                row["id"] = json!(format!("m{n:011}"));
                // The original period selects 5,000 candidates, including 100
                // own messages: 4,900 qualify. The 10k cases remain stress cases.
                row["senderId"] = json!(if rows == 5000 && n % 50 == 0 { principal.clone() } else { "b".repeat(31) });
                row["recipients"] = json!((0..50).map(|i| match i { 0 => principal.clone(), 1 => "b".repeat(31), _ => format!("recipient{i:022}") }).collect::<Vec<_>>());
                for field in ["photo", "oncePhoto", "video"] { row.as_object_mut().unwrap().remove(field); }
            }
            ("messages".into(), wire::row_from_json(engine.schema().table("messages").unwrap(), &row).unwrap())
        }));
        if recipients == 50 { engine.load(seed).unwrap(); } else { engine.seed_at(seed, 1000).unwrap(); }
        let mut args: BTreeMap<_, _> = [("conversationId".into(), Value::Id(chat.into())), ("principal".into(), Value::Id(principal.clone())),
            ("periodStart".into(), Value::Int(10_000)), ("periodEnd".into(), Value::Int(20_000)), ("readAt".into(), Value::Int(0))].into();
        let op = if quiet == 0 { "countPeriod" } else { args.remove("conversationId"); "countAll" };
        let (control, allocated, elapsed) = measured(|| engine.query(op, Context::new(&principal, args).at(20_000)).unwrap());
        println!("count control quiet={quiet} rows={rows} body={body} recipients={recipients} heap={} examined={} steps={} writes={} rust_allocated={allocated} us={elapsed} complete={} state={:?}",
            control.metered.heap_bytes, control.metered.examined, control.metered.steps, control.metered.rows_written, control.complete, control.data);
        if (rows == 10_000 && body == 2000) || (rows >= 5000 && recipients == 50) {
            assert_eq!(control.data, Value::Null);
            assert!(!control.complete);
            assert!(control.metered.heap_bytes > Ceilings::job().heap_bytes);
        } else {
            assert_eq!(control.data, Value::Int(rows as i64), "{control:?}");
            assert!(control.complete, "{control:?}");
        }

        let tx = engine.store_mut().read_transaction().unwrap();
        for batch in [32, rows + 1] {
            // Deliberately an allocation experiment, NOT an alternative interpreter:
            // all candidates must be decoded, including the exact period's own
            // messages. Other read semantics cannot make those decodes cheaper.
            let ((count, eligible, decoded_heap), allocated, elapsed) = measured(|| {
                let mut bounds = Bounds { gte: Some(Value::Int(10_000)), lt: Some(Value::Int(20_000)), ..Bounds::default() };
                let mut count = 0;
                let mut eligible = 0;
                let mut heap = 0;
                loop {
                    let fetched = tx.scan("messages", "byConversation", &[Value::Id(chat.into())], &bounds, Dir::Asc, batch).unwrap();
                    let n = fetched.len();
                    for (row, key) in fetched {
                        heap += row.heap_bytes();
                        count += 1;
                        eligible += usize::from(row.field("senderId").unwrap().as_str().unwrap() != principal);
                        bounds.after = Some(snapback4_core::key::decode(&key).unwrap().into_iter().skip(1).collect());
                    }
                    if n < batch { break; }
                }
                (count, eligible, heap)
            });
            assert_eq!(count, rows);
            assert_eq!(eligible, if rows == 5000 && recipients == 50 { 4900 } else { rows });
            if (rows == 10_000 && body == 2000) || (rows >= 5000 && recipients == 50) {
                assert!(decoded_heap > Ceilings::job().heap_bytes);
                assert!(allocated as u64 > Ceilings::job().heap_bytes);
            }
            println!("count decode-only quiet={quiet} rows={rows} eligible={eligible} body={body} recipients={recipients} batch={batch} decoded_heap={decoded_heap} rust_allocated={allocated} us={elapsed}");
        }
        tx.rollback().unwrap();
    }
}
