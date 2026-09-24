//! LLP 3000.013 §5: exact domain scalars, adaptive transactions and permanent effect keys.
use snapback4_core::{Ceilings, Context, Engine, JobState, Store, Value, wire};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("work_intent.q");
fn compiled(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn memory(source: &str) -> Engine {
    let bound = compiled(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows: Vec<(String, Value)> = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect();
    engine.load(rows).unwrap();
}
fn period() -> BTreeMap<String, Value> { [("periodStart".into(), Value::Int(0)), ("periodEnd".into(), Value::Int(120_000))].into() }

#[test]
fn recipient_heavy_digest_streams_below_unchanged_heap_ceiling() {
    let mut engine = memory(SOURCE);
    let principal = "a".repeat(31);
    load(&mut engine, vec![("profiles", json!({"id":"p", "principal":principal})), ("conversations", json!({"id":"chat0", "title":"busy"})),
        ("members", json!({"id":"membership", "conversationId":"chat0", "principal":principal, "readOrdinal":0}))]);
    let recipients: Vec<_> = (0..50).map(|i| format!("recipient{i:022}")).collect();
    load(&mut engine, (0..5000).map(|n| ("messages", json!({"id":format!("m{n:011}"), "conversationId":"chat0", "senderId":if n % 50 == 0 { principal.clone() } else { "b".repeat(31) },
        "body":"x".repeat(31), "recipients":recipients, "ordinal":n+1,"at":15_000,"tombstone":false,"edited":false,"expiresAt":null,"replyTo":null}))).collect());
    let run = engine.run_job("daily", period(), 120_001).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(run.chunks, 1);
    assert!(run.heap_peak <= 373_000, "recipient-heavy transient scratch envelope: {run:?}");
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].payload.field("unreadMessages").unwrap(), &Value::Int(4900));
    assert_eq!(effects[0].payload.field("unreadChats").unwrap(), &Value::Int(1));
    println!("recipient-heavy: candidates=5000 hits=4900 recipients=50 peak_heap={} ceiling={} chunks={} writes={}", run.heap_peak, Ceilings::job().heap_bytes, run.chunks, run.rows_written);
    let again = engine.run_job("daily", period(), 120_002).unwrap();
    assert_eq!(again.state, JobState::Done);
    assert_eq!(again.rows_written, 0);
    assert_eq!(engine.effects(None, 10).unwrap().len(), 1);
    let args = [("c".into(), Value::Id("chat0".into()))].into();
    assert_eq!(engine.query("amount", Context::new(&principal, args).at(120_001)).unwrap().data, Value::Int(12_502_500));
}

const VARYING: &str = r#"
effect notify
table items:
  cost: int
  visits: int default 0
  public 'test items'
  online only
job sweep():
  for item in items:
    emit notify { item: item.id } once [item.id]
    for i in range(0, item.cost):
      n = i + 1
    update items[item.id] { visits: item.visits + 1 }
"#;
fn file() -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    std::env::temp_dir().join(format!("sb4-work-intent-{}-{}-{}", std::process::id(), snapback4_core::now_ms(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))).join("store.sqlite")
}
#[test]
fn varying_cost_retries_and_reopens_at_committed_cursor() {
    let path = file();
    let bound = compiled(VARYING);
    let mut engine = Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, (0..80).map(|i| ("items", json!({"id":format!("i{i:03}"),"cost":if i < 16 { 1 } else { 8000 },"visits":0}))).collect());
    let id = engine.enqueue_job("sweep", BTreeMap::new(), 1).unwrap();
    let first = engine.run_job_chunk(1).unwrap().unwrap();
    assert_eq!(first.state, JobState::Running, "{first:?}");
    assert!(first.retries > 0 && first.chunk_size < 64, "{first:?}");
    println!("adaptive first: {first:?}");
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    while engine.run_job_chunk(2).unwrap().is_some() {}
    let run = engine.job(&id).unwrap().unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    assert_eq!(engine.effects(None, 500).unwrap().len(), 80);
    let rows = engine.store().conn().prepare("SELECT data FROM r").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    for row in rows { assert!(row.contains("visits")); let v: Value = serde_json::from_str(&row).unwrap(); assert_eq!(v.field("visits").unwrap(), &Value::Int(1)); }
    drop(engine);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn impossible_item_parks_without_committing_its_key_or_writes() {
    let mut engine = memory(VARYING);
    load(&mut engine, (0..65).map(|i| ("items", json!({"id":format!("i{i:03}"),"cost":if i == 64 { 2_000_000 } else { 0 },"visits":0}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert_eq!(run.chunks, 1);
    assert_eq!(run.chunk_size, 1);
    assert_eq!(run.retries, 6);
    assert!(run.error.unwrap().starts_with("E_BOUND:"));
    assert_eq!(engine.effects(None, 500).unwrap().len(), 64);
    let keys: i64 = engine.store().conn().query_row("SELECT count(*) FROM _effect_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(keys, 64);
}

#[test]
fn sweep_upper_bound_excludes_later_inserts_and_break_return_match_chunk() {
    let mut engine = memory(VARYING);
    load(&mut engine, (0..70).map(|i| ("items", json!({"id":format!("i{i:03}"),"cost":0,"visits":0}))).collect());
    let id = engine.enqueue_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(engine.run_job_chunk(1).unwrap().unwrap().state, JobState::Running);
    load(&mut engine, vec![("items", json!({"id":"z-later","cost":0,"visits":0}))]);
    while engine.run_job_chunk(2).unwrap().is_some() {}
    assert_eq!(engine.job(&id).unwrap().unwrap().state, JobState::Done);
    assert_eq!(engine.effects(None, 500).unwrap().len(), 70);

    for automatic in [true, false] {
        for (end, expected) in [("break", 2), ("return", 1)] {
            let sweep = if automatic { "for item in items:" } else { "chunk item in items first 64 by byId:" };
            let source = format!("effect notify\ntable items:\n  public 'test'\n  online only\njob sweep():\n  {sweep}\n    emit notify {{ item: item.id }}\n    {end}\n  {sweep}\n    emit notify {{ item: item.id }}\n    break\n");
            let mut engine = memory(&source);
            load(&mut engine, vec![("items", json!({"id":"a"})), ("items", json!({"id":"b"}))]);
            assert_eq!(engine.run_job("sweep", BTreeMap::new(), 1).unwrap().state, JobState::Done);
            assert_eq!(engine.effects(None, 10).unwrap().len(), expected);
        }
    }

    let mut engine = memory(&VARYING.replace("for item in items:", "chunk item in items first 64 by byId:"));
    load(&mut engine, (0..64).map(|i| ("items", json!({"id":format!("i{i:03}"),"cost":8000,"visits":0}))).collect());
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Parked); assert_eq!(run.chunk_size, 64); assert_eq!(run.retries, 0);
    assert!(engine.effects(None, 100).unwrap().is_empty());
}

#[test]
fn scheduled_digest_for_busy_chat_and_one_hundred_memberships_retries_and_restarts() {
    let path = file();
    let bound = compiled(SOURCE);
    let mut engine = Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let users: Vec<_> = (0..50).map(|i| format!("recipient{i:022}")).collect();
    let mut seed = Vec::new();
    for (i, principal) in users.iter().enumerate() {
        seed.push(("profiles", json!({"id":format!("p{i:03}"),"principal":principal})));
        seed.push(("members", json!({"id":format!("b{i:03}"),"conversationId":"chat0","principal":principal,"readOrdinal":0})));
    }
    seed.push(("profiles", json!({"id":"zzz", "principal":"inactive"})));
    seed.push(("conversations", json!({"id":"chat0", "title":"busy"})));
    for n in 0..10_000 {
        seed.push(("messages", json!({"id":format!("m{n:011}"),"conversationId":"chat0","senderId":if n % 50 == 0 { users[0].clone() } else { "b".repeat(31) },
            "body":"x".repeat(31),"recipients":users,"ordinal":n+1,"at":if n < 5000 {15_000} else {125_000},"tombstone":false,"edited":false,"expiresAt":null,"replyTo":null})));
    }
    for chat in 1..100 {
        let id = format!("quiet{chat}");
        seed.push(("conversations", json!({"id":id,"title":"quiet"})));
        seed.push(("members", json!({"id":format!("q{chat}"),"conversationId":id,"principal":users[0],"readOrdinal":0})));
        for n in 0..5 {
            seed.push(("messages", json!({"id":format!("q{chat}m{n}"),"conversationId":id,"senderId":"quiet-sender","body":"quiet","recipients":[users[0]],
                "ordinal":n+1,"at":15_000,"tombstone":false,"edited":false,"expiresAt":null,"replyTo":null})));
        }
    }
    load(&mut engine, seed);
    assert!(engine.fire_schedules(0).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(120_000).unwrap(), ["dailyDigest"]);
    let first = engine.run_job_chunk(120_000).unwrap().unwrap();
    assert!(first.retries > 0 && first.chunk_size < 64, "{first:?}");
    assert_eq!(first.state, JobState::Running);
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert!(engine.fire_schedules(120_001).unwrap().is_empty());
    while engine.run_job_chunk(120_001).unwrap().is_some() {}
    let run = engine.job(&first.id).unwrap().unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    let effects = engine.effects(None, 500).unwrap();
    assert_eq!(effects.len(), 50);
    for effect in effects {
        let probe = effect.payload.field("targetUserId").unwrap() == &Value::Id(users[0].clone());
        assert_eq!(effect.payload.field("unreadMessages").unwrap(), &Value::Int(if probe { 5395 } else { 5000 }));
        assert_eq!(effect.payload.field("unreadChats").unwrap(), &Value::Int(if probe { 100 } else { 1 }));
    }
    let rerun = engine.run_job("daily", period(), 120_002).unwrap();
    assert_eq!(rerun.state, JobState::Done);
    assert_eq!(rerun.rows_written, 0);
    assert_eq!(engine.effects(None, 500).unwrap().len(), 50);
    println!("scheduled scale: busy_rows=10000 period_candidates=5000 probe_chats=100 effects=50 chunks={} chunk_size={} retries={} peak_heap={}", run.chunks, run.chunk_size, run.retries, run.heap_peak);
    drop(engine);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn replay_consumes_canonical_keys_and_effect_names_have_separate_domains() {
    let source = VARYING.replace("effect notify", "effect notify\neffect audit").replace("    for i in range(0, item.cost):", "    emit audit { item: item.id } once [item.id]\n    emit notify { duplicate: true } once [item.id]\n    for i in range(0, item.cost):");
    let path = file();
    let bound = compiled(&source);
    let mut engine = Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, vec![("items", json!({"id":"i", "cost":0,"visits":0}))]);
    engine.store_mut().set_meta("dev:replay", "true").unwrap();
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Done);
    assert_eq!(engine.effect_counts().unwrap()["suppressed"], 2);
    assert!(engine.effects(None, 10).unwrap().is_empty());
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    engine.store_mut().set_meta("dev:replay", "false").unwrap();
    assert_eq!(engine.run_job("sweep", BTreeMap::new(), 2).unwrap().state, JobState::Done);
    assert!(engine.effects(None, 10).unwrap().is_empty());
    let value: String = engine.store().conn().query_row("SELECT data FROM r", [], |r| r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&value).unwrap().field("visits").unwrap(), &Value::Int(2));
    drop(engine);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn automatic_sweep_freezes_bounds_across_reopen_but_replays_prelude() {
    let source = r#"
table items:
  at: time
  observed: time ?
  by byAt: at, id
  immutable at
  public 'test'
  online only
job sweep():
  cutoff = now
  for item in items[at < cutoff] by byAt:
    update items[item.id] { observed: cutoff }
"#;
    let path = file(); let bound = compiled(source);
    let mut engine = Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, (0..130).map(|i| ("items", json!({"id":format!("i{i:03}"),"at":i,"observed":null}))).collect());
    let id = engine.enqueue_job("sweep", BTreeMap::new(), 100).unwrap();
    let first = engine.run_job_chunk(100).unwrap().unwrap();
    assert_eq!(first.chunk_size, 64); assert_eq!(first.rows_written, 64);
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    while engine.run_job_chunk(200).unwrap().is_some() {}
    assert_eq!(engine.job(&id).unwrap().unwrap().rows_written, 100, "the later clock must not extend the sweep");
    let rows = engine.store().conn().prepare("SELECT data FROM r ORDER BY id").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(serde_json::from_str::<Value>(row).unwrap().field("observed").unwrap(), &if i < 64 {Value::Int(100)} else if i < 100 {Value::Int(200)} else {Value::Null});
    }
    drop(engine); std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn unstable_sweeps_and_carried_locals_are_refused_and_constraint_refusals_do_not_retry() {
    for (source, code) in [
        (VARYING.replace("  public 'test items'", "  by byCost: cost, id\n  public 'test items'").replace("for item in items:", "for item in items[] by byCost:"), "E_JOB_CURSOR_INDEX"),
        (VARYING.replace("job sweep():", "job sweep():\n  total = 0").replace("    emit notify", "    total = total + 1\n    emit notify"), "E_QUARRY_PLACEMENT"),
        (VARYING.replace("job sweep():", "job sweep():\n  totals = []").replace("    emit notify", "    totals = totals + [item.id]\n    emit notify"), "E_QUARRY_PLACEMENT"),
    ] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == code), "expected {code}: {:?}", bound.diagnostics);
    }
    let mut engine = memory(&VARYING.replace("    emit notify", "    require item.cost = 0 else TOO_COSTLY\n    emit notify"));
    load(&mut engine, vec![("items", json!({"id":"item","cost":1,"visits":0}))]);
    let run = engine.run_job("sweep", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, JobState::Parked); assert_eq!(run.retries, 0); assert_eq!(run.chunk_size, 64);
    assert!(run.error.unwrap().starts_with("TOO_COSTLY:"));
}

#[test]
fn domain_scalars_keep_admission_rules_expiry_and_meter_cuts() {
    let source = r#"
effect notify
table items:
  owner: principal
  n: int
  active: bool
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
query total(owner: principal):
  return count(items[owner] by byOwner where .active)
query amount(owner: principal):
  return sum(items[owner] by byOwner where .active, .n)
query any(owner: principal):
  return exists items[owner] by byOwner where .active
mutation totalMutation():
  n = count(items[viewer] by byOwner where .active)
  emit notify { n } once [viewer, 'total']
  return n
"#;
    let mut engine = memory(source);
    load(&mut engine, (0..8).map(|i| ("items",json!({"id":format!("i{i}"),"owner":"alice","n":i,"active":i%2==0}))).collect());
    let ctx = |viewer: &str| Context::new(viewer, [("owner".into(),Value::Id("alice".into()))].into()).at(1);
    for (op, expected) in [("total",Value::Int(4)), ("amount",Value::Int(12)), ("any",Value::Bool(true))] {
        assert_eq!(engine.query(op,ctx("alice")).unwrap().data, expected);
        assert_eq!(engine.query(op,ctx("bob")).unwrap().data, if op == "any" {Value::Bool(false)} else {Value::Int(0)});
    }
    engine.set_ceilings(Ceilings {examined:3, ..Ceilings::default()});
    let cut = engine.query("total",ctx("alice")).unwrap();
    assert!(!cut.complete); assert_eq!(cut.data, Value::Null);
    let outcome = engine.mutate("totalMutation",Some("cut"),Context::new("alice",BTreeMap::new()).at(1)).unwrap();
    assert!(matches!(outcome.state, snapback4_core::engine::WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{outcome:?}");
    assert!(engine.effects(None,10).unwrap().is_empty());
    for steps in [2, 8, 20] {
        engine.set_ceilings(Ceilings {steps, ..Ceilings::default()});
        let cut = engine.query("total",ctx("alice")).unwrap();
        assert!(!cut.complete); assert_eq!(cut.data, Value::Null);
    }
    for change in ["  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n", ""] {
        let changed = source.replace("  n: int\n", &format!("  n: int\n{change}")).replace("read <- .owner = viewer", if change.is_empty() {"read <- .n = 0"} else {"read <- .owner = viewer"});
        let changed = format!("{}mutation totalMutation{}", changed.split("query total").next().unwrap(), changed.split("mutation totalMutation").nth(1).unwrap());
        let bound = snapback4_lang::compile(&[("schema.q".into(),changed)]);
        assert!(bound.diagnostics.iter().any(|d| d.code=="E_STRUCTURAL_FANOUT"), "{:?}",bound.diagnostics);
    }
}

#[test]
fn device_streaming_totals_require_coverage_and_emits_claim_no_keys() {
    use snapback4_core::rows::{MemoryRows, Rows};
    let source = r#"
effect notify
table items:
  n: int
  expiresAt: time ?
  by byExpiry: expiresAt
  expire at .expiresAt
  public 'test'
  sync last 2 by byId
query total():
  return count(items)
query amount():
  return sum(items, .n)
query any():
  return exists items
mutation send():
  emit notify { n: 1 } once ['key']
  return true
"#;
    let bound = compiled(source);
    let rows = MemoryRows::new(); let table = &bound.schema.tables["items"];
    let row = wire::row_from_json(table,&json!({"id":"i","n":7,"expiresAt":100})).unwrap();
    rows.put("items",table,&row,None).unwrap();
    for op in ["total","amount"] {
        let program = &bound.programs.iter().find(|p|p.program.name==op).unwrap().program;
        let result = snapback4_core::engine::local::query(&rows,&bound.schema,program,Context::new("alice",BTreeMap::new()).at(1),Ceilings::default()).unwrap();
        assert!(!result.complete); assert_eq!(result.data,Value::Null);
    }
    let any = &bound.programs.iter().find(|p|p.program.name=="any").unwrap().program;
    let positive = snapback4_core::engine::local::query(&rows,&bound.schema,any,Context::new("alice",BTreeMap::new()).at(1),Ceilings::default()).unwrap();
    assert!(positive.complete); assert_eq!(positive.data,Value::Bool(true));
    let expired = snapback4_core::engine::local::query(&rows,&bound.schema,any,Context::new("alice",BTreeMap::new()).at(100),Ceilings::default()).unwrap();
    assert!(!expired.complete); assert_eq!(expired.data,Value::Null);
    let whole = compiled(&source.replace("sync last 2 by byId", "sync"));
    for (op, expected) in [("total", Value::Int(1)), ("amount", Value::Int(7))] {
        let program = &whole.programs.iter().find(|p|p.program.name==op).unwrap().program;
        let result = snapback4_core::engine::local::query(&rows,&whole.schema,program,Context::new("alice",BTreeMap::new()).at(1),Ceilings::default()).unwrap();
        assert!(result.complete); assert_eq!(result.data,expected); assert_eq!(result.next_expiry,Some(100));
        let expired = snapback4_core::engine::local::query(&rows,&whole.schema,program,Context::new("alice",BTreeMap::new()).at(100),Ceilings::default()).unwrap();
        assert!(expired.complete); assert_eq!(expired.data,Value::Int(0));
    }
    let send = &bound.programs.iter().find(|p|p.program.name=="send").unwrap().program;
    let prediction = snapback4_core::engine::local::predict(&rows,&bound.schema,send,Context::new("alice",BTreeMap::new()).at(1),Ceilings::default()).unwrap();
    assert_eq!(prediction.result,Value::Bool(true));
}

#[test]
fn canonical_keys_are_ordered_values_and_outbox_failure_rolls_back_the_key() {
    let source = r#"
effect notify
mutation send():
  emit notify { n: 1 } once [{ a: 1, b: 2 }]
  emit notify { n: 2 } once [{ b: 2, a: 1 }]
  emit notify { n: 3 } once [1, '1']
  emit notify { n: 4 } once ['1', 1]
  return true
"#;
    let mut engine = memory(source);
    engine.store().conn().execute_batch("CREATE TRIGGER fail_outbox BEFORE INSERT ON _outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END;").unwrap();
    assert!(engine.mutate("send",Some("failed"),Context::system().at(1)).is_err());
    let tables: i64 = engine.store().conn().query_row("SELECT count(*) FROM sqlite_master WHERE name = '_effect_keys'",[],|r|r.get(0)).unwrap();
    assert_eq!(tables,0, "failed first emission rolls back the key table too");
    engine.store().conn().execute_batch("DROP TRIGGER fail_outbox").unwrap();
    engine.mutate("send",Some("good"),Context::system().at(2)).unwrap();
    assert_eq!(engine.effects(None,10).unwrap().len(),3);
    engine.mutate("send",Some("again"),Context::system().at(3)).unwrap();
    assert_eq!(engine.effects(None,10).unwrap().len(),3);
    engine.store().conn().execute("DELETE FROM _outbox", []).unwrap();
    engine.mutate("send",Some("after-removal"),Context::system().at(4)).unwrap();
    assert!(engine.effects(None,10).unwrap().is_empty(), "settled or removed outbox rows never release lifetime keys");
    let stmt = snapback4_core::ir::Stmt::Emit {effect:"notify".into(),payload:snapback4_core::ir::Expr::Literal(Value::Null),once:None};
    let json = serde_json::to_value(&stmt).unwrap();
    assert!(json["Emit"].get("once").is_none());
    assert_eq!(serde_json::from_value::<snapback4_core::ir::Stmt>(json).unwrap(),stmt);
}

#[test]
fn inner_job_domain_uses_job_meter_without_truncating_at_query_ceiling() {
    let source = r#"
effect total
table starts:
  public
  online only
table entries:
  value: int
  public
  online only
job sweep():
  for start in starts:
    n = 0
    for entry in entries:
      n = n + entry.value
    emit total { n }
"#;
    let mut engine = memory(source);
    load(&mut engine,vec![("starts",json!({"id":"start"}))]);
    load(&mut engine,(0..9000).map(|n|("entries",json!({"id":format!("i{n:05}"),"value":1}))).collect());
    let run = engine.run_job("sweep",BTreeMap::new(),1).unwrap();
    assert_eq!(run.state,JobState::Done,"{run:?}");
    assert_eq!(engine.effects(None,1).unwrap()[0].payload.field("n").unwrap(),&Value::Int(9000));
}
