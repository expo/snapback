#[path = "row_view_disclosure/cases.rs"] mod cases;
#[path = "row_view_disclosure/mod.rs"] mod disclosure;
use disclosure::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Value};

fn large_member(bytes: usize) -> Pair {
    let mut source = cases::SOURCE.replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  note: text <=20000000 default ''")
        .replace("  expire at .until\n", "")
        + "\nquery ordinary(member: members):\n  row = members[member]\n  return row.readUpTo\nquery repeated(member: members):\n";
    for i in 0..20 { source += &format!("  n{i} = unread[member]\n"); }
    source += "  return n19\n";
    let mut member = cases::member("a", "alice", 0);
    member.1["note"] = json!("x".repeat(bytes));
    Pair::new(source, [vec![member.clone()], vec![member]], "alice", Operation::new("mark", json!({"member":"a","readUpTo":1}), "alice"))
}
#[test]
fn count_member_decode_obeys_the_same_heap_bound_as_an_ordinary_read() {
    let mut pair = large_member(17 << 20);
    for file in [false, true] {
        pair.file_store = file;
        let mut e = pair.engine(0);
        for query in ["ordinary", "unreadFor"] {
            let r = e.query(query, Context::new("alice", inputs(&e, query, &json!({"member":"a"}))).at(NOW)).unwrap();
            assert!(!r.complete, "{query}: {r:?}");
            assert_eq!(r.data, Value::Null, "{query}: {r:?}");
            assert_eq!(r.cut, Some(snapback4_core::engine::ReadCut::Meter), "{query}: {r:?}");
            assert!(matches!(r.capped_at, Some((snapback4_core::error::MeterKind::HeapBytes, _))), "{query}: {r:?}");
        }
    }
}
#[test]
fn repeated_count_reads_release_transient_members() {
    let mut pair = large_member(1 << 20);
    for file in [false, true] {
        pair.file_store = file;
        let mut e = pair.engine(0);
        let r = e.query("repeated", Context::new("alice", inputs(&e, "repeated", &json!({"member":"a"}))).at(NOW)).unwrap();
        assert!(r.complete, "{r:?}");
        assert_eq!(r.data, Value::Int(0));
        assert!(r.metered.heap_bytes < 1 << 20, "{r:?}");
    }
}

#[path = "row_view_disclosure/scalars.rs"] mod scalars;
#[test]
fn generated_scalar_comparisons_count_insertions_and_forward_reverse_marks() {
    assert_eq!(scalars::visit(|name, mut pair, marks, expected| {
        for file in [false, true] {
            pair.file_store = file;
            let mut e = pair.engine(0);
            for (mark, expected) in marks.iter().zip(&expected) {
                let args = json!({"member":"scalar-member","readUpTo":mark});
                let result = e.mutate("mark", None, Context::new("alice", inputs(&e, "mark", &args)).at(NOW)).unwrap();
                assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{name}: {result:?}");
                let r = e.query("unreadFor", Context::new("alice", inputs(&e, "unreadFor", &json!({"member":"scalar-member"}))).at(NOW)).unwrap();
                assert!(r.complete, "{name}: {r:?}");
                assert_eq!(r.data, Value::Int(*expected), "{name} mark={mark}");
            }
        }
    }), 24);
}

#[test]
fn pending_and_completed_expiry_corrections_have_identical_public_meters() {
    // These are formerly live inputs, not born-expired rows (which retire on
    // insert). Observe only after expiry; completeness remains a named residual.
    for (population, examined, incomplete) in [(30, 48, true), (1200, 8192, false), (10000, 8192, true)] {
        for excluded in ["counted", "tombstone", "own-send"] {
            let mut results = Vec::new();
            for n in [0, population] {
                let mut seed = vec![cases::member("a", "alice", 0), cases::message("live", 100, false)];
                // Include a common future head to check steps and next-expiry too.
                seed[1].1["until"] = json!(NOW + 100);
                for i in 0..n {
                    let mut row = cases::message(&format!("expired{i:05}"), 5, excluded == "tombstone");
                    row.1["until"] = json!(NOW + 1);
                    if excluded == "own-send" { row.1["senderId"] = json!("alice"); }
                    seed.push(row);
                }
                let source = cases::SOURCE.to_owned() + "\nmutation useCount(member: members):\n  return unread[member]\n";
                let mut pair = Pair::new(source, [seed.clone(), seed], "alice", Operation::new("mark", json!({"member":"a","readUpTo":1}), "alice"));
                for file in [false, true] {
                    pair.file_store = file;
                    pair.examined = Some(examined);
                    let mut e = pair.engine(0);
                    let r = e.query("unreadFor", Context::new("alice", inputs(&e, "unreadFor", &json!({"member":"a"}))).at(NOW + 2)).unwrap();
                    assert_eq!(r.complete, n == 0 || !incomplete, "{excluded}/{n}: {r:?}");
                    assert_eq!(r.data, Value::Int(if n == 0 || !incomplete { 1 } else { 0 }));
                    assert_eq!(r.next_expiry, Some(NOW + 100));
                    results.push(r.metered);
                    let marked = e.mutate("mark", None, Context::new("alice", inputs(&e, "mark", &json!({"member":"a","readUpTo":100}))).at(NOW + 2)).unwrap();
                    assert!(matches!(marked.state, snapback4_core::WriteState::Sent { .. }), "{marked:?}");
                    let mut chunks = 0;
                    while e.run_view_chunk(NOW + 2).unwrap().is_some() { chunks += 1; assert!(chunks < 1000); }
                    let after = e.query("unreadFor", Context::new("alice", inputs(&e, "unreadFor", &json!({"member":"a"}))).at(NOW + 2)).unwrap();
                    assert_eq!(after.data, Value::Int(0), "expired inputs cannot reappear after recount: {after:?}");
                    let writer = e.mutate("useCount", None, Context::new("alice", inputs(&e, "useCount", &json!({"member":"a"}))).at(NOW + 2)).unwrap();
                    // The deferred expiry residual permits refusal under the smaller
                    // writer allowance; neither outcome may publish an expired count.
                    match writer.state {
                        snapback4_core::WriteState::Sent { result, .. } => assert_eq!(result, Value::Int(0)),
                        snapback4_core::WriteState::Failed { why, .. } => assert_eq!(why.code, "E_VIEW_KEY"),
                    }
                    eprintln!("formerly-live/{excluded}/{n}/file-{file}: chunks={chunks}, read-complete={}", after.complete);
                }
            }
            assert!(results.windows(2).all(|p| p[0] == p[1]), "{excluded}/{population}: {results:?}");
        }
    }
}
