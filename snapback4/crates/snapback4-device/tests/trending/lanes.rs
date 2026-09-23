use super::super::common::*;
use snapback4_core::Value;
use snapback4_device::device::Queued;
use serde_json::json;
#[path = "../../../snapback4-sim/tests/trending/lanes_fixture.rs"]
mod f;

fn run<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(&f::source(true)); f::fixture(&mut server);
    backend.schema=backend.schema.public_projection();
    let mut device = host.open("w14a-lanes", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let read = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
    assert!(read.complete); assert_eq!(f::scored(&f::rows(&read.data)), f::oracle(&server, f::NOW).into_iter().take(10).collect::<Vec<_>>());
    let later = device.query("trending", "bob", &json!({"c":null}), f::NOW + f::HOUR).unwrap();
    assert!(later.complete); assert_eq!(f::scored(&f::rows(&later.data)), f::oracle(&server, f::NOW + f::HOUR).into_iter().take(10).collect::<Vec<_>>());
    let fill = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
    assert!(fill.complete);
    assert_eq!(f::names(&f::rows(&fill.data)), ["mid", "fresh", "edge", "quiet-00", "quiet-01", "quiet-02", "quiet-03", "quiet-04", "quiet-05", "quiet-06"]);
    for row in f::rows(&fill.data).iter().filter(|r| r.field("id").unwrap().as_str().unwrap().starts_with("quiet-")) {
        assert_eq!(row.field("likeCount").unwrap(), &Value::Int(0));
    }
    for (step, liked) in [false, true, false].into_iter().enumerate() {
        let from = server.seq().unwrap();
        f::set_like(&mut server, "bob", "quiet-00", liked, f::NOW, &format!("quiet-server-{step}"));
        device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
        for stored in [server.store().rows("posts").unwrap(), device.store().raw_rows("posts")] {
            let row = stored.iter().find(|r| r.field("id").unwrap() == &f::id("quiet-00")).unwrap();
            assert_eq!(row.field("likeCount").unwrap(), &Value::Int(i64::from(liked)));
        }
        let ranked = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
        let rows = f::rows(&ranked.data);
        assert_eq!(f::names(&rows).iter().position(|id| id == "quiet-00"), Some(if liked { 2 } else { 3 }));
        assert_eq!(rows[if liked { 2 } else { 3 }].field("likeCount").unwrap(), &Value::Int(i64::from(liked)));
    }
    for (n, liked) in [true, true, false, false].into_iter().enumerate() {
        let entry = device.admit(Queued { id: format!("q{n}"), seq:n as u64 + 1, op:"setLike".into(), args:json!({"postId":"quiet-00","liked":liked}),
            viewer:"bob".into(), now:f::NOW, new_ids:vec![format!("local-{n}")], predicted:vec![], predictable:true, sent_seq: None, receipt_store: None, observed_seq:None }).unwrap();
        assert!(entry.predictable, "{}: {entry:?}", host.label());
        let result = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
        assert_eq!(result.data,read.data,"source prediction never changes a parent count");
    }
    println!("W14a {}: oracle equal; offline 1h edge removed; zeros in one merge examined={}; 4/4 predicted source set/clear leave rank unchanged", host.label(), fill.metered.examined);
    host.close("w14a-lanes", device);

    let (mut server, mut backend) = compile(&f::source(true)); f::paging_fixture(&mut server);
    let expected = f::names(&f::ranking(&mut server, f::NOW));
    backend.schema=backend.schema.public_projection();
    let mut device = host.open("w14a-paging", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let first = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
    assert!(first.complete && first.next.is_some());
    let full = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
    assert!(full.complete && f::rows(&full.data).iter().all(|r| r.field("likeCount").unwrap() != &Value::Int(0)));
    let mut result = f::names(&f::rows(&first.data)); let mut cursor = first.next;
    let from = server.seq().unwrap(); f::set_like(&mut server, "concurrent", &result[0], true, f::NOW, "concurrent");
    device.apply(&stream_page(&mut server, "bob", from), false).unwrap();
    while let Some(next) = cursor {
        let page = device.query("trending", "bob", &json!({"c":next}), f::NOW).unwrap();
        assert!(page.complete); result.extend(f::names(&f::rows(&page.data))); cursor = page.next;
    }
    assert_eq!(result, expected); assert_eq!(result.len(), 37);
    println!("W14a {} paging: 37 liked posts, each once across synced winner increment; first page examined={}", host.label(), first.metered.examined);
    host.close("w14a-paging", device);
}

#[test] fn w14a_hour_lanes_on_sqlite() { run(&mut Sqlite::new("w14a-lanes")); }
#[test] fn w14a_hour_lanes_on_memory() { run(&mut Memory::new()); }

fn population<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(&f::source(true));
    for n in 0..10_000 { f::seed_post(&mut server, &format!("p{n:05}"), f::NOW - (n % 24) * f::HOUR - 1, 1); }
    backend.schema=backend.schema.public_projection();
    let mut device = host.open("w14a-population", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut server, "bob", 1_000);
    let targets: usize = pages.iter().map(|p| p.events.iter().filter(|e| e.table == "posts").count()).sum();
    assert_eq!(targets, 10_000);
    for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let page = device.query("trending", "bob", &json!({"c":null}), f::NOW).unwrap();
    assert!(page.complete && page.next.is_some()); assert_eq!(f::rows(&page.data).len(), 10); assert_eq!(page.metered.examined, 34);
    let expected = server.query("trending", snapback4_core::Context::new("bob", args(&[("c", Value::Null)])).at(f::NOW)).unwrap();
    assert_eq!(page.data, expected.data);
    assert!(expected.next.is_some());
    let second = device.query("trending", "bob", &json!({"c":page.next}), f::NOW).unwrap();
    assert!(second.complete && second.next.is_some());
    assert_eq!(f::rows(&second.data).len(), 10);
    let first_ids = f::names(&f::rows(&page.data));
    assert!(f::names(&f::rows(&second.data)).iter().all(|id| !first_ids.contains(id)));
    let old = device.query("trending", "bob", &json!({"c":null}), f::NOW + 2 * f::DAY).unwrap();
    assert!(old.complete && old.next.is_none() && f::rows(&old.data).is_empty());
    println!("W14a {} population: in-window=10000; examined={}; complete=true; next=true; cold target rows={targets}", host.label(), page.metered.examined);
    host.close("w14a-population", device);
}

#[test] fn w14a_population_on_sqlite() { population(&mut Sqlite::new("w14a-population")); }
#[test] fn w14a_population_on_memory() { population(&mut Memory::new()); }

fn ties<H: Host>(host: &mut H) {
    let (mut server, mut backend) = compile(&(f::source(true) + &f::tie_queries(7))); f::tie_fixture(&mut server);
    assert_eq!(server.schema().operations["trending"].runs.as_deref(), Some("device"));
    assert_eq!(server.schema().operations["setLike"].predicts.as_deref(), Some("eligible"));
    let expected = f::oracle(&server, f::TIE_NOW).into_iter().map(|r| r.0).collect::<Vec<_>>();
    backend.schema=backend.schema.public_projection();
    let mut device = host.open("w15c-ties", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 100).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    for op in ["tieFirst", "tieLast"] {
        let mut expected = expected.clone(); if op == "tieFirst" { expected.reverse(); }
        let mut result = Vec::new(); let mut cursor = serde_json::Value::Null;
        for _ in 0..10 {
            let page = device.query(op, "bob", &json!({"c":cursor}), f::TIE_NOW).unwrap();
            assert!(page.complete); result.extend(f::names(&f::rows(&page.data)));
            match page.next { Some(next) => cursor = json!(next), None => break }
        }
        assert_eq!(result, expected, "{} {op}", host.label());
    }
    // Prediction leaves the rank unchanged; the authoritative stream moves it.
    for (n, liked) in [true, false].into_iter().enumerate() {
        let before=device.query("trending","bob",&json!({"c":null}),f::TIE_NOW).unwrap().data;
        let from=server.seq().unwrap();
        let entry = device.admit(Queued { id: format!("w15c-{n}"), seq: n as u64 + 1, op: "setLike".into(), args: json!({"postId":"tie-00","liked":liked}),
            viewer: "bob".into(), now: f::TIE_NOW, new_ids: vec![format!("w15c-like-{n}")], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None, receipt_store: None }).unwrap();
        assert!(entry.predictable, "{entry:?}");
        assert_eq!(device.query("trending","bob",&json!({"c":null}),f::TIE_NOW).unwrap().data,before);
        f::set_like(&mut server, "bob", "tie-00", liked, f::TIE_NOW, &format!("w15c-server-{n}"));
        device.settle(&format!("w15c-{n}"),Some(server.seq().unwrap())).unwrap();
        device.apply(&stream_page(&mut server,"bob",from),false).unwrap();
        let page = device.query("trending", "bob", &json!({"c":null}), f::TIE_NOW).unwrap();
        let remote = server.query("trending", snapback4_core::Context::new("bob", args(&[("c", Value::Null)])).at(f::TIE_NOW)).unwrap();
        assert!(page.complete && remote.complete);
        assert_eq!(f::scored(&f::rows(&page.data)), f::scored(&f::rows(&remote.data)));
    }
    println!("W15c {}: 48 ties, both cursor directions, 2/2 source predictions preserve rank until server mirrors arrive", host.label());
    host.close("w15c-ties", device);
}
#[test] fn w15c_ties_on_sqlite() { ties(&mut Sqlite::new("w15c-ties")); }
#[test] fn w15c_ties_on_memory() { ties(&mut Memory::new()); }
