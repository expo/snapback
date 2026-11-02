use snapback4_core::{Context, Engine, Store, Value, engine::CertifiedAcquisition,
    partition::{AcquisitionGroup, SnapshotCursor}, value::object};
use std::collections::{BTreeMap, BTreeSet};

const SOURCE: &str = r#"
use personas alice, bob
table participants:
  threadId: threads
  personId: principal
  unique threadId, personId
  cap 50 by threadId
  read <- exists participants[.threadId, viewer]
  delete <- .personId = viewer
  sync by .personId
table threads:
  subject: text <=100
  read <- exists participants[.id, viewer]
  sync to participants[.id] by .personId
table messages:
  conversation: threads
  body: text <=100
  at: time
  until: time ?
  opens: time ?
  not before .opens
  expire at .until
  read <- exists participants[.conversation, viewer]
  update <- exists participants[.conversation, viewer]
  retain delivered-history
  sync to participants[.conversation] by .personId last 2 by .at, .id
mutation edit(m: messages, body: text <=100):
  update messages[m] {body: body}
mutation leave(m: participants):
  delete participants[m]
"#;

fn engine(source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::new_at(Store::memory().unwrap(), b.schema, b.programs.into_iter().map(|p| p.program), 100).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn message(group: &str, n: i64, until: Value) -> (String, Value) {
    ("messages".into(), object([("id", id(&format!("{group}{n}"))), ("conversation", id(group)),
        ("body", Value::String(format!("body {n}"))), ("at", Value::Int(1)), ("until", until), ("opens", Value::Null)]))
}
fn fixture() -> Engine {
    let mut e = engine(SOURCE);
    for group in ["a", "b", "c"] {
        e.seed_at([("threads".into(), object([("id", id(group)), ("subject", Value::String(group.into()))])),
            ("participants".into(), object([("id", id(&format!("p{group}"))), ("threadId", id(group)), ("personId", id("alice"))]))], 100).unwrap();
        if group != "c" {
            for n in 1..=4 { e.seed_at([message(group, n, Value::Null)], 100).unwrap(); }
        }
    }
    e
}
fn hint(group: &str) -> AcquisitionGroup {
    AcquisitionGroup { table: "messages".into(), group: vec![serde_json::json!(group)] }
}
fn page(e: &mut Engine, cursor: Option<&str>, hint: Option<&AcquisitionGroup>, skip: &[AcquisitionGroup], limit: usize) -> CertifiedAcquisition {
    let from = e.seq().unwrap();
    e.acquisition_page_at("alice", cursor, hint, skip, from, limit, 100, &[]).unwrap()
}
fn tier2(e: &mut Engine) -> String {
    let mut cursor = None;
    for _ in 0..20 {
        let p = page(e, cursor.as_deref(), None, &[], 1);
        assert_eq!(p.acquire.unit.as_ref().unwrap().tier, 1);
        cursor = p.acquire.cursor;
        if SnapshotCursor::decode(cursor.as_ref().unwrap()).unwrap().tier == 2 { return cursor.unwrap(); }
    }
    panic!("tier 1 never finished")
}

#[test]
fn cold_first_unit_pins_the_head_but_later_and_non_cold_units_keep_from() {
    let mut e = fixture();
    e.mutate("edit", Some("own-edit"), Context::new("alice", BTreeMap::from([
        ("m".into(), id("a4")), ("body".into(), Value::String("new".into()))])).at(100)).unwrap();
    let head = e.seq().unwrap();
    let first = e.acquisition_page_at("alice", None, None, &[], 0, 1, 100, &["own-edit".into()]).unwrap();
    assert!(head > 0 && first.acquire.pinned);
    assert_eq!(first.page.watermark, head);
    assert_eq!(first.page.images_at, Some(head));
    assert!(!first.page.more);
    assert!(first.acknowledged.is_empty());
    assert_eq!(first.committed_above, BTreeMap::from([("own-edit".into(), head)]));
    // Even a continuation at zero must not pin again.
    for from in [0, head - 1, head] {
        let later = e.acquisition_page_at("alice", first.acquire.cursor.as_deref(), None, &[], from, 1, 100, &[]).unwrap();
        assert!(!later.acquire.pinned);
        assert_eq!(later.page.watermark, from);
        assert_eq!(later.page.more, from < head);
    }
    let warm = e.acquisition_page_at("alice", None, None, &[], head - 1, 1, 100, &[]).unwrap();
    assert!(!warm.acquire.pinned);
    assert_eq!(warm.page.watermark, head - 1);
}

#[test]
fn two_tiers_in_schema_order_match_the_quiescent_snapshot_rows_and_floors() {
    for limit in [1, 2, 3, 100] {
        let mut e = fixture();
        let mut expected_rows = BTreeMap::new();
        let mut expected_floors = BTreeSet::new();
        let mut cursor = None;
        loop {
            let p = e.snapshot_acquisition_page_at("alice", cursor.as_deref(), limit, 100).unwrap();
            for event in p.events { expected_rows.insert((event.table, event.id), event.data); }
            for a in p.acquisitions {
                expected_floors.insert(serde_json::to_string(&(a.table, a.index, a.group, a.floor)).unwrap());
            }
            cursor = p.next.map(|c| c.encode());
            if cursor.is_none() { break; }
        }
        let mut rows = BTreeMap::new(); let mut floors = BTreeSet::new();
        let mut whole = vec![]; let mut units = vec![];
        for _ in 0..30 {
            let p = page(&mut e, cursor.as_deref(), None, &[], limit);
            assert_eq!(p.page.watermark, p.page.images_at.unwrap());
            let unit = p.acquire.unit.unwrap();
            units.push((unit.tier, unit.table.clone(), unit.group));
            assert!(p.page.events.iter().all(|event| event.table == unit.table));
            if unit.tier == 1 { assert!(p.page.events.len() <= limit); }
            for event in p.page.events { rows.insert((event.table, event.id), event.data); }
            for a in p.page.acquisitions {
                floors.insert(serde_json::to_string(&(a.table, a.index, a.group, a.floor)).unwrap());
            }
            whole.extend(p.acquire.whole_tables);
            cursor = p.acquire.cursor;
            assert_eq!(cursor.is_none(), p.acquire.exhausted);
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none());
        assert_eq!(rows, expected_rows);
        assert_eq!(floors, expected_floors);
        assert_eq!(whole, ["participants", "threads"]);
        assert!(units.windows(2).all(|w| w[0].0 <= w[1].0));
        assert_eq!(units.iter().filter(|u| u.0 == 2).map(|u| u.2.clone().unwrap()).collect::<Vec<_>>(),
            [hint("a").group, hint("b").group, hint("c").group]);
        assert_eq!(units.first().unwrap().1, "participants", "messages sorts first, but has a horizon");
    }
}

#[test]
fn hints_skip_sets_and_changing_foreground_preserve_walk_progress() {
    let mut e = fixture(); let cursor = tier2(&mut e);
    let foreground = page(&mut e, Some(&cursor), Some(&hint("c")), &[], 1);
    assert_eq!(foreground.acquire.unit.unwrap().group, Some(hint("c").group));
    assert_eq!(foreground.page.acquisitions.last().unwrap().floor.as_deref(), Some("whole"));
    let background = page(&mut e, foreground.acquire.cursor.as_deref(), Some(&hint("b")), &[hint("c")], 1);
    assert!(background.acquire.hint_ignored, "one normal step between priority units");
    assert_eq!(background.acquire.unit.unwrap().group, Some(hint("a").group));
    assert_eq!(background.page.events.len(), 2, "a horizoned unit is atomic even at limit one");
    let last = page(&mut e, background.acquire.cursor.as_deref(), None, &[hint("c")], 1);
    assert_eq!(last.acquire.unit.unwrap().group, Some(hint("b").group));
    assert_eq!(last.acquire.skipped, [hint("c")]);
    assert!(last.acquire.exhausted && last.acquire.cursor.is_none());
}

#[test]
fn leave_between_pages_skips_and_reports_the_cursor_group_and_ignores_its_hint() {
    let mut e = fixture(); let cursor = tier2(&mut e);
    e.mutate("leave", Some("leave-a"), Context::new("alice", BTreeMap::from([("m".into(), id("pa"))])).at(100)).unwrap();
    let p = page(&mut e, Some(&cursor), Some(&hint("a")), &[], 1);
    assert!(p.acquire.hint_ignored);
    assert_eq!(p.acquire.skipped, [hint("a")]);
    assert_eq!(p.acquire.unit.unwrap().group, Some(hint("b").group));
    assert!(p.page.events.iter().all(|event| event.id.starts_with('b')));
}

#[test]
fn pending_write_evidence_matches_stream_at_the_same_event_cut() {
    let mut e = fixture(); let cursor = tier2(&mut e); let from = e.seq().unwrap();
    e.mutate("edit", Some("own-edit"), Context::new("alice", BTreeMap::from([
        ("m".into(), id("a4")), ("body".into(), Value::String("new".into()))])).at(100)).unwrap();
    let pending = vec!["own-edit".into(), "uncommitted".into()];
    let p = e.acquisition_page_at("alice", Some(&cursor), None, &[], from, 1, 100, &pending).unwrap();
    assert_eq!(p.page.watermark, from);
    assert_eq!(p.committed_above, BTreeMap::from([("own-edit".into(), from + 1)]));
    let stream = e.certified_stream_at("alice", from, 1, 100, &pending).unwrap();
    assert_eq!(p.page.images_at, stream.page.images_at);
    let receipts: BTreeMap<_, _> = stream.acknowledged.into_iter().chain(stream.committed_above).collect();
    assert_eq!(p.committed_above, receipts.into_iter().filter(|(_, seq)| *seq > from).collect());
    assert!(p.acknowledged.is_empty());
    let stream = e.certified_stream_at("alice", from - 1, 1, 100, &pending).unwrap();
    assert_eq!(stream.page.watermark, from);
    assert_eq!(stream.committed_above, p.committed_above);
    assert_eq!(stream.acknowledged, p.acknowledged);
    let head = e.seq().unwrap();
    let current = e.acquisition_page_at("alice", Some(&cursor), None, &[], head, 1, 100, &pending).unwrap();
    let current_stream = e.certified_stream_at("alice", head, 1, 100, &pending).unwrap();
    assert_eq!(current.acknowledged, current_stream.acknowledged);
    assert_eq!(current.committed_above, current_stream.committed_above);
    assert_eq!(current.page.images_at, current_stream.page.images_at);
}

#[test]
fn expired_and_unopened_rows_consume_no_horizon_slots_and_empty_group_is_whole() {
    let mut e = fixture();
    e.seed_at([message("a", 9, Value::Int(50))], 1).unwrap();
    let (_, mut future) = message("a", 8, Value::Null);
    if let Value::Row(fields) = &mut future { fields.insert("opens".into(), Value::Int(1000)); }
    e.seed_at([("messages".into(), future)], 100).unwrap();
    let cursor = tier2(&mut e);
    let p = page(&mut e, Some(&cursor), None, &[], 1);
    assert_eq!(p.page.events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["a4", "a3"]);
    let p = page(&mut e, p.acquire.cursor.as_deref(), Some(&hint("c")), &[], 1);
    assert!(p.page.events.is_empty());
    assert_eq!(p.page.acquisitions.last().unwrap().floor.as_deref(), Some("whole"));
}

#[test]
fn legacy_cursor_bytes_and_new_cursor_domains_are_separate() {
    let legacy = SnapshotCursor::default().encode();
    assert_eq!(legacy, "eyJ0YWJsZSI6MCwidGFrZW4iOjAsIndhdGVybWFyayI6MH0");
    let mut e = fixture();
    assert!(e.acquisition_page_at("alice", Some(&legacy), None, &[], 0, 1, 100, &[]).is_err());
    let cursor = tier2(&mut e);
    assert!(e.snapshot_acquisition_page_at("alice", Some(&cursor), 1, 100).is_err());
    assert!(e.acquisition_page_at("alice", Some(&cursor), None, &vec![hint("a"); 33], 0, 1, 100, &[]).is_err());
    assert!(e.acquisition_page_at("alice", None, None, &[], u64::MAX, 1, 100, &[]).is_err());
}

#[test]
fn union_rows_still_walk_but_never_gain_a_whole_table_fact() {
    let mut e = engine("use personas alice, bob\ntable notes:\n  owner: principal\n  other: principal\n  read <- .owner = viewer or .other = viewer\n  sync to .owner or .other\n");
    e.seed_at([("notes".into(), object([("id", id("one")), ("owner", id("alice")), ("other", id("bob"))]))], 100).unwrap();
    let mut cursor = None; let mut rows = BTreeSet::new();
    loop {
        let p = page(&mut e, cursor.as_deref(), None, &[], 1);
        assert!(p.acquire.whole_tables.is_empty());
        rows.extend(p.page.events.into_iter().map(|e| e.id));
        cursor = p.acquire.cursor;
        if cursor.is_none() { break; }
    }
    assert_eq!(rows, BTreeSet::from(["one".into()]));
}

#[test]
fn oversized_atomic_group_refuses_without_a_partial_floor_and_legacy_paging_remains_available() {
    let mut e = engine("table notes:\n  public 'fixture'\n  sync public last 9000 by .id\n");
    e.seed_at((0..8193).map(|n| ("notes".into(), object([("id", id(&format!("n{n:05}")))]))), 100).unwrap();
    let result = e.acquisition_page_at("alice", None, None, &[], 0, 1, 100, &[]);
    assert!(matches!(result, Err(snapback4_core::RuntimeError::Bound { .. })));
    let legacy = e.snapshot_acquisition_page_at("alice", None, 1, 100).unwrap();
    assert_eq!(legacy.events.len(), 1);
    assert!(legacy.next.is_some());
    assert!(legacy.acquisitions.iter().all(|a| a.floor.is_none()));
}
