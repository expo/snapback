//! Deterministic state-machine comparison with an independent, full model.
use super::*;
use crate::{Context, Engine, Schema, Store, Ceilings, meter::{Meter, Cut}};
use std::collections::BTreeMap;

#[path = "lifetime_tests.rs"]
mod lifetimes;

const FIXTURE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q");
fn compile(gated: bool) -> Schema { compile_lifetimes(gated, false) }
fn compile_lifetimes(gated: bool, expiring_members: bool) -> Schema {
    // Clique's predicate, plus the corpus language card's messageCounts and
    // guide maintains / fixtures/ag/reactions.q's reactionCounts.
    let source = FIXTURE.replace("readUpTo", "seenOrdinal") + r#"
table access:
  until: time ?
  expire at .until
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
    let source = if expiring_members { source.replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  until: time ?\n  expire at .until") } else { source };
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
fn incremental_certification_matches_naive_after_every_random_step() { property_clock(false); }
#[test]
fn incremental_certification_matches_naive_with_expiring_members() { property_clock(true); }

#[test]
fn seeded_expired_row_view_sources_do_not_revive_on_clock_rollback() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0))], 1).unwrap();
    e.seed_at([("messages".into(), message(0, 1, 99, false, Some(100)))], 1).unwrap();

    // Updating a live source into an expired final image and seeding a new
    // born-expired source both retire through the common action path.
    e.seed_at([
        ("messages".into(), message(0, 1, 99, false, Some(5))),
        ("messages".into(), message(1, 1, 99, false, Some(5))),
    ], 10).unwrap();
    assert!(e.store().rows("messages").unwrap().is_empty());

    // Ordinary expired fixture images keep the seed contract.
    let grant = with_deadline(object([
        ("id", id("expired-grant")),
        ("conversationId", id("room")),
        ("principal", id("reader")),
    ]), Some(5));
    e.seed_at([("access".into(), grant)], 10).unwrap();
    assert_eq!(e.store().rows("access").unwrap().len(), 1);

    // A later rollback cannot resurrect either retired source into the live
    // acquisition, even though both deadlines would otherwise be live at 2.
    let views = e.store().rows("unread").unwrap();
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(2),
        Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let acquired = runner.live_acquisition_batch("unread", &views).unwrap();
    assert_eq!(acquired.len(), 1);
    assert_eq!(acquired[0].as_ref().map(|row| field(row, "value")), Some(0));
}

fn property_clock(expiring_members: bool) {
    const SEEDS: [u64; 8] = [1, 7, 28, 20261002, 0xbadcafe, 0xdeadbeef, 0x12345678, 0x5eed];
    let mut assertions = 0;
    let mut operations = [0usize; 15];
    let mut chunks = 0;
    let mut aborted_chunks = 0;
    let mut backward = 0;
    let mut forward = 0;
    for (case, seed) in SEEDS.into_iter().enumerate().filter(|(case, _)| (*case % 2 == 1) == expiring_members) {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target")
            .join(format!("bg-certification-{}-{seed}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut e = Engine::new(Store::open(&path).unwrap(), compile_lifetimes(false, expiring_members), vec![]).unwrap();
        let mut messages = BTreeMap::<usize, Value>::new();
        let mut members = BTreeMap::<usize, Value>::new();
        let mut reactions = BTreeMap::<usize, Value>::new();
        let mut state = seed;
        let mut now = 1;
        let mut gated = false;
        let grant_row = |until| with_deadline(object([("id", id("grant")), ("conversationId", id("room")), ("principal", id("reader"))]), until);
        let mut grant = Some(grant_row(None));
        e.seed_at([("access".into(), grant.clone().unwrap())], now).unwrap();
        let population = 1101 + (random(&mut state) % 1100) as usize;
        eprintln!("BG property start: seed={seed} expiring_members={expiring_members} population={population}");
        for step in 0..300 {
            let n = (random(&mut state) % (population as u64 + 24)) as usize;
            let u = (random(&mut state) % 8) as usize;
            let operation = (random(&mut state) % 15) as usize;
            if step >= 10 { operations[operation] += 1; }
            if step < 10 {
                // Generated prefixes guarantee both review counterexamples,
                // varying the population across seeds, with a read at every step.
                if expiring_members {
                    match step {
                        0 => { let row = with_deadline(member(0, 0, 0), Some(10)); e.seed_at([("members".into(), row.clone())], now).unwrap(); members.insert(0, row); }
                        1 => { now = 11; for n in 0..population { messages.insert(n, message(n, 60, 99, false, None)); } e.seed_at(messages.values().cloned().map(|row| ("messages".into(), row)), now).unwrap(); }
                        2 => { now = 9; }
                        3 => { let row = with_deadline(member(0, 0, 0), None); e.seed_at([("members".into(), row.clone())], now).unwrap(); members.insert(0, row); }
                        _ => { chunks += usize::from(e.run_view_chunk(now).unwrap().is_some()); }
                    }
                } else {
                    match step {
                        0 => { for n in 0..population { messages.insert(n, message(n, 60, 99, false, Some(if n == 0 { 5 } else { 100 })) ); } e.seed_at(messages.values().cloned().map(|row| ("messages".into(), row)), now).unwrap(); }
                        1 => { now = 10; let row = member(0, 0, 0); e.seed_at([("members".into(), row.clone())], now).unwrap(); members.insert(0, row); }
                        2 => { chunks += usize::from(e.run_view_chunk(now).unwrap().is_some()); }
                        _ => { now = 2; chunks += usize::from(e.run_view_chunk(now).unwrap().is_some()); }
                    }
                }
            } else { match operation {
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
                    if messages.get(&n).is_some_and(|row| live(row, now)) { messages.remove(&n); }
                }
                4 => {
                    let row = member(u, (random(&mut state) % 50) as i64, (random(&mut state) % 15) as i64);
                    let row = if expiring_members { with_deadline(row, (random(&mut state) % 3 != 0).then(|| now + (random(&mut state) % 20) as i64)) } else { row };
                    e.seed_at([("members".into(), row.clone())], now).unwrap();
                    members.insert(u, row); // Expired recipients remain stored until sweep.
                }
                5 => { remove(&mut e, "members", &format!("u{u}"), now); if members.get(&u).is_some_and(|row| live(row, now)) { members.remove(&u); } }
                6 => {
                    let previous = now;
                    now = (now + (random(&mut state) % 41) as i64 - 20).max(1);
                    backward += usize::from(now < previous); forward += usize::from(now > previous);
                }
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
                        let schema = compile_lifetimes(gated, expiring_members);
                        e.adopt_at(schema, vec![], now).unwrap();
                    } else {
                        if grant.as_ref().is_some_and(|row| live(row, now)) && random(&mut state) % 2 == 0 {
                            remove(&mut e, "access", "grant", now); grant = None;
                        } else {
                            let row = grant_row((random(&mut state) % 3 != 0).then(|| now + (random(&mut state) % 15) as i64));
                            e.seed_at([("access".into(), row.clone())], now).unwrap();
                            grant = Some(row); // Expiry hides an unswept grant; rollback can revive it.
                        }
                    }
                }
                9 => {
                    if messages.get(&n).is_some_and(|m| live(m, now)) {
                        let row = object([("id", id(&format!("r{n}"))), ("message", id(&format!("m{n}"))), ("principal", id("reader")), ("emoji", Value::String(if u % 2 == 0 { "a" } else { "b" }.into())), ("until", Value::Int(now + 10))]);
                        e.seed_at([("reactions".into(), row.clone())], now).unwrap(); reactions.insert(n, row);
                    } else { remove(&mut e, "reactions", &format!("r{n}"), now); if reactions.get(&n).is_some_and(|row| live(row, now)) { reactions.remove(&n); } }
                }
                10 => { chunks += usize::from(e.run_view_chunk(now).unwrap().is_some()); }
                11 => {
                    // Abort after an ordinary source delta has changed count and
                    // evidence, then close/reopen the real SQLite database.
                    let before = durable_counts(&e);
                    let row = message(n, 60, 99, false, Some(now + 5));
                    assert!(e.seed_at([("messages".into(), row), ("missing-table".into(), object([("id", id("bad"))]))], now).is_err());
                    let schema = e.schema().clone(); drop(e);
                    e = Engine::new_at(Store::open(&path).unwrap(), schema, vec![], now).unwrap();
                    assert_eq!(durable_counts(&e), before, "aborted source commit seed={seed} step={step}");
                }
                12 => {
                    let before = durable_counts(&e);
                    let schema = e.schema().clone();
                    let m = schema.maintains.iter().find(|m| m.target == "unread").unwrap();
                    if let Some(work) = e.store().rows(&m.work_table()).unwrap().first() {
                        let tx = e.store_mut().transaction().unwrap();
                        let mut r = Runner::new(&tx, &schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
                        r.recount_chunk(m, work).unwrap();
                        // Dropping the transaction interrupts this chunk before commit.
                        drop(r); drop(tx); aborted_chunks += 1;
                        assert_eq!(durable_counts(&e), before, "aborted recount seed={seed} step={step}");
                    }
                }
                13 => { for _ in 0..3 { chunks += usize::from(e.run_view_chunk(now).unwrap().is_some()); } }
                _ => {} // delivery with no intervening write
            } }
            let granted = grant.as_ref().is_some_and(|row| live(row, now));
            let schema = e.schema().clone();
            let views = e.store().rows("unread").unwrap();
            assert_eq!(views.len(), members.len(), "all member counts exist: seed={seed} step={step}");
            let tx = e.store_mut().transaction().unwrap();
            let mut r = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
            let actual = r.live_aggregate_batch("unread", &views).unwrap();
            let mut naive = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
            let acquired = naive.live_acquisition_batch("unread", &views).unwrap();
            for ((view, actual), acquired) in views.iter().zip(actual).zip(acquired) {
                let name = view.field("member").unwrap().as_str().unwrap();
                let n: usize = name[1..].parse().unwrap();
                let u = &members[&n];
                assertions += 1;
                if !live(u, now) || (gated && !granted) { assert!(actual.is_none() && acquired.is_none(), "seed={seed} step={step}"); continue; }
                let expected = messages.values().filter(|m| live(m, now)
                    && field(m, "ordinal") > field(u, "seenOrdinal")
                    && field(m, "ordinal") > field(u, "joinedAt")
                    && m.field("senderId").unwrap() != u.field("principal").unwrap()
                    && m.field("tombstone").unwrap() == &Value::Bool(false)).count();
                assert_eq!(acquired.as_ref().map(|v|field(v,"value")), Some(expected as i64), "independent acquisition seed={seed} step={step}");
                assert!(!pending(acquired.as_ref().unwrap()));
                assert_eq!(r.live_aggregate("unread", view.clone()).unwrap(), actual, "scalar seed={seed} step={step}");
                assertions += 1;
                let actual = actual.unwrap();
                assert_eq!(actual.field("value").unwrap(), &Value::Int(expected as i64), "seed={seed} step={step} member={name} now={now}");
                assert_eq!(actual.field("recountPending").unwrap(), &Value::Bool(false));
                assertions += 1;
            }
            // Ordinary aggregate views remain governed by their live recount.
            // Check every materialized group against the separate model too.
            for name in ["messageCounts", "reactionCounts"] {
                let groups = tx.scan(name, "byId", &[], &Bounds::default(), Dir::Asc, 1000).unwrap();
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
        eprintln!("BG property seed complete: case={case} seed={seed}; 300 steps");
        drop(e); std::fs::remove_file(path).unwrap();
    }
    assert!(backward > 0 && forward > 0 && chunks > 0 && aborted_chunks > 0);
    eprintln!("BG property: expiring_members={expiring_members} seeds={:?}; 1200 steps; {assertions} naive/scalar comparisons; 1200 full-acquisition comparisons; unread, messageCounts, reactionCounts; operations={operations:?}; committed_chunks={chunks} aborted_chunks={aborted_chunks} backward={backward} forward={forward}", SEEDS.into_iter().enumerate().filter(|(i, _)| (*i % 2 == 1) == expiring_members).map(|(_, seed)| seed).collect::<Vec<_>>());
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

fn with_deadline(row: Value, until: Option<i64>) -> Value {
    let mut fields = row.as_object().unwrap().clone();
    fields.insert("until".into(), until.map(Value::Int).unwrap_or(Value::Null));
    Value::Row(fields.into())
}

fn compare_unread(e: &mut Engine, now: i64, expected: i64) {
    let views = e.store().rows("unread").unwrap();
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut stream = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let mut full = Runner::new(&tx, &schema, Context::new("reader", Default::default()).at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), 0);
    let walked = full.live_acquisition_batch("unread", &views).unwrap();
    assert_eq!(field(walked[0].as_ref().unwrap(), "value"), expected, "independent fixture oracle");
    let actual = stream.live_aggregate_batch("unread", &views).unwrap();
    assert_eq!(actual, walked, "stream versus full acquisition at {now}");
    assert_eq!(stream.live_aggregate("unread", views[0].clone()).unwrap(), walked[0], "scalar at {now}");
}

#[test]
fn clock_rollback_after_expired_member_skipped_delta() {
    let mut e = Engine::memory(compile_lifetimes(false, true), vec![]).unwrap();
    e.seed_at([("members".into(), with_deadline(member(0, 0, 0), Some(10)))], 1).unwrap();
    compare_unread(&mut e, 1, 0);
    e.seed_at([("messages".into(), message(0, 1, 99, false, None))], 11).unwrap();
    compare_unread(&mut e, 9, 1);
}

#[test]
fn clock_rollback_during_recount_restarts_the_excluded_prefix() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at((0..1101).map(|n| ("messages".into(), message(n, 1, 99, false, Some(if n == 1100 { 5 } else { 100 })))), 1).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0))], 10).unwrap();
    assert!(pending(&e.store().rows("unread").unwrap()[0]));
    assert!(e.run_view_chunk(10).unwrap().is_some());
    let mut chunks = 1;
    while e.run_view_chunk(2).unwrap().is_some() { chunks += 1; }
    assert!(chunks >= 5, "the test spans several chunks");
    compare_unread(&mut e, 2, 1101);
}

fn durable_counts(e: &Engine) -> Vec<Vec<Value>> {
    let m = e.schema().maintains.iter().find(|m| m.target == "unread").unwrap();
    ["messages", "members", "unread", "$basis:unread", &m.work_table()].into_iter()
        .map(|name| e.store().rows(name).unwrap()).collect()
}

#[test]
fn pre_rollback_fix_evidence_is_never_reused() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0)), ("messages".into(), message(0, 1, 99, false, Some(100)))], 1).unwrap();
    let schema = e.schema().clone();
    let m = schema.maintains.iter().find(|m| m.target == "unread").unwrap();
    let k = m.row_key.as_ref().unwrap();
    {
        let tx = e.store_mut().transaction().unwrap();
        for (name, field, value) in [
            ("unread", "value", Value::Int(0)),
            ("$basis:unread", "version", Value::String(crate::value::digest(&("count-basis-v1", m, &schema.tables[&m.source], &schema.tables[&k.table])))),
        ] {
            let old = tx.get(name, "u0").unwrap().unwrap();
            let mut row = old.as_object().unwrap().clone(); row.insert(field.into(), value);
            tx.put(name, &schema.tables[name], &Value::Row(row.into()), Some(&old)).unwrap();
        }
        tx.commit().unwrap();
    }
    compare_unread(&mut e, 2, 1);
}

#[test]
fn legacy_partial_recount_cannot_stamp_an_incomplete_prefix_with_new_evidence() {
    let mut e = Engine::memory(compile(false), vec![]).unwrap();
    e.seed_at((0..1101).map(|n| ("messages".into(), message(n, 1, 99, false, Some(if n == 1100 { 5 } else { 100 })))), 1).unwrap();
    e.seed_at([("members".into(), member(0, 0, 0))], 10).unwrap();
    e.run_view_chunk(10).unwrap().unwrap();
    // An old worker resumed at 2 without resetting its cursor. It could persist
    // that partial state and crash before completing. Its version is absent.
    let schema = e.schema().clone();
    {
        let tx = e.store_mut().transaction().unwrap();
        let old = tx.get("$recount:unread", "u0").unwrap().unwrap();
        let mut row = old.as_object().unwrap().clone();
        row.remove("version"); row.insert("at".into(), Value::Int(2));
        tx.put("$recount:unread", &schema.tables["$recount:unread"], &Value::Row(row.into()), Some(&old)).unwrap();
        tx.commit().unwrap();
    }
    while e.run_view_chunk(2).unwrap().is_some() {}
    compare_unread(&mut e, 2, 1101);
}

#[test]
fn malformed_required_evidence_never_certifies_a_count() {
    for (table, key) in [("$basis:unread","at"),("$basis:unread","deadline"),("$basis:unread","version"),("unread","recountPending"),("unread","value")] {
        for corruption in 0..3 {
            let mut e=Engine::memory(compile(false),vec![]).unwrap();
            e.seed_at([("members".into(),member(0,0,0)),("messages".into(),message(0,1,99,false,None))],1).unwrap();
            let schema=e.schema().clone();
            {
                let tx=e.store_mut().transaction().unwrap();
                // Keep a matching current version and a deliberately stale value.
                let old=tx.get("unread","u0").unwrap().unwrap();
                let mut bad=old.as_object().unwrap().clone();bad.insert("value".into(),Value::Int(0));
                tx.put("unread",&schema.tables["unread"],&Value::Row(bad.into()),Some(&old)).unwrap();
                let old=tx.get(table,"u0").unwrap().unwrap();
                let mut bad=old.as_object().unwrap().clone();
                match corruption {
                    0 => {bad.remove(key);},
                    1 => {bad.insert(key.into(),Value::String("malformed".into()));},
                    _ => {bad.insert(key.into(),Value::Id(old.field(key).ok().and_then(|v|v.as_str().ok()).unwrap_or("malformed").into()));},
                }
                tx.put(table,&schema.tables[table],&Value::Row(bad.into()),Some(&old)).unwrap();tx.commit().unwrap();
            }
            eprintln!("BG malformed evidence: {table}.{key}");
            compare_unread(&mut e,2,1);
        }
    }
}
