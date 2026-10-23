//! Three-store overlap: the common engine on SQLite and Postgres, and the
//! retained evaluator on Postgres. Prefetch changes physical access only.
// @ref LLP 3000.009.001.000#3.4 — keep the evaluator as the on/off comparison oracle through S10d.
use super::super::*;
use crate::{Engine, store_port::AnyStore, ledger::LedgerReader};
const SOURCE: &str = "table notes:\n  n: int\n  by byN: n\n  public\n  insert <- allow\n  update <- allow\n  sync public\nmutation put(key: id, n: int):\n  upsert notes[key] { n }\n  return n\nmutation fail(key: id):\n  update notes[key] { n: -1 }\n  require false else NO\nquery peek(key: id):\n  return notes[key]\nquery page():\n  return notes where .n >= 0 by .n first 5\n";
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn sqlite_unified_and_evaluator_overlap_prefetch_on_and_off() {
    for enabled in [false, true] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let programs: Vec<Program> = bound.programs.iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
        let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
        let mut sqlite = Engine::new_at(AnyStore::memory().unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        let mut unified = Engine::new_at(AnyStore::create_postgres(&connection, &format!("sb4_eval_oracle_u_{:x}", crate::ids::seed())).unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        { let handle = unified.store_mut().test_postgres_handle_mut(); handle.store.get_mut().prefetch = enabled; }
        let mut evaluator = PostgresEngine::create(Client::connect(&connection, postgres::NoTls).unwrap(), &format!("sb4_eval_oracle_e_{:x}", crate::ids::seed()), schema, programs).unwrap();
        evaluator.set_prefetch(enabled);
        for i in 0..24 {
            let args = [("key".into(), Value::Id(format!("n{}", i % 8))), ("n".into(), Value::Int(i))].into();
            let context = Context::new("alice", args).at(1000);
            let id = format!("op{i}");
            let a = sqlite.mutate("put", Some(&id), context.clone()).unwrap();
            let b = unified.mutate("put", Some(&id), context.clone()).unwrap();
            let c = evaluator.mutate("put", Some(&id), context.clone()).unwrap();
            assert_eq!(a.reply(Some(&id)), b.reply(Some(&id))); assert_eq!(a.reply(Some(&id)), c.reply(Some(&id)));
            assert_eq!(a.metered, b.metered); assert_eq!(a.metered, c.metered);
            for engine in [&mut sqlite, &mut unified] { assert!(engine.mutate("put", Some(&id), context.clone()).unwrap().replayed); }
            assert!(evaluator.mutate("put", Some(&id), context.clone()).unwrap().replayed);
            for op in ["peek", "page"] {
                let mut read = context.clone(); read.args.remove("n"); if op == "page" { read.args.clear(); }
                let a = sqlite.query(op, read.clone()).unwrap(); let b = unified.query(op, read.clone()).unwrap(); let c = evaluator.query(op, read).unwrap();
                assert_eq!((&a.data, a.seq, a.metered, a.complete, &a.next), (&b.data, b.seq, b.metered, b.complete, &b.next));
                assert_eq!((&a.data, a.seq, a.metered, a.complete, &a.next), (&c.data, c.seq, c.metered, c.complete, &c.next));
            }
            if i % 4 == 0 {
                let mut context = context; context.args.remove("n"); let id = format!("fail{i}");
                let a = sqlite.mutate("fail", Some(&id), context.clone()).unwrap(); let b = unified.mutate("fail", Some(&id), context.clone()).unwrap(); let c = evaluator.mutate("fail", Some(&id), context).unwrap();
                assert_eq!(a.reply(Some(&id)), b.reply(Some(&id))); assert_eq!(a.reply(Some(&id)), c.reply(Some(&id)));
                assert_eq!(a.metered, b.metered); assert_eq!(a.metered, c.metered);
            }
        }
        assert_eq!(sqlite.store().rows("notes").unwrap(), unified.store().rows("notes").unwrap());
        let sqlite_rows = sqlite.store().rows("notes").unwrap();
        let a = sqlite.store_mut().read_transaction().unwrap(); let b = unified.store_mut().read_transaction().unwrap(); let c = evaluator.store.transaction(None).unwrap();
        assert_eq!(a.read_log("public", 0, 1000).unwrap(), b.read_log("public", 0, 1000).unwrap());
        assert_eq!(a.read_log("public", 0, 1000).unwrap(), c.read_log("public", 0, 1000).unwrap());
        assert_eq!(a.commits_after(0, 100).unwrap(), b.commits_after(0, 100).unwrap());
        assert_eq!(a.commits_after(0, 100).unwrap(), c.commits_after(0, 100).unwrap());
        let oracle_rows: Vec<Value> = c.query("SELECT data FROM r WHERE t='notes' ORDER BY id", &[]).unwrap().iter().map(|r| store::decode(r.get(0)).unwrap()).collect();
        // The notes fixture has primary-key order on every adapter.
        assert_eq!(oracle_rows, sqlite_rows);
        for i in 0..24 {
            for id in [Some(format!("op{i}")), (i % 4 == 0).then(|| format!("fail{i}"))].into_iter().flatten() {
                let receipt = |r: Option<crate::receipts::ReceiptRecord>| r.map(|r| (r.outcome, r.name, r.args_digest));
                assert_eq!(receipt(a.receipt("alice", &id).unwrap()), receipt(b.receipt("alice", &id).unwrap()));
                assert_eq!(receipt(a.receipt("alice", &id).unwrap()), receipt(c.receipt("alice", &id).unwrap()));
            }
        }
        a.rollback().unwrap(); b.rollback().unwrap(); c.rollback().unwrap();
        eprintln!("S10e-1 overlap prefetch={enabled}: 24 writes, 24 replays, 48 reads, 6 rolled-back refusals; rows, logs, ledger and meters equal");
    }
}
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn common_engine_c1_prefetch_forwards_marked_reads_and_bounds_calls() {
    use crate::value::object;
    let source = "table payloads:\n  value: int\n  public 'test'\n  insert <- allow\n  online only\ntable refs:\n  owner: principal\n  target: payloads\n  by byOwner: owner, id\n  cap 10 by owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nfn related(target: payloads): payloads[target]\nquery derived():\n  page = refs[viewer] first 10 by byOwner\n  return page { target, value: related(.target) }\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound.programs.iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
    let mut rows = Vec::new();
    for i in 0..8 {
        rows.push(("refs".into(), object([("id", Value::Id(format!("r{i}"))), ("owner", Value::Id("alice".into())), ("target", Value::Id(format!("p{i}")))])));
        rows.push(("payloads".into(), object([("id", Value::Id(format!("p{i}"))), ("value", Value::Int(i))])));
    }
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let mut sqlite = Engine::memory(schema.clone(), programs.clone()).unwrap(); sqlite.seed_at(rows.clone(), 1000).unwrap();
    let ctx = Context::new("alice", BTreeMap::new()).at(1000);
    let expected = sqlite.query("derived", ctx.clone()).unwrap();
    let mut calls = Vec::new();
    for enabled in [false, true] {
        let mut engine = Engine::new_at(AnyStore::create_postgres(&connection, &format!("sb4_eval_c1_u_{:x}", crate::ids::seed())).unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        { let handle = engine.store_mut().test_postgres_handle_mut(); handle.store.get_mut().prefetch = enabled; }
        engine.seed_at(rows.clone(), 1000).unwrap();
        let mut evaluator = PostgresEngine::create(Client::connect(&connection, postgres::NoTls).unwrap(), &format!("sb4_eval_c1_e_{:x}", crate::ids::seed()), schema.clone(), programs.clone()).unwrap();
        evaluator.set_prefetch(enabled); evaluator.seed_at(rows.clone(), 1000).unwrap();
        for _ in 0..2 { engine.query("derived", ctx.clone()).unwrap(); evaluator.query("derived", ctx.clone()).unwrap(); }
        let before = engine.store().test_postgres_handle().borrow().unwrap().calls.get();
        let before_e = evaluator.stats().database_calls;
        let actual = engine.query("derived", ctx.clone()).unwrap(); let oracle = evaluator.query("derived", ctx.clone()).unwrap();
        assert_eq!(actual, expected);
        assert_eq!((&actual.data, actual.seq, actual.metered, actual.complete), (&oracle.data, oracle.seq, oracle.metered, oracle.complete));
        let (calls_u, marked) = { let s = engine.store().test_postgres_handle().borrow().unwrap(); (s.calls.get() - before, s.page_reads.get()) };
        let calls_e = evaluator.stats().database_calls - before_e;
        if enabled { assert_eq!(marked, 8); }
        let bound = if enabled { 23 } else { 20 };
        assert!((1..=bound).contains(&calls_u), "common prefetch={enabled}: {calls_u} > {bound}");
        assert!((1..=bound).contains(&calls_e), "evaluator prefetch={enabled}: {calls_e} > {bound}");
        calls.push((calls_u, calls_e, marked));
    }
    // The existing C1 rule permits speculative overhead up to marked reads +
    // four control/prepare calls; this small derived page need not get cheaper.
    assert!(calls[1].0 <= calls[0].0 + calls[1].2 + 4, "common on/off physical calls: {calls:?}");
    assert!(calls[1].1 <= calls[0].1 + calls[1].2 + 4, "evaluator on/off physical calls: {calls:?}");
    eprintln!("S10e-1 C1 warmed query calls (common, evaluator, marked), off={:?}, on={:?}; outcomes and logical meters equal", calls[0], calls[1]);
}

#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn existing_evaluator_fixture_matches_common_engine_in_both_prefetch_modes() {
    use crate::value::object;
    let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../experiments/postgres/fixture.q"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
    let programs: Vec<Program> = bound.programs.iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap()).collect();
    let id = |s: &str| Value::Id(s.into());
    let text = |s: &str| Value::String(s.into());
    let context = |viewer: &str, args: Vec<(&str, Value)>| Context::new(viewer, args.into_iter().map(|(k,v)| (k.into(),v)).collect()).at(1000);
    let mut rows = vec![];
    for viewer in ["alice", "bob"] {
        rows.push(("memberships".into(), object([("id", id(&format!("r000-{viewer}"))), ("room", id("r000")), ("principal", id(viewer)), ("role", text(if viewer == "alice" { "admin" } else { "member" }))])));
    }
    for i in 0..45 {
        rows.push(("items".into(), object([("id", id(&format!("r000-i{i:04}"))), ("room", id("r000")), ("owner", id("alice")), ("title", text(&format!("item-{i:04}"))), ("amount", Value::Int(i)), ("at", Value::Int(i))])));
    }
    let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    for enabled in [false, true] {
        let mut sqlite = Engine::new_at(AnyStore::memory().unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        let mut common = Engine::new_at(AnyStore::create_postgres(&connection, &format!("sb4_eval_fixture_u_{:x}", crate::ids::seed())).unwrap(), schema.clone(), programs.clone(), 1000).unwrap();
        { let h = common.store_mut().test_postgres_handle_mut(); h.store.get_mut().prefetch = enabled; }
        let mut evaluator = PostgresEngine::create(Client::connect(&connection, postgres::NoTls).unwrap(), &format!("sb4_eval_fixture_e_{:x}", crate::ids::seed()), schema.clone(), programs.clone()).unwrap();
        evaluator.set_prefetch(enabled);
        let seeded = sqlite.seed_at(rows.clone(), 10).unwrap();
        assert_eq!(common.seed_at(rows.clone(), 10).unwrap(), seeded); assert_eq!(evaluator.seed_at(rows.clone(), 10).unwrap(), seeded);
        for viewer in ["alice", "bob", "stranger"] {
            let mut cursor = Value::Null;
            for _ in 0..4 {
                let ctx = context(viewer, vec![("room", id("r000")), ("c", cursor)]);
                let expected = sqlite.query("page", ctx.clone()).unwrap();
                assert_eq!(common.query("page", ctx.clone()).unwrap(), expected);
                assert_eq!(evaluator.query("page", ctx).unwrap(), expected);
                cursor = expected.next.map(Value::String).unwrap_or(Value::Null);
                if cursor == Value::Null { break; }
            }
            let expected = sqlite.query("inbox", context(viewer, vec![])).unwrap();
            assert_eq!(common.query("inbox", context(viewer, vec![])).unwrap(), expected);
            assert_eq!(evaluator.query("inbox", context(viewer, vec![])).unwrap(), expected);
        }
        let writes = [
            ("add", "alice", vec![("room", id("r000")), ("title", text("new")), ("amount", Value::Int(71)), ("fail", Value::Bool(false))]),
            ("add", "alice", vec![("room", id("r000")), ("title", text("abort")), ("amount", Value::Int(999)), ("fail", Value::Bool(true))]),
            ("revise", "bob", vec![("itemId", id("r000-i0000")), ("title", text("denied")), ("amount", Value::Int(99))]),
            ("revise", "alice", vec![("itemId", id("r000-i0000")), ("title", text("renamed")), ("amount", Value::Int(-3))]),
            ("remove", "alice", vec![("itemId", id("r000-i0001"))]),
            ("add", "stranger", vec![("room", id("r000")), ("title", text("denied")), ("amount", Value::Int(123)), ("fail", Value::Bool(false))]),
        ];
        for (i, (name, viewer, args)) in writes.into_iter().enumerate() {
            let op = format!("fixture-{i}"); let ctx = context(viewer, args).with_ids([format!("new-{i}")]);
            let before_u = common.store().test_postgres_handle().borrow().unwrap().calls.get();
            let before_e = evaluator.stats().database_calls;
            let expected = sqlite.mutate(name, Some(&op), ctx.clone()).unwrap();
            let actual = common.mutate(name, Some(&op), ctx.clone()).unwrap(); let oracle = evaluator.mutate(name, Some(&op), ctx.clone()).unwrap();
            let calls_u = common.store().test_postgres_handle().borrow().unwrap().calls.get() - before_u;
            let calls_e = evaluator.stats().database_calls - before_e;
            eprintln!("S10e-1 C1 fixture tail prefetch={enabled} op={name}/{i}: common={calls_u} evaluator={calls_e}");
            assert_eq!(actual.reply(Some(&op)), expected.reply(Some(&op))); assert_eq!(oracle.reply(Some(&op)), expected.reply(Some(&op)));
            assert_eq!(actual.metered, expected.metered); assert_eq!(oracle.metered, expected.metered);
            let expected = sqlite.mutate(name, Some(&op), ctx.clone()).unwrap();
            assert_eq!(common.mutate(name, Some(&op), ctx.clone()).unwrap().reply(Some(&op)), expected.reply(Some(&op)));
            assert_eq!(evaluator.mutate(name, Some(&op), ctx).unwrap().reply(Some(&op)), expected.reply(Some(&op)));
            let expected = sqlite.query("inbox", context("alice", vec![])).unwrap();
            assert_eq!(common.query("inbox", context("alice", vec![])).unwrap(), expected);
            assert_eq!(evaluator.query("inbox", context("alice", vec![])).unwrap(), expected);
        }
        for table in ["items", "memberships", "totals"] { assert_eq!(common.store().rows(table).unwrap(), sqlite.store().rows(table).unwrap()); }
        assert_eq!(crate::engine::effects::OutboxStore::effect_counts(common.store()).unwrap(), crate::engine::effects::OutboxStore::effect_counts(sqlite.store()).unwrap());
        eprintln!("S10e-1 evaluator fixture prefetch={enabled}: rules/defaults/maintains, cursors, effects, rollback and replay agree on all three stores");
    }
}
