mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, wire};
use snapback4_device::device::{Device, StreamPage};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q");

fn inherited_expiry_replay<H: Host>(h: &mut H) {
    for (name, source) in [
        ("member", include_str!("../../snapback4-lang/tests/fixtures/row-view-inherited-member.q")),
        ("source", include_str!("../../snapback4-lang/tests/fixtures/row-view-inherited-source.q")),
    ] {
        let source = source.replace("  read through .room", "  read through .room\n  sync public");
        let (mut e, mut b) = compile(&source);
        b.schema = b.schema.public_projection();
        let seeded = e.mutate("seed", None, Context::new("alice", Default::default()).at(1000)).unwrap();
        assert!(matches!(seeded.state, snapback4_core::WriteState::Sent { .. }), "{seeded:?}");
        let mut d = h.open(name, Some(b)).unwrap();
        for (n, p) in snapshot(&mut e, 1000, 1000).iter().enumerate() { d.apply(p, n == 0).unwrap(); }
        for now in [1000, 1999, 2000, 3000] {
            let count = d.query("countFor", "bob", &json!({}), now).unwrap();
            assert!(count.complete && !count.unavailable, "{name}: {count:?}");
            assert_eq!(count.data, Value::Int(i64::from(now < 2000)), "{name} at {now}");
            assert_eq!(count.next_expiry, (now < 2000).then_some(2000));
            let point = d.query("message", "bob", &json!({}), now).unwrap();
            assert_eq!(point.data != Value::Null, now < 2000);
        }
        if name == "source" {
            d.predict("mark", "bob", &json!({}), 3000, vec![], 1).unwrap();
            assert_eq!(d.store().raw_rows("unread")[0].field("value"), Ok(&Value::Int(0)));
        }
        h.close(name, d);
        let mut d = h.open(name, None).unwrap();
        let count = d.query("countFor", "bob", &json!({}), 3000).unwrap();
        assert!(count.complete);
        assert_eq!(count.data, Value::Int(0));
    }
}
#[test] fn inherited_expiry_replay_memory() { inherited_expiry_replay(&mut Memory::new()); }
#[test] fn inherited_expiry_replay_sqlite() { inherited_expiry_replay(&mut Sqlite::new("inherited-expiry")); }
fn setup() -> (Engine, snapback4_device::device::Backend) {
    let (mut e, mut b) = compile(SOURCE);
    b.schema = b.schema.public_projection();
    let row = wire::row_from_json(
        &e.schema().tables["members"],
        &json!({"id":"b","conversationId":"c","principal":"bob","readUpTo":0,"joinedAt":0}),
    )
    .unwrap();
    e.seed([("members".into(), row)]).unwrap();
    (e, b)
}
fn send(e: &mut Engine, id: &str, expiry: Option<i64>, now: i64) {
    let r = e
        .mutate(
            "send",
            None,
            Context::new(
                "alice",
                args(&[
                    ("id", common::id(id)),
                    ("conversationId", common::id("c")),
                    ("ordinal", Value::Int(1)),
                    ("senderId", common::id("alice")),
                    ("until", expiry.map_or(Value::Null, Value::Int)),
                ]),
            )
            .at(now),
        )
        .unwrap();
    assert!(
        matches!(r.state, snapback4_core::WriteState::Sent { .. }),
        "{r:?}"
    );
}
fn snapshot(e: &mut Engine, first_at: i64, view_at: i64) -> Vec<StreamPage> {
    let mut after = None;
    let mut pages = vec![];
    loop {
        let p = e
            .snapshot_acquisition_page_at("bob", after.as_deref(), 1, first_at)
            .unwrap();
        // Re-serve a view page after expiry, leaving earlier source pages intact.
        let p = if p.events.iter().any(|v| v.table == "unread") {
            e.snapshot_acquisition_page_at("bob", after.as_deref(), 1, view_at)
                .unwrap()
        } else {
            p
        };
        let next = p.next.map(|c| c.encode());
        let page = json!({"snapshot":true,"after":after,"watermark":p.watermark,"more":next.is_some(),"next":next,"held":p.held,"acquisitions":p.acquisitions,"generation":e.generation(),"events":p.events.iter().map(|v|json!({"table":v.table,"id":v.id,"kind":v.kind.word(),"data":v.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>()});
        pages.push(serde_json::from_value(page).unwrap());
        after = next;
        if after.is_none() {
            return pages;
        }
    }
}
fn catchup(e: &mut Engine, w: u64, now: i64) -> StreamPage {
    let p = e.stream_at("bob", w, 100, now).unwrap();
    serde_json::from_value(json!({"snapshot":false,"watermark":p.watermark,"more":p.more,"requested_watermark":w,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,"generation":e.generation(),"events":p.events.iter().map(|v|json!({"table":v.table,"id":v.id,"kind":v.kind,"data":v.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>()})).unwrap()
}
fn basis<S: snapback4_device::store::DeviceStore>(d: &mut Device<S>, expected: i64, now: i64) {
    let q = d
        .query("unreadFor", "bob", &json!({"member":"b"}), now)
        .unwrap();
    assert!(
        q.complete,
        "small covered live basis must be certified: {q:?}"
    );
    assert_eq!(
        q.data,
        Value::Int(expected),
        "certified count differs from held live rows"
    );
}
fn wire_basis(pages: &[StreamPage], expected: i64) {
    let views = pages
        .iter()
        .flat_map(|p| &p.events)
        .filter(|e| e.table == "unread" && e.kind == "put")
        .collect::<Vec<_>>();
    assert!(!views.is_empty(), "missing view delivery");
    for v in views {
        let row = v.data.as_ref().unwrap();
        assert!(
            row["recountPending"] == true || row["value"] == expected,
            "wire certifies a count outside the device's live basis: {row}"
        );
    }
}
fn spanning<H: Host>(h: &mut H) {
    let (mut e, b) = setup();
    send(&mut e, "expired", Some(10), 9);
    let pages = snapshot(&mut e, 9, 11);
    wire_basis(&pages, 0);
    let mut d = h.open("spanning", Some(b)).unwrap();
    for (n, p) in pages.iter().enumerate() {
        d.apply(p, n == 0).unwrap();
    }
    basis(&mut d, 0, 11);
}
fn missed<H: Host>(h: &mut H, held_before: bool) -> Json {
    let mut worlds = vec![];
    for hidden_expiry in [12, 14] {
        let (mut e, b) = setup();
        send(&mut e, "live", None, 1);
        send(&mut e, "before-watermark", Some(10), 1);
        let initial = if held_before { 9 } else { 11 };
        let pages = snapshot(&mut e, initial, initial);
        wire_basis(&pages, if held_before { 2 } else { 1 });
        let mut d = h
            .open(&format!("missed-{held_before}-{hidden_expiry}"), Some(b))
            .unwrap();
        for (n, p) in pages.iter().enumerate() {
            d.apply(p, n == 0).unwrap();
        }
        let w = e.seq().unwrap();
        send(&mut e, "after-watermark", Some(hidden_expiry), 11);
        send(&mut e, "second-live", None, 15);
        let p = catchup(&mut e, w, 15);
        wire_basis(std::slice::from_ref(&p), 2);
        d.apply(&p, false).unwrap();
        basis(&mut d, 2, 15);
        // Prediction must start from live held input, regardless of which raw
        // expired rows the server still stores or the device once received.
        let predicted = d.predict("send","bob",&json!({"id":"pred","conversationId":"c","ordinal":2,"senderId":"alice","until":null}),15,vec!["pred".into()],1).unwrap();
        basis(&mut d, 3, 15);
        let transcript = json!({"page":p,"prediction":predicted,"state":d.state().unwrap(),"query":d.query("unreadFor","bob",&json!({"member":"b"}),15)});
        worlds.push(transcript);
    }
    assert_eq!(
        serde_json::to_vec(&worlds[0]).unwrap(),
        serde_json::to_vec(&worlds[1]).unwrap(),
        "hidden expiry changed a device channel"
    );
    worlds.remove(0)
}
#[test]
fn snapshot_spans_expiry_memory() {
    spanning(&mut Memory::new());
}
#[test]
fn snapshot_spans_expiry_sqlite() {
    spanning(&mut Sqlite::new("spanning"));
}
#[test]
fn snapshot_after_expiry_then_stream_memory() {
    missed(&mut Memory::new(), false);
}
#[test]
fn snapshot_after_expiry_then_stream_sqlite() {
    missed(&mut Sqlite::new("missed"), false);
}
#[test]
fn catchup_expired_before_and_after_watermark_memory() {
    missed(&mut Memory::new(), true);
}
#[test]
fn catchup_expired_before_and_after_watermark_sqlite() {
    missed(&mut Sqlite::new("catchup"), true);
}

fn unchanged_mark_after_expiry<H: Host>(h: &mut H) {
    let (mut e, b) = setup();
    send(&mut e, "expired", Some(10), 9);
    send(&mut e, "live", None, 9);
    let mut d = h.open("unchanged-mark", Some(b)).unwrap();
    for (n, p) in snapshot(&mut e, 9, 9).iter().enumerate() {
        d.apply(p, n == 0).unwrap();
    }
    d.predict(
        "mark",
        "bob",
        &json!({"member":"b","readUpTo":0}),
        11,
        vec![],
        1,
    )
    .unwrap();
    let image = d.store().raw_rows("unread").pop().unwrap();
    assert_eq!(
        image.field("value"),
        Ok(&Value::Int(1)),
        "prediction certified the pre-expiry count"
    );
    assert_eq!(image.field("recountPending"), Ok(&Value::Bool(false)));
    basis(&mut d, 1, 11);
}
#[test]
fn unchanged_mark_after_clock_expiry_memory() {
    unchanged_mark_after_expiry(&mut Memory::new());
}
#[test]
fn unchanged_mark_after_clock_expiry_sqlite() {
    unchanged_mark_after_expiry(&mut Sqlite::new("clock"));
}

// @ref LLP 3000.015#3 — rejected candidates retain an index cursor, never a payload cursor.
fn durable_source_rule_budget<H: Host>(host: &mut H) {
    let source=SOURCE.replace("return unread first 100", "return unread where .conversationId = 'c' first 100").replace("  expire at .until\n", "")
        .replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  until: time ?\n  expire at .until")
        .replace("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public",
            "  read <- exists access[.conversationId, viewer]\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to access[.conversationId]")
        + "\ntable access:\n  conversationId: conversations\n  principal: principal\n  unique conversationId, principal\n  public\n  sync public\n";
    let mut state=20261002u64;
    for step in 0..16 {
        state^=state<<13; state^=state>>7; state^=state<<17;
        let (mut engine,mut backend)=compile(&source);
        backend.schema=backend.schema.public_projection();
        engine.seed_at([("access".into(),wire::row_from_json(&engine.schema().tables["access"],
            &json!({"id":"grant","conversationId":"c","principal":"bob"})).unwrap()),
            ("members".into(),wire::row_from_json(&engine.schema().tables["members"],
            &json!({"id":"b","conversationId":"c","principal":"bob","readUpTo":0,"joinedAt":0,"until":100})).unwrap())],1).unwrap();
        let mut device=host.open(&format!("budget-{step}"),Some(backend)).unwrap();
        for (n,page) in snapshot(&mut engine,1,1).iter().enumerate() { device.apply(page,n==0).unwrap(); }
        // The first prefix is Astra's literal: one matching provisional durable source.
        let population=if step==0 {1} else {1+(state%5) as usize};
        let mut facts=Vec::new();
        let mut predicted=Vec::new();
        for n in 0..population {
            let sender=if n==0 || (state>>(n+1))&1==0 {"alice"} else {"bob"};
            let ordinal=if n==0 {1} else {(state>>(n+8)) as i64 % 3};
            let id=format!("pred-{n}");
            let prediction=device.predict("send","bob",&json!({"id":id,"conversationId":"c","ordinal":ordinal,"senderId":sender,"until":null}),
                2,vec![id],n as u64+1).unwrap();
            assert!(prediction.predicted.iter().any(|row|row=="unread/b"),"{prediction:?}");
            predicted.extend(prediction.predicted);
            facts.push((sender.to_string(),ordinal));
        }
        for now in [2,99,100,9] {
            let expected=if now>=100 {0} else {facts.iter().filter(|(sender,ordinal)|sender!="bob" && *ordinal>0).count() as i64};
            let full=device.query("unreadFor","bob",&json!({"member":"b"}),now).unwrap();
            assert!(full.complete,"{} step={step} {full:?}",host.label());
            assert_eq!(full.data,Value::Int(expected));
            assert_eq!(full.next_expiry,(now<100).then_some(100));
            let rows=device.query("unreadRows","bob",&json!({}),now).unwrap();
            assert!(rows.complete);
            let rows=rows.data.as_array().unwrap();
            if now < 100 {
                assert_eq!(rows.len(),1);
                assert_eq!(rows[0].field("value"),Ok(&Value::Int(expected)));
                assert_eq!(rows[0].field("pending"),Ok(&Value::Bool(true)),"prediction metadata: {} step={step} clock={now}",host.label());
            } else { assert!(rows.is_empty()); }
            for remaining in [0,1,2,3,4,5,6,7,8,12,32] {
                let result=snapback4_device::call::call(&mut device,json!({"op":"query","name":"unreadFor",
                    "viewer":"bob","args":{"member":"b"},"now":now,
                    "spent":snapback4_core::meter::Metered {rule_probes:8192-remaining,..Default::default()}}));
                assert!(result["denied"].is_null() && result["ok"]["denied"].is_null(),
                    "{} seed=20261002 step={step} clock={now} remaining={remaining}: {result}",host.label());
                if result["ok"]["complete"]==true {
                    assert_eq!(result["ok"]["data"],expected);
                } else {
                    assert!(!result["ok"]["cut"].is_null(),"meter exhaustion must be a cut: {result}");
                }
                if step==0 && now==2 && [3,4].contains(&remaining) {
                    assert_eq!(result["ok"]["complete"],false);
                    eprintln!("BG round4 {} literal remaining={remaining}: {result}",host.label());
                }
            }
        }
        predicted.sort();predicted.dedup();device.withdraw(&predicted).unwrap();
        let rows=device.query("unreadRows","bob",&json!({}),2).unwrap();
        assert!(rows.data.as_array().unwrap().iter().all(|row|row.field("pending")!=Ok(&Value::Bool(true))));
        host.close(&format!("budget-{step}"),device);
    }
    eprintln!("BG round4 {} device property: seed=20261002, 16 populations, 64 unrestricted + 704 budget observations",host.label());
}
#[test] fn durable_source_rule_budget_memory() { durable_source_rule_budget(&mut Memory::new()); }
#[test] fn durable_source_rule_budget_sqlite() { durable_source_rule_budget(&mut Sqlite::new("durable-budget")); }

#[path = "../../snapback4-core/tests/row_view_witness/admission_cases.rs"] mod admission_cases;
fn maintenance_admission<H: Host>(host: &mut H) {
    let (schema,programs)=admission_cases::base();
    let mut device=host.open("admitted",Some(snapback4_device::device::Backend {generation:1,schema,programs})).unwrap();
    for (n,(name,schema,programs)) in admission_cases::cases().into_iter().enumerate() {
        let backend=snapback4_device::device::Backend {generation:2,schema,programs};
        let error=device.adopt(backend.clone()).unwrap_err();
        assert!(error.to_string().contains("E_VIEW_KEY"),"{} adopt {name}: {error}",host.label());
        assert_eq!(device.backend().generation,1,"refused adoption must preserve the prior backend");
        let error=host.open(&format!("bad-{n}"),Some(backend)).err().expect(&name);
        assert!(error.to_string().contains("E_VIEW_KEY"),"{} {name}: {error}",host.label());
    }
}
#[test] fn maintenance_admission_memory() { maintenance_admission(&mut Memory::new()); }
#[test] fn maintenance_admission_sqlite() { maintenance_admission(&mut Sqlite::new("maintenance-admission")); }
