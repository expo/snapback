//! Successful mutation data and generated TypeScript agree across write barriers.
use snapback4_core::{Context, Engine, Value, WriteState, wire};
use snapback4_lang::{compile, types::Ty};
use serde_json::json;

const TABLES: &str = r#"
table mods:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table publicRows:
  slug: text <=20
  body: text <=20
  unique slug
  public 'test rows'
  insert <- allow
  update <- allow
  delete <- allow
  online only
table privateRows:
  owner: principal
  visible: bool
  body: text <=20
  read <- .owner = viewer or .visible or exists mods[principal = viewer]
  insert <- allow
  update <- allow
  delete <- allow
  online only
table throughRows:
  parent: publicRows
  body: text <=20
  immutable parent
  read through .parent
  insert <- allow
  update <- allow
  online only
table selfRows:
  principal: principal
  unique principal
  read <- exists selfRows[principal = viewer]
  insert <- allow
  update <- allow
  online only
table expiring:
  until: time
  body: text <=20
  public 'temporary test rows'
  insert <- allow
  update <- allow
  expire at .until
  online only
table unopened:
  opens: time
  body: text <=20
  public 'timed test rows'
  insert <- allow
  update <- allow
  by byOpens: opens
  not before .opens
  online only
"#;

fn checked(programs: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), format!("{TABLES}{programs}"))]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}
fn assert_type(b: &snapback4_lang::Bound, name: &str, table: &str, optional: bool) {
    let expected = Ty::Row(table.into());
    let expected = if optional { expected.optional() } else { expected };
    assert_eq!(b.programs.iter().find(|p| p.program.name == name).unwrap().result, expected, "{name}");
    let ts = snapback4_lang::emit::typescript(b);
    let line = ts.lines().find(|line| line.trim_start().starts_with(&format!("{name}: Mutation<"))).unwrap();
    assert!(line.ends_with(&format!("Rows[\"{table}\"]{}>;", if optional { " | null" } else { "" })), "{line}");
}

#[test]
fn guaranteed_write_results_and_stable_guarded_rereads_are_required() {
    let b = checked(r#"
mutation patch(k: publicRows):
  return update publicRows[k] { body: 'patched' }
mutation conditional(k: publicRows):
  return update publicRows[k] { body: 'conditional' } if .body = 'old'
mutation upsertRow(k: publicRows):
  return upsert publicRows[k] { slug: 'new', body: 'inserted' }
mutation asserted(k: publicRows):
  row = publicRows[k] ! else NOT_FOUND
  update publicRows[k] { body: 'patched' }
  return publicRows[k]
mutation guarded(k: privateRows):
  require exists privateRows[k] else NOT_FOUND
  update privateRows[k] { body: 'patched' }
  return privateRows[k]
mutation moderator(k: privateRows):
  require exists mods[principal = viewer] else NOT_MOD
  row = privateRows[k] ! else NOT_FOUND
  update privateRows[k] { visible: false }
  return privateRows[k]
mutation moderatorResult(k: privateRows):
  require exists mods[principal = viewer] else NOT_MOD
  return update privateRows[k] { visible: false }
"#);
    for name in ["patch", "conditional", "upsertRow", "asserted"] { assert_type(&b, name, "publicRows", false); }
    for name in ["guarded", "moderator", "moderatorResult"] { assert_type(&b, name, "privateRows", false); }
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for (table, row) in [("publicRows", json!({"id":"p", "slug":"old", "body":"old"})),
        ("privateRows", json!({"id":"s", "owner":"alice", "visible":true, "body":"old"})),
        ("mods", json!({"id":"m", "principal":"mod"}))] {
        let row = wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap();
        engine.seed_at(vec![(table.into(), row)], 4_000_000_000_000).unwrap();
    }
    let run = |engine: &mut Engine, name: &str, viewer: &str, id: &str| engine.mutate(name, None,
        Context::new(viewer, [("k".into(), Value::Id(id.into()))].into()).at(4_000_000_000_002));
    for name in ["conditional", "patch", "asserted"] {
        let result = run(&mut engine, name, "alice", "p").unwrap();
        assert!(matches!(result.state, WriteState::Sent { result, .. } if result != Value::Null));
    }
    let result = run(&mut engine, "upsertRow", "alice", "new").unwrap();
    assert!(matches!(result.state, WriteState::Sent { result, .. } if result != Value::Null));
    for (name, viewer) in [("guarded", "alice"), ("moderator", "mod"), ("moderatorResult", "mod")] {
        let result = run(&mut engine, name, viewer, "s").unwrap();
        assert!(matches!(result.state, WriteState::Sent { result, .. } if result != Value::Null));
    }
    assert!(matches!(run(&mut engine, "patch", "alice", "missing").unwrap().state, WriteState::Failed { .. }));
    assert!(matches!(run(&mut engine, "conditional", "alice", "p").unwrap().state, WriteState::Failed { .. }));
}

#[test]
fn authority_keys_lifetimes_and_control_flow_do_not_invent_presence() {
    let b = checked(r#"
mutation authorityLoss(k: privateRows):
  row = privateRows[k] ! else NOT_FOUND
  update privateRows[k] { owner: 'bob', visible: false }
  return privateRows[k]
mutation blind(k: privateRows):
  return update privateRows[k] { body: 'patched' }
mutation keyChange(k: publicRows, slug: text <=20):
  require exists publicRows[slug = slug] else NOT_FOUND
  update publicRows[k] { slug: 'different' }
  return publicRows[slug = slug]
mutation extraEquality(k: publicRows):
  require exists publicRows[id = k, body = 'old'] else NOT_FOUND
  update publicRows[k] { body: 'new' }
  return publicRows[id = k, body = 'old']
mutation removed(k: publicRows):
  require exists publicRows[k] else NOT_FOUND
  delete publicRows[k]
  return publicRows[k]
mutation otherWrite(k: privateRows, other: mods):
  require exists privateRows[k] else NOT_FOUND
  delete mods[other]
  return privateRows[k]
mutation branch(k: publicRows, ready: bool):
  if ready:
    require exists publicRows[k] else NOT_FOUND
    update publicRows[k] { body: 'new' }
  return publicRows[k]
fn patchHelper(k: publicRows):
  update publicRows[k] { body: 'helper' }
  return true
mutation helper(k: publicRows):
  row = publicRows[k] ! else NOT_FOUND
  patchHelper(k)
  return publicRows[k]
mutation rebound(k: publicRows, other: publicRows):
  key = k
  row = publicRows[key] ! else NOT_FOUND
  key = other
  update publicRows[k] { body: 'new' }
  return publicRows[key]
mutation selfResult(k: selfRows):
  require exists selfRows[principal = viewer] else NOT_FOUND
  return update selfRows[k] { principal: 'bob' }
mutation selfReread(k: selfRows):
  row = selfRows[k] ! else NOT_FOUND
  update selfRows[k] { principal: 'bob' }
  return selfRows[k]
mutation throughResult(k: throughRows):
  return update throughRows[k] { body: 'patched' }
mutation throughReread(k: throughRows):
  row = throughRows[k] ! else NOT_FOUND
  update throughRows[k] { body: 'patched' }
  return throughRows[k]
mutation expires(k: expiring):
  row = expiring[k] ! else NOT_FOUND
  update expiring[k] { until: now }
  return expiring[k]
mutation expiryResult(k: expiring):
  return update expiring[k] { until: now }
mutation unopenedResult(k: unopened):
  return upsert unopened[k] { opens: now + 1h, body: 'future' }
"#);
    for name in ["authorityLoss", "blind", "otherWrite"] { assert_type(&b, name, "privateRows", true); }
    for name in ["keyChange", "extraEquality", "removed", "branch", "helper", "rebound"] { assert_type(&b, name, "publicRows", true); }
    for name in ["expires", "expiryResult"] { assert_type(&b, name, "expiring", true); }
    assert_type(&b, "unopenedResult", "unopened", true);
    for name in ["throughResult", "throughReread"] { assert_type(&b, name, "throughRows", true); }
    for name in ["selfResult", "selfReread"] { assert_type(&b, name, "selfRows", true); }
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for (table, row) in [("privateRows", json!({"id":"s", "owner":"alice", "visible":true, "body":"old"})),
        ("selfRows", json!({"id":"self", "principal":"alice"})),
        ("expiring", json!({"id":"e", "until":4_000_000_000_100i64, "body":"old"}))] {
        let row = wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap();
        engine.seed_at(vec![(table.into(), row)], 4_000_000_000_000).unwrap();
    }
    for (name, id) in [("authorityLoss", "s"), ("expiryResult", "e"), ("unopenedResult", "u"), ("selfResult", "self")] {
        let outcome = engine.mutate(name, None, Context::new("alice", [("k".into(), Value::Id(id.into()))].into()).at(4_000_000_000_002)).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { result: Value::Null, .. }), "{name}: {outcome:?}");
    }
}

#[test]
fn indirect_maintained_roster_changes_never_prove_final_readability() {
    let b = compile(&[("schema.q".into(), r#"
view gateCounts: count counted where .active by .owner
  read <- allow
  online only
table counted:
  owner: principal
  active: bool
  read <- exists gateCounts[viewer]
  update <- allow
  online only
mutation direct(k: counted):
  require exists gateCounts[viewer] else NO_GATE
  return update counted[k] { active: false }
mutation reread(k: counted):
  require exists gateCounts[viewer] else NO_GATE
  row = counted[k] ! else NOT_FOUND
  update counted[k] { active: false }
  return counted[k]
"#.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    for name in ["direct", "reread"] {
        assert_type(&b, name, "counted", true);
        let mut engine = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
        let rows = [("counted", json!({"id":"c", "owner":"alice", "active":true}))];
        let rows: Vec<_> = rows.into_iter().map(|(table, row)| (table.into(),
            wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect();
        engine.seed_at(rows, 1).unwrap();
        let outcome = engine.mutate(name, None, Context::new("alice", [("k".into(), Value::Id("c".into()))].into()).at(2)).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { result: Value::Null, .. }), "{name}: {outcome:?}");
    }
}
