use snapback4_lang::compile;
use snapback4_core::{Context, Engine, Value, value::object};

const TABLES: &str = "table funding:
  owner: principal
  limit: int
  expires: time ?
  unique owner
  read <- .owner = viewer
  expire at .expires
  online only
table work:
  n: int
  public
  update <- allow
  online only
";

fn checked(body: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), format!("{TABLES}{body}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn optional_private_side_reads_name_the_hiding_rule_and_null_consequence() {
    for body in [
        "mutation approve(who: principal):\n  row = funding[who]\n  require (row.limit ?? 0) > 1 else NEEDS_APPROVAL\n  return null\n",
        "fn threshold(who: principal): funding[who]\nmutation approve(who: principal):\n  return threshold(who)\n",
        "fn threshold(who: principal): funding[who]\nmutation approve(who: principal, other: principal):\n  x = who\n  require x = viewer else NO\n  x = other\n  return threshold(x)\n",
    ] {
        let bound = checked(body);
        let notes: Vec<_> = bound.notes.iter().filter(|note| note.code == "N_LOOKUP_FILTERED").collect();
        assert_eq!(notes.len(), 1, "{:?}", bound.notes);
        assert!(notes[0].message.contains("read <- .owner = viewer") && notes[0].message.contains("returns null"), "{}", notes[0]);
        assert_eq!(notes[0].site.file, "schema.q");
        assert!(notes[0].site.line > 0);
        assert!(notes[0].rewrite.contains("projection"));
    }
}

#[test]
fn otherwise_readable_expired_rows_are_absent_in_mutations_and_helper_assertions() {
    let bound = checked("fn need(who: principal): funding[who] ! else NOT_FOUND\nmutation required(who: principal):\n  row = need(who)\n  require row.limit > 1 else TOO_LOW\n  return row.limit\nmutation early(who: principal):\n  require false else FIRST\n  return need(who)\nmutation optional(who: principal):\n  return funding[who]\n");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("funding".into(), object([("id", Value::Id("expired".into())), ("owner", Value::Id("viewer".into())), ("limit", Value::Int(3)), ("expires", Value::Int(10))]))]).unwrap();
    let ctx = |now| Context::new("viewer", [("who".into(), Value::Id("viewer".into()))].into()).at(now);
    assert!(matches!(engine.mutate("required", None, ctx(1)).unwrap().state, snapback4_core::WriteState::Sent { .. }));
    let optional = engine.mutate("optional", None, ctx(20)).unwrap();
    assert!(matches!(optional.state, snapback4_core::WriteState::Sent { result: Value::Null, .. }));
    for (op, code) in [("required", "NOT_FOUND"), ("early", "FIRST")] {
        let result = engine.mutate(op, None, ctx(20)).unwrap();
        assert!(matches!(result.state, snapback4_core::WriteState::Failed { ref why, .. } if why.code == code), "{result:?}");
    }
}

#[test]
fn exact_read_authority_guards_assertions_and_blind_writes_stay_quiet() {
    for body in [
        "mutation mine():\n  return funding[viewer]\n",
        "mutation guarded(who: principal):\n  require who = viewer else NO\n  return funding[who]\n",
        "mutation guarded(who: principal):\n  require exists funding[who] else NO\n  return funding[who]\n",
        "mutation required(who: principal):\n  return funding[who] ! else NO\n",
        "mutation blind(w: work):\n  update work[w] { n: 1 }\n",
        "query optional(who: principal):\n  return funding[who]\n",
        "fn threshold(who: principal): funding[who]\nmutation guarded(who: principal):\n  require who = viewer else NO\n  return threshold(who)\n",
        "fn threshold(who: principal): funding[who]\nmutation guarded():\n  return threshold(viewer)\n",
    ] {
        let bound = checked(body);
        assert!(!bound.notes.iter().any(|note| note.code == "N_LOOKUP_FILTERED"), "{body}: {:?}", bound.notes);
    }
}

#[test]
fn optional_and_required_lookups_keep_hidden_absent_and_expired_equivalent() {
    let bound = checked("fn peek(who: principal): funding[who]\nquery optional(who: principal):\n  return peek(who)\nquery required(who: principal):\n  row = funding[who] ! else NOT_FOUND\n  require row.limit > 1 else TOO_LOW\n  return row.limit\n");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("funding".into(), object([("id", Value::Id("a".into())), ("owner", Value::Id("hidden".into())), ("limit", Value::Int(3)), ("expires", Value::Null)])),
        ("funding".into(), object([("id", Value::Id("b".into())), ("owner", Value::Id("expired".into())), ("limit", Value::Int(3)), ("expires", Value::Int(10))])),
        ("funding".into(), object([("id", Value::Id("c".into())), ("owner", Value::Id("viewer".into())), ("limit", Value::Int(3)), ("expires", Value::Null)])),
    ]).unwrap();
    let mut refusals = Vec::new();
    for who in ["hidden", "missing", "expired"] {
        let viewer = if who == "expired" { "expired" } else { "viewer" };
        let ctx = || Context::new(viewer, [("who".into(), Value::Id(who.into()))].into()).at(20);
        let optional = engine.query("optional", ctx()).unwrap();
        assert_eq!(optional.data, Value::Null);
        assert!(optional.complete);
        refusals.push(engine.query("required", ctx()).unwrap_err());
    }
    assert!(refusals.iter().all(|refusal| refusal.code == "NOT_FOUND"));
    assert_eq!(serde_json::to_value(&refusals[0]).unwrap(), serde_json::to_value(&refusals[1]).unwrap());
    assert_eq!(serde_json::to_value(&refusals[0]).unwrap(), serde_json::to_value(&refusals[2]).unwrap());
    let visible = engine.query("required", Context::new("viewer", [("who".into(), Value::Id("viewer".into()))].into()).at(20)).unwrap();
    assert_eq!(visible.data, Value::Int(3));
}
