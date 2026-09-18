//! Joins sharing a commit keep their own ordinals on every device host.
use super::*;

fn fixture(kind: &str, horizon: bool, split: bool, retained: bool) -> Json {
    let mut source = GROUP.replace("  person: principal", "  person: principal\n  until: time ?\n  expire at .until\n  by byExpiry: until")
        .replace("  online only", "  sync to .person")
        .replace("  update <- deny", "  update <- allow\n  delete <- allow")
        + "\nmutation rejoin():\n  insert members {id: 'm', group: 'g', person: 'dev:bob', until: 1000}\n  delete members['m']\n  insert members {id: 'm', group: 'g', person: 'dev:bob', until: 2000}\n";
    if retained { source = source.replace("  sync to members", "  retain delivered-history\n  sync to members"); }
    if !horizon { source = source.replace(" last 2 by byTime\nquery", "\nquery"); }
    let (mut engine, backend) = compile(&source);
    engine.seed_at((1..=3).map(group_post), 1).unwrap();
    let member = |expiry| ("members".into(), object([("id",id("m")),("group",Value::String("g".into())),("person",id("dev:bob")),("until",Value::Int(expiry))]));
    if kind == "rejoin" {
        let result = engine.mutate("rejoin", Some("rejoin"), snapback4_core::Context::system().at(500)).unwrap();
        assert!(matches!(result.state, snapback4_core::engine::WriteState::Sent {..}));
    } else {
        let mut rows = vec![member(1000), member(2000)];
        if kind == "twice" { rows.push(member(3000)); }
        engine.seed_at(rows, 500).unwrap();
    }
    // A later member put makes limit=1 cross a real page boundary. Only
    // `later` changes its lifetime again; commits themselves stay indivisible.
    engine.seed_at([member(if kind == "twice" || kind == "later" { 3000 } else { 2000 })], 1500).unwrap();
    let transitions = engine.store_mut().transaction().unwrap().membership_transitions("p:dev:bob", 1).unwrap();
    let transitions: Vec<_> = transitions.iter().filter(|e| e.table == "posts").collect();
    let kinds: Vec<_> = transitions.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, match kind { "rejoin" => vec!["join","scope","join"], "twice" | "later" => vec!["join","join","join"], _ => vec!["join","join"] });
    assert!(transitions.windows(2).all(|w| (w[0].seq, w[0].ord) < (w[1].seq, w[1].ord)));
    let acquiring = if kind == "rejoin" { transitions[2] } else { transitions[0] };
    assert_eq!(acquiring.seq, 2);
    let position = json!([acquiring.seq, acquiring.ord]);
    let mut from = 1; let mut pages = Vec::new(); let mut positions = Vec::new();
    loop {
        let page = engine.stream_at("dev:bob", from, if split { 1 } else { 1000 }, 1600).unwrap();
        positions.extend(page.events.iter().filter(|e| e.table == "posts" && e.kind == "put").map(|e| json!([e.seq,e.ord])));
        from = page.watermark; let more = page.more; pages.push(wire_stream(page));
        if !more { break; }
    }
    let floor = horizon.then(|| snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(
        backend.schema.tables["posts"].index("byTime").unwrap(), &group_post(2).1, "p2")));
    json!({"name":format!("same-commit-{kind}-horizon={horizon}-split={split}-retained={retained}"),"kind":kind,"horizon":horizon,"split":split,"retained":retained,
        "backend":backend,"initial":[],"pages":pages,"floor":floor,"now":1600,"position":position,"positions":positions,
        "expected":[{"id":"p3","at":3000},{"id":"p2","at":2000}]})
}

fn check_wire(f: &Json) {
    let pages = f["pages"].as_array().unwrap();
    assert_eq!(pages.len(), if f["split"] == true { 2 } else { 1 });
    let events: Vec<_> = pages.iter().flat_map(|p| p["events"].as_array().unwrap()).filter(|e| e["table"] == "posts").collect();
    let puts: Vec<_> = events.iter().filter(|e| e["kind"] == "put").map(|e| e["id"].as_str().unwrap()).collect();
    let expected = if f["horizon"] == true { vec!["p3","p2"] } else { vec!["p3","p2","p1"] };
    assert_eq!(puts, expected, "one acquisition per live chain");
    assert_eq!(f["positions"], json!(vec![f["position"].clone(); expected.len()]), "acquire at the chain's first join ordinal");
    let scopes: Vec<_> = events.iter().filter(|e| e["kind"] == "scope").collect();
    assert_eq!(scopes.len(), if f["kind"] == "rejoin" { 1 } else { 0 });
    if f["kind"] == "rejoin" { assert_eq!(events[0]["kind"], "scope", "the revoked first grant delivers nothing before scope"); }
    let markers: Vec<_> = pages.iter().flat_map(|p| p["acquisitions"].as_array().unwrap()).collect();
    assert_eq!(markers.len(), if f["horizon"] == true { 2 } else { 0 });
    if f["horizon"] == true {
        let start = pages[0]["events"].as_array().unwrap().iter().position(|e| e["table"] == "posts" && e["kind"] == "put").unwrap();
        assert_eq!(markers[0]["at"], start); assert!(markers[0].get("floor").is_none());
        assert_eq!(markers[1]["at"], start + 2); assert_eq!(markers[1]["floor"], f["floor"]);
    }
    if f["retained"] == true {
        let joined: Vec<_> = pages.iter().flat_map(|p| p["joined"]["posts"].as_array().into_iter().flatten()).collect();
        assert_eq!(json!(joined), json!([["g"]]), "only the surviving join names the held group");
    }
    if f["split"] == true {
        assert!(pages[1]["events"].as_array().unwrap().iter().all(|e| e["table"] != "posts"));
        assert!(pages[1]["acquisitions"].as_array().unwrap().is_empty());
    }
}

macro_rules! case {
    ($name:ident, $kind:literal) => {
        mod $name {
            use super::*;
            macro_rules! variant {
                ($variant:ident, $horizon:literal, $split:literal, $retained:literal) => {
                    mod $variant {
                        use super::*;
                        #[test] fn sqlite() {
                            let f = fixture($kind, $horizon, $split, $retained);
                            apply_fixture(&mut Sqlite::new(concat!(stringify!($name), "-", stringify!($variant))), &f); check_wire(&f);
                        }
                        #[test] fn memory() {
                            let f = fixture($kind, $horizon, $split, $retained);
                            apply_fixture(&mut Memory::new(), &f); check_wire(&f);
                        }
                    }
                };
            }
            variant!(horizon_together, true, false, false);
            variant!(horizon_split, true, true, false);
            variant!(horizonless_together, false, false, false);
            variant!(horizonless_split, false, true, false);
            variant!(retained_horizon_together, true, false, true);
            variant!(retained_horizon_split, true, true, true);
            variant!(retained_horizonless_together, false, false, true);
            variant!(retained_horizonless_split, false, true, true);
        }
    };
}
case!(grant_renew, "renew");
case!(grant_revoke_rejoin, "rejoin");
case!(grant_renew_twice, "twice");
case!(grant_renew_later, "later");

pub(super) fn fixtures() -> Vec<Json> {
    let mut out = Vec::new();
    for kind in ["renew","rejoin","twice","later"] { for horizon in [false,true] { for split in [false,true] { for retained in [false,true] {
        out.push(fixture(kind,horizon,split,retained));
    } } } }
    out
}
