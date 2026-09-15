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
fn args(row: &str, author: &str, at: i64, selected: bool, score: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([("row".into(), Value::Id(row.into())), ("author".into(), Value::Id(author.into())), ("at".into(), Value::Int(at)), ("selected".into(), Value::Bool(selected)), ("score".into(), Value::Int(score))])
}
fn fold(e: &Engine) {
    let mut counts = BTreeMap::<(String, i64), i64>::new();
    let mut scores = BTreeMap::<String, i64>::new();
    for row in e.store().rows("posts").unwrap() {
        if !row.field("selected").unwrap().as_bool().unwrap() { continue; }
        let author = row.field("author").unwrap().as_str().unwrap().to_owned();
        *counts.entry((author.clone(), row.field("at").unwrap().as_int().unwrap().div_euclid(86_400_000))).or_default() += 1;
        *scores.entry(author).or_default() += row.field("score").unwrap().as_int().unwrap();
    }
    let actual: BTreeMap<_, _> = e.store().rows("counts").unwrap().iter().map(|r| ((r.field("author").unwrap().as_str().unwrap().to_owned(), r.field("day").unwrap().as_int().unwrap()), r.field("value").unwrap().as_int().unwrap())).collect();
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
    e.seed([("posts".into(), object([("id", Value::Id("r".into())), ("author", Value::Id("a".into())), ("at", Value::Int(-1)), ("selected", Value::Bool(true)), ("score", Value::Int(7)), ("extra", Value::Int(0))]))]).unwrap();
    let before = e.store().rows("posts").unwrap();
    for text in [DERIVED.to_owned(), DERIVED.replace("where .selected", "where not .selected"), DERIVED.replace("day(.at)", "bucket(.at, 2m)").replace("day(at)", "bucket(at, 2m)")] {
        let next = bound(&(SOURCE.to_owned() + &text));
        e.adopt(next.schema, next.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(before, e.store().rows("posts").unwrap());
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
    let source = SOURCE.replace("  read <- allow", "  read <- .author = viewer");
    let derived = DERIVED.replace("  read <- allow", "  read <- deny");
    let source = if denied { source.replace("  update <- allow", "  update <- deny") } else { source };
    let source = if expiring { source.replace("  extra: int default 0", "  extra: int default 0\n  until: time default 2000\n  by byUntil: until\n  expire at .until") } else { source };
    let derived = if expiring { derived.replace("  by byScore: value, id\n", "").replace("last 10 by byScore", "first 10 by byGroup") } else { derived };
    let text = source + &derived + "\nmutation blind():\n  update posts['hidden'] {at: 86400000}\n  return null\nquery hidden():\n  return counts['owner', 0]\n";
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
