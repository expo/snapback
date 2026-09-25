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
    let mut pair = large_member(900_000);
    pair.source = pair.source.replace("text <=20000000", "text <=900000");
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
    // insert). Observe only after expiry; every observation must now agree.
    for (population, examined) in [(30, 48), (1200, 8192), (10000, 8192)] {
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
                    assert_eq!(r.complete, true, "{excluded}/{n}: {r:?}");
                    assert_eq!(r.data, Value::Int(1));
                    assert_eq!(r.next_expiry, Some(NOW + 100));
                    results.push(r.metered);
                    let marked = e.mutate("mark", None, Context::new("alice", inputs(&e, "mark", &json!({"member":"a","readUpTo":100}))).at(NOW + 2)).unwrap();
                    assert!(matches!(marked.state, snapback4_core::WriteState::Sent { .. }), "{marked:?}");
                    let mut chunks = 0;
                    while e.run_view_chunk(NOW + 2).unwrap().is_some() { chunks += 1; assert!(chunks < 1000); }
                    let after = e.query("unreadFor", Context::new("alice", inputs(&e, "unreadFor", &json!({"member":"a"}))).at(NOW + 2)).unwrap();
                    assert_eq!(after.data, Value::Int(0), "expired inputs cannot reappear after recount: {after:?}");
                    let writer = e.mutate("useCount", None, Context::new("alice", inputs(&e, "useCount", &json!({"member":"a"}))).at(NOW + 2)).unwrap();
                    assert_eq!(chunks,0,"expired inputs selected background work");
                    assert!(matches!(&writer.state, snapback4_core::WriteState::Sent {result,..} if result==&Value::Int(0)), "{writer:?}");
                    while e.sweep_expired(NOW+2,100).unwrap()>0 {}
                    let swept=e.query("unreadFor",Context::new("alice",inputs(&e,"unreadFor",&json!({"member":"a"}))).at(NOW+2)).unwrap();
                    assert!(swept.complete); assert_eq!(swept.data,Value::Int(0));
                    assert_eq!(e.store().rows("unread").unwrap()[0].field("value").unwrap(), &Value::Int(0), "sweep subtracted twice");
                    eprintln!("formerly-live/{excluded}/{n}/file-{file}: chunks={chunks}, read-complete={}", after.complete);
                }
            }
            assert!(results.windows(2).all(|p| p[0] == p[1]), "{excluded}/{population}: {results:?}");
        }
    }
}

#[test]
fn a_new_live_basis_and_later_sweep_cannot_subtract_the_same_input_twice() {
    for file in [false,true] {
        let mut rows=vec![cases::member("a","alice",0),cases::message("live",100,false)];
        for n in 0..1200 {
            let mut row=cases::message(&format!("expired{n:05}"),5,false);
            row.1["until"]=json!(NOW+1); rows.push(row);
        }
        let mut pair=Pair::new(cases::SOURCE,[rows.clone(),rows],"alice",Operation::new("mark",json!({"member":"a","readUpTo":1}),"alice"));
        pair.file_store=file;
        let mut e=pair.engine(0);
        let r=e.mutate("mark",None,Context::new("alice",inputs(&e,"mark",&pair.operations[0].args)).at(NOW+2)).unwrap();
        assert!(matches!(r.state,snapback4_core::WriteState::Sent{..}));
        assert!(e.run_view_chunk(NOW+2).unwrap().is_none());
        assert_eq!(e.store().rows("unread").unwrap()[0].field("value"),Ok(&Value::Int(1)));
        while e.sweep_expired(NOW+2,100).unwrap()>0 {}
        assert_eq!(e.store().rows("unread").unwrap()[0].field("value"),Ok(&Value::Int(1)));
        let read=e.query("unreadFor",Context::new("alice",inputs(&e,"unreadFor",&json!({"member":"a"}))).at(NOW+2)).unwrap();
        assert!(read.complete); assert_eq!(read.data,Value::Int(1));
    }
}

#[test]
fn expiry_cursor_reconciles_edits_clock_advance_restart_and_sweep() {
    for file in [false,true] {
        let mut rows=vec![cases::member("a","alice",0)];
        for n in 0..1200 {
            let mut row=cases::message(&format!("m{n:05}"),5,false);
            row.1["until"]=json!(NOW+if n<600 {10} else {20}); rows.push(row);
        }
        let source=cases::SOURCE.to_owned()+"\nmutation extend(message: messages, until: time):\n  update messages[message] { until: until }\n";
        let mut pair=Pair::new(source,[rows.clone(),rows],"alice",Operation::new("mark",json!({"member":"a","readUpTo":1}),"alice"));
        pair.file_store=file;
        let mut e=pair.engine(0);
        let mark=e.mutate("mark",None,Context::new("alice",inputs(&e,"mark",&pair.operations[0].args)).at(NOW+2)).unwrap();
        assert!(matches!(mark.state,snapback4_core::WriteState::Sent{..}));
        assert!(e.run_view_chunk(NOW+2).unwrap().is_some());
        let edit=e.mutate("extend",None,Context::new("alice",inputs(&e,"extend",&json!({"message":"m00000","until":NOW+30}))).at(NOW+2)).unwrap();
        assert!(matches!(edit.state,snapback4_core::WriteState::Sent{..}),"{edit:?}");
        // A process restart retains both composite cursor and contributing deadline.
        // The work row itself is the durable continuation, as the file-store
        // reopen test in row_keyed_views also exercises.
        assert!(!e.store().rows("$recount:unread").unwrap().is_empty());
        let mut chunks=0;
        while e.run_view_chunk(NOW+10).unwrap().is_some() {chunks+=1;assert!(chunks<20);}
        assert_eq!(e.store().rows("unread").unwrap()[0].field("value"),Ok(&Value::Int(601)));
        while e.sweep_expired(NOW+10,100).unwrap()>0 {}
        assert_eq!(e.store().rows("unread").unwrap()[0].field("value"),Ok(&Value::Int(601)));
    }
}
