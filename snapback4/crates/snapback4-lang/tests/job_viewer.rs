//! LLP 3000.007 §21.12: ordinary query and job read authority must agree.
use snapback4_core::{Context, Engine, Value, Store, engine::job::JobState, value::object};
use snapback4_lang::{compile, Bound};
use std::collections::BTreeMap;

fn id(s: impl Into<String>) -> Value { Value::Id(s.into()) }
fn args(start: i64, end: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([("periodStart".into(), Value::Int(start)), ("periodEnd".into(), Value::Int(end))])
}
fn source() -> String {
    snapback4_lang::guide::card("jobs").unwrap().split("```quarry\n").skip(1)
        .map(|part| part.split("```").next().unwrap()).find(|part| part.contains("job digest(")).unwrap().to_owned()
}
fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn engine(source: &str) -> Engine {
    let bound = checked(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn profile(p: &str) -> (String, Value) { ("profiles".into(), object([("id", id(p)), ("principal", id(p))])) }
fn member(room: usize, p: &str, seen: i64) -> (String, Value) {
    ("members".into(), object([("id", id(format!("{room}:{p}"))), ("conversationId", id(format!("r{room}"))), ("principal", id(p)), ("readOrdinal", Value::Int(seen))]))
}
fn message(room: usize, n: usize, p: &str, at: i64, expiry: Option<i64>, tombstone: bool) -> (String, Value) {
    ("messages".into(), object([("id", id(format!("m{room}:{n:05}"))), ("conversationId", id(format!("r{room}"))), ("senderId", id(p)),
        ("ordinal", Value::Int(n as i64)), ("body", Value::String(format!("message {n}"))), ("at", Value::Int(at)),
        ("expiresAt", expiry.map(Value::Int).unwrap_or(Value::Null)), ("tombstone", Value::Bool(tombstone))]))
}
fn drain(e: &mut Engine, name: &str, p: &str, mut args: BTreeMap<String, Value>, now: i64) -> Vec<Value> {
    let mut rows = Vec::new();
    args.insert("c".into(), Value::Null);
    loop {
        let page = e.query(name, Context::new(p, args.clone()).at(now)).unwrap();
        assert!(page.complete && !page.unavailable, "{name}/{p}: {page:?}");
        rows.extend(page.data.as_array().unwrap().iter().cloned());
        match page.next { Some(next) => { args.insert("c".into(), Value::String(next)); }, None => break }
    }
    rows
}
fn done(e: &mut Engine, name: &str, input: BTreeMap<String, Value>, now: i64) {
    let run = e.run_job(name, input, now).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
}

#[test]
fn random_viewer_rows_counts_disclosure_expiry_and_removal_equal_clients() {
    let source = source().replace("  body: text <=4000", "  secret: int default 7 written by .senderId\n  body: text <=4000") + r#"
query room(r: conversations, c: cursor ?):
  return messages where .conversationId = r and not .tombstone first 7 by .ordinal after c
job observe(r: conversations, periodStart: time, periodEnd: time):
  for p in profiles:
    rows = []
    totals = []
    as p.principal:
      for m in all(room(r, null)):
        rows = rows + [m]
      for m in all(inbox(null)):
        n = unreadTotal(m.conversationId, m.readOrdinal, periodStart, periodEnd).data
        totals = totals + [{ conversationId: m.conversationId, unread: n }]
    emit push { principal: p.principal, rows, totals, authorityRestored: viewer }
"#;
    let people = ["dev:alice", "user:bob", "guest:carol", "service:reader", "user:none", "user:removed"];
    let mut random = 0x8197_abcd_8765_u64;
    for seed in 0..24 {
        round1::compare_hidden_rows(seed);
        let mut next = || { random ^= random << 13; random ^= random >> 7; random ^= random << 17; random };
        let mut e = engine(&source);
        let mut rows: Vec<_> = people.iter().map(|p| profile(p)).collect();
        for room in 0..27 {
            rows.push(("conversations".into(), object([("id", id(format!("r{room}"))), ("title", Value::String("room".into()))])));
            for p in &people[..4] {
                if room == 0 || next() % 3 != 0 { rows.push(member(room, p, (next() % 20) as i64)); }
            }
            rows.push(member(room, "user:removed", 0));
            for n in 1..=35 {
                let at = 50 + (next() % 220) as i64;
                let expiry = match next() % 4 { 0 => Some(199), 1 => Some(200), 2 => Some(201), _ => None };
                rows.push(message(room, n, people[(next() % 4) as usize], at, expiry, next() % 5 == 0));
            }
        }
        e.seed_at(rows, 0).unwrap();
        for room in 0..27 { e.seed_delete("members", &format!("{room}:user:removed")).unwrap(); }
        let mut expected = BTreeMap::new();
        for p in people {
            let rows = drain(&mut e, "room", p, BTreeMap::from([("r".into(), id("r0"))]), 200);
            let totals = drain(&mut e, "inbox", p, BTreeMap::new(), 200).into_iter().map(|m| {
                let mut input = args(100, 200);
                input.insert("conversationId".into(), m.field("conversationId").unwrap().clone());
                input.insert("readOrdinal".into(), m.field("readOrdinal").unwrap().clone());
                let total = e.query("unreadTotal", Context::new(p, input).at(200)).unwrap();
                assert!(total.complete);
                object([("conversationId", m.field("conversationId").unwrap().clone()), ("unread", total.data)])
            }).collect::<Vec<_>>();
            if p == "user:none" || p == "user:removed" { assert!(rows.is_empty() && totals.is_empty()); }
            for row in &rows {
                let visible = row.as_object().unwrap().contains_key("secret");
                assert_eq!(visible, row.field("senderId").unwrap() == &id(p));
            }
            expected.insert(p.to_owned(), (rows, totals));
        }
        let mut input = args(100, 200); input.insert("r".into(), id("r0"));
        done(&mut e, "observe", input, 200);
        let effects = e.effects(None, 100).unwrap();
        assert_eq!(effects.len(), people.len());
        for effect in effects {
            let p = effect.payload.field("principal").unwrap().as_str().unwrap();
            assert_eq!(effect.payload.field("rows").unwrap().as_array().unwrap(), &expected[p].0, "seed {seed}/{p}");
            assert_eq!(effect.payload.field("totals").unwrap().as_array().unwrap(), &expected[p].1, "seed {seed}/{p}");
            assert_eq!(effect.payload.field("authorityRestored").unwrap(), &id("system"));
        }
    }
}

#[test]
fn side_effects_and_invalid_scopes_refuse_with_repairs() {
    let base = "effect push\ntable profiles:\n  principal: principal\n  public 'profiles'\nfn writeIt(p: profiles):\n  update profiles[p.id] { principal: p.principal }\n  return 1\njob run():\n  for p in profiles:\n    as p.principal:\n      BODY\n";
    for body in ["update profiles[p.id] { principal: p.principal }", "emit push {}", "x = writeIt(p)", "x = new", "x = consumeOnce(p)", "x = consume(p)"] {
        let bound = compile(&[("schema.q".into(), base.replace("BODY", body))]);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_JOB_VIEWER_READ_ONLY").unwrap_or_else(|| panic!("{body}: {:?}", bound.diagnostics));
        assert!(d.rewrite.contains("compute inside as; act outside"));
    }
    for (source, code) in [
        (base.replace("BODY", "return 1"), "E_JOB_VIEWER_FLOW"),
        (base.replace("as p.principal", "as 'system'").replace("BODY", "x = 1"), "E_JOB_VIEWER_PRINCIPAL"),
        (base.replace("as p.principal", "as null").replace("BODY", "x = 1"), "E_JOB_VIEWER_PRINCIPAL"),
        (base.replace("job run()", "query run()").replace("BODY", "x = 1"), "E_JOB_VIEWER_CONTEXT"),
        (base.replace("BODY", "as p.principal:\n        x = 1"), "E_JOB_VIEWER_CONTEXT"),
    ] {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == code), "{code}: {:?}", bound.diagnostics);
    }
}

#[test]
fn over_budget_recipient_parks_without_partial_effect_or_key() {
    let mut e = engine(&source());
    let mut rows = vec![profile("dev:alice"), member(0, "dev:alice", 0),
        ("conversations".into(), object([("id", id("r0")), ("title", Value::String("large".into()))]))];
    rows.extend((1..=17_000).map(|n| message(0, n, "dev:bob", 150, None, false)));
    e.seed_at(rows, 0).unwrap();
    let run = e.run_job("digest", args(100, 200), 200).unwrap();
    assert_eq!(run.state, JobState::Parked, "{run:?}");
    assert!(run.error.as_deref().unwrap().contains("E_BOUND"), "{run:?}");
    assert_eq!(run.chunk_size, 1);
    assert!(e.effects(None, 100).unwrap().is_empty());
    let keys: i64 = e.store().conn().query_row("SELECT count(*) FROM sqlite_master WHERE name = '_effect_keys'", [], |r| r.get(0)).unwrap();
    if keys != 0 { assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _effect_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 0); }
}

#[test]
fn guide_digest_restart_closed_clients_idle_and_legacy_emissions() {
    let modern = source().replace("every 1d at 08:00", "every 120s");
    let legacy_body = r#"    unread = 0
    chats = 0
    for m in members where .principal = p.principal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
"#;
    let from = modern.find("    unread = 0\n").unwrap();
    let to = modern[from..].find("    if unread > 0:").unwrap() + from;
    let legacy = format!("{}{}{}", &modern[..from], legacy_body, &modern[to..]);
    let mut results = Vec::new();
    for (tag, source) in [("viewer", modern), ("legacy", legacy)] {
        let dir = std::env::temp_dir().join(format!("jv-digest-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let _ = std::fs::remove_file(&path);
        let b = checked(&source);
        let mut e = Engine::new(Store::open(&path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        e.fire_schedules(0).unwrap();
        e.seed_at(vec![profile("dev:alice"), profile("dev:bob"), profile("user:removed"), member(0, "dev:alice", 1), member(0, "dev:bob", 0), member(0, "user:removed", 0),
            ("conversations".into(), object([("id", id("r0")), ("title", Value::String("chat".into()))])),
            message(0, 1, "dev:bob", 1_000, None, false), message(0, 2, "dev:bob", 2_000, None, false),
            message(0, 3, "dev:alice", 3_000, None, false), message(0, 4, "dev:bob", 4_000, Some(120_000), false),
            message(0, 5, "dev:bob", 5_000, None, true)], 0).unwrap();
        e.seed_delete("members", "0:user:removed").unwrap();
        assert!(e.fire_schedules(60_000).unwrap().is_empty());
        drop(e); // No clients or sessions exist; restart midway through the period.
        let mut e = Engine::open_at(Store::open(&path).unwrap(), 60_000).unwrap();
        assert_eq!(e.fire_schedules(120_000).unwrap(), ["daily"]);
        while e.run_job_chunk(120_000).unwrap().is_some() {}
        let first = e.effects(None, 100).unwrap();
        assert_eq!(first.len(), 2);
        assert!(first.iter().all(|e| e.payload.field("unread").unwrap() == &Value::Int(1)));
        done(&mut e, "digest", args(0, 120_000), 120_000);
        assert_eq!(e.effects(None, 100).unwrap().len(), 2, "rerun deduplicates");
        drop(e);
        let mut e = Engine::open_at(Store::open(&path).unwrap(), 120_000).unwrap();
        assert!(e.fire_schedules(120_000).unwrap().is_empty());
        assert_eq!(e.fire_schedules(240_000).unwrap(), ["daily"]);
        while e.run_job_chunk(240_000).unwrap().is_some() {}
        let mut payloads: Vec<_> = e.effects(None, 100).unwrap().into_iter().map(|e| e.payload).collect();
        assert_eq!(payloads.len(), 2, "idle period adds no digest");
        payloads.sort_by_key(snapback4_core::value::canonical_json);
        results.push(payloads);
        drop(e);
        std::fs::remove_dir_all(dir).unwrap();
    }
    assert_eq!(results[0], results[1]);
}

#[test]
fn calibration_28_builder_digest_matches_with_restart_and_idle_period() {
    const SCHEMA: &str = include_str!("../../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/source/snapback/schema.q");
    const CONFIG: &str = include_str!("../../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/source/snapback/config.q");
    const SCHEDULE: &str = include_str!("../../../../benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/source/snapback/digest.q");
    let start = SCHEMA.find("    for member in members where .principal = p.principal:").unwrap();
    let end = start + SCHEMA[start..].find("    if newFollowers > 0").unwrap();
    let modern = format!("{}{}{}{}", &SCHEMA[..start], r#"    as p.principal:
      for chat in all(unreadPreview(periodStart, periodEnd, null)):
        if chat.unread > 0:
          unreadMessages = unreadMessages + chat.unread
          unreadChats = unreadChats + 1
"#, &SCHEMA[end..], r#"
query unreadPreview(start: time, end: time, c: cursor ?):
  return members where .principal = viewer first 2 by .conversation after c { conversation, unread: digestUnread(.conversation, viewer, .seenOrdinal, start, end) }
"#);
    let mut expected = None;
    for (tag, source) in [("original", SCHEMA), ("viewer", modern.as_str())] {
        let bound = compile(&[("schema.q".into(), source.into()), ("config.q".into(), CONFIG.into()), ("digest.q".into(), SCHEDULE.into())]);
        assert!(bound.diagnostics.is_empty(), "{tag}: {:?}", bound.diagnostics);
        let dir = std::env::temp_dir().join(format!("jv-clique-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let mut e = Engine::new_at(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), 0).unwrap();
        e.fire_schedules(0).unwrap();
        let mut rows = Vec::new();
        for p in ["alice", "bob", "removed", "none"] {
            rows.push(("profiles".into(), object([("id", id(p)), ("principal", id(format!("user:{p}"))), ("displayName", Value::String(p.into())),
                ("handle", Value::String(p.into())), ("bio", Value::String("".into())), ("location", Value::String("".into()))])));
        }
        for room in 0..5 {
            rows.push(("conversations".into(), object([("id", id(format!("r{room}"))), ("kind", Value::String("group".into())), ("title", Value::String("chat".into())),
                ("description", Value::String("".into())), ("creator", id("user:alice"))])));
            for p in ["alice", "bob", "removed"] {
                rows.push(("members".into(), object([("id", id(format!("{room}:{p}"))), ("conversation", id(format!("r{room}"))), ("principal", id(format!("user:{p}"))),
                    ("role", Value::String("member".into())), ("joinedOrdinal", Value::Int(0)), ("seenOrdinal", Value::Int(if p == "alice" { 1 } else { 0 }))])));
            }
            for n in 1..=6 {
                rows.push(("messages".into(), object([("id", id(format!("m{room}:{n}"))), ("conversation", id(format!("r{room}"))), ("sender", id(if n == 3 { "user:alice" } else { "user:bob" })),
                    ("ordinal", Value::Int(n)), ("recipients", Value::Int(2)), ("text", Value::String("hello".into())), ("at", Value::Int(if n == 6 { -1 } else { n * 1000 })),
                    ("expiresAt", if n == 4 { Value::Int(120_000) } else { Value::Null }), ("tombstone", Value::Bool(n == 5))])));
            }
        }
        let profiles: Vec<_> = rows.iter().filter(|(table, _)| table == "profiles").map(|(_, row)| row.clone()).collect();
        rows.retain(|(table, _)| table != "profiles");
        for row in profiles {
            let p = row.field("principal").unwrap().as_str().unwrap();
            let input = ["displayName", "handle", "bio", "location"].into_iter().map(|name| (name.into(), row.field(name).unwrap().clone()))
                .chain([("link".into(), Value::Null)]).collect();
            let outcome = e.mutate("saveProfile", None, Context::new(p, input).at(1000)).unwrap();
            assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { .. }), "{outcome:?}");
        }
        for (name, viewer, input, now) in [
            ("setFollow", "user:bob", BTreeMap::from([("principal".into(), id("user:alice")), ("enabled".into(), Value::Bool(true))]), 4000),
            ("publish", "user:alice", BTreeMap::from([("id".into(), id("post")), ("text".into(), Value::String("post".into())), ("parent".into(), Value::Null), ("images".into(), Value::Array(vec![])), ("video".into(), Value::Null)]), 5000),
        ] {
            let outcome = e.mutate(name, None, Context::new(viewer, input).at(now)).unwrap();
            assert!(matches!(outcome.state, snapback4_core::WriteState::Sent { .. }), "{outcome:?}");
        }
        e.seed_at(rows, 0).unwrap();
        for room in 0..5 { e.seed_delete("members", &format!("{room}:removed")).unwrap(); }
        assert!(e.fire_schedules(60_000).unwrap().is_empty());
        drop(e);
        let mut e = Engine::open_at(Store::open(&path).unwrap(), 60_000).unwrap();
        assert_eq!(e.fire_schedules(120_000).unwrap(), ["daily"]);
        while e.run_job_chunk(120_000).unwrap().is_some() {}
        assert!(e.jobs(100).unwrap().iter().all(|j| j.state == JobState::Done), "{:?}", e.jobs(100).unwrap());
        let mut payloads: Vec<_> = e.effects(None, 100).unwrap().into_iter().map(|e| e.payload).collect();
        assert_eq!(payloads.len(), 2, "{tag}");
        for payload in &payloads {
            assert_eq!(payload.field("unreadMessages").unwrap(), &Value::Int(5));
            assert_eq!(payload.field("unreadChats").unwrap(), &Value::Int(5));
            assert_eq!(payload.field("newPostsInFollowing").unwrap(), &Value::Int(1));
        }
        payloads.sort_by_key(snapback4_core::value::canonical_json);
        if let Some(expected) = &expected { assert_eq!(&payloads, expected); } else { expected = Some(payloads); }
        done(&mut e, "dailyDigest", args(0, 120_000), 120_000);
        assert!(e.fire_schedules(120_000).unwrap().is_empty());
        assert_eq!(e.fire_schedules(240_000).unwrap(), ["daily"]);
        while e.run_job_chunk(240_000).unwrap().is_some() {}
        assert!(e.jobs(100).unwrap().iter().all(|j| j.state == JobState::Done));
        assert_eq!(e.effects(None, 100).unwrap().len(), 2);
        drop(e);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn all_refuses_a_cursor_argument_that_does_not_continue_the_returned_page() {
    let source = source();
    let page = "first 20 by .conversationId after c { conversationId, readOrdinal }";
    assert!(source.contains(page));
    let source = source.replace(page, "first 20 by .conversationId { conversationId, readOrdinal }");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_JOB_VIEWER_QUERY" && d.message.contains("owns the returned page")), "{:?}", b.diagnostics);
}

#[test]
fn service_seats_direct_reads_query_calls_and_prior_chunk_writes_share_clock_and_transaction() {
    let source = r#"
effect push
table profiles:
  principal: principal
  public 'profiles'
table settings:
  value: int
  read <- viewer = 'service:reader'
  update <- deny
  online only
query current():
  return { value: settings['only'], clock: now, principal: viewer }
job inspect():
  for p in profiles:
    update settings['only'] { value: 42 }
    value = null
    direct = null
    as p.principal:
      direct = settings['only']
      value = current().data
    emit push { principal: p.principal, direct, value, outside: viewer }
"#;
    let mut e = engine(source);
    e.seed_at([profile("service:reader"), profile("user:none"), ("settings".into(), object([("id", id("only")), ("value", Value::Int(1))]))], 0).unwrap();
    done(&mut e, "inspect", BTreeMap::new(), 1234);
    for effect in e.effects(None, 100).unwrap() {
        let p = effect.payload.field("principal").unwrap().as_str().unwrap();
        let client = e.query("current", Context::new(p, BTreeMap::new()).at(1234)).unwrap();
        assert_eq!(effect.payload.field("value").unwrap(), &client.data);
        assert_eq!(effect.payload.field("direct").unwrap(), client.data.field("value").unwrap());
        assert_eq!(effect.payload.field("outside").unwrap(), &id("system"));
        if p == "service:reader" { assert_eq!(client.data.field("value").unwrap().field("value").unwrap(), &Value::Int(42)); }
        else { assert_eq!(client.data.field("value").unwrap(), &Value::Null); }
    }
}

#[test]
fn runtime_refuses_system_viewer_and_forged_effectful_blocks() {
    use snapback4_core::ir::{Builtin, Expr, Stmt};
    let mut b = checked(&source());
    let job = b.programs.iter_mut().find(|p| p.program.name == "digest").unwrap();
    let Stmt::For { body, .. } = job.program.body.last_mut().unwrap() else { panic!() };
    let scope = body.iter_mut().find_map(|stmt| match stmt {
        Stmt::Let { value: Expr::Builtin { builtin: Builtin::JobAs, args }, .. } => Some(args), _ => None,
    }).unwrap();
    scope[1] = Expr::Block { body: vec![Stmt::Emit { effect: "push".into(), payload: Expr::Object(BTreeMap::new()), once: None }], value: Box::new(Expr::Literal(Value::Null)) };
    let mut forged = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    forged.seed_at([profile("dev:alice")], 0).unwrap();
    let run = forged.run_job("digest", args(0, 10), 10).unwrap();
    assert!(run.error.unwrap().starts_with("E_JOB_VIEWER_READ_ONLY"));
    assert!(forged.effects(None, 10).unwrap().is_empty());
    let mut e = engine(&source().replace("as p.principal:", "as viewer:"));
    e.seed_at([profile("dev:alice")], 0).unwrap();
    let run = e.run_job("digest", args(0, 10), 10).unwrap();
    assert!(run.error.unwrap().starts_with("E_JOB_VIEWER_PRINCIPAL"));
    assert!(e.effects(None, 10).unwrap().is_empty());
}

#[test]
fn changing_a_called_query_parks_an_already_queued_job() {
    let s = source();
    let mut e = engine(&s);
    let run = e.enqueue_job("digest", args(0, 10), 10).unwrap();
    let changed = checked(&s.replace("first 20 by .conversationId after c", "first 19 by .conversationId after c"));
    e.adopt_at(changed.schema, changed.programs.into_iter().map(|p| p.program), 10).unwrap();
    e.run_job_chunk(10).unwrap();
    assert!(e.job(&run).unwrap().unwrap().error.unwrap().starts_with("E_JOB_GENERATION"));
}

#[path = "job_viewer/round1.rs"]
mod round1;
