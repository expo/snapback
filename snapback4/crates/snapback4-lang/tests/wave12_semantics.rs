use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{compile, types::Ty};
use std::collections::BTreeMap;

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    bound
}

fn engine(source: &str) -> Engine {
    let bound = checked(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap()
}

#[test]
fn global_count_is_zero_then_tracks_inserts_and_deletes() {
    let source = r#"
table entries:
  public
  insert <- allow
  delete <- allow
  online only
table moderators:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
view total: count entries
  read <- allow
  online only
view privateTotal: count entries
  read <- exists moderators[viewer]
  online only
mutation add(id: id):
  return insert entries { id }
mutation remove(id: entries):
  delete entries[id]
  return null
query totalEntries():
  return total
query privateEntries():
  return privateTotal
"#;
    let bound = checked(source);
    let generated = snapback4_lang::emit::typescript(&bound);
    let native = snapback4_lang::emit::rust::rust(&bound);
    assert!(!generated.contains("$global") && !native.contains("$global"),
        "the physical discriminator leaked into generated application types");
    for expression in ["total first 1 by .id", "total[true]"] {
        let bound = compile(&[("bad.q".into(), format!("{source}\nquery bad(c: cursor ?):\n  return {expression}\n"))]);
        assert!(bound.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
            && diagnostic.message.contains("global maintained scalar")), "{expression}: {:#?}", bound.diagnostics);
    }
    let mut engine = engine(source);
    let query = |engine: &mut Engine| engine.query("totalEntries", Context::new("alice", BTreeMap::new())).unwrap().data;
    let private = |engine: &mut Engine, viewer| engine.query("privateEntries", Context::new(viewer, BTreeMap::new())).unwrap().data;
    assert_eq!(query(&mut engine), Value::Int(0));
    assert_eq!(private(&mut engine, "alice"), Value::Null, "an unauthorized empty global stays hidden");
    engine.seed([("moderators".into(), snapback4_core::value::object([
        ("id", Value::Id("mod".into())), ("principal", Value::Id("alice".into())),
    ]))]).unwrap();
    assert_eq!(private(&mut engine, "alice"), Value::Int(0), "authorized absence is the count identity");
    assert_eq!(private(&mut engine, "bob"), Value::Null, "a hidden absence is not zero");
    for id in ["a", "b"] {
        let outcome = engine.mutate("add", None, Context::new("alice", BTreeMap::from([("id".into(), Value::Id(id.into()))]))).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
    }
    assert_eq!(query(&mut engine), Value::Int(2));
    assert_eq!(private(&mut engine, "alice"), Value::Int(2));
    assert_eq!(private(&mut engine, "bob"), Value::Null, "a hidden stored scalar remains null");
    engine.mutate("remove", None, Context::new("alice", BTreeMap::from([("id".into(), Value::Id("a".into()))]))).unwrap();
    assert_eq!(query(&mut engine), Value::Int(1));
    engine.mutate("remove", None, Context::new("alice", BTreeMap::from([("id".into(), Value::Id("b".into()))]))).unwrap();
    assert_eq!(query(&mut engine), Value::Int(0));
    assert!(engine.store().rows("total").unwrap().is_empty(), "zero deletes the physical aggregate row");
    assert!(engine.store().rows("privateTotal").unwrap().is_empty(), "private zero also has no physical row");
}

#[test]
fn matching_count_guard_narrows_only_the_same_required_projection_until_a_write() {
    let schema = r#"
table entries:
  owner: principal
  score: int
  optionalScore: int ?
  by byOwner: owner, id
  public
  insert <- allow
  delete <- allow
  online only
"#;
    let sound = checked(&format!(r#"{schema}
query stats(owner: principal):
  n = count(entries[owner] by byOwner)
  require n > 0 else EMPTY
  return {{ low: min(entries[owner] by byOwner, .score), high: max(entries[owner] by byOwner, .score), total: sum(entries[owner] by byOwner, .score) }}
query filtered(owner: principal):
  require count(entries where .owner = owner) > 0 else EMPTY
  return min(entries where .owner = owner, .score) + 1
mutation freshAfterWrite(owner: principal, victim: entries):
  delete entries[victim]
  n = count(entries[owner] by byOwner)
  require n > 0 else EMPTY
  return min(entries[owner] by byOwner, .score) + 1
"#));
    let result = &sound.programs.iter().find(|program| program.program.name == "stats").unwrap().result;
    assert!(matches!(result, Ty::Object(fields) if fields.values().all(|ty| ty == &Ty::Int)), "{result:?}");
    assert_eq!(sound.programs.iter().find(|program| program.program.name == "filtered").unwrap().result, Ty::Int);

    for (name, body) in [
        ("different", "n = count(entries[owner] by byOwner)\n  require n > 0 else EMPTY\n  return min(entries['other'] by byOwner, .score) + 1"),
        ("optional", "n = count(entries[owner] by byOwner)\n  require n > 0 else EMPTY\n  return min(entries[owner] by byOwner, .optionalScore) + 1"),
        ("written", "n = count(entries[owner] by byOwner)\n  require n > 0 else EMPTY\n  delete entries[victim]\n  return min(entries[owner] by byOwner, .score) + 1"),
        ("stale_binding", "n = count(entries[owner] by byOwner)\n  delete entries[victim]\n  require n > 0 else EMPTY\n  return min(entries[owner] by byOwner, .score) + 1"),
        ("rebound", "n = count(entries[owner] by byOwner)\n  n = 1\n  require n > 0 else EMPTY\n  return min(entries[owner] by byOwner, .score) + 1"),
        ("joined", "n = count(entries[owner] by byOwner)\n  if flag:\n    n = 1\n  require n > 0 else EMPTY\n  return min(entries[owner] by byOwner, .score) + 1"),
        ("root_rebound", "who = owner\n  n = count(entries[who] by byOwner)\n  who = next\n  require n > 0 else EMPTY\n  return min(entries[who] by byOwner, .score) + 1"),
    ] {
        let args = match name {
            "written" | "stale_binding" => "owner: principal, victim: entries",
            "joined" => "owner: principal, flag: bool",
            "root_rebound" => "owner: principal, next: principal",
            _ => "owner: principal",
        };
        let kind = if matches!(name, "written" | "stale_binding") { "mutation" } else { "query" };
        let bound = compile(&[("schema.q".into(), format!("{schema}{kind} {name}({args}):\n  {body}\n"))]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")), "{name}: {:#?}", bound.diagnostics);
    }

    let helper = compile(&[("schema.q".into(), format!(r#"{schema}
fn remove(victim: entries):
  delete entries[victim]
  return true
mutation staleHelper(owner: principal, victim: entries):
  n = count(entries[owner] by byOwner)
  removed = remove(victim)
  require n > 0 else EMPTY
  return min(entries[owner] by byOwner, .score) + 1
"#))]);
    assert!(helper.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")), "{:#?}", helper.diagnostics);

    let authority = compile(&[("schema.q".into(), format!(r#"{schema}
job staleAuthority():
  for row in entries:
    n = count(entries[row.owner] by byOwner)
    as row.owner:
      require n > 0 else EMPTY
      narrowed = min(entries[row.owner] by byOwner, .score) + 1
"#))]);
    assert!(authority.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")), "{:#?}", authority.diagnostics);

    let self_dependent = compile(&[("schema.q".into(), r#"
table buckets:
  bucket: int
  score: int
  by byBucket: bucket, id
  public
  online only
query staleSelfDependent():
  bucket = 1
  bucket = count(buckets[bucket] by byBucket)
  require bucket > 0 else EMPTY
  return min(buckets[bucket] by byBucket, .score) + 1
"#.into())]);
    assert!(self_dependent.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")),
        "a count result must not inherit the old value's domain provenance: {:#?}", self_dependent.diagnostics);

    let pure_domain = checked(&format!(r#"{schema}
fn sameOwner(owner: principal):
  return owner
query pureDomain(owner: principal):
  n = count(entries[sameOwner(owner)] by byOwner)
  require n > 0 else EMPTY
  return min(entries[sameOwner(owner)] by byOwner, .score) + 1
"#));
    assert_eq!(pure_domain.programs.iter().find(|program| program.program.name == "pureDomain").unwrap().result, Ty::Int);

    let impure_domain = compile(&[("schema.q".into(), format!(r#"{schema}
fn changingOwner(owner: principal, victim: entries):
  delete entries[victim]
  return owner
mutation staleDomain(owner: principal, victim: entries):
  n = count(entries[changingOwner(owner, victim)] by byOwner)
  require n > 0 else EMPTY
  return min(entries[changingOwner(owner, victim)] by byOwner, .score) + 1
"#))]);
    assert!(impure_domain.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")),
        "writeful domains must never be replayed as aggregate proof: {:#?}", impure_domain.diagnostics);

    let shadowed = compile(&[("schema.q".into(), format!(r#"{schema}
fn count(owner: principal):
  return 1
query shadowedCount(owner: principal):
  n = count(owner)
  require n > 0 else EMPTY
  return min(entries[owner] by byOwner, .score) + 1
"#))]);
    assert!(shadowed.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.message.contains("int ?")),
        "a user helper named count must not create builtin provenance: {:#?}", shadowed.diagnostics);
}

#[test]
fn matching_role_guard_narrows_only_the_authorized_keyed_total() {
    let source = r#"
table entries:
  owner: principal
  public
  online only
table staff:
  principal: principal
  role: enum('finance')
  unique principal, role
  read <- .principal = viewer
  delete <- .principal = viewer
  online only
view totals: count entries by .owner
  read <- exists staff[principal = viewer, role = 'finance']
  online only
query raw(owner: principal):
  return totals[owner]
query guarded(owner: principal):
  require exists staff[principal = viewer, role = 'finance'] else NOT_FINANCE
  return totals[owner] + 1
"#;
    let bound = checked(source);
    assert_eq!(bound.programs.iter().find(|program| program.program.name == "raw").unwrap().result, Ty::Int.optional());
    assert_eq!(bound.programs.iter().find(|program| program.program.name == "guarded").unwrap().result, Ty::Int);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
    engine.seed([("entries".into(), snapback4_core::value::object([
        ("id", Value::Id("one".into())), ("owner", Value::Id("bob".into())),
    ]))]).unwrap();
    let raw = |engine: &mut Engine, owner: &str| engine.query("raw", Context::new("alice", BTreeMap::from([
        ("owner".into(), Value::Id(owner.into())),
    ]))).unwrap().data;
    assert_eq!(raw(&mut engine, "bob"), Value::Null, "a hidden stored total is not disclosed");
    assert_eq!(raw(&mut engine, "nobody"), Value::Null, "a hidden miss is indistinguishable from a hidden hit");
    engine.seed([("staff".into(), snapback4_core::value::object([
        ("id", Value::Id("finance".into())), ("principal", Value::Id("alice".into())),
        ("role", Value::String("finance".into())),
    ]))]).unwrap();
    assert_eq!(raw(&mut engine, "bob"), Value::Int(1));
    assert_eq!(raw(&mut engine, "nobody"), Value::Int(0), "an authorized keyed miss has the count identity");
    assert_eq!(engine.query("guarded", Context::new("alice", BTreeMap::from([
        ("owner".into(), Value::Id("nobody".into())),
    ]))).unwrap().data, Value::Int(1));

    let stale = compile(&[("schema.q".into(), format!(r#"{source}
mutation stale(owner: principal, grant: staff):
  require exists staff[principal = viewer, role = 'finance'] else NOT_FINANCE
  delete staff[grant]
  return totals[owner] + 1
"#))]);
    assert!(stale.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"
        && diagnostic.message.contains("int ?")), "a write must invalidate the role proof: {:#?}", stale.diagnostics);
}

#[test]
fn email_format_is_one_shared_ascii_contract() {
    let source = r#"
table contacts:
  email: text 3..254 format email
  public
  insert <- allow
  online only
query echo(email: text 3..254 format email):
  return email
"#;
    let mut engine = engine(source);
    for email in ["a@example.com", "first.last+tag@sub.example", "x@localhost"] {
        let result = engine.query("echo", Context::new("alice", BTreeMap::from([("email".into(), Value::String(email.into()))]))).unwrap();
        assert_eq!(result.data, Value::String(email.into()));
    }
    for email in ["a..b@example.com", ".a@example.com", "a@-example.com", "a@example..com", "a@пример.рф", "a@@example.com"] {
        let error = engine.query("echo", Context::new("alice", BTreeMap::from([("email".into(), Value::String(email.into()))]))).unwrap_err();
        assert_eq!(error.code, "E_INPUT", "{email}: {error:?}");
    }
}

#[test]
fn enum_columns_use_the_existing_word_search_path() {
    let source = r#"
table businesses:
  category: enum('coffee-shop', 'book_store', 'museum')
  search category
  public
  online only
query find(q: text <=40, c: cursor ?):
  return businesses matching q first 20 by .id after c
"#;
    let mut engine = engine(source);
    engine.seed([
        ("businesses".into(), snapback4_core::value::object([("id", Value::Id("cafe".into())), ("category", Value::String("coffee-shop".into()))])),
        ("businesses".into(), snapback4_core::value::object([("id", Value::Id("books".into())), ("category", Value::String("book_store".into()))])),
    ]).unwrap();
    let result = engine.query("find", Context::new("alice", BTreeMap::from([
        ("q".into(), Value::String("cof".into())), ("c".into(), Value::Null),
    ]))).unwrap();
    let rows = result.data.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("id").unwrap(), &Value::Id("cafe".into()));
}

#[test]
fn rounded_division_is_exact_signed_and_keeps_numeric_types() {
    let source = r#"
query rounded():
  return [
    divide(5, 2, 'toward-zero'), divide(5, 2, 'away-from-zero'),
    divide(5, 2, 'floor'), divide(5, 2, 'ceiling'),
    divide(5, 2, 'half-away-from-zero'), divide(5, 2, 'half-even'),
    divide(7, 2, 'half-even'), divide(-5, 2, 'half-away-from-zero'),
    divide(-5, 2, 'floor'), divide(-5, 2, 'ceiling'),
    divide(5, -2, 'floor'), divide(5, -2, 'ceiling'),
    divide(7, 3, 'half-even'), divide(8, 3, 'half-even')
  ]
query decimalValue(value: decimal 2):
  return divide(value, 2, 'half-even')
query moneyValue(value: money USD 2):
  return divide(value, 2, 'half-even')
query scaled(numerator: int, denominator: int):
  return [
    divide(numerator, denominator, 2, 'half-even'),
    divide(numerator, denominator, 2, 'half-away-from-zero')
  ]
query wide(numerator: int, denominator: int):
  return divide(numerator, denominator, 12, 'half-even')
query scaleZero(numerator: int, denominator: int):
  return divide(numerator, denominator, 0, 'half-even')
query scaledOverflow():
  return divide(9007199254740991, 1, 1, 'half-even')
query zero():
  return divide(1, 0, 'half-even')
"#;
    let bound = checked(source);
    assert_eq!(bound.programs.iter().find(|p| p.program.name == "decimalValue").unwrap().result, Ty::Decimal(2));
    assert_eq!(bound.programs.iter().find(|p| p.program.name == "moneyValue").unwrap().result, Ty::Money("USD".into(), 2));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let values = engine.query("rounded", Context::new("alice", BTreeMap::new())).unwrap().data;
    assert_eq!(values, Value::Array([2, 3, 2, 3, 3, 2, 4, -3, -3, -2, -3, -2, 2, 3].into_iter().map(Value::Int).collect()));
    for name in ["decimalValue", "moneyValue"] {
        let value = engine.query(name, Context::new("alice", BTreeMap::from([("value".into(), Value::Int(5))]))).unwrap().data;
        assert_eq!(value, Value::Int(2), "{name}");
    }
    let scaled = |engine: &mut Engine, numerator, denominator| engine.query("scaled", Context::new("alice", BTreeMap::from([
        ("numerator".into(), Value::Int(numerator)), ("denominator".into(), Value::Int(denominator)),
    ]))).unwrap().data;
    assert_eq!(scaled(&mut engine, 101, 2), Value::Array(vec![Value::Int(5050), Value::Int(5050)]));
    assert_eq!(scaled(&mut engine, -101, 2), Value::Array(vec![Value::Int(-5050), Value::Int(-5050)]));
    assert_eq!(scaled(&mut engine, 1, 8), Value::Array(vec![Value::Int(12), Value::Int(13)]));
    assert_eq!(scaled(&mut engine, -1, 8), Value::Array(vec![Value::Int(-12), Value::Int(-13)]));
    assert_eq!(engine.query("wide", Context::new("alice", BTreeMap::from([
        ("numerator".into(), Value::Int(snapback4_core::value::I53_MAX)),
        ("denominator".into(), Value::Int(snapback4_core::value::I53_MAX)),
    ]))).unwrap().data, Value::Int(1_000_000_000_000), "the wide scaled intermediate is not restricted to i53");
    assert_eq!(engine.query("scaleZero", Context::new("alice", BTreeMap::from([
        ("numerator".into(), Value::Int(5)), ("denominator".into(), Value::Int(2)),
    ]))).unwrap().data, Value::Int(2));
    assert_eq!(engine.query("scaledOverflow", Context::new("alice", BTreeMap::new())).unwrap_err().code, "E_OVERFLOW");
    assert_eq!(engine.query("zero", Context::new("alice", BTreeMap::new())).unwrap_err().code, "E_DIV_ZERO");

    use snapback4_core::ir::{Builtin, Expr, Program, ProgramKind, Rounding, Stmt};
    let overflow = Program {
        name: "overflow".into(), kind: ProgramKind::Query, args: BTreeMap::new(),
        read_time_granularity_ms: None, native: false, returned_shapes: BTreeMap::new(),
        body: vec![Stmt::Return(Expr::Builtin { builtin: Builtin::Divide { rounding: Rounding::TowardZero, scale: None },
            args: vec![Expr::Literal(Value::Int(i64::MIN)), Expr::Literal(Value::Int(-1))] })],
    };
    let mut raw = Engine::memory(Default::default(), [overflow]).unwrap();
    assert_eq!(raw.query("overflow", Context::new("alice", BTreeMap::new())).unwrap_err().code, "E_OVERFLOW");

    for bad in ["divide(1, 2, 'nearest')", "divide(1, 2, mode)", "divide(1, divisor, 'half-even')",
        "divide(1, 2, 13, 'half-even')", "divide(1, 2, scale, 'half-even')"] {
        let source = if bad.contains("mode") { format!("query bad(mode: enum('half-even')):\n  return {bad}\n") }
            else if bad.contains("scale") { format!("query bad(scale: int):\n  return {bad}\n") }
            else if bad.contains("divisor") { format!("query bad(divisor: decimal 2):\n  return {bad}\n") }
            else { format!("query bad():\n  return {bad}\n") };
        let bound = compile(&[("bad.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{bad}: {:#?}", bound.diagnostics);
    }
}
