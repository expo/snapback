mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, wire};
use snapback4_device::device::{Device, StreamPage};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q");
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
