//! Deterministic state-machine comparison with an independent, full model.
use super::*;
use crate::{Context, Engine, Schema, Store, Ceilings, meter::{Meter, Cut}};
use std::collections::BTreeMap;

const FIXTURE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q");
fn compile(gated: bool) -> Schema {
    // Clique's predicate, plus the corpus language card's messageCounts and
    // guide maintains / fixtures/ag/reactions.q's reactionCounts.
    let source = FIXTURE.replace("readUpTo", "seenOrdinal") + r#"
table access:
  conversationId: conversations
  principal: principal
  unique conversationId, principal
  public
view messageCounts: count messages by .conversationId
  read <- allow
table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, principal
  until: time ?
  expire at .until
  public
view reactionCounts: count reactions by .message, .emoji
"#;
    let source = if gated { source.replace("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- exists access[.conversationId, viewer]\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to access[.conversationId]").replace("view messageCounts: count messages by .conversationId\n  read <- allow", "view messageCounts: count messages by .conversationId\n  read <- exists access[.conversationId, viewer]") } else { source };
    let b = snapback4_lang::compile(&[("certification.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap()
}
fn id(v: &str) -> Value { Value::Id(v.into()) }
fn field(row: &Value, name: &str) -> i64 { row.field(name).unwrap().as_int().unwrap() }
fn member(n: usize, seen: i64, joined: i64) -> Value {
    object([("id", id(&format!("u{n}"))), ("conversationId", id("room")),
        ("principal", id(&format!("p{n}"))), ("seenOrdinal", Value::Int(seen)), ("joinedAt", Value::Int(joined))])
}
fn message(n: usize, ordinal: i64, sender: usize, tombstone: bool, deadline: Option<i64>) -> Value {
    object([("id", id(&format!("m{n}"))), ("conversationId", id("room")),
        ("ordinal", Value::Int(ordinal)), ("senderId", id(&format!("p{sender}"))),
        ("tombstone", Value::Bool(tombstone)), ("until", deadline.map(Value::Int).unwrap_or(Value::Null))])
}
fn remove(e: &mut Engine, table: &str, id: &str, now: i64) {
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    if tx.get(table, id).unwrap().as_ref().is_none_or(|row| schema.tables[table].expired(row, now)) { return; }
    let mut r = Runner::new(&tx, &schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    r.delete(table, id).unwrap();
    drop(r); tx.commit().unwrap();
}
fn live(row: &Value, now: i64) -> bool {
    row.field("until").ok().and_then(|v| v.as_int().ok()).is_none_or(|t| t > now)
}
fn random(state: &mut u64) -> u64 {
    *state ^= *state << 13; *state ^= *state >> 7; *state ^= *state << 17; *state
}

#[test]
fn incremental_certification_matches_naive_after_every_random_step() {
    const SEEDS: [u64; 8] = [1, 7, 28, 20261002, 0xbadcafe, 0xdeadbeef, 0x12345678, 0x5eed];
    let mut assertions = 0;
    let mut operations = [0usize; 10];
    for seed in SEEDS {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target")
            .join(format!("bg-certification-{}-{seed}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut e = Engine::new(Store::open(&path).unwrap(), compile(false), vec![]).unwrap();
        let mut messages = BTreeMap::<usize, Value>::new();
        let mut members = BTreeMap::<usize, Value>::new();
        let mut reactions = BTreeMap::<usize, Value>::new();
        let mut state = seed;
        let mut now = 1;
        let mut gated = false;
        let mut granted = true;
        e.seed_at([("access".into(), object([("id", id("grant")), ("conversationId", id("room")), ("principal", id("reader"))]))], now).unwrap();
        for step in 0..300 {
            let n = (random(&mut state) % 24) as usize;
            let u = (random(&mut state) % 8) as usize;
            let operation = (random(&mut state) % 10) as usize;
            operations[operation] += 1;
            match operation {
                0..=2 => {
                    let ordinal = (random(&mut state) % 50) as i64;
                    let deadline = (random(&mut state) % 3 != 0).then(|| now + (random(&mut state) % 20) as i64);
                    let row = message(n, ordinal, u, random(&mut state) % 5 == 0, deadline);
                    // Imported source updates use the ordinary transactional
                    // contribution path, including retirement of born-expired rows.
                    e.seed_at([("messages".into(), row.clone())], now).unwrap();
                    if live(&row, now) { messages.insert(n, row); } else { messages.remove(&n); }
                }
                3 => {
                    remove(&mut e, "messages", &format!("m{n}"), now);
                    messages.remove(&n);
                }
                4 => {
                    let row = member(u, (random(&mut state) % 50) as i64, (random(&mut state) % 15) as i64);
                    e.seed_at([("members".into(), row.clone())], now).unwrap(); members.insert(u, row);
                }
                5 => { remove(&mut e, "members", &format!("u{u}"), now); members.remove(&u); }
                6 => { now += (random(&mut state) % 12) as i64; }
                7 => {
                    // A real close/reopen, with durable counts and certificates.
                    let schema = e.schema().clone(); drop(e);
                    e = Engine::new(Store::open(&path).unwrap(), schema, vec![]).unwrap();
                }
                8 => {
                    if random(&mut state) % 2 == 0 {
                        // Rule definition changes are independent of the
                        // maintained predicate; fresh authority must still win.
                        gated = !gated;
                        let schema = compile(gated);
                        e.adopt_at(schema, vec![], now).unwrap();
                    } else {
                        granted = !granted;
                        if granted { e.seed_at([("access".into(), object([("id", id("grant")), ("conversationId", id("room")), ("principal", id("reader"))]))], now).unwrap(); }
                        else { remove(&mut e, "access", "grant", now); }
                    }
                }
                _ => {
                    if messages.get(&n).is_some_and(|m| live(m, now)) {
                        let row = object([("id", id(&format!("r{n}"))), ("message", id(&format!("m{n}"))), ("principal", id("reader")), ("emoji", Value::String(if u % 2 == 0 { "a" } else { "b" }.into())), ("until", Value::Int(now + 10))]);
                        e.seed_at([("reactions".into(), row.clone())], now).unwrap(); reactions.insert(n, row);
                    } else { remove(&mut e, "reactions", &format!("r{n}"), now); reactions.remove(&n); }
                }
            }
            let schema = e.schema().clone();
            let views = e.store().rows("unread").unwrap();
            assert_eq!(views.len(), members.len(), "all member counts exist: seed={seed} step={step}");
            let tx = e.store_mut().transaction().unwrap();
            let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
            let actual = r.live_aggregate_batch("unread", &views).unwrap();
            let mut naive = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
            assert_eq!(actual, naive.live_acquisition_batch("unread", &views).unwrap(), "full recount seed={seed} step={step}");
            for (view, actual) in views.iter().zip(actual) {
                let name = view.field("member").unwrap().as_str().unwrap();
                let n: usize = name[1..].parse().unwrap();
                if gated && !granted { assert!(actual.is_none(), "seed={seed} step={step}"); continue; }
                let u = &members[&n];
                let expected = messages.values().filter(|m| live(m, now)
                    && field(m, "ordinal") > field(u, "seenOrdinal")
                    && field(m, "ordinal") > field(u, "joinedAt")
                    && m.field("senderId").unwrap() != u.field("principal").unwrap()
                    && m.field("tombstone").unwrap() == &Value::Bool(false)).count();
                let actual = actual.unwrap();
                assert_eq!(actual.field("value").unwrap(), &Value::Int(expected as i64), "seed={seed} step={step} member={name} now={now}");
                assert_eq!(actual.field("recountPending").unwrap(), &Value::Bool(false));
                assertions += 1;
            }
            // Ordinary aggregate views remain governed by their live recount.
            // Check every materialized group against the separate model too.
            for name in ["messageCounts", "reactionCounts"] {
                let groups = tx.scan(name, "byId", &[], &Bounds::default(), Dir::Asc, 100).unwrap();
                if name == "messageCounts" && messages.values().any(|m| live(m, now)) {
                    assert_eq!(groups.len(), 1, "live message group exists: seed={seed} step={step}");
                }
                if name == "reactionCounts" {
                    for reaction in reactions.values().filter(|row| live(row, now)) {
                        assert!(groups.iter().any(|(row, _)| row.field("message").ok() == reaction.field("message").ok()
                            && row.field("emoji").ok() == reaction.field("emoji").ok()), "live reaction group exists: seed={seed} step={step}");
                    }
                }
                for (row, _) in groups {
                    let expected = if name == "messageCounts" { messages.values().filter(|m| live(m, now)).count() } else {
                        reactions.values().filter(|reaction| live(reaction, now)
                            && reaction.field("message").ok() == row.field("message").ok()
                            && reaction.field("emoji").ok() == row.field("emoji").ok()).count()
                    };
                    // Ordinary aggregates enter their internal recount only
                    // after the caller has authorized the aggregate key.
                    let actual = if r.authorize_read(name, &row, false).unwrap() {
                        r.live_aggregate(name, row).unwrap()
                    } else { None };
                    if name == "messageCounts" && gated && !granted {
                        assert!(actual.is_none(), "seed={seed} step={step} denied {name}");
                    } else {
                        assert_eq!(actual.as_ref().map_or(0, |v| field(v, "value")), expected as i64, "seed={seed} step={step} {name}");
                    }
                    assertions += 1;
                }
            }
        }
        drop(e); std::fs::remove_file(path).unwrap();
    }
    eprintln!("BG property: seeds={SEEDS:?}; 2400 steps; {assertions} naive comparisons; unread, messageCounts, reactionCounts; operations={operations:?}");
}

#[test]
fn certification_delivery_work_is_independent_of_ten_or_hundred_thousand_history() {
    let mut work = Vec::new();
    for history in [10_000, 100_000] {
        let mut e = Engine::memory(compile(false), vec![]).unwrap();
        e.seed_at((0..50).map(|n| ("members".into(), member(n, 0, 0))), 1).unwrap();
        e.seed_at((0..history).map(|n| ("messages".into(), message(n, 1, 99, false, None))), 1).unwrap();
        // Source insertion advances the already certified empty basis. No
        // background settlement is needed, and new input costs just its delta.
        e.seed_at([("messages".into(), message(history, 2, 99, false, Some(100)))], 2).unwrap();
        let views = e.store().rows("unread").unwrap();
        let schema = e.schema().clone();
        let tx = e.store_mut().transaction().unwrap();
        let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(3), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
        let result = r.live_aggregate_batch("unread", &views).unwrap();
        assert_eq!(result.len(), 50);
        assert!(result.iter().all(Option::is_some));
        for row in result.into_iter().flatten() { assert_eq!(field(&row, "value"), history as i64 + 1); }
        assert_eq!(r.rebuilt_source_rows, 0, "delivery must not re-evaluate unchanged history of {history}");
        work.push((r.rebuilt_source_rows, r.meter.used.examined, r.meter.used.steps));
        eprintln!("BG history={history}: delivery work {:?}", work.last().unwrap());
    }
    assert_eq!(work[0], work[1]);
}

#[test]
fn pending_counts_and_due_deadlines_still_use_the_current_live_basis() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at((0..1100).map(|n| ("messages".into(), message(n, 1, 99, false, Some(if n < 600 { 10 } else { 20 })))), 1).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0))], 1).unwrap();
    let views = e.store().rows("unread").unwrap();
    assert!(pending(&views[0]));
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    for (now, expected) in [(9, 1100), (10, 500), (20, 0)] {
        let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
        let actual = r.live_aggregate_batch("unread", &views).unwrap();
        assert_eq!(field(actual[0].as_ref().unwrap(), "value"), expected);
        assert!(!pending(actual[0].as_ref().unwrap()));
        assert_eq!(r.rebuilt_source_rows, expected as u64);
        assert_eq!(r.meter.used.examined, 2);
    }
}

#[test]
fn sweeping_the_minimum_deadline_restores_incremental_delivery() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0)),
        ("messages".into(), message(0, 1, 99, false, Some(10))),
        ("messages".into(), message(1, 1, 99, false, Some(20))),
        ("messages".into(), message(2, 1, 99, false, None))], 1).unwrap();
    for (now, expected, walk) in [(9, 3, false), (10, 2, true), (10, 2, false), (20, 1, true), (20, 1, false)] {
        let views = e.store().rows("unread").unwrap();
        let schema = e.schema().clone();
        {
            let tx = e.store_mut().transaction().unwrap();
            let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
            let actual = r.live_aggregate_batch("unread", &views).unwrap();
            assert_eq!(field(actual[0].as_ref().unwrap(), "value"), expected);
            assert_eq!(r.rebuilt_source_rows > 0, walk, "now={now}");
        }
        if walk { while e.sweep_expired(now, 100).unwrap() > 0 {} }
    }
}

#[test]
fn legacy_basis_upgrades_atomically_before_reuse() {
    let mut original = Engine::memory(compile(false), vec![]).unwrap();
    original.seed_at([("members".into(), member(0, 0, 0)),
        ("messages".into(), message(0, 1, 99, false, None))], 1).unwrap();
    let mut legacy = original.schema().clone();
    let basis = legacy.tables.get_mut("$basis:unread").unwrap();
    basis.columns.remove("deadline");
    basis.columns.remove("version");
    let mut store = Store::memory().unwrap();
    store.activate_at(&legacy, Some(&BTreeMap::new()), false, 1, |tx, _, _| {
        for name in ["members", "messages", "unread", "$basis:unread"] {
            for row in original.store().rows(name)? {
                let row = if name == "$basis:unread" {
                    let mut fields = row.as_object()?.clone();
                    fields.remove("deadline"); fields.remove("version");
                    Value::Row(fields.into())
                } else { row };
                tx.put(name, &legacy.tables[name], &row, None)?;
            }
        }
        Ok(())
    }).unwrap();
    let mut e = Engine::new(store, compile(false), vec![]).unwrap();
    let views = e.store().rows("unread").unwrap();
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(crate::now_ms()), Meter::new(Ceilings::default(), Cut::Cap), 0);
    let actual = r.live_aggregate_batch("unread", &views).unwrap();
    assert_eq!(field(actual[0].as_ref().unwrap(), "value"), 1);
    assert_eq!(r.rebuilt_source_rows, 0);
}

#[test]
fn recorded_member_inputs_keep_the_disclosed_full_recount() {
    use crate::schema::{ColumnType, Constraint, RecordedField};
    let mut schema = compile(false);
    let room = schema.tables.get_mut("conversations").unwrap();
    room.columns.insert("mark".into(), ColumnType::Int);
    room.constraints.push(Constraint::Immutable { fields: vec!["mark".into()] });
    let member = schema.tables.get_mut("members").unwrap();
    member.columns.insert("conversationId.mark".into(), ColumnType::Optional(Box::new(ColumnType::Int)));
    member.recorded.insert("conversationId.mark".into(), RecordedField {
        reference: "conversationId".into(), table: "conversations".into(), column: "mark".into(),
    });
    member.constraints.push(Constraint::Immutable { fields: vec!["conversationId".into()] });
    // Raw-schema admission also accepts this recorded predicate. Maintenance
    // sees its stored capture, while an authorized member query omits it.
    let maintain = schema.maintains.iter_mut().find(|m| m.target == "unread").unwrap();
    let predicate = &mut maintain.row_key.as_mut().unwrap().predicate;
    *predicate = crate::json_codec::from_text(&crate::json_codec::to_text(predicate).unwrap()
        .replace("$row.seenOrdinal", "$row.conversationId.mark")).unwrap();
    let mut e = Engine::memory(schema, vec![]).unwrap();
    e.seed_at([("conversations".into(), object([("id", id("room")), ("title", Value::String("room".into())), ("mark", Value::Int(5))])),
        ("members".into(), self::member(0, 0, 0)),
        ("messages".into(), message(0, 1, 99, false, None))], 1).unwrap();
    let views = e.store().rows("unread").unwrap();
    assert_eq!(field(&views[0], "value"), 0);
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut warm = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(2), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let mut naive = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(2), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let actual = warm.live_aggregate_batch("unread", &views).unwrap();
    assert_eq!(actual, naive.live_acquisition_batch("unread", &views).unwrap());
    assert_eq!(field(actual[0].as_ref().unwrap(), "value"), 1);
}
