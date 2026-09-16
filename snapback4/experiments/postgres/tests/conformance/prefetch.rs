use super::*;
use snapback4_core::{Context, MutationOutcome, QueryOutcome, Refusal, meter::Metered, value::object};

fn twins(source: Option<&str>, rows: Vec<(String, Value)>) -> (PostgresEngine, PostgresEngine) {
    let (schema, programs) = if let Some(source) = source {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        (bound.schema, bound.programs.into_iter().map(|p| p.program).collect())
    } else { compiled() };
    let mut on = PostgresEngine::create(connect(), &namespace("prefetch_on"), schema.clone(), programs.clone()).unwrap();
    let mut off = PostgresEngine::create(connect(), &namespace("prefetch_off"), schema, programs).unwrap();
    off.set_prefetch(false);
    on.seed_at(rows.clone(), 10).unwrap();
    off.seed_at(rows, 10).unwrap();
    (on, off)
}

// A page may be filled just before a meter cut. Every differential run,
// including cold prepares, must stay within that page's marked reads plus
// four control/prepare calls. Never disable the bound for cuts or mutations.
static LARGEST_EXCESS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn calls_bounded(name: &str, on: &PostgresEngine, off: &PostgresEngine, before: (u64, u64)) {
    let calls = (on.stats().database_calls - before.0, off.stats().database_calls - before.1);
    let marked = on.stats().prefetch_page_reads;
    assert!(calls.0 <= calls.1 + marked + 4, "{name}: calls on/off={calls:?}, marked reads={marked}");
    let excess = calls.0.saturating_sub(calls.1);
    let previous = LARGEST_EXCESS.fetch_max(excess, std::sync::atomic::Ordering::Relaxed);
    if excess > previous { println!("PREFETCH largest call excess: {excess}; {name}, calls={calls:?}, marked={marked}, allowance={}", marked + 4); }
}

fn query(on: &mut PostgresEngine, off: &mut PostgresEngine, name: &str, ctx: Context, count: bool) -> Result<QueryOutcome, Refusal> {
    let before = (on.stats().database_calls, off.stats().database_calls);
    let a = on.query(name, ctx.clone());
    let b = off.query(name, ctx);
    assert_eq!(a, b, "all QueryOutcome/refusal fields, {name}");
    let calls = (on.stats().database_calls - before.0, off.stats().database_calls - before.1);
    calls_bounded(name, on, off, before);
    if count { assert!(calls.0 <= calls.1, "{name}: calls on/off={calls:?}"); }
    a
}
fn mutate(on: &mut PostgresEngine, off: &mut PostgresEngine, name: &str, ctx: Context) -> MutationOutcome {
    let before = (on.stats().database_calls, off.stats().database_calls);
    let a = on.mutate(name, None, ctx.clone()).unwrap();
    let b = off.mutate(name, None, ctx).unwrap();
    assert_eq!(a, b, "all MutationOutcome fields, {name}");
    calls_bounded(name, on, off, before);
    a
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn prefetch_complete_fixture_queries_mutations_and_hidden_rows() {
    let (mut on, mut off) = twins(None, fixture(32, 3));
    for viewer in ["alice", "bob", "stranger"] {
        for (name, args) in [
            ("item", vec![("itemId", id("r000-i0000"))]),
            ("page", vec![("room", id("r000")), ("c", Value::Null)]),
            ("inbox", vec![]), ("counter", vec![("slot", id("c0"))]),
        ] {
            query(&mut on, &mut off, name, context(viewer, &args), false).unwrap(); // warm prepares
            query(&mut on, &mut off, name, context(viewer, &args), true).unwrap();
        }
    }
    let before = (on.stats().database_calls, off.stats().database_calls);
    query(&mut on, &mut off, "inbox", context("alice", &[]), true).unwrap();
    let calls = (on.stats().database_calls - before.0, off.stats().database_calls - before.1);
    assert!(calls.0 < 10, "inbox calls: {calls:?}");
    assert_eq!(calls.1, 68);
    println!("PREFETCH inbox warmed calls on/off: {calls:?}");
    for viewer in ["alice", "stranger"] {
        for fail in [false, true] {
            mutate(&mut on, &mut off, "add", context(viewer, &[("room", id("r000")), ("title", string(format!("{viewer}-{fail}"))), ("amount", Value::Int(2)), ("fail", Value::Bool(fail))]).with_ids([format!("new-{viewer}-{fail}")]));
        }
    }
    mutate(&mut on, &mut off, "increment", context("alice", &[("slot", id("c0"))]));
    query(&mut on, &mut off, "inbox", context("alice", &[]), true).unwrap();
}

fn field(m: &Metered, n: usize) -> u64 {
    [m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written][n]
}
fn precharge(n: usize, remaining: u64) -> Metered {
    let c = Ceilings::default();
    let mut used = Metered::default();
    let (slot, ceiling) = match n {
        0 => (&mut used.examined, c.examined), 1 => (&mut used.index_entries, c.index_entries),
        2 => (&mut used.rule_probes, c.rule_probes), 3 => (&mut used.steps, c.steps),
        4 => (&mut used.heap_bytes, c.heap_bytes), 5 => (&mut used.output_bytes, c.output_bytes),
        _ => (&mut used.rows_written, c.rows_written),
    };
    *slot = ceiling.saturating_sub(remaining);
    used
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn prefetch_every_charge_position_and_early_cut_matches_complete_outcomes() {
    let (mut on, mut off) = twins(None, fixture(3, 1));
    let mut runs = 0;
    let mut extra_calls = 0;
    // Exhaust every remaining integer budget, including byte meters: this
    // includes both sides of every multi-byte charge, not sampled positions.
    for viewer in ["alice", "stranger"] {
        for (name, args) in [
            ("item", vec![("itemId", id("r000-i0000"))]),
            ("page", vec![("room", id("r000")), ("c", Value::Null)]),
            ("inbox", vec![]), ("counter", vec![("slot", id("c0"))]),
        ] {
            on.set_meter_precharge(Metered::default()); off.set_meter_precharge(Metered::default());
            let baseline = query(&mut on, &mut off, name, context(viewer, &args), false).unwrap();
            for n in 0..7 { for remaining in 0..=field(&baseline.metered, n) {
                let used = precharge(n, remaining);
                on.set_meter_precharge(used); off.set_meter_precharge(used);
                let before = (on.stats().database_calls, off.stats().database_calls);
                let _ = query(&mut on, &mut off, name, context(viewer, &args), false);
                let calls = (on.stats().database_calls - before.0, off.stats().database_calls - before.1);
                extra_calls += u64::from(calls.0 > calls.1);
                runs += 1;
            }}
        }
    }
    on.set_meter_precharge(Metered::default()); off.set_meter_precharge(Metered::default());
    let ctx = context("alice", &[("slot", id("c0"))]);
    let baseline = mutate(&mut on, &mut off, "increment", ctx.clone());
    for n in 0..7 { for remaining in 0..=field(&baseline.metered, n) {
        let used = precharge(n, remaining);
        on.set_meter_precharge(used); off.set_meter_precharge(used);
        mutate(&mut on, &mut off, "increment", ctx.clone());
        runs += 1;
    }}
    println!("PREFETCH differential: {runs} pre-charge positions; {extra_calls} query positions incurred speculative physical-call overhead; every complete outcome/refusal equal");
}

const EXPIRING: &str = "table sources:\n  room: id\n  expires: time\n  by byRoom: room, id\n  by byExpiry: expires, id\n  expire at .expires\n  public 'test'\n  insert <- allow\n  online only\nmaintain totals: count sources by room\n  read <- allow\n  online only\ntable rooms:\n  public 'test'\n  insert <- allow\n  online only\nquery inbox():\n  return rooms first 10 by byId { id, total: totals[.id] }\n";

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn expiring_maintains_are_unmarked_and_keep_next_expiry_and_live_values() {
    let mut rows = Vec::new();
    for i in 0..8 {
        rows.push(("rooms".into(), object([("id", id(format!("r{i}")))])));
        rows.push(("sources".into(), object([("id", id(format!("s{i}"))), ("room", id(format!("r{i}"))), ("expires", Value::Int(if i % 2 == 0 { 900 } else { 1100 }))])));
    }
    let (mut on, mut off) = twins(Some(EXPIRING), rows);
    query(&mut on, &mut off, "inbox", context("alice", &[]), false).unwrap();
    let before = (on.stats().database_calls, off.stats().database_calls);
    query(&mut on, &mut off, "inbox", context("alice", &[]), true).unwrap();
    assert_eq!(on.stats().database_calls - before.0, off.stats().database_calls - before.1, "no expiring maintain prefetch calls");
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn word_entries_and_truncated_query_terms_match_sqlite() {
    let source = "table docs:\n  body: text <=2000\n  by byWords: words(body), id\n  public 'test'\n  insert <- allow\n  online only\nquery search(term: text <=2000):\n  return docs matching term first 20 by byWords\n";
    let rows: Vec<_> = ["𐐨".repeat(100), "x".repeat(200), "coffee café".into()].into_iter().enumerate()
        .map(|(i, body)| ("docs".into(), object([("id", id(format!("d{i}"))), ("body", string(body))]))).collect();
    let (mut on, mut off) = twins(Some(source), rows.clone());
    let mut sqlite = Engine::memory(on.schema().clone(), on.programs().values().cloned()).unwrap();
    sqlite.seed_at(rows, 10).unwrap();
    for term in ["𐐨".repeat(100), "x".repeat(180), "cof".into(), "café".into(), "absent".into()] {
        let ctx = context("alice", &[("term", string(term))]);
        assert_eq!(query(&mut on, &mut off, "search", ctx.clone(), true), sqlite.query("search", ctx));
    }
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn rows_beyond_prefetch_byte_budget_have_identical_results() {
    let source = "table payloads:\n  body: text <=6000000\n  public 'test'\n  insert <- allow\n  online only\ntable refs:\n  target: payloads\n  public 'test'\n  insert <- allow\n  online only\nquery inbox():\n  return refs first 10 by byId { target, payload: payloads[.target] }\n";
    let mut rows = Vec::new();
    for i in 0..6 {
        rows.push(("refs".into(), object([("id", id(format!("r{i}"))), ("target", id(format!("p{i}")))])));
        rows.push(("payloads".into(), object([("id", id(format!("p{i}"))), ("body", string("x".repeat(800_000)))])));
    }
    let (mut on, mut off) = twins(Some(source), rows);
    on.set_ceilings(Ceilings::unbounded()); off.set_ceilings(Ceilings::unbounded());
    let result = query(&mut on, &mut off, "inbox", context("alice", &[]), false).unwrap();
    assert!(result.complete);
    assert_eq!(result.data.as_array().unwrap().len(), 6);
    on.set_ceilings(Ceilings { examined: 4, ..Ceilings::default() });
    off.set_ceilings(Ceilings { examined: 4, ..Ceilings::default() });
    query(&mut on, &mut off, "inbox", context("alice", &[]), false).unwrap();
}

const WRITES: &str = "table payloads:\n  value: int\n  public 'test'\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\ntable refs:\n  owner: principal\n  target: payloads\n  by byOwner: owner, id\n  cap 10 by owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nfn related(target: payloads): payloads[target]\nquery derived():\n  page = refs[viewer] first 10 by byOwner\n  return page { target, value: related(.target) }\nmutation bump(fail: bool):\n  for r in refs[viewer] first 10 by byOwner:\n    old = related(r.target) ! else MISSING\n    update payloads[old] { value: old.value + 1 }\n    current = payloads[r.target] ! else MISSING\n    require current.value = old.value + 1 else STALE\n  require not fail else ROLLBACK\n  return true\nmutation conflict():\n  for r in refs[viewer] first 10 by byOwner:\n    old = payloads[r.target] ! else MISSING\n    update payloads[old] { value: old.value + 1 }\n  for r in refs[viewer] first 10 by byOwner:\n    current = payloads[r.target]\n    require current != null else MISSING\n    update payloads[r.target] { value: 999 } if .value = -1\n  return true\n";

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn aliases_derived_pages_mutation_invalidation_and_conflict_reread() {
    let mut rows = Vec::new();
    for i in 0..8 {
        rows.push(("refs".into(), object([("id", id(format!("r{i}"))), ("owner", id("alice")), ("target", id(format!("p{}", i % 6)))])));
        if i < 6 { rows.push(("payloads".into(), object([("id", id(format!("p{i}"))), ("value", Value::Int(0))]))); }
    }
    let (mut on, mut off) = twins(Some(WRITES), rows);
    query(&mut on, &mut off, "derived", context("alice", &[]), false).unwrap();
    mutate(&mut on, &mut off, "bump", context("alice", &[("fail", Value::Bool(false))]));
    let failed = mutate(&mut on, &mut off, "bump", context("alice", &[("fail", Value::Bool(true))]));
    assert!(matches!(failed.state, WriteState::Failed { .. }));
    let conflict = mutate(&mut on, &mut off, "conflict", context("alice", &[]));
    let WriteState::Failed { why, current: Some(current) } = conflict.state else { panic!("expected conflict reread") };
    assert_eq!(why.code, "E_CONFLICT");
    assert_eq!(current.field("value").unwrap(), &Value::Int(2), "reread is from before the rolled-back writes");
    query(&mut on, &mut off, "derived", context("alice", &[]), false).unwrap();
    // Exercise all remaining budgets around every charge in an actual
    // prefetching write loop. Each pair commits or rolls back identically.
    let ctx = context("alice", &[("fail", Value::Bool(false))]);
    let baseline = mutate(&mut on, &mut off, "bump", ctx.clone());
    let mut positions = 0;
    for n in 0..7 { for remaining in 0..=field(&baseline.metered, n) {
        let used = precharge(n, remaining);
        on.set_meter_precharge(used); off.set_meter_precharge(used);
        mutate(&mut on, &mut off, "bump", ctx.clone());
        positions += 1;
    }}
    println!("PREFETCH write-loop differential: {positions} pre-charge positions; complete MutationOutcome equality");
}
