//! Review witnesses share the actual Rust server pages with the wasm suite.
use super::*;
use serde_json::{Value as Json, json};
use snapback4_device::device::StreamPage;
#[path = "../../../snapback4-core/tests/common/acquisition.rs"]
mod mixed;
#[path = "same_commit.rs"]
mod same_commit;

fn wire_stream(stream: snapback4_core::partition::StreamPage) -> Json {
    json!({"snapshot":false,"events":stream.events.iter().map(|e| json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "acquisitions":stream.acquisitions,"joined":stream.joined,"watermark":stream.watermark,"more":stream.more,"generation":1})
}
fn fixture(kind: &str, horizon: bool, split: bool) -> Json {
    let mut source = GROUP.replace("  person: principal", "  person: principal\n  until: time ?\n  expire at .until\n  by byExpiry: until")
        .replace("  online only", "  sync to .person")
        .replace("  update <- deny", "  update <- allow\n  delete <- allow")
        .replace("  update <- allow\n  sync", "  update <- allow\n  delete <- allow\n  sync")
        + "\nmutation renew(m: members, t: time):\n  update members[m] {until: t}\nmutation leave():\n  delete members['m']\nmutation remove():\n  delete posts['p3']\nquery one(p: posts):\n  return posts[p]\n";
    if !horizon { source = source.replace(" last 2 by byTime\nquery", "\nquery"); }
    let (mut engine, backend) = compile(&source);
    engine.seed_at((1..=3).map(group_post), 1).unwrap();
    let member = |m: &str, expiry| ("members".into(), object([("id",id(m)),("group",Value::String("g".into())),("person",id("dev:bob")),("until",expiry)]));
    engine.seed_at([member("m", if kind == "unlimited" { Value::Null } else { Value::Int(1000) })], 2).unwrap();
    let mut initial = Vec::new();
    let mut from = 1;
    let (renew_id, renew_at, end, now) = if kind == "gap" {
        initial = snapshots_at(&mut engine, 100, 1).iter().map(page_json).collect();
        from = initial[0]["watermark"].as_u64().unwrap();
        let removed = engine.mutate("remove", Some("gap-delete"), snapback4_core::Context::system().at(1100)).unwrap();
        assert!(matches!(removed.state, snapback4_core::engine::WriteState::Sent {..}));
        engine.seed_at([member("replacement", Value::Int(2000))], 1200).unwrap();
        ("replacement", 1500, 3000, 1600)
    } else {
        if kind == "revoke" {
            let left = engine.mutate("leave", Some("leave"), context("dev:bob", &[]).at(100)).unwrap();
            assert!(matches!(left.state, snapback4_core::engine::WriteState::Sent {..}));
            engine.seed_at([member("replacement", Value::Int(1000))], 200).unwrap();
        }
        (if kind == "revoke" { "replacement" } else { "m" }, 500, 2000, 1600)
    };
    let renewed = engine.mutate("renew", Some("renew"), context("dev:bob", &[("m",id(renew_id)),("t",Value::Int(end))]).at(renew_at)).unwrap();
    assert!(matches!(renewed.state, snapback4_core::engine::WriteState::Sent {..}));
    let mut pages = Vec::new();
    loop {
        let page = engine.stream_at("dev:bob", from, if split { 1 } else { 1000 }, now).unwrap();
        from = page.watermark; let more = page.more; pages.push(wire_stream(page));
        if !more { break; }
    }
    let floor_row = if kind == "gap" { 1 } else { 2 };
    let floor = horizon.then(|| snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(
        backend.schema.tables["posts"].index("byTime").unwrap(), &group_post(floor_row).1, &format!("p{floor_row}"))));
    json!({"name":format!("{kind}-horizon={horizon}-split={split}"),"kind":kind,"horizon":horizon,"split":split,
        "backend":backend,"initial":initial,"pages":pages,"floor":floor,"now":now,
        "expected":if kind == "gap" { json!([{"id":"p2","at":2000},{"id":"p1","at":1000}]) } else { json!([{"id":"p3","at":3000},{"id":"p2","at":2000}]) }})
}

fn check_wire(f: &Json) {
    let pages = f["pages"].as_array().unwrap();
    assert_eq!(pages.len(), if f["split"] == true { if f["kind"] == "revoke" { 4 } else { 2 } } else { 1 });
    let events: Vec<_> = pages.iter().flat_map(|p| p["events"].as_array().unwrap()).filter(|e| e["table"] == "posts").collect();
    let puts: Vec<_> = events.iter().filter(|e| e["kind"] == "put").map(|e| e["id"].as_str().unwrap()).collect();
    let expected = if f["kind"] == "gap" { vec!["p2","p1"] } else if f["horizon"] == true { vec!["p3","p2"] } else { vec!["p3","p2","p1"] };
    assert_eq!(puts, expected, "the acquiring grant survives its renewal exactly once");
    if f["kind"] == "gap" || f["kind"] == "revoke" {
        assert_eq!(events[0]["kind"], "scope");
        assert_eq!(events.iter().filter(|e| e["kind"] == "scope").count(), 1);
    }
    let markers: Vec<_> = pages.iter().flat_map(|p| p["acquisitions"].as_array().unwrap()).collect();
    assert_eq!(markers.len(), if f["horizon"] == true { 2 } else { 0 });
    if f["horizon"] == true {
        assert_eq!(markers[1]["floor"], f["floor"]);
        let acquiring_page = pages.iter().find(|p| !p["acquisitions"].as_array().unwrap().is_empty()).unwrap();
        let start = acquiring_page["events"].as_array().unwrap().iter().position(|e| e["table"] == "posts" && e["kind"] == "put").unwrap();
        assert_eq!(markers[0]["at"], start);
        assert_eq!(markers[1]["at"], start + 2);
    }
    if f["split"] == true {
        assert!(pages.last().unwrap()["events"].as_array().unwrap().iter().all(|e| e["table"] != "posts"), "renewal itself emits nothing");
        assert!(pages.last().unwrap()["acquisitions"].as_array().unwrap().is_empty());
        if f["kind"] == "revoke" {
            assert!(pages[0]["events"].as_array().unwrap().iter().all(|e| e["table"] != "posts"), "revoked grant acquires nothing");
            assert!(pages[0]["acquisitions"].as_array().unwrap().is_empty());
        }
    }
}
fn apply_fixture<H: Host>(host: &mut H, f: &Json) {
    let backend = serde_json::from_value(f["backend"].clone()).unwrap();
    let mut device = host.open(f["name"].as_str().unwrap(), Some(backend)).unwrap();
    for (i, page) in f["initial"].as_array().unwrap().iter().enumerate() {
        device.apply(&serde_json::from_value(page.clone()).unwrap(), i == 0).unwrap();
    }
    if f["kind"] == "gap" {
        assert_ne!(device.query("one", "dev:bob", &json!({"p":"p3"}), 100).unwrap().data, Value::Null, "fixture holds the soon-deleted row before catch-up");
    }
    for page in f["pages"].as_array().unwrap() {
        device.apply(&serde_json::from_value(page.clone()).unwrap(), false).unwrap();
    }
    if f["kind"] == "gap" {
        assert_eq!(device.query("one", "dev:bob", &json!({"p":"p3"}), 1600).unwrap().data, Value::Null, "the gap deletion is cleared by scope");
    }
    let (read, unknown, _) = device.query_with_coverage("timeline", "dev:bob", &json!({"g":"g","c":null}), f["now"].as_i64().unwrap());
    let read = read.unwrap();
    assert_eq!(snapback4_core::wire::to_json(&read.data), f["expected"]);
    assert!(read.complete && !unknown);
    if f["horizon"] == true {
        assert_eq!(device.store().boundary_entries().iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>(), [f["floor"].as_str().unwrap()]);
        let (below, unknown, _) = device.query_with_coverage("timeline", "dev:bob", &json!({"g":"g","c":read.next}), f["now"].as_i64().unwrap());
        assert!(!below.unwrap().complete && unknown);
    }
    assert!(device.sync_state().unwrap().acquired);
}
macro_rules! renewal_case {
    ($name:ident, $kind:literal, $horizon:literal, $split:literal) => {
        mod $name {
            use super::*;
            #[test] fn sqlite() {
                let f = fixture($kind, $horizon, $split);
                apply_fixture(&mut Sqlite::new(stringify!($name)), &f); check_wire(&f);
            }
            #[test] fn memory() {
                let f = fixture($kind, $horizon, $split);
                apply_fixture(&mut Memory::new(), &f); check_wire(&f);
            }
        }
    };
}
renewal_case!(cold_horizon_together, "cold", true, false);
renewal_case!(cold_horizon_split, "cold", true, true);
renewal_case!(cold_horizonless_together, "cold", false, false);
renewal_case!(cold_horizonless_split, "cold", false, true);
renewal_case!(gap_horizon_together, "gap", true, false);
renewal_case!(gap_horizon_split, "gap", true, true);
renewal_case!(gap_horizonless_together, "gap", false, false);
renewal_case!(gap_horizonless_split, "gap", false, true);
renewal_case!(revoke_horizon_together, "revoke", true, false);
renewal_case!(revoke_horizon_split, "revoke", true, true);
renewal_case!(revoke_horizonless_together, "revoke", false, false);
renewal_case!(revoke_horizonless_split, "revoke", false, true);
renewal_case!(unlimited_horizon_split, "unlimited", true, true);

fn mixed_fixture(hidden: usize, readable: usize, deleted: bool, snapshot: bool) -> Json {
    let fixture = mixed::mixed_acquisition(hidden, readable, deleted);
    let (_, mut backend) = compile("table writes:\n  bucket: int\n  body: text <=4000\n  owner: principal\n  by byBucket: bucket, id\n  read <- allow\n  sync public last 2 by byBucket\nquery timeline(c: cursor ?):\n  return writes after c last 2 by byBucket\n");
    backend.schema = fixture.schema;
    let floor = if readable < 2 { "whole".into() } else {
        snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(backend.schema.tables["writes"].index("byBucket").unwrap(),
            &object([("id",id("r1")),("bucket",Value::Int(1))]), "r1"))
    };
    // Historical group joins cannot establish a boundary on a public table.
    assert!(fixture.stream.events.is_empty() && fixture.stream.acquisitions.is_empty());
    let pages = if snapshot {
        let mut after = None;
        fixture.snapshots.into_iter().map(|p| {
            let next = p.next.map(|c| c.encode());
            let page = json!({"snapshot":true,"after":after,"next":next,"held":p.held,"watermark":p.watermark,"more":next.is_some(),"generation":1,
                "acquisitions":p.acquisitions,"events":p.events.iter().map(|e| json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>()});
            after = next; page
        }).collect::<Vec<_>>()
    } else { vec![wire_stream(fixture.stream)] };
    json!({"name":format!("mixed-{hidden}-{readable}-{deleted}-{snapshot}"),"backend":backend,"pages":pages,"floor":floor,"readable":readable,"snapshot":snapshot})
}
fn mixed_fixtures() -> Vec<Json> {
    [false,true].into_iter().flat_map(|snapshot| [(0,3,false),(1,3,false),(1000,3,false),(0,3,true),(0,0,false),(1000,0,false)]
        .map(|(hidden,readable,deleted)| mixed_fixture(hidden,readable,deleted,snapshot))).collect()
}
fn apply_mixed<H: Host>(host: &mut H, f: &Json) {
    let mut device = host.open(f["name"].as_str().unwrap(), Some(serde_json::from_value(f["backend"].clone()).unwrap())).unwrap();
    for (i, page) in f["pages"].as_array().unwrap().iter().enumerate() {
        let page: StreamPage = serde_json::from_value(page.clone()).unwrap();
        device.apply(&page, i == 0 && page.snapshot).unwrap();
    }
    if f["snapshot"] == false {
        assert!(device.store().boundary_entries().is_empty());
        let (read, unknown, _) = device.query_with_coverage("timeline", "bob", &json!({"c":null}), 3);
        assert!(unknown && !read.unwrap().complete, "an obsolete join cannot certify a public window");
        return;
    }
    assert_eq!(device.store().boundary_entries().iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>(), [f["floor"].as_str().unwrap()]);
    let (read, unknown, _) = device.query_with_coverage("timeline", "bob", &json!({"c":null}), 3);
    let read = read.unwrap();
    let ids: Vec<_> = read.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect();
    assert_eq!(ids, if f["readable"] == 0 { vec![] } else { vec!["r2","r1"] });
    assert!(read.complete && !unknown);
    if f["readable"] != 0 {
        let (below, unknown, _) = device.query_with_coverage("timeline", "bob", &json!({"c":read.next}), 3);
        let below = below.unwrap(); assert!(!below.complete && unknown); assert!(below.data.as_array().unwrap().is_empty());
    } else { assert!(read.next.is_none()); }
}
#[test]
fn mixed_readable_pages_reach_both_stores() {
    for f in mixed_fixtures() {
        apply_mixed(&mut Sqlite::new("mixed-review"), &f);
        apply_mixed(&mut Memory::new(), &f);
    }
}

#[test]
fn export_wire_fixtures() {
    // JS invokes this test with a private temporary path; no committed generated file.
    let Some(path) = std::env::var_os("SNAPBACK4_REVIEW_FIXTURES") else { return };
    let mut renewals = Vec::new();
    for kind in ["cold","gap","revoke"] { for horizon in [false,true] { for split in [false,true] { renewals.push(fixture(kind,horizon,split)); } } }
    renewals.push(fixture("unlimited",true,true));
    std::fs::write(path, serde_json::to_vec(&json!({"renewals":renewals,"mixed":mixed_fixtures(),"same_commit":same_commit::fixtures()})).unwrap()).unwrap();
}
