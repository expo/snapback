use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::store::Store;
use snapback4_core::value::{Value, object};
use std::collections::BTreeMap;

const SOURCE: &str = r#"table posts:
  author: principal
  at: time default 0
  selected: bool default true
  score: int default 1
  extra: int default 0
  by byAuthor: author, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only
mutation add(row: id, author: principal, at: time, selected: bool, score: int):
  insert posts { id: row, author, at, selected, score }
mutation edit(row: id, author: principal, at: time, selected: bool, score: int):
  update posts[row] { author, at, selected, score }
mutation remove(row: id):
  delete posts[row]
"#;
const DERIVED: &str = r#"
maintain counts: count posts where .selected by author, day(.at)
  read <- allow
  online only
maintain scores: sum posts of score where .selected by author
  read <- allow
  online only
  by byScore: value, id
query rank():
  return scores last 10 by byScore
query days(author: principal):
  return counts[author] first 50 by byGroup
query scalar(author: principal, at: time):
  return counts[author, day(at)]
query calendar(at: time):
  return { day: day(at), hour: hour(at), bucket: bucket(at, 2m) }
"#;
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn engine(source: &str) -> Engine {
    let b = bound(source); Engine::new(Store::memory().unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn anchored_calendar_keys_match_on_server_memory_and_sqlite() {
    use snapback4_core::wire;
    use snapback4_device::{device::{Backend, Device, StreamPage}, memory::MemoryStore, store::DeviceStore};
    use serde_json::json;
    let source = SOURCE.replace("online only", "sync public") + &DERIVED.replace("  online only\n", "")
        .replace("day(.at)", "day(.at, 8h)").replace("day(at)", "day(at, 8h)")
        .replace("hour(at)", "hour(at, 30m)").replace("bucket(at, 2m)", "bucket(at, 1d, 8h)")
        + "\nmaintain bucketCounts: count posts by author, bucket(.at, 1d, 8h)\n  read <- allow\nquery bucketScalar(author: principal, at: time):\n  return bucketCounts[author, bucket(at, 1d, 8h)]\n";
    let mut e = engine(&source);
    // Epoch, negative time, both I53 endpoints, and the US DST transition
    // dates. These are UTC millisecond values: every day is exactly 24 h.
    let times = [-9_007_199_254_740_991, -57_600_001, -57_600_000, -1, 0, 28_799_999, 28_800_000, 28_800_001,
        115_199_999, 115_200_000, 1_710_057_599_999, 1_710_057_600_000, 1_730_620_799_999, 1_730_620_800_000, 9_007_199_254_740_991];
    for (n, at) in times.into_iter().enumerate() {
        let result = e.mutate("add", None, Context::new("a", args(&format!("r{n}"), "a", at, true, 1))).unwrap();
        assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
    }
    let backend = Backend { generation: e.generation(), schema: e.schema().clone(), programs: e.programs().cloned().collect() };
    let (events, watermark) = e.snapshot_at("a", 1000).unwrap();
    let page: StreamPage = serde_json::from_value(json!({"snapshot":true,"events":events.iter().map(|event| json!({"table":event.table,"kind":event.kind.word(),"id":event.id,"data":event.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>(),"watermark":watermark,"more":false,"generation":e.generation()})).unwrap();
    fn check<S: DeviceStore>(mut device: Device<S>, e: &mut Engine, page: &StreamPage, times: &[i64]) {
        device.apply(page, true).unwrap();
        for &at in times {
            let input = BTreeMap::from([("at".into(), Value::Int(at))]);
            let expected = object([("day", Value::Int((at - 28_800_000).div_euclid(86_400_000))),
                ("hour", Value::Int((at - 1_800_000).div_euclid(3_600_000))), ("bucket", Value::Int((at - 28_800_000).div_euclid(86_400_000)))]);
            let server = e.query("calendar", Context::new("a", input)).unwrap();
            let local = device.query("calendar", "a", &json!({"at":at}), 1000).unwrap();
            assert!(server.complete && local.complete); assert_eq!(server.data, expected); assert_eq!(local.data, expected);
            let expected_count = times.iter().filter(|&&t| (t - 28_800_000).div_euclid(86_400_000) == (at - 28_800_000).div_euclid(86_400_000)).count() as i64;
            let server = e.query("scalar", Context::new("a", BTreeMap::from([("at".into(), Value::Int(at)), ("author".into(), Value::Id("a".into()))]))).unwrap();
            let local = device.query("scalar", "a", &json!({"at":at,"author":"a"}), 1000).unwrap();
            assert!(server.complete && local.complete); assert_eq!(server.data, Value::Int(expected_count)); assert_eq!(local.data, server.data);
            let bucket = device.query("bucketScalar", "a", &json!({"at":at,"author":"a"}), 1000).unwrap();
            assert!(bucket.complete); assert_eq!(bucket.data, server.data);
        }
        for (op, at) in [("add", 28_799_999), ("edit", 28_800_000), ("remove", 28_800_000)] {
            let input = if op == "remove" { json!({"row":"predicted"}) }
                else { json!({"row":"predicted","author":"prediction","at":at,"selected":true,"score":1}) };
            device.predict(op, "a", &input, 1000, vec![], 1).unwrap();
            let server_args = if op == "remove" { BTreeMap::from([("row".into(), Value::Id("predicted".into()))]) }
                else { args("predicted", "prediction", at, true, 1) };
            let result = e.mutate(op, None, Context::new("a", server_args)).unwrap();
            assert!(matches!(result.state, WriteState::Sent { .. }));
            for time in [28_799_999, 28_800_000] {
                let server = e.query("scalar", Context::new("a", BTreeMap::from([("at".into(), Value::Int(time)), ("author".into(), Value::Id("prediction".into()))]))).unwrap();
                let local = device.query("scalar", "a", &json!({"at":time,"author":"prediction"}), 1000).unwrap();
                assert!(server.complete && local.complete); assert_eq!(local.data, server.data);
                assert_eq!(local.data, Value::Int(i64::from(op != "remove" && at == time)));
            }
        }
    }
    check(Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap(), &mut e, &page, &times);
    let dir = std::env::temp_dir().join(format!("sb4-anchor-device-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    check(Device::open(&dir.join("store.sqlite"), Some(backend)).unwrap(), &mut e, &page, &times);
    std::fs::remove_dir_all(dir).unwrap();
    println!("calendar: hosts=3 boundary_inputs={} offset_ms=28800000 period_ms=86400000", times.len());
}

#[test]
fn changing_calendar_offset_rebuilds_keys_without_source_backfill() {
    let source = SOURCE.to_owned() + &DERIVED.replace("day(.at)", "day(.at, 8h)").replace("day(at)", "day(at, 8h)");
    let mut e = engine(&source);
    e.mutate("add", None, Context::new("a", args("r", "a", 28_800_000, true, 1))).unwrap();
    let before = e.store().rows("posts").unwrap();
    let old = e.schema().clone();
    assert_eq!(e.store().rows("counts").unwrap()[0].field("day").unwrap(), &Value::Int(0));
    let next = bound(&source.replace("8h", "9h"));
    assert_ne!(serde_json::to_value(&old).unwrap(), serde_json::to_value(&next.schema).unwrap());
    e.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.store().rows("counts").unwrap()[0].field("day").unwrap(), &Value::Int(-1));
    assert_eq!(e.store().rows("posts").unwrap(), before);
    println!("calendar adoption: offset_before_ms=28800000 offset_after_ms=32400000 source_rows_rewritten=0");
}
fn args(row: &str, author: &str, at: i64, selected: bool, score: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([("row".into(), Value::Id(row.into())), ("author".into(), Value::Id(author.into())), ("at".into(), Value::Int(at)), ("selected".into(), Value::Bool(selected)), ("score".into(), Value::Int(score))])
}
fn fold(e: &Engine) { fold_definition(e, true, 86_400_000, "day"); }
fn fold_definition(e: &Engine, selected: bool, duration: i64, field: &str) {
    let mut counts = BTreeMap::<(String, i64), i64>::new();
    let mut scores = BTreeMap::<String, i64>::new();
    for row in e.store().rows("posts").unwrap() {
        if row.field("selected").unwrap().as_bool().unwrap() != selected { continue; }
        let author = row.field("author").unwrap().as_str().unwrap().to_owned();
        *counts.entry((author.clone(), row.field("at").unwrap().as_int().unwrap().div_euclid(duration))).or_default() += 1;
        *scores.entry(author).or_default() += row.field("score").unwrap().as_int().unwrap();
    }
    let actual: BTreeMap<_, _> = e.store().rows("counts").unwrap().iter().map(|r| ((r.field("author").unwrap().as_str().unwrap().to_owned(), r.field(field).unwrap().as_int().unwrap()), r.field("value").unwrap().as_int().unwrap())).collect();
    assert_eq!(actual, counts);
    let actual: BTreeMap<_, _> = e.store().rows("scores").unwrap().iter().map(|r| (r.field("author").unwrap().as_str().unwrap().to_owned(), r.field("value").unwrap().as_int().unwrap())).collect();
    scores.retain(|_, v| *v != 0); assert_eq!(actual, scores);
}
#[test]
fn contribution_transitions_coalesce_and_match_a_fold() {
    let mut e = engine(&(SOURCE.to_owned() + DERIVED));
    for (n, (op, author, at, selected, score)) in [
        ("add", "a", 0, false, 3), ("edit", "b", -1, false, 8),
        ("edit", "b", -1, true, 8), ("edit", "b", -1, true, 8),
        ("edit", "a", 86_400_000, true, 5), ("edit", "a", 86_400_000, false, 5),
        ("edit", "a", 0, true, 9),
    ].into_iter().enumerate() {
        let out = e.mutate(op, Some(&n.to_string()), Context::new("a", args("r", author, at, selected, score))).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{:?}", out.state);
        if n == 1 || n == 3 { assert_eq!(out.metered.rows_written, 1); }
        fold(&e);
        assert!(e.mutate(op, Some(&n.to_string()), Context::new("a", args("r", author, at, selected, score))).unwrap().replayed);
        fold(&e);
    }
    e.mutate("remove", None, Context::new("a", BTreeMap::from([("row".into(), Value::Id("r".into()))]))).unwrap(); fold(&e);
}
#[test]
fn calendar_is_euclidean_and_rank_matches_an_exact_sort_after_changes() {
    let mut e = engine(&(SOURCE.to_owned() + DERIVED));
    for at in [-9_007_199_254_740_991, -86_400_001, -86_400_000, -3_600_001, -1, 0, 1, 3_600_000, 86_400_000, 1_709_164_800_000, 1_710_057_600_000, 9_007_199_254_740_991] {
        let out = e.query("calendar", Context::new("a", BTreeMap::from([("at".into(), Value::Int(at))]))).unwrap();
        assert_eq!(out.data, object([("day", Value::Int(at.div_euclid(86_400_000))), ("hour", Value::Int(at.div_euclid(3_600_000))), ("bucket", Value::Int(at.div_euclid(120_000)))]));
    }
    for n in 0..15 { let out = e.mutate("add", None, Context::new("a", args(&format!("r{n}"), &format!("a{n}"), 0, true, n / 2 + 1))).unwrap(); assert!(matches!(out.state, WriteState::Sent { .. })); }
    for (n, author, score) in [(14, "a14", 1), (13, "a0", 2), (12, "a12", 0)] {
        let out = e.mutate("edit", None, Context::new("a", args(&format!("r{n}"), author, 0, true, score))).unwrap(); assert!(matches!(out.state, WriteState::Sent { .. }));
        let mut expected = source_scores(&e);
        expected.sort_by(|a,b| b.field("value").unwrap().total_cmp(a.field("value").unwrap()).then_with(|| b.field("id").unwrap().total_cmp(a.field("id").unwrap())));
        expected.truncate(10);
        assert_eq!(e.query("rank", Context::new("a", BTreeMap::new())).unwrap().data.as_array().unwrap(), &expected);
    }
    for row in ["r11", "r10", "r9"] {
        e.mutate("remove", None, Context::new("a", BTreeMap::from([("row".into(), Value::Id(row.into()))]))).unwrap();
        let mut expected = source_scores(&e);
        expected.sort_by(|a,b| b.field("value").unwrap().total_cmp(a.field("value").unwrap()).then_with(|| b.field("id").unwrap().total_cmp(a.field("id").unwrap())));
        expected.truncate(10);
        assert_eq!(e.query("rank", Context::new("a", BTreeMap::new())).unwrap().data.as_array().unwrap(), &expected);
    }
}
#[test]
fn adoption_rebuilds_filters_buckets_and_defaults_without_source_writes() {
    let mut e = engine(SOURCE);
    e.seed([("posts".into(), object([("id", Value::Id("r".into())), ("author", Value::Id("a".into())), ("at", Value::Int(120_001)), ("selected", Value::Bool(true)), ("score", Value::Int(7)), ("extra", Value::Int(0))]))]).unwrap();
    e.seed([("posts".into(), object([("id", Value::Id("excluded".into())), ("author", Value::Id("b".into())), ("at", Value::Int(-120_001)), ("selected", Value::Bool(false)), ("score", Value::Int(3)), ("extra", Value::Int(0))]))]).unwrap();
    let before = e.store().rows("posts").unwrap();
    for (text, selected, duration, field) in [
        (DERIVED.to_owned(), true, 86_400_000, "day"),
        (DERIVED.replace("where .selected", "where not .selected"), false, 86_400_000, "day"),
        (DERIVED.replace("day(.at)", "bucket(.at, 2m)").replace("day(at)", "bucket(at, 2m)"), true, 120_000, "bucket"),
    ] {
        let next = bound(&(SOURCE.to_owned() + &text));
        e.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(before, e.store().rows("posts").unwrap());
        fold_definition(&e, selected, duration, field);
    }
}

#[test]
fn expiring_computed_groups_seek_selected_sources_and_sweep_once() {
    let source = SOURCE.replace("  extra: int default 0", "  extra: int default 0\n  until: time ?\n  by byUntil: until\n  expire at .until");
    let derived = DERIVED.replace("  by byScore: value, id\n", "").replace("  return scores last 10 by byScore", "  return scores first 10 by byGroup");
    let mut e = engine(&(source + &derived));
    let mut seed = Vec::new();
    for n in 0..200 {
        seed.push(("posts".into(), object([("id", Value::Id(format!("r{n}"))), ("author", Value::Id("a".into())), ("at", Value::Int(n * 86_400_000)), ("selected", Value::Bool(n % 2 == 0)), ("score", Value::Int(1)), ("until", Value::Int(1000 + n)), ("extra", Value::Int(0))])));
    }
    e.seed(seed).unwrap();
    assert!(e.schema().tables["posts"].indexes.keys().any(|s| s.starts_with("$contribution:")));
    let a = BTreeMap::from([("author".into(), Value::Id("a".into())), ("at".into(), Value::Int(2 * 86_400_000))]);
    let live = e.query("scalar", Context::new("a", a.clone()).at(999)).unwrap();
    assert_eq!(live.data, Value::Int(1)); assert!(live.metered.examined < 5, "{:?}", live.metered);
    assert_eq!(e.query("scalar", Context::new("a", a.clone()).at(1002)).unwrap().data, Value::Int(0));
    e.sweep_expired(1002, 50).unwrap();
    assert_eq!(e.query("scalar", Context::new("a", a).at(1002)).unwrap().data, Value::Int(0));
}

#[test]
fn overflow_rolls_back_the_source_targets_and_value_index() {
    let mut e = engine(&(SOURCE.to_owned() + DERIVED));
    let top = snapback4_core::value::I53_MAX;
    let sent = e.mutate("add", None, Context::new("a", args("r", "a", 0, true, top))).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }));
    let before = e.store().rows("posts").unwrap();
    let totals = e.store().rows("counts").unwrap();
    let ranked = e.query("rank", Context::new("a", BTreeMap::new())).unwrap().data;
    let failed = e.mutate("add", None, Context::new("a", args("overflow", "a", 0, true, 1))).unwrap();
    assert!(matches!(failed.state, WriteState::Failed { .. }), "{failed:?}");
    assert_eq!(e.store().rows("posts").unwrap(), before);
    assert_eq!(e.store().rows("counts").unwrap(), totals);
    assert_eq!(e.query("rank", Context::new("a", BTreeMap::new())).unwrap().data, ranked);
}

const CHIPS: &str = r#"
table members:
  room: id
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipalRoom: principal, room, id
  cap 50 by room
  read <- allow
  sync
table reactions:
  room: id
  message: id
  principal: principal
  emoji: text <=20
  unique byReaction: room, message, principal
  by byMessage: room, message, id
  cap 50 by room, message
  read <- exists members[.room, viewer]
  insert <- .principal = viewer and exists members[.room, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
maintain chips: count reactions by room, message, emoji
  read <- exists members[.room, viewer]
mutation react(room: id, message: id, emoji: text <=20):
  upsert reactions[room, message, viewer] { emoji }
mutation unreact(room: id, message: id):
  delete reactions[room, message, viewer]
query chipsFor(room: id, message: id, c: cursor ?):
  return chips[room, message] after c first 50 by byGroup { emoji, count: .value }
"#;
#[test]
fn chips_transition_cap_cursor_and_outsider() {
    for capped in [true, false] {
        let source = if capped { CHIPS.to_owned() } else { CHIPS.replace("  cap 50 by room, message\n", "") };
        let mut e = engine(&source);
        e.seed((0..51).map(|n| ("members".into(), object([("id", Value::Id(format!("m{n}"))), ("room", Value::Id("r".into())), ("principal", Value::Id(format!("p{n}")))]))).take(50)).unwrap();
        let args = |emoji: &str| BTreeMap::from([("room".into(), Value::Id("r".into())), ("message".into(), Value::Id("msg".into())), ("emoji".into(), Value::String(emoji.into()))]);
        for (p, emoji) in [("p0", "heart"), ("p1", "heart"), ("p2", "laugh")] {
            assert!(matches!(e.mutate("react", None, Context::new(p, args(emoji))).unwrap().state, WriteState::Sent { .. }));
        }
        let query_args = BTreeMap::from([("room".into(), Value::Id("r".into())), ("message".into(), Value::Id("msg".into())), ("c".into(), Value::Null)]);
        let read = e.query("chipsFor", Context::new("p0", query_args.clone())).unwrap();
        assert_eq!(read.data.as_array().unwrap().len(), 2);
        assert_eq!(read.data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(2));
        e.mutate("react", None, Context::new("p1", args("laugh"))).unwrap();
        for p in ["p0", "p1", "p2"] {
            e.mutate("unreact", None, Context::new(p, BTreeMap::from([("room".into(), Value::Id("r".into())), ("message".into(), Value::Id("msg".into()))]))).unwrap();
        }
        assert!(e.store().rows("chips").unwrap().is_empty());
        // System seeding tests the cap independently of membership authority.
        let seeds = |range: std::ops::Range<i32>| range.map(|n| ("reactions".into(), object([("id", Value::Id(format!("s{n}"))), ("room", Value::Id("r".into())), ("message", Value::Id("msg".into())), ("principal", Value::Id(format!("p{n}"))), ("emoji", Value::String(format!("e{n:02}")))])));
        e.seed(seeds(0..50)).unwrap();
        assert_eq!(e.seed(seeds(50..51)).is_err(), capped);
        let read = e.query("chipsFor", Context::new("p0", query_args.clone())).unwrap();
        assert_eq!(read.data.as_array().unwrap().len(), 50);
        assert_eq!(read.next.is_some(), !capped); assert!(read.complete);
        if let Some(next) = read.next {
            let mut a = query_args.clone(); a.insert("c".into(), Value::String(next));
            let last = e.query("chipsFor", Context::new("p0", a)).unwrap();
            assert_eq!(last.data.as_array().unwrap().len(), 1); assert!(last.complete);
        }
        let denied = e.query("chipsFor", Context::new("outsider", query_args)).unwrap();
        assert!(denied.data.as_array().unwrap().is_empty()); assert!(denied.complete);
        assert!(!e.snapshot("outsider").unwrap().0.iter().any(|event| event.table == "chips"));
    }
}

#[path = "common/write_observation.rs"]
mod observation;

fn hidden_world(selected: bool, present: bool, denied: bool, expiring: bool) -> Engine {
    hidden_world_until(selected, present, denied, expiring.then_some(2000))
}
fn hidden_world_until(selected: bool, present: bool, denied: bool, until: Option<i64>) -> Engine {
    let expiring = until.is_some();
    let source = SOURCE.replace("  read <- allow", "  read <- .author = viewer");
    let derived = DERIVED.replace("  read <- allow", "  read <- deny");
    let source = if denied { source.replace("  update <- allow", "  update <- deny").replace("  delete <- allow", "  delete <- deny") } else { source };
    let source = if expiring { source.replace("  extra: int default 0", "  extra: int default 0\n  until: time default 2000\n  by byUntil: until\n  expire at .until") } else { source };
    let source = if let Some(until) = until { source.replace("time default 2000", &format!("time default {until}")) } else { source };
    let derived = if expiring { derived.replace("  by byScore: value, id\n", "").replace("last 10 by byScore", "first 10 by byGroup") } else { derived };
    let text = source + &derived + "\nmutation blind():\n  update posts['hidden'] {at: 86400000}\n  return null\nmutation blindDelete():\n  delete posts['hidden']\n  return null\nquery hidden():\n  return counts['owner', 0]\n";
    let mut e = engine(&text);
    // Every world has exactly one seed commit, so its watermark is comparable.
    e.seed([("posts".into(), object([("id", Value::Id(if present { "hidden" } else { "other" }.into())), ("author", Value::Id("owner".into())), ("at", Value::Int(0)), ("selected", Value::Bool(selected)), ("score", Value::Int(1)), ("extra", Value::Int(0))]))]).unwrap();
    e
}
#[test]
fn hidden_filter_work_has_one_wire_and_meter_observation() {
    let run = |selected, present, denied, expiring, ceilings| {
        let mut e = hidden_world(selected, present, denied, expiring); e.set_ceilings(ceilings);
        let before = serde_json::to_value(e.query("hidden", Context::new("writer", BTreeMap::new()).at(1000))).unwrap();
        let observed = observation::observe(&mut e, "blind", "writer", serde_json::json!({}), "blind", ("hidden", serde_json::json!({}))).1;
        let after = serde_json::to_value(e.query("hidden", Context::new("writer", BTreeMap::new()).at(1000))).unwrap();
        (observed, serde_json::json!({"before":before, "after":after}))
    };
    let full = snapback4_core::Ceilings::default();
    let a = run(false, true, false, false, full);
    let b = run(true, true, false, false, full);
    let same = |a: &(observation::Observation, serde_json::Value), b: &(observation::Observation, serde_json::Value)| {
        assert_eq!(a.1, b.1, "server query data, completeness, cursor, dependencies, expiry and seven meters");
        let (a, b) = (&a.0, &b.0);
        assert_eq!(a.first_http_body, b.first_http_body);
        assert_eq!(a.receipt, b.receipt); assert_eq!(a.retry_http_body, b.retry_http_body);
        assert_eq!(a.meter, b.meter, "filter-dependent physical work must not disclose hidden contributions");
        assert_eq!(a.effects, b.effects);
        assert_eq!(a.stream, b.stream); assert_eq!(a.snapshot, b.snapshot); assert_eq!(a.devices, b.devices);
    };
    same(&a, &b);
    let used = [a.0.meter.steps, a.0.meter.examined, a.0.meter.index_entries, a.0.meter.rows_written,
        a.0.meter.heap_bytes, a.0.meter.rule_probes, a.0.meter.output_bytes];
    for kind in 0..7 {
        let mut limits = vec![0, 1, 4, 32, used[kind].saturating_sub(1), used[kind], used[kind] + 1];
        if kind == 4 { limits.extend([16_383, 16_384, 65_535, 65_536]); }
        limits.sort_unstable(); limits.dedup();
        for limit in limits {
            let mut c = full;
            match kind { 0 => c.steps = limit, 1 => c.examined = limit, 2 => c.index_entries = limit, 3 => c.rows_written = limit, 4 => c.heap_bytes = limit, 5 => c.rule_probes = limit, _ => c.output_bytes = limit }
            for expiring in [false, true] {
                same(&run(false, true, false, expiring, c), &run(true, true, false, expiring, c));
                let absent = run(false, false, true, expiring, c);
                same(&absent, &run(false, true, true, expiring, c));
                same(&absent, &run(true, true, true, expiring, c));
            }
        }
    }
}

#[test]
fn adoption_assesses_final_filtered_sums_and_default_changes_without_rewriting_sources() {
    let mut e = engine(SOURCE);
    let max = snapback4_core::value::I53_MAX;
    for (row, score, selected) in [("a", max, true), ("b", 1, false)] {
        e.mutate("add", None, Context::new("a", args(row, "a", 0, selected, score))).unwrap();
    }
    let initial = bound(&(SOURCE.to_owned() + DERIVED));
    e.adopt(initial.schema, initial.programs.into_iter().map(|p| p.program)).unwrap();
    let next = bound(&(SOURCE.to_owned() + &DERIVED.replace("where .selected", "where true")));
    let assessed = e.store_mut().successor(&next.schema).unwrap();
    let refusal = assessed.iter().find(|s| s.change == snapback4_core::successor::Change::Narrowing).expect("read-only assessment catches the final sum");
    assert!(refusal.path.starts_with("maintains["));
    let generation = e.generation();
    let source_rows = e.store().rows("posts").unwrap();
    let refused = e.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap_err();
    assert!(refused.to_string().contains("E_ADOPT"), "{refused}");
    assert_eq!(e.generation(), generation); assert_eq!(e.store().rows("posts").unwrap(), source_rows);

    let base = SOURCE.replace("  selected: bool default true\n", "").replace("  score: int default 1\n", "");
    // Keep only the table for old raw images that predate defaults.
    let base = base.split("mutation add").next().unwrap();
    let mut old = engine(base);
    old.seed([("posts".into(), object([("id", Value::Id("old".into())), ("author", Value::Id("a".into())), ("at", Value::Int(-1)), ("extra", Value::Int(0))]))]).unwrap();
    let physical = old.store().rows("posts").unwrap();
    for (default, expected) in [("true", 1), ("false", 0)] {
        let next = bound(&(SOURCE.replace("selected: bool default true", &format!("selected: bool default {default}")) + DERIVED));
        old.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(old.store().rows("posts").unwrap(), physical);
        let a = BTreeMap::from([("author".into(), Value::Id("a".into())), ("at".into(), Value::Int(-1))]);
        assert_eq!(old.query("scalar", Context::new("a", a)).unwrap().data, Value::Int(expected));
    }
}

#[test]
fn filtered_computed_zero_sum_candidate_survives_independent_expiry() {
    let source = SOURCE.replace("  extra: int default 0", "  extra: int default 0\n  until: time ?\n  by byUntil: until\n  expire at .until");
    let derived = "\nmaintain totals: sum posts of score where .selected by author, day(.at)\n  read <- allow\n  online only\nquery total():\n  return totals['a', 0]\nquery page():\n  return totals['a'] first 10 by byGroup\n";
    let mut e = engine(&(source + derived));
    e.seed([("positive", 1, 1500), ("negative", -1, 1000)].map(|(name, score, until)| ("posts".into(), object([
        ("id", Value::Id(name.into())), ("author", Value::Id("a".into())), ("at", Value::Int(0)),
        ("selected", Value::Bool(true)), ("score", Value::Int(score)), ("until", Value::Int(until)), ("extra", Value::Int(0)),
    ])))).unwrap();
    assert_eq!(e.store().rows("totals").unwrap().len(), 1);
    for (now, expected) in [(999, 0), (1000, 1), (1499, 1), (1500, 0)] {
        let q = e.query("total", Context::new("a", BTreeMap::new()).at(now)).unwrap();
        assert_eq!(q.data, Value::Int(expected)); assert!(q.complete);
    }
    e.sweep_expired(1000, 50).unwrap();
    assert_eq!(e.query("total", Context::new("a", BTreeMap::new()).at(1000)).unwrap().data, Value::Int(1));
    e.sweep_expired(1500, 50).unwrap();
    assert!(e.store().rows("totals").unwrap().is_empty());
}

#[test]
fn scoped_value_order_and_seven_day_scalars_match_the_oracle() {
    let extra = "\nmaintain scoped: sum posts of score where .selected by author, day(.at)\n  read <- allow\n  online only\n  by byCount: author, value, id\nquery scoped(author: principal):\n  return scoped[author] last 10 by byCount\n";
    let mut e = engine(&(SOURCE.to_owned() + DERIVED + extra));
    for author in ["a", "b"] {
        for n in 0..15 {
            e.mutate("add", None, Context::new("a", args(&format!("{author}{n}"), author, n * 86_400_000, true, n / 2 + 1))).unwrap();
        }
    }
    for (row, author, at, selected, score) in [("a14", "a", 14 * 86_400_000, true, -100), ("a13", "b", 0, true, 10), ("a12", "a", 12 * 86_400_000, false, 1)] {
        e.mutate("edit", None, Context::new("a", args(row, author, at, selected, score))).unwrap();
        for author in ["a", "b"] {
            let mut sums = BTreeMap::<i64,i128>::new();
            for row in e.store().rows("posts").unwrap() {
                if row.field("author").unwrap() == &Value::Id(author.into()) && row.field("selected").unwrap().as_bool().unwrap() {
                    *sums.entry(row.field("at").unwrap().as_int().unwrap().div_euclid(86_400_000)).or_default() += i128::from(row.field("score").unwrap().as_int().unwrap());
                }
            }
            let mut expected: Vec<_> = sums.into_iter().filter(|(_,value)|*value!=0).map(|(day,value)|object([
                ("id",Value::Id(snapback4_core::schema::maintained_id(&[Value::Id(author.into()),Value::Int(day)]))),
                ("author",Value::Id(author.into())),("day",Value::Int(day)),("value",Value::Int(value.try_into().unwrap()))
            ])).collect();
            expected.sort_by(|a,b| b.field("value").unwrap().total_cmp(a.field("value").unwrap()).then_with(|| b.field("id").unwrap().total_cmp(a.field("id").unwrap())));
            expected.truncate(10);
            let read = e.query("scoped", Context::new("a", BTreeMap::from([("author".into(), Value::Id(author.into()))]))).unwrap();
            assert_eq!(read.data.as_array().unwrap(), &expected);
        }
    }
    let seven: Vec<_> = (10..17).map(|day| e.query("scalar", Context::new("a", BTreeMap::from([
        ("author".into(), Value::Id("a".into())), ("at".into(), Value::Int(day * 86_400_000)),
    ]))).unwrap().data).collect();
    assert_eq!(seven, [1, 1, 0, 0, 1, 0, 0].map(Value::Int));
}

fn source_scores(e: &Engine) -> Vec<Value> {
    let mut sums = BTreeMap::<String, i128>::new();
    for row in e.store().rows("posts").unwrap() {
        if row.field("selected").unwrap().as_bool().unwrap() {
            *sums.entry(row.field("author").unwrap().as_str().unwrap().into()).or_default() += i128::from(row.field("score").unwrap().as_int().unwrap());
        }
    }
    sums.into_iter().filter(|(_,value)| *value != 0).map(|(author,value)| object([
        ("id",Value::Id(snapback4_core::schema::maintained_id(&[Value::Id(author.clone())]))), ("author",Value::Id(author)), ("value",Value::Int(value.try_into().unwrap()))
    ])).collect()
}

#[test]
fn hidden_filter_work_delete_has_one_observation_per_target_outcome() {
    let run = |selected, present, denied, expiry, ceilings| {
        let mut e = hidden_world_until(selected, present, denied, match expiry { 0 => None, 1 => Some(2000), _ => Some(500) });
        e.set_ceilings(ceilings);
        let before = serde_json::to_value(e.query("hidden", Context::new("writer", BTreeMap::new()).at(1000))).unwrap();
        let (out, observed) = observation::observe(&mut e, "blindDelete", "writer", serde_json::json!({}), "delete", ("hidden", serde_json::json!({})));
        let after = serde_json::to_value(e.query("hidden", Context::new("writer", BTreeMap::new()).at(1000))).unwrap();
        if matches!(out.state, WriteState::Sent { .. }) {
            assert!(present && !denied && expiry != 2);
            assert!(e.store().rows("posts").unwrap().is_empty());
            assert!(e.store().rows("counts").unwrap().is_empty());
            assert!(e.store().rows("scores").unwrap().is_empty());
        } else { observed.assert_unchanged(); }
        (observed, serde_json::json!({"before": before, "after": after}))
    };
    let same = |a: &(observation::Observation, serde_json::Value), b: &(observation::Observation, serde_json::Value)| {
        assert_eq!(a.1, b.1, "server query: data, completeness, cursor, dependencies, expiry, meters");
        let (a, b) = (&a.0, &b.0);
        assert_eq!(a.first_http_body, b.first_http_body, "first reply");
        assert_eq!(a.receipt, b.receipt); assert_eq!(a.retry_http_body, b.retry_http_body);
        assert_eq!(a.meter, b.meter, "hidden delete's filter-dependent work");
        assert_eq!(a.effects, b.effects); assert_eq!(a.stream, b.stream);
        assert_eq!(a.snapshot, b.snapshot); assert_eq!(a.devices, b.devices);
    };
    let full = snapback4_core::Ceilings::default();
    let ceiling = |kind, limit| {
        let mut c = full;
        match kind { 0 => c.steps = limit, 1 => c.examined = limit, 2 => c.index_entries = limit, 3 => c.rows_written = limit, 4 => c.heap_bytes = limit, 5 => c.rule_probes = limit, _ => c.output_bytes = limit }
        c
    };
    let mut pairs = 0;
    for expiry in 0..3 {
        let a = run(false, true, false, expiry, full);
        let b = run(true, true, false, expiry, full);
        println!("hidden delete expiry={expiry}: excluded={:?}; selected={:?}", a.0.meter, b.0.meter);
        same(&a, &b); pairs += 1;
        for (present, denied) in [(true, false), (false, false), (true, true), (false, true)] {
            let a = run(false, present, denied, expiry, full);
            let b = run(true, present, denied, expiry, full);
            same(&a, &b); pairs += 1;
            let body = a.0.body();
            if !present || expiry == 2 { assert_eq!(body["why"]["code"], "NOT_FOUND"); }
            else if denied { assert_eq!(body["why"]["code"], "E_RULE"); }
            else { assert_eq!(body["state"], "sent"); }
        }
        let used = a.0.meter;
        let mut thresholds = Vec::new();
        for (kind, amount) in [used.steps, used.examined, used.index_entries, used.rows_written, used.heap_bytes, used.rule_probes, used.output_bytes].into_iter().enumerate() {
            // Locate the actual admission boundary too: transient reserved heap is released
            // before the final meter, so that meter alone cannot identify its ceiling.
            let mut lo = 0;
            let mut hi = [full.steps, full.examined, full.index_entries, full.rows_written, full.heap_bytes, full.rule_probes, full.output_bytes][kind];
            while lo < hi {
                let limit = lo + (hi - lo) / 2;
                let mut e = hidden_world_until(true, true, false, match expiry { 0 => None, 1 => Some(2000), _ => Some(500) });
                e.set_ceilings(ceiling(kind, limit));
                let out = e.mutate("blindDelete", None, Context::new("writer", BTreeMap::new()).at(1000)).unwrap();
                if matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND") { lo = limit + 1; }
                else { hi = limit; }
            }
            thresholds.push(lo);
            let mut limits = vec![0, 1, 4, 32, amount.saturating_sub(1), amount, amount + 1, lo.saturating_sub(1), lo, lo + 1];
            if kind == 4 { limits.extend([16_383, 16_384, 65_535, 65_536]); }
            limits.sort_unstable(); limits.dedup();
            for limit in limits {
                let c = ceiling(kind, limit);
                for (present, denied) in [(true, false), (false, false), (true, true), (false, true)] {
                    same(&run(false, present, denied, expiry, c), &run(true, present, denied, expiry, c)); pairs += 1;
                }
            }
        }
        println!("hidden delete expiry={expiry}: minimum non-bound ceilings [steps, examined, indexes, rows, heap, probes, output]={thresholds:?}");
        // Below the common reservation, even the existing delete outcome distinctions
        // have not been inspected yet: absent, denied and admitted targets all E_BOUND.
        let a = run(false, false, false, expiry, ceiling(0, 10));
        assert_eq!(a.0.body()["why"]["code"], "E_BOUND");
        for selected in [false, true] {
            for (present, denied) in [(true, false), (false, false), (true, true), (false, true)] {
                same(&a, &run(selected, present, denied, expiry, ceiling(0, 10))); pairs += 1;
            }
        }
    }
    println!("hidden delete: {pairs} complete-observation pairs, seven ceilings, three expiry states, two device stores");
}

#[test]
fn hidden_filtered_keyed_overflow_residual_is_value_free_and_atomic() {
    let text = SOURCE.replace("  read <- allow", "  read <- .author = viewer") +
        "\nmaintain totals: sum posts of score where .selected by author, day(.at)\n  read <- deny\n  online only\nmutation blind():\n  update posts['hidden'] {score: 2}\n  return null\nquery hidden():\n  return totals['owner', 0]\n";
    let run = |selected| {
        let mut e = engine(&text);
        e.seed([("base", true, snapback4_core::value::I53_MAX - 1), ("hidden", selected, 1)].map(|(id, selected, score)|
            ("posts".into(), object([("id", Value::Id(id.into())), ("author", Value::Id("owner".into())), ("at", Value::Int(0)), ("selected", Value::Bool(selected)), ("score", Value::Int(score)), ("extra", Value::Int(0))])))).unwrap();
        observation::observe(&mut e, "blind", "writer", serde_json::json!({}), "overflow", ("hidden", serde_json::json!({})))
    };
    let (a, excluded) = run(false);
    let (b, selected) = run(true);
    println!("hidden overflow: excluded={}; selected={}", excluded.body(), selected.body());
    // @ref LLP 3000.007#20.9 — overflow is a documented constraint-outcome residual, even with both source and aggregate hidden.
    assert!(matches!(a.state, WriteState::Sent { .. }));
    let WriteState::Failed { why, current } = b.state else { panic!("selected contribution must overflow") };
    assert_eq!(why.code, "E_OVERFLOW");
    assert_eq!(why.message, "E_OVERFLOW: maintain totals.value overflowed");
    assert!(current.is_none());
    selected.assert_unchanged();
    assert_eq!(excluded.committed["posts"].iter().find(|row| row.field("id").unwrap() == &Value::Id("hidden".into())).unwrap().field("score").unwrap(), &Value::Int(2));
    assert_eq!(excluded.before["totals"], excluded.committed["totals"]);
    let retry: serde_json::Value = serde_json::from_slice(&selected.retry_http_body).unwrap();
    assert_eq!(retry["why"]["code"], "E_OVERFLOW");
    assert_eq!(retry["why"]["message"], "the program refused with E_OVERFLOW");
}
