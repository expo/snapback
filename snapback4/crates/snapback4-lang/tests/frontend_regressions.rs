//! Authored programs exercise the frontend contract, not hand-patched IR.
//! R20–R24, R32 and R33 from the 2026-09-12 architecture review.

use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{Bound, compile};
use snapback4_lang::types::Ty;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

const ITEMS: &str = "table items:\n  n: int\n  a: int\n  b: int\n  unique byAB: a, b\n  by byABId: a, b, id\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public\n";
const HELPERS: &str = r#"
fn identity(x: int): x
fn pair(x: int, y: int): x * 10 + y
fn twice(x: id): { left: x, right: x }
fn add(x: int, y: int):
  local = pair(x, y)
  insert items { n: local, a: x, b: y }
  return
query repeated():
  return identity(1) + identity(2)
query nested(x: int):
  return pair(identity(1), pair(2, x)) + x
mutation helpers(x: int):
  local = 7
  add(1, x)
  add(2, x)
  for i in range(0, 3):
    add(i + 3, x)
  return { x, local }
mutation minted():
  return twice(new)
mutation arguments():
  return pair((insert items { a: 10, b: 0, n: 1 }).n, count(items[] first 10 by byId))
mutation readBeforeWrite():
  return pair(count(items[] first 10 by byId), (insert items { a: 10, b: 0, n: 1 }).n)
"#;
const LAZY: &str = r#"
fn present(): (items['missing'] ! else MISSING) != null
query skipped():
  return { a: true or present(), b: false and present(), c: false or (true or present()) }
query selected():
  return false or present()
mutation skippedWrites():
  a = true or ((insert items { a: 1, b: 1, n: 1 }) != null)
  b = false and ((insert items { a: 2, b: 2, n: 2 }) != null)
  return count(items[] first 10 by byId)
mutation selectedWrite():
  a = false or ((insert items { a: 1, b: 1, n: 1 }) != null)
  return count(items[] first 10 by byId)
query narrowed(x: int ?):
  return x != null and x > 0
"#;

fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn self_witness_notes_name_only_the_unpinned_deciding_columns() {
    let source = include_str!("../../snapback4-sim/tests/fixtures/membership.q");
    let rule = ".principal = viewer or exists memberships[.chatKey, viewer]";
    let positive = bound(source);
    assert!(!positive.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "{:?}", positive.notes);
    let blocked = bound(&source.replace("  by byPrincipalChat:", "  unique byChatPrincipalRole: chatKey, principal, role\n  by byPrincipalChat:")
        .replace(rule, ".principal = viewer or exists memberships[.chatKey, viewer, 'admin']"));
    let note = blocked.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE" && note.message.contains("query roster:")).unwrap();
    assert!(note.message.contains("reads .principal, which the scan does not pin"), "{note:?}");
    assert!(note.rewrite.contains("pin .principal with where equalities"), "{note:?}");
    assert!(!note.rewrite.contains("principal, principal"), "{note:?}");
    let residual = bound(&source.replace(rule, &format!("{rule} or .role = 'admin'")));
    let note = residual.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE" && note.message.contains("query roster:")).unwrap();
    assert!(note.message.contains("reads .role, which the scan does not pin"), "{note:?}");
    assert!(note.rewrite.contains("pin .role with where equalities"), "{note:?}");
}

fn engine(source: &str) -> Engine {
    let bound = bound(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn context(args: &[(&str, Value)]) -> Context {
    Context::new("dev:alice", args.iter().map(|(name, value)| ((*name).into(), value.clone())).collect::<BTreeMap<_, _>>()).at(1)
}

fn query(engine: &mut Engine, name: &str, args: &[(&str, Value)]) -> Value {
    engine.query(name, context(args)).unwrap().data
}

fn mutation(engine: &mut Engine, name: &str, args: &[(&str, Value)]) -> Value {
    match engine.mutate(name, None, context(args).with_ids((1..20).map(|n| format!("id{n}")))).unwrap().state {
        WriteState::Sent { result, .. } => result,
        other => panic!("{other:?}"),
    }
}

#[test]
fn accumulated_values_write_under_runtime_column_bounds() {
    let source = r#"
table labels:
  text: text <=3
  values: [int] <=3
  read <- allow
  insert <- allow
mutation build(extra: bool):
  text = ''
  values = []
  record = { text: '' }
  for i in range(0, 3):
    text = text + 'x'
    values = values + [i]
    record = { text: record.text + 'x' }
  if extra:
    text = text + 'x'
  insert labels { text, values }
  return record.text
query precise():
  text = 'x'
  text = 'xx'
  return text
"#;
    let compiled = bound(source);
    assert_eq!(compiled.programs[1].result, Ty::Text(2));
    let mut e = engine(source);
    assert_eq!(mutation(&mut e, "build", &[("extra", Value::Bool(false))]), Value::String("xxx".into()));
    let outcome = e.mutate("build", None, context(&[("extra", Value::Bool(true))])).unwrap();
    let WriteState::Failed { why, .. } = outcome.state else { panic!("column length still applies") };
    assert_eq!(why.code, "E_INPUT");
    assert!(why.message.contains("labels.text"), "{why:?}");
    assert_eq!(e.store().rows("labels").unwrap().len(), 1);
}

#[test]
fn upsert_patches_existing_rows_and_validates_absent_rows_as_inserts() {
    let source = r#"
table profiles:
  owner: principal
  name: text <=40
  bio: text <=100 ?
  score: int
  unique byOwner: owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
mutation create():
  return upsert profiles[owner=viewer] { name: 'Alice', bio: 'kept', score: 1 }
mutation rename():
  return upsert profiles[owner=viewer] { name: 'New name' }
mutation score(id: profiles):
  return upsert profiles[id = id] { score: 2 }
mutation clear():
  return upsert profiles[owner=viewer] { bio: null }
mutation absent():
  return upsert profiles[owner=viewer] { bio: 'only a bio' }
"#;
    let mut e = engine(source);
    let absent = e.mutate("absent", None, context(&[])).unwrap();
    let WriteState::Failed { why, .. } = absent.state else { panic!("missing required column must refuse") };
    assert_eq!(why.code, "NOT_FOUND");
    assert!(!why.message.contains("profiles.name"), "{why:?}");
    assert!(e.store().rows("profiles").unwrap().is_empty());
    let created = mutation(&mut e, "create", &[]);
    let id = created.field("id").unwrap().clone();
    let renamed = mutation(&mut e, "rename", &[]);
    assert_eq!(renamed.field("id"), Ok(&id));
    assert_eq!(renamed.field("name"), Ok(&Value::String("New name".into())));
    assert_eq!(renamed.field("bio"), Ok(&Value::String("kept".into())));
    assert_eq!(renamed.field("score"), Ok(&Value::Int(1)));
    let scored = mutation(&mut e, "score", &[("id", id)]);
    assert_eq!(scored.field("name"), renamed.field("name"));
    assert_eq!(scored.field("score"), Ok(&Value::Int(2)));
    assert_eq!(mutation(&mut e, "clear", &[]).field("bio"), Ok(&Value::Null));
    let other = e.mutate("score", None, Context::new("dev:bob", BTreeMap::from([("id".into(), created.field("id").unwrap().clone())])).at(1)).unwrap();
    assert!(matches!(other.state, WriteState::Failed { .. }));
    assert_eq!(e.store().rows("profiles").unwrap().len(), 1);
}

#[test]
fn job_preludes_rerun_for_each_chunk_and_each_sweep() {
    let source = format!("{ITEMS}\n{}", r#"
table config:
  n: int
  read <- allow
  update <- allow
mutation configure(n: int):
  update config['settings'] { n }
  return
fn amount():
  row = config['settings'] ! else NO_CONFIG
  return row.n
job refresh():
  base = amount()
  total = 0
  for i in range(0, 2):
    total = total + base
  chunk row in items first 1 by byId:
    update items[row.id] { n: row.n + total }
  chunk row in items first 1 by byId:
    update items[row.id] { n: row.n + total }
"#);
    let mut e = engine(&source);
    e.seed([("config".into(), snapback4_core::value::object([("id", Value::Id("settings".into())), ("n", Value::Int(1))]))]).unwrap();
    e.seed((0..3).map(|n| ("items".into(), snapback4_core::value::object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(0)), ("a", Value::Int(n)), ("b", Value::Int(0)),
    ])))).unwrap();
    let id = e.enqueue_job("refresh", BTreeMap::new(), 1).unwrap();
    let first = e.run_job_chunk(1).unwrap().unwrap();
    assert_eq!((first.chunks, first.rows_written), (1, 1));
    mutation(&mut e, "configure", &[("n", Value::Int(3))]);
    while e.run_job_chunk(2).unwrap().is_some() {}
    let run = e.job(&id).unwrap().unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done);
    assert_eq!((run.chunks, run.rows_written), (6, 6));
    assert_eq!(e.store().rows("items").unwrap().iter().map(|row| row.field("n").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [8, 12, 12]);
    println!("job prelude: {} chunks, {} rows written, values [8, 12, 12]", run.chunks, run.rows_written);
    for prelude in ["  update items['r0'] { n: 7 }\n", "  changed = (update items['r0'] { n: 7 })\n", "  change()\n", "  emit notify { n: 1 }\n"] {
        let source = format!("{ITEMS}\neffect notify\nfn change():\n  update items['r0'] {{ n: 7 }}\n  return\njob refused():\n{prelude}  chunk row in items first 1 by byId:\n    return\n");
        let refused = compile(&[("schema.q".into(), source)]);
        assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT" && d.message.contains("a write belongs to a chunk")), "{:?}", refused.diagnostics);
    }
}

#[test]
fn job_prelude_meter_refusal_parks_before_writing_a_chunk() {
    let source = format!("{ITEMS}\njob limited(s: text <=1000000):\n  for i in range(0, 100):\n    text = lower(s)\n  chunk row in items first 1 by byId:\n    update items[row.id] {{ n: 1 }}\n");
    let mut e = engine(&source);
    e.seed([("items".into(), snapback4_core::value::object([("id", Value::Id("r".into())), ("n", Value::Int(0)), ("a", Value::Int(0)), ("b", Value::Int(0))]))]).unwrap();
    let run = e.run_job("limited", BTreeMap::from([("s".into(), Value::String("A".repeat(1_000_000)))]), 1).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Parked);
    assert_eq!((run.chunks, run.rows_written), (0, 0));
    assert!(run.error.as_ref().is_some_and(|error| error.contains("E_BOUND") && error.contains("heap")), "{run:?}");
    assert_eq!(e.store().rows("items").unwrap()[0].field("n"), Ok(&Value::Int(0)));
}

#[test]
fn helper_bodies_return_values_without_returning_from_the_caller() {
    let source = format!("{ITEMS}\n{}", r#"
fn find(n: int):
  for i in range(0, 4):
    if i != n:
      continue
    for j in range(0, 2):
      return i * 10 + j
  return -1
fn write(n: int):
  row = insert items { n, a: n, b: 0 }
  return row.n
fn empty():
  return
fn number():
  return 100
query caller(n: int):
  number()
  return { value: find(n) + 1, empty: empty() }
mutation writes():
  first = write(1)
  second = write(2)
  return first + second
"#);
    let mut e = engine(&source);
    for (n, expected) in [(2, 21), (9, 0)] {
        let result = query(&mut e, "caller", &[("n", Value::Int(n))]);
        assert_eq!(result.field("value"), Ok(&Value::Int(expected)));
        assert_eq!(result.field("empty"), Ok(&Value::Null));
    }
    assert_eq!(mutation(&mut e, "writes", &[]), Value::Int(3));
    assert_eq!(e.store().rows("items").unwrap().len(), 2);
    let compiled = bound(&source);
    assert!(matches!(&compiled.programs[0].result, Ty::Object(fields) if fields["value"] == Ty::Int && fields["empty"] == Ty::Null));
    let call = "query refuses():\n  return write(3)\n";
    let refused = compile(&[("schema.q".into(), format!("{source}{call}"))]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT" && d.site.line == source.lines().count() as u32 + 2 && d.message.contains("insert items")), "{:?}", refused.diagnostics);
    let refused = compile(&[("schema.q".into(), "proc old():\n  return\n".into())]);
    assert_eq!((&*refused.diagnostics[0].code, &*refused.diagnostics[0].rewrite), ("E_QUARRY_UNSUPPORTED", "fn"));
    let refused = compile(&[("schema.q".into(), "fn mint():\n  id = new\n  return id\nquery q():\n  return mint()\n".into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT" && d.site.line == 5 && d.message.contains("mint ids")));
    for source in [
        "fn noReturn():\n  n = 1\nquery q():\n  return noReturn()\n",
        "fn recursive(): recursive()\nquery q():\n  return recursive()\n",
        "fn stop():\n  continue\n  return\nquery q():\n  for i in range(0, 2):\n    stop()\n  return 1\n",
    ] {
        assert!(!compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty(), "{source}");
    }
}

#[test]
fn loop_carried_types_include_continued_paths_and_reject_recursive_accumulation() {
    for source in [
        "query q(flag: bool):\n  x = 1\n  for i in range(0, 3):\n    n = x + 1\n    if flag:\n      x = null\n      continue\n    else:\n      continue\n  return x\n",
        "query q():\n  xs = []\n  for i in range(0, 3):\n    xs = xs + [xs]\n  return xs\n",
    ] {
        let refused = compile(&[("schema.q".into(), source.into())]);
        assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{source}");
    }
    let source = "query q():\n  xs = []\n  ys = []\n  for i in range(0, 3):\n    xs = xs + [ys]\n    ys = ys + [i]\n  return xs\n";
    let result = query(&mut engine(source), "q", &[]);
    assert_eq!(result.as_array().unwrap().iter().map(|value| value.as_array().unwrap().len()).collect::<Vec<_>>(), [0, 1, 2]);
}

#[test]
fn division_and_remainder_share_divmods_results_precedence_and_zero_refusal() {
    let source = r#"
query divide(a: int, b: int):
  (q, r) = divmod(a, b)
  return { q, r, quotient: a / b, remainder: a % b, precedence: 2 + 12 / 3 * 2 % 5 }
query clockParts(t: time):
  return { q: t / 1000, r: t % 1000 }
query divideZero():
  return 1 / 0
query remainderZero():
  return 1 % 0
"#;
    let mut e = engine(source);
    for (a, b) in [(7, 3), (-7, 3), (7, -3), (-7, -3)] {
        let result = query(&mut e, "divide", &[("a", Value::Int(a)), ("b", Value::Int(b))]);
        assert_eq!(result.field("q"), result.field("quotient"));
        assert_eq!(result.field("r"), result.field("remainder"));
        assert_eq!(result.field("precedence"), Ok(&Value::Int(5)));
    }
    let clock = query(&mut e, "clockParts", &[("t", Value::Int(1234))]);
    assert_eq!(clock.field("q"), Ok(&Value::Int(1)));
    assert_eq!(clock.field("r"), Ok(&Value::Int(234)));
    for name in ["divideZero", "remainderZero"] {
        assert_eq!(e.query(name, context(&[])).unwrap_err().code, "E_DIV_ZERO");
    }
    let refused = compile(&[("schema.q".into(), "query q(x: int ?):\n  return x / 2\n".into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
}

#[test]
fn text_operations_use_characters_and_meter_new_results() {
    let source = r#"
query textForms():
  s = 'start'
  for i in range(0, 2):
    s = s + 'é'
  return { s, chars: count('é😊'), folded: lower('İSTANBUL'), stripped: trim('  hello\t'), joined: join(['a', '😊', 'b'], ' / '), empty: join([], ',') }
mutation lowerText(s: text <=1000):
  return lower(s)
mutation trimText(s: text <=1000):
  return trim(s)
mutation joinText(xs: [text <=1000] <=3):
  return join(xs, '-')
"#;
    let mut e = engine(source);
    let result = query(&mut e, "textForms", &[]);
    for (field, expected) in [("s", "startéé"), ("folded", "i\u{307}stanbul"), ("stripped", "hello"), ("joined", "a / 😊 / b"), ("empty", "")] {
        assert_eq!(result.field(field), Ok(&Value::String(expected.into())));
    }
    assert_eq!(result.field("chars"), Ok(&Value::Int(2)));
    e.set_ceilings(snapback4_core::Ceilings { heap_bytes: 10, ..e.ceilings() });
    for (name, args) in [
        ("lowerText", vec![("s", Value::String("A".repeat(100)))]),
        ("trimText", vec![("s", Value::String("x".repeat(100)))]),
        ("joinText", vec![("xs", Value::Array(vec![Value::String("x".repeat(100))]))]),
    ] {
        let outcome = e.mutate(name, None, context(&args)).unwrap();
        let WriteState::Failed { why, .. } = outcome.state else { panic!("must cut at heap meter") };
        assert_eq!(why.code, "E_BOUND");
        assert!(why.message.contains("heap"), "{why:?}");
    }
    for expression in ["'a' + 1", "count(null)", "lower(1)", "trim(null)", "join([1], ',')"] {
        let refused = compile(&[("schema.q".into(), format!("query q():\n  return {expression}\n"))]);
        assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{expression}");
    }
}

#[test]
fn sha256_hashes_exact_utf8_and_infers_one_fixed_text_bound() {
    let source = r#"
query hash(value: text <=1000):
  return sha256(value)
query vectors():
  return { empty: sha256(''), ascii: sha256('abc'), nonAscii: sha256('你好'), composed: sha256('é'), decomposed: sha256('é') }
"#;
    let bound = bound(source);
    assert_eq!(bound.programs.iter().find(|program| program.program.name == "hash").unwrap().result, Ty::Text(64));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|program| program.program)).unwrap();
    let vectors = query(&mut engine, "vectors", &[]);
    for (field, expected) in [
        ("empty", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        ("ascii", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        ("nonAscii", "670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e"),
        ("composed", "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c"),
        ("decomposed", "bf12767b0f2a56b2190075bae8169f656e3ce8d6357d4aff184bc6c7ea48f9f6"),
    ] {
        assert_eq!(vectors.field(field), Ok(&Value::String(expected.into())), "{field}");
    }
    assert_ne!(vectors.field("composed"), vectors.field("decomposed"), "sha256 must not normalize Unicode");

    for source in [
        "query q():\n  return sha256()\n",
        "query q():\n  return sha256('a', 'b')\n",
        "query q():\n  return sha256(1)\n",
        "query q(value: text <=10 ?):\n  return sha256(value)\n",
    ] {
        let refused = compile(&[("schema.q".into(), source.into())]);
        assert!(refused.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_TYPE"), "{source}\n{:?}", refused.diagnostics);
    }
}

#[test]
fn else_if_selects_one_branch_and_elif_names_the_exact_rewrite() {
    let source = r#"
query choose(n: int):
  result = 0
  if n < 0:
    result = -1
  else if n = 0:
    result = 10
  else if n = 1:
    result = 20
  else:
    result = 30
  return result
"#;
    let mut e = engine(source);
    for (n, expected) in [(-2, -1), (0, 10), (1, 20), (2, 30)] {
        assert_eq!(query(&mut e, "choose", &[("n", Value::Int(n))]), Value::Int(expected));
    }
    let refused = compile(&[("schema.q".into(), source.replace("else if", "elif"))]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_UNSUPPORTED" && d.rewrite == "else if cond:"));
}

#[test]
fn continue_advances_the_nearest_for_or_chunk() {
    let source = format!("{ITEMS}\n{}", r#"
query skip():
  n = 0
  for i in range(0, 4):
    if i = 1:
      continue
    for j in range(0, 3):
      if j != 2:
        continue
      n = n + i
  return n
job skipRows():
  chunk row in items first 10 by byId:
    if row.n = 1:
      continue
    update items[row.id] { n: row.n + 10 }
"#);
    let mut e = engine(&source);
    assert_eq!(query(&mut e, "skip", &[]), Value::Int(5));
    e.seed((0..3).map(|n| ("items".into(), snapback4_core::value::object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n)), ("a", Value::Int(n)), ("b", Value::Int(0)),
    ])))).unwrap();
    let run = e.run_job("skipRows", BTreeMap::new(), 1).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done);
    assert_eq!(e.store().rows("items").unwrap().iter().map(|row| row.field("n").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [10, 1, 12]);
    let refused = compile(&[("schema.q".into(), "query q():\n  continue\n".into())]);
    assert_eq!(refused.diagnostics[0].code, "E_QUARRY_PLACEMENT");
}

#[test]
fn accumulated_lists_append_in_place_and_can_be_iterated() {
    let source = r#"
query accumulate():
  xs = []
  for i in range(0, 5):
    xs = xs + [{ n: i }]
  total = 0
  for row in xs:
    total = total + row.n
  return { xs, total }
"#;
    let compiled = bound(source);
    let Ty::Object(result) = &compiled.programs[0].result else { panic!("object result") };
    assert!(matches!(result["xs"], Ty::List(_, u32::MAX)));
    let ir = format!("{:?}", compiled.programs[0].program.body);
    assert!(ir.contains("Push"));
    assert!(!ir.contains("Concat"));
    let result = query(&mut engine(source), "accumulate", &[]);
    assert_eq!(result.field("total"), Ok(&Value::Int(10)));
    assert_eq!(result.field("xs").unwrap().as_array().unwrap().len(), 5);
    let invalid = bound("query q():\n  xs = []\n  xs = xs + [1]\n  return xs\n");
    assert!(matches!(invalid.programs[0].result, Ty::List(ref item, u32::MAX) if **item == Ty::Int));
    let refused = compile(&[("schema.q".into(), "query q():\n  xs = [1]\n  xs = xs + ['bad']\n  return xs\n".into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"));
}

#[test]
fn reassignment_carries_locals_through_branches_and_loops_and_resets_refinements() {
    let source = r#"
query counter(flag: bool):
  n = 0
  for i in range(0, 4):
    if flag:
      n = n + i
    else:
      n = n + 1
  n = n + 10
  return n
query nullable(x: int ?):
  n = x
  require n != null else MISSING
  n = null
  return n
query guarded():
  n = 1
  for i in range(0, 3):
    if n != null:
      n = n + 1
    n = null
  return n
query replaced(x: int ?):
  n = x
  n = 1
  return n + 1
"#;
    let compiled = bound(source);
    assert!(format!("{:?}", compiled.programs[0].program.body).contains("Assign"));
    let mut e = engine(source);
    assert_eq!(query(&mut e, "counter", &[("flag", Value::Bool(true))]), Value::Int(16));
    assert_eq!(query(&mut e, "counter", &[("flag", Value::Bool(false))]), Value::Int(14));
    assert_eq!(query(&mut e, "nullable", &[("x", Value::Int(1))]), Value::Null);
    assert_eq!(query(&mut e, "guarded", &[]), Value::Null);
    assert_eq!(query(&mut e, "replaced", &[("x", Value::Null)]), Value::Int(2));
    for source in [
        "query q(x: int):\n  x = 1\n  return x\n",
        "query q(x: int):\n  for x in range(0, 2):\n    return x\n",
        "query q():\n  n = 1\n  n = 'text'\n  return n\n",
        "query q(x: int ?):\n  n = x\n  require n != null else MISSING\n  n = x\n  return n + 1\n",
        "query q():\n  n = 1\n  for i in range(0, 2):\n    m = n + 1\n    n = null\n  return n\n",
        "query q():\n  n = 1\n  for i in range(0, 0):\n    n = null\n  return n + 1\n",
    ] {
        let compiled = compile(&[("schema.q".into(), source.into())]);
        assert!(!compiled.diagnostics.is_empty(), "{source}");
    }
}

#[test]
fn helpers_have_lexical_bindings_and_snapshot_arguments_once_in_source_order() {
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(query(&mut e, "repeated", &[]), Value::Int(3));
    assert_eq!(query(&mut e, "nested", &[("x", Value::Int(5))]), Value::Int(40));
    let minted = mutation(&mut e, "minted", &[]);
    assert_eq!(minted.field("left"), Ok(&Value::Id("id1".into())));
    assert_eq!(minted.field("left"), minted.field("right"));
    let locals = mutation(&mut e, "helpers", &[("x", Value::Int(9))]);
    assert_eq!(locals.field("x"), Ok(&Value::Int(9)));
    assert_eq!(locals.field("local"), Ok(&Value::Int(7)));
    let rows = e.store().rows("items").unwrap();
    assert_eq!(rows.len(), 5);
    for row in rows {
        assert_eq!(row.field("b"), Ok(&Value::Int(9)), "later arguments resolve in the caller, before formal x exists");
    }
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(mutation(&mut e, "arguments", &[]), Value::Int(11));
    let mut e = engine(&format!("{ITEMS}\n{HELPERS}"));
    assert_eq!(mutation(&mut e, "readBeforeWrite", &[]), Value::Int(1));
}

#[test]
fn a_helper_cannot_capture_or_refine_a_callers_local() {
    let source = "fn capture(): outer\nquery q(outer: int):\n  return capture()\n";
    let compiled = compile(&[("schema.q".into(), source.into())]);
    assert!(compiled.diagnostics.iter().any(|d| d.message == "unknown name outer"));
    let source = "fn checked(x: int ?): x + 1 if x != null else 0\nquery q(x: int ?):\n  y = checked(x)\n  return x + 1\n";
    let compiled = compile(&[("schema.q".into(), source.into())]);
    assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.site.line == 4));
}

#[test]
fn boolean_lowering_keeps_refusals_and_writes_in_the_selected_branch() {
    let mut e = engine(&format!("{ITEMS}\n{LAZY}"));
    let value = query(&mut e, "skipped", &[]);
    assert_eq!(value.field("a"), Ok(&Value::Bool(true)));
    assert_eq!(value.field("b"), Ok(&Value::Bool(false)));
    assert_eq!(value.field("c"), Ok(&Value::Bool(true)));
    assert_eq!(e.query("selected", context(&[])).unwrap_err().code, "MISSING");
    assert_eq!(mutation(&mut e, "skippedWrites", &[]), Value::Int(0));
    assert_eq!(mutation(&mut e, "selectedWrite", &[]), Value::Int(1));
    assert_eq!(query(&mut e, "narrowed", &[("x", Value::Null)]), Value::Bool(false));
    assert_eq!(query(&mut e, "narrowed", &[("x", Value::Int(1))]), Value::Bool(true));
}

#[test]
fn null_refinements_join_only_continuing_paths() {
    for body in [
        "  if x != null:\n    y = x + 1\n  return x + 1\n",
        "  if flag:\n    require x != null else MISSING\n  return x + 1\n",
        "  for i in range(0, 2):\n    require x != null else MISSING\n  return x + 1\n",
        "  y = x + 1 if x != null else 0\n  return x + 1\n",
        "  if flag:\n    if x = null:\n      return 0\n  return x + 1\n",
    ] {
        let source = format!("query q(x: int ?, flag: bool):\n{body}");
        let compiled = compile(&[("schema.q".into(), source)]);
        assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "branch refinement escaped: {body}");
    }
    let source = r#"
query early(x: int ?):
  if x = null:
    return 0
  return x + 1
query refuse(x: int ?):
  if x = null:
    require false else MISSING
  return x + 1
query both(x: int ?, flag: bool):
  if flag:
    require x != null else MISSING
  else:
    if x = null:
      return 0
  return x + 1
query nested(x: int ?, flag: bool):
  if x = null:
    if flag:
      return 0
    else:
      return 1
  return x + 1
"#;
    let mut e = engine(source);
    assert_eq!(query(&mut e, "early", &[("x", Value::Null)]), Value::Int(0));
    assert_eq!(query(&mut e, "early", &[("x", Value::Int(9))]), Value::Int(10));
    assert_eq!(e.query("refuse", context(&[("x", Value::Null)])).unwrap_err().code, "MISSING");
    assert_eq!(query(&mut e, "both", &[("x", Value::Int(9)), ("flag", Value::Bool(false))]), Value::Int(10));
    assert_eq!(query(&mut e, "nested", &[("x", Value::Null), ("flag", Value::Bool(false))]), Value::Int(1));
}

#[test]
fn result_types_include_null_when_control_can_reach_the_end() {
    let source = r#"
query conditional(x: int ?):
  if x != null:
    return x
query loop(xs: [int] <=2):
  for x in xs:
    return x
query complete(flag: bool):
  if flag:
    return 1
  else:
    return 2
"#;
    let compiled = bound(source);
    let results: BTreeMap<_, _> = compiled.programs.iter().map(|program| (program.program.name.as_str(), &program.result)).collect();
    assert_eq!(results["conditional"], &Ty::Int.optional());
    assert_eq!(results["loop"], &Ty::Int.optional());
    assert_eq!(results["complete"], &Ty::Int);
    let mut engine = Engine::memory(compiled.schema.clone(), compiled.programs.iter().map(|program| program.program.clone())).unwrap();
    assert_eq!(query(&mut engine, "conditional", &[("x", Value::Null)]), Value::Null);
    assert_eq!(query(&mut engine, "loop", &[("xs", Value::Array(Vec::new()))]), Value::Null);
    let emitted = snapback4_lang::emit::typescript(&compiled);
    assert!(emitted.contains("conditional: Query<{ x?: number | null }, number | null>;"), "{emitted}");
    assert!(emitted.contains("loop: Query<{ xs: number[] }, number | null>;"), "{emitted}");
    assert!(emitted.contains("complete: Query<{ flag: boolean }, number>;"), "{emitted}");
}

#[test]
fn declaration_failures_are_diagnostic_instead_of_being_dropped_or_overwritten() {
    let duplicates = compile(&[("schema.q".into(), r#"
shape card = { value: 1 }
shape card = { value: 2 }
fn calculate(x: int): x
fn calculate(x: int): x + 1
fn fill():
  return null
fn fill():
  return null
effect notify
effect notify
"#.into())]);
    assert_eq!(duplicates.diagnostics.len(), 4, "{:?}", duplicates.diagnostics);
    for name in ["duplicate shape card", "duplicate fn calculate", "duplicate fn fill", "duplicate effect notify"] {
        assert!(duplicates.diagnostics.iter().any(|diagnostic| diagnostic.message.contains(name)), "{name}: {:?}", duplicates.diagnostics);
    }

    for source in ["shape card from legacy\n", "fn calculate from legacy\n", "proc fill from legacy\n"] {
        let refused = compile(&[("schema.q".into(), source.into())]);
        assert_eq!(refused.diagnostics[0].code, "E_QUARRY_UNSUPPORTED", "{source}: {:?}", refused.diagnostics);
    }
    let readable = compile(&[("schema.q".into(), "table rows:\n  read <- allow\nmaintain totals: count rows by id\n  readable <- allow\n".into())]);
    assert!(readable.diagnostics.iter().any(|diagnostic| diagnostic.code == "E_QUARRY_UNSUPPORTED" && diagnostic.message.contains("readable on a maintain")), "{:?}", readable.diagnostics);

    let empty_enum = compile(&[("schema.q".into(), "table rows:\n  state: enum()\n  read <- allow\n".into())]);
    assert_eq!(empty_enum.diagnostics[0].code, "E_QUARRY_SYNTAX");
    assert!(empty_enum.diagnostics[0].message.contains("at least one variant"));
}

#[test]
fn sync_inversion_and_hoisted_chunk_checks_keep_their_specific_diagnostics() {
    let inverted = compile(&[("schema.q".into(), "table rows:\n  owner: principal\n  read <- allow\n  sync to .owner\n".into())]);
    assert_eq!(inverted.diagnostics.len(), 1, "{:?}", inverted.diagnostics);
    assert_eq!(inverted.diagnostics[0].code, "E_SYNC");
    assert_eq!(inverted.diagnostics[0].guide, "sync");

    let unstable = compile(&[("schema.q".into(), r#"
table rows:
  rank: int
  by byRank: rank, id
  read <- allow
  update <- allow
fn one(): 1
job moveRows():
  chunk row in rows[one()] first 10 by byRank:
    update rows[row.id] { rank: row.rank + 1 }
"#.into())]);
    assert_eq!(unstable.diagnostics.len(), 1, "{:?}", unstable.diagnostics);
    assert_eq!(unstable.diagnostics[0].code, "E_JOB_CURSOR_INDEX");
    assert_eq!(unstable.diagnostics[0].site.line, 9);
}

#[test]
fn duplicate_named_keys_are_located_diagnostics_for_reads_ranges_and_rules() {
    let source = format!(
        "{ITEMS}\nquery point():\n  return items[a=1, a=2]\nquery page():\n  return items[a=1, a=2] first 10 by byABId\nquery mixed():\n  return items[a=1, 2]\ntable other:\n  n: int\n  read <- exists items[a=1, a=2]\nquery separate():\n  return misspelled\n"
    );
    let compiled = compile(&[("schema.q".into(), source)]);
    assert_eq!(compiled.diagnostics.len(), 5, "{:?}", compiled.diagnostics);
    assert_eq!(compiled.diagnostics.iter().filter(|d| d.message.contains("key repeats column a")).count(), 3);
    for diagnostic in &compiled.diagnostics {
        assert_eq!(diagnostic.site.file, "schema.q");
        assert!(diagnostic.site.line > 0 && diagnostic.site.col > 0);
        assert!(!diagnostic.rewrite.is_empty());
    }
    let source = format!("{ITEMS}\nquery valid():\n  return items[b=2, a=1]\n");
    let mut e = engine(&source);
    assert_eq!(query(&mut e, "valid", &[]), Value::Null);
}

#[test]
fn operation_uniqueness_uses_the_qualified_name_and_preserves_both_sites() {
    let sources = [("schema.q".into(), "query list():\n  return 1\n".into()), ("feed.q".into(), "query list():\n  return 2\n".into()), ("inbox.q".into(), "query list():\n  return 3\n".into())];
    let compiled = compile(&sources);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let names: Vec<_> = compiled.programs.iter().map(|p| p.program.name.as_str()).collect();
    assert_eq!(names, ["list", "feed.list", "inbox.list"]);
    let api = snapback4_lang::emit::typescript(&compiled);
    assert!(api.contains("name: \"feed.list\""));
    assert!(api.contains("name: \"inbox.list\""));
    let duplicate = compile(&[("feed.q".into(), "query list():\n  return 1\nquery list():\n  return 2\n".into())]);
    assert_eq!(duplicate.diagnostics.len(), 1);
    assert_eq!(duplicate.diagnostics[0].site.line, 3);
    assert!(duplicate.diagnostics[0].message.contains("duplicate operation feed.list; first declared at feed.q:1:1"));
    let collision = compile(&[("schema.q".into(), "query feed():\n  return 1\n".into()), ("feed.q".into(), "query list():\n  return 2\n".into())]);
    assert_eq!(collision.diagnostics.len(), 1);
    assert!(collision.diagnostics[0].message.contains("API name feed is both an operation and a module; first declared at schema.q:1:1"));
}

#[test]
fn numeric_rule_literals_use_the_same_checked_domain_as_program_literals() {
    for literal in ["1.5", "-1.5", "9007199254740992", "-9007199254740992", "18446744073709551616", "-18446744073709551616"] {
        for rule in [format!(".n = {literal}"), format!("exists targets[n = {literal}]")] {
            let source = format!("table targets:\n  n: int\n  unique byN: n\n  read <- allow\ntable t:\n  n: int\n  read <- {rule}\n");
            let compiled = compile(&[("schema.q".into(), source)]);
            assert!(compiled.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE" && d.site.line == 7), "literal {literal}: {:?}", compiled.diagnostics);
        }
    }
    for literal in ["0", "1", "-1", "9007199254740991", "-9007199254740991"] {
        let compiled = bound(&format!("table targets:\n  n: int\n  unique byN: n\n  read <- allow\ntable t:\n  n: int\n  read <- .n = {literal} or exists targets[n = {literal}]\n"));
        let json = serde_json::to_value(&compiled.schema.tables["t"].rules.read).unwrap();
        assert_eq!(json["Or"][0]["Eq"][1]["Literal"]["Int"], literal.parse::<i64>().unwrap());
        assert_eq!(json["Or"][1]["Exists"]["key"][0]["Literal"]["Int"], literal.parse::<i64>().unwrap());
    }
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("snapback4-lang-{}-{unique}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn workspace() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn generated_typescript_preserves_strings_and_typechecks_with_the_real_contract() {
    let source = "table t:\n  label: enum('has\"quote', 'back\\\\slash', 'line\\nbreak', 'tab\\tstop', 'é😀', '__proto__')\n  read <- allow\nquery __proto__():\n  return t['missing']\nquery metadata(photo: image <=1000):\n  return { width: photo.width, height: photo.height, duration: photo.duration, bytes: photo.bytes }\n";
    let compiled = compile(&[("quote\"back\\slash.q".into(), source.into())]);
    assert!(compiled.diagnostics.is_empty(), "{:?}", compiled.diagnostics);
    let api = snapback4_lang::emit::typescript(&compiled);
    for literal in ["has\"quote", "back\\slash", "line\nbreak", "tab\tstop", "é😀"] {
        assert!(api.contains(&serde_json::to_string(literal).unwrap()), "{api}");
    }
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("api.ts"), api.replace("\"snapback4/contract\"", "\"./contract\"")).unwrap();
    std::fs::write(scratch.0.join("contract.ts"), include_str!("../../../packages/snapback4/src/contract.ts")).unwrap();
    std::fs::write(
        scratch.0.join("check.ts"),
        r#"import { api, type Rows } from './api';
const label: Rows['t']['label'][] = ['has"quote', 'back\\slash', 'line\nbreak', 'tab\tstop', 'é😀', '__proto__'];
const name: string = api['quote"back\\slash'].__proto__.name;
type Metadata = NonNullable<typeof api['quote"back\\slash']['metadata']['__result']>;
const metadata: Metadata = { width: null, height: null, duration: null, bytes: 24 };
// @ts-expect-error Metadata can be absent for an image or a video.
const width: number = metadata.width;
const bytes: number = metadata.bytes;
type MetadataArgs = NonNullable<typeof api['quote"back\\slash']['metadata']['__args']>;
const input: MetadataArgs = { photo: { id: 'upload-id', width: null, height: null, duration: null } };
void width; void bytes; void input;
void label; void name;
"#,
    )
    .unwrap();
    let tsc = workspace().join("node_modules/typescript/bin/tsc");
    assert!(tsc.exists(), "the emitted-TypeScript check uses the existing Bun workspace dependencies; run bun install --frozen-lockfile in snapback4");
    let result = Command::new("node").arg(tsc).args(["--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "api.ts", "check.ts"]).current_dir(&scratch.0).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}

#[test]
fn generated_array_elements_preserve_union_precedence() {
    use snapback4_lang::emit::ty_ts;

    let row = Ty::Row("posts".into());
    let object = Ty::Object(BTreeMap::from([("id".into(), Ty::Id)]));
    let fields = BTreeMap::from([("id".into(), Ty::Id.optional())]);
    let cases = [
        ("optional row", row.clone().optional(), "(Rows[\"posts\"] | null)[]"),
        ("optional object", object.optional(), "({ id: string } | null)[]"),
        ("optional projection", Ty::RowShape(fields.clone()).optional(), "({ id: string | null; pending?: boolean } | null)[]"),
        ("enum", Ty::Enum(vec!["draft".into(), "published".into()]), "(\"draft\" | \"published\")[]"),
        ("nested list", Ty::List(Box::new(row.clone().optional()), 10), "(Rows[\"posts\"] | null)[][]"),
        ("nested collection", Ty::Collection(Box::new(row.clone().optional()), 10), "(Rows[\"posts\"] | null)[][]"),
        ("optional nested list", Ty::List(Box::new(row.clone().optional()), 10).optional(), "((Rows[\"posts\"] | null)[] | null)[]"),
        ("optional nested collection", Ty::Collection(Box::new(row.clone().optional()), 10).optional(), "((Rows[\"posts\"] | null)[] | null)[]"),
        ("nullable field", Ty::Object(fields), "{ id: string | null }[]"),
        ("row", row, "Rows[\"posts\"][]"),
        ("single variant", Ty::Enum(vec!["draft".into()]), "\"draft\"[]"),
        ("optional scalar", Ty::Int.optional(), "(number | null)[]"),
        ("image", Ty::Image, "{ id: string; width?: number | null; height?: number | null; bytes?: number; type?: string; duration?: number | null }[]"),
        ("video", Ty::Video, "{ id: string; width?: number | null; height?: number | null; bytes?: number; type?: string; duration?: number | null }[]"),
    ];
    let mut failures = Vec::new();
    for (name, element, expected) in cases {
        for array in [Ty::List(Box::new(element.clone()), 10), Ty::Collection(Box::new(element.clone()), 10)] {
            let actual = ty_ts(&array);
            if actual != expected {
                failures.push(format!("{name}: {array:?}\nexpected: {expected}\nactual:   {actual}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn generated_nullable_arrays_typecheck_with_the_real_contract() {
    let compiled = bound(r#"
table posts:
  label: text <=50
  read <- allow
  sync public
query nullableRows():
  out = []
  for post in posts first 10 by byId:
    out = out + [posts[post.id]]
  return out
query nullableObjects():
  out = []
  for post in posts first 10 by byId:
    out = out + [posts[post.id] { id, label }]
  return out
"#);
    let scratch = Scratch::new();
    let api = snapback4_lang::emit::typescript(&compiled);
    std::fs::write(scratch.0.join("api.ts"), api.replace("\"snapback4/contract\"", "\"./contract\"")).unwrap();
    std::fs::write(scratch.0.join("contract.ts"), include_str!("../../../packages/snapback4/src/contract.ts")).unwrap();
    std::fs::write(scratch.0.join("check.ts"), r#"import { api, type Rows } from './api';
type NullableRows = NonNullable<typeof api.nullableRows.__result>;
type NullableObjects = NonNullable<typeof api.nullableObjects.__result>;
const row: Rows['posts'] = { id: 'post', label: 'hello' };
const rows: NullableRows = [row, null];
const objects: NullableObjects = [null, row];
// @ts-expect-error A single row is not an array.
const singleRow: NullableRows = row;
// @ts-expect-error A single object is not an array.
const singleObject: NullableObjects = row;
function labels(values: NullableRows | NullableObjects): string[] {
  const first = values[0];
  // @ts-expect-error Indexing must preserve nullability.
  const required: Rows['posts'] = first;
  const result: string[] = [];
  if (first != null) result.push(first.id, first.label);
  for (const value of values) {
    // @ts-expect-error Iteration must preserve nullability.
    const required: Rows['posts'] = value;
    if (value !== null) result.push(value.id, value.label);
  }
  return result;
}
labels(rows); labels(objects);
"#).unwrap();
    let tsc = workspace().join("node_modules/typescript/bin/tsc");
    assert!(tsc.exists(), "the emitted-TypeScript check uses the existing Bun workspace dependencies; run bun install --frozen-lockfile in snapback4");
    let result = Command::new("node").arg(tsc).args(["--noEmit", "--strict", "--noUncheckedIndexedAccess", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "api.ts", "check.ts"]).current_dir(&scratch.0).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}

#[test]
fn asset_metadata_narrowing_matches_nullable_server_facts() {
    use snapback4_lang::types::Ty;
    let source = "query metadata(photo: image <=1000, clip: video <=1000):\n  return { width: photo.width, height: clip.height, duration: photo.duration, bytes: photo.bytes, safeDuration: clip.duration ?? 0 }\n";
    let compiled = bound(source);
    let Ty::Object(fields) = &compiled.programs[0].result else { panic!("metadata has object result") };
    for name in ["width", "height", "duration"] {
        assert_eq!(fields[name], Ty::Int.optional());
    }
    assert_eq!(fields["bytes"], Ty::Int);
    assert_eq!(fields["safeDuration"], Ty::Int);
    let invalid = compile(&[("schema.q".into(), "query duration(photo: image <=1000):\n  return photo.duration + 1\n".into())]);
    assert!(!invalid.diagnostics.is_empty(), "nullable metadata must be narrowed before arithmetic");
    let value = Value::Map(BTreeMap::from([("id".into(), Value::Id("upload-id".into())), ("width".into(), Value::Null), ("height".into(), Value::Null), ("duration".into(), Value::Null), ("bytes".into(), Value::Int(24))]).into());
    let result = query(&mut engine(source), "metadata", &[("photo", value.clone()), ("clip", value)]);
    assert_eq!(result.field("duration").unwrap(), &Value::Null);
    assert_eq!(result.field("safeDuration").unwrap(), &Value::Int(0));
    assert_eq!(result.field("bytes").unwrap(), &Value::Int(24));
}

#[test]
fn structural_population_refusals_surface_during_authored_compilation() {
    let schema = "table members:\n  group: id\n  seen: bool\n  by byGroup: group, id\n  read <- allow\n  update <- allow\n  sync public\n";
    let operation = "mutation visit(group: id):\n  page = members[group] first 10 by byGroup\n  for row in page:\n    update members[row.id] { seen: true }\n  return true\n";
    let refused = compile(&[("fanout.q".into(), format!("{schema}{operation}"))]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let diagnostic = &refused.diagnostics[0];
    assert_eq!(diagnostic.code, "E_STRUCTURAL_FANOUT");
    assert_eq!(diagnostic.site.file, "fanout.q");
    assert!(diagnostic.site.line > 0);
    assert!(!diagnostic.rewrite.is_empty());
    assert!(refused.programs.is_empty());
    let capped = schema.replace("  read <-", "  cap 10 by group\n  read <-");
    let admitted = bound(&format!("{capped}{operation}"));
    assert_eq!(admitted.programs.len(), 1);
    let query = "query page(group: id):\n  return members[group] first 10 by byGroup\n";
    assert_eq!(bound(&format!("{schema}{query}")).programs.len(), 1);
}

#[test]
fn references_allow_absent_ids_and_explicit_guards_require_visible_targets() {
    use snapback4_core::{ir::ArgType, value::object, wire};
    let source = r#"
table posts:
  author: principal
  read <- .author = viewer
  insert <- allow
  delete <- .author = viewer
table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
mutation unchecked(postId: posts, direction: int):
  upsert votes[postId, viewer] { direction }
mutation checked(postId: posts, direction: int):
  require exists posts[id = postId] else POST_NOT_FOUND
  upsert votes[postId, viewer] { direction }
mutation insertVote(postId: posts):
  insert votes { postId, principal: viewer, direction: 1 }
mutation changeVote(voteId: votes, postId: posts):
  update votes[voteId] { postId }
mutation removePost(postId: posts):
  delete posts[id = postId]
query post(postId: posts):
  return posts[id = postId]
"#;
    let id = |s: &str| Value::Id(s.into());
    let kind = ArgType::Ref { table: "posts".into() };
    let missing = wire::from_json(&kind, &serde_json::json!("null")).unwrap();
    assert_eq!(missing, id("null"));
    assert!(wire::from_json(&kind, &serde_json::Value::Null).is_err());
    let mut e = engine(source);
    e.seed([
        ("posts".into(), object([("id", id("visible")), ("author", id("dev:alice"))])),
        ("posts".into(), object([("id", id("hidden")), ("author", id("dev:bob"))])),
    ]).unwrap();
    let args = |post: Value, n| vec![("postId", post), ("direction", Value::Int(n))];
    let row = mutation(&mut e, "unchecked", &args(missing.clone(), 1));
    assert_eq!(row.field("postId"), Ok(&missing));
    mutation(&mut e, "unchecked", &args(missing.clone(), -1));
    assert_eq!(e.store().rows("votes").unwrap().len(), 1, "upsert may replace a dangling reference");
    let inserted = e.mutate("insertVote", None, context(&[("postId", id("also-absent"))]).with_ids(["vote2".into()])).unwrap();
    let WriteState::Sent { result: inserted, .. } = inserted.state else { panic!("{inserted:?}") };
    let vote_id = inserted.field("id").unwrap().clone();
    mutation(&mut e, "changeVote", &[("voteId", vote_id), ("postId", id("still-absent"))]);
    let before = e.store().rows("votes").unwrap();
    for target in [missing.clone(), id("hidden")] {
        let outcome = e.mutate("checked", None, context(&args(target.clone(), 1))).unwrap();
        assert!(matches!(outcome.state, WriteState::Failed { ref why, .. } if why.code == "POST_NOT_FOUND"), "{outcome:?}");
        assert_eq!(outcome.metered.examined, 1, "the explicit point read is metered even on a miss");
        assert_eq!(query(&mut e, "post", &[("postId", target)]), Value::Null);
        assert_eq!(e.store().rows("votes").unwrap(), before, "a guard refusal leaves rows intact");
    }
    let unguarded = e.mutate("unchecked", None, context(&args(id("visible"), 1))).unwrap();
    let guarded = e.mutate("checked", None, context(&args(id("visible"), 1))).unwrap();
    assert!(matches!(guarded.state, WriteState::Sent { .. }), "{guarded:?}");
    // Compare the same upsert path after the row exists, with and without its guard.
    let unguarded_again = e.mutate("unchecked", None, context(&args(id("visible"), 1))).unwrap();
    assert!(matches!(unguarded.state, WriteState::Sent { .. }));
    assert_eq!(guarded.metered.examined, unguarded_again.metered.examined + 1);
    mutation(&mut e, "removePost", &[("postId", id("visible"))]);
    assert!(e.store().rows("votes").unwrap().iter().any(|r| r.field("postId") == Ok(&id("visible"))), "deleting a target does not cascade to references");
    assert_eq!(query(&mut e, "post", &[("postId", id("visible"))]), Value::Null);
}


#[test]
fn actions_declare_typed_admission_and_unknown_results_without_a_quarry_body() {
    let sources = [("schema.q".into(), "use server\naction invite(email: text <=200, tags: [text <=10] <=3 ?)\naction rank() <- viewer = 'service:ranker'\naction paused() <- deny\n".into()), ("mail.q".into(), "action send(to: text <=100) <- not (viewer = 'dev:blocked')\n".into())];
    let bound = compile(&sources);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.programs.len(), 4);
    for p in &bound.programs {
        assert_eq!(p.program.kind, snapback4_core::ProgramKind::Action);
        assert_eq!(p.result, Ty::Unknown);
        assert_eq!(bound.schema.operations[&p.program.name].runs.as_deref(), Some("server"));
        assert_eq!(bound.schema.operations[&p.program.name].predicts.as_deref(), Some("never"));
    }
    let api = snapback4_lang::emit::typescript(&bound);
    assert!(api.contains("invite: Action<{ email: string; tags?: string[] | null }, unknown>"), "{api}");
    assert!(api.contains("name: \"mail.send\""), "{api}");
    assert!(api.contains("kind: \"action\""), "{api}");
    for source in ["use server\naction x():\n  return 1\n", "use server\naction x(a: int, a: int)\n", "use server\naction x() <- exists profiles[principal = viewer]\n", "use server\naction x(n: int) <- n = 1\n", "use server\naction x()\naction x()\n", "use server\nquery x():\n  return 1\naction x()\n", "use server\naction x(item: missing)\n"] {
        assert!(!compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty(), "accepted {source}");
    }
    let conflict = compile(&[("schema.q".into(), "use server\naction mail()\n".into()), ("mail.q".into(), "query inbox():\n  return 1\n".into())]);
    assert!(!conflict.diagnostics.is_empty());
    // The parser recovers to the new declaration after an unrelated bad line.
    let (document, diagnostics) = snapback4_lang::parser::parse_document("schema.q", "use server\nwat\naction recovered()\n");
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(document.actions[0].name, "recovered");
}
#[test]
fn range_seeks_type_the_next_column_and_continue_in_both_directions() {
    let source = format!("{ITEMS}\nquery seek(lo: int, hi: int, c: cursor ?):\n  return items[1, b > lo, b <= hi] after c first 2 by byABId\nquery reverse(lo: int, hi: int, c: cursor ?):\n  return items[a = 1, b >= lo, b < hi] after c last 2 by byABId\n");
    let mut engine = engine(&source);
    engine.seed((0..10).map(|n| ("items".into(), snapback4_core::value::object([("id", Value::Id(format!("n{n}"))), ("a", Value::Int(1)), ("b", Value::Int(n)), ("n", Value::Int(n))])))).unwrap();
    for (op, want) in [("seek", vec![3, 4, 5, 6, 7]), ("reverse", vec![6, 5, 4, 3, 2])] {
        let mut input = vec![("lo", Value::Int(2)), ("hi", Value::Int(7))];
        let mut values = Vec::new();
        for _ in 0..4 {
            let page = engine.query(op, context(&input)).unwrap();
            assert!(page.complete, "{page:?}");
            values.extend(page.data.as_array().unwrap().iter().map(|r| r.field("b").unwrap().as_int().unwrap()));
            match page.next { Some(cursor) => { input.retain(|(k, _)| *k != "c"); input.push(("c", Value::String(cursor))); }, None => break }
        }
        assert_eq!(values, want);
    }
    for (from, to) in [("b > lo", "n > lo"), ("b > lo", "b > 'bad'"), ("b > lo", "b > lo, b >= lo"), ("b > lo", "b > lo, 2")] {
        let bad = compile(&[("schema.q".into(), source.replace(from, to))]);
        assert!(!bad.diagnostics.is_empty(), "{to}");
    }
    for operation in [
        "query bad():\n  return exists items[1, b >= 2]\n",
        "mutation bad():\n  update items[1, b >= 2] { n: 9 }\n",
        "mutation bad():\n  delete items[1, b >= 2]\n",
    ] {
        let bad = compile(&[("schema.q".into(), format!("{ITEMS}\n{operation}"))]);
        assert!(!bad.diagnostics.is_empty(), "a point operation must not discard seek bounds: {operation}");
    }
    let bad_rule = compile(&[("schema.q".into(), format!("{ITEMS}\ntable guarded:\n  read <- exists items[1, b >= 2]\n"))]);
    assert!(!bad_rule.diagnostics.is_empty(), "a rule must not discard seek bounds");
}

#[test]
fn where_filters_after_rules_and_meters_lazy_predicate_reads() {
    let source = format!("{ITEMS}\ntable flags:\n  item: items\n  owner: principal\n  keep: bool\n  unique byItemOwner: item, owner\n  read <- .owner = viewer\nquery selected(c: cursor ?):\n  return items[1] after c first 2 by byABId where .n >= 4 and exists flags[.id, viewer] and flags[.id, viewer].keep = true\nquery sought(c: cursor ?):\n  return items[1] after c first 2 by byABId where .b >= 4\nquery direct(c: cursor ?):\n  return items[1, b >= 4] after c first 2 by byABId\n");
    let bound = bound(&source);
    assert_eq!(bound.notes.iter().filter(|n| n.code == "N_SEEK").count(), 1);
    let selected = &bound.programs.iter().find(|p| p.program.name == "selected").unwrap().program;
    let sites = snapback4_core::ir::read_sites(selected);
    assert_eq!(sites.iter().filter(|s| s.table == "flags" && s.index == "byItemOwner").count(), 2);
    assert!(bound.schema.operations["selected"].sites.iter().any(|s| s.table == "flags"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..8).map(|n| ("items".into(), snapback4_core::value::object([("id", Value::Id(format!("n{n}"))), ("a", Value::Int(1)), ("b", Value::Int(n)), ("n", Value::Int(n))])))).unwrap();
    engine.seed([4, 6].map(|n| ("flags".into(), snapback4_core::value::object([("id", Value::Id(format!("f{n}"))), ("item", Value::Id(format!("n{n}"))), ("owner", Value::Id("dev:alice".into())), ("keep", Value::Bool(true))])))).unwrap();
    let page = engine.query("selected", context(&[])).unwrap();
    assert_eq!(page.data.as_array().unwrap().iter().map(|r| r.field("n").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [4, 6]);
    assert_eq!(page.metered.rule_probes, 5, "rows 4..6 probe presence; the two present flags also read keep");
    assert_eq!(engine.query("sought", context(&[])).unwrap().data, engine.query("direct", context(&[])).unwrap().data);
    let bad = compile(&[("schema.q".into(), source.replace(".n >= 4 and exists", ".n + 4 and exists"))]);
    assert!(!bad.diagnostics.is_empty());
}

#[test]
fn grouping_preserves_first_seen_order_and_list_selection_is_nullable() {
    let mut engine = engine("query grouped():\n  rows = [{ emoji: 'b', who: 1 }, { emoji: 'a', who: 2 }, { emoji: 'b', who: 3 }]\n  return group(rows, 'emoji') { key, count: count(.items), first: first(.items), last: last(.items), at: at(.items, 1) }\nquery empty():\n  return { first: first([]), last: last([]), at: at([1], 9), negative: at([1], -1) }\n");
    let grouped = query(&mut engine, "grouped", &[]);
    let rows = grouped.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].field("key").unwrap(), &Value::String("b".into()));
    assert_eq!(rows[0].field("count").unwrap(), &Value::Int(2));
    assert_eq!(rows[0].field("first").unwrap().field("who").unwrap(), &Value::Int(1));
    assert_eq!(rows[0].field("last").unwrap().field("who").unwrap(), &Value::Int(3));
    assert_eq!(rows[0].field("at").unwrap().field("who").unwrap(), &Value::Int(3));
    assert_eq!(rows[1].field("at").unwrap(), &Value::Null);
    assert!(query(&mut engine, "empty", &[]).as_object().unwrap().values().all(|v| v == &Value::Null));
    for value in ["group([{ emoji: 'a' }], 'missing')", "group([1], 'emoji')", "at([1], 'x')"] {
        assert!(!compile(&[("schema.q".into(), format!("query bad():\n  return {value}\n"))]).diagnostics.is_empty());
    }
}

#[test]
fn every_list_builtin_accepts_pages_and_shaped_collections() {
    for source in ["items[] first 20 by byId", "items[] first 20 by byId { * }", "[{ id: 'a', n: 2 }, { id: 'b', n: 3 }]"] {
        let mut engine = engine(&format!("{ITEMS}\nquery all():\n  rows = {source}\n  total = 0\n  labels = []\n  for row in rows:\n    total = total + row.n\n    labels = labels + ['x']\n  return {{ total, sum: sum(rows, .n), count: count(rows), slice: slice(rows, 0, 1), sort: sort(rows, '-n'), group: group(rows, 'n'), first: first(rows), last: last(rows), at: at(rows, 1), joined: join(labels, ',') }}\n"));
        engine.seed([("a", 2), ("b", 3)].map(|(id, n)| ("items".into(), snapback4_core::value::object([("id", Value::Id(id.into())), ("a", Value::Int(n)), ("b", Value::Int(n)), ("n", Value::Int(n))])))).unwrap();
        let result = query(&mut engine, "all", &[]);
        assert_eq!(result.field("total").unwrap(), &Value::Int(5));
        assert_eq!(result.field("sum").unwrap(), &Value::Int(5));
        assert_eq!(result.field("count").unwrap(), &Value::Int(2));
        assert_eq!(result.field("sort").unwrap().as_array().unwrap()[0].field("n").unwrap(), &Value::Int(3));
        assert_eq!(result.field("first").unwrap().field("n").unwrap(), &Value::Int(2));
        assert_eq!(result.field("last").unwrap().field("n").unwrap(), &Value::Int(3));
        assert_eq!(result.field("joined").unwrap(), &Value::String("x,x".into()));
    }
}

#[test]
fn expression_ranges_evaluate_bounds_once_and_stop_at_the_step_meter() {
    let source = "query total(a: int, b: int):\n  total = 0\n  for i in range(a + 1, b * 2):\n    total = total + i\n  return total\nmutation capped(n: int):\n  for i in range(0, n):\n    continue\n  return 1\nquery literal():\n  n = 0\n  for i in range(0, 10001):\n    n = n + 1\n  return n\n";
    let mut engine = engine(source);
    assert_eq!(query(&mut engine, "total", &[("a", Value::Int(1)), ("b", Value::Int(4))]), Value::Int(27));
    assert_eq!(query(&mut engine, "total", &[("a", Value::Int(10)), ("b", Value::Int(2))]), Value::Int(0));
    assert_eq!(query(&mut engine, "literal", &[]), Value::Int(10001));
    engine.set_ceilings(snapback4_core::Ceilings { steps: 30, ..snapback4_core::Ceilings::default() });
    let outcome = engine.mutate("capped", None, context(&[("n", Value::Int(9007199254740991))])).unwrap();
    let WriteState::Failed { why, .. } = outcome.state else { panic!("expected step refusal") };
    assert_eq!(why.code, "E_BOUND");
    assert!(why.message.contains("steps"), "{}", why.message);
    assert!(outcome.metered.heap_bytes < 1000, "a range is not materialized: {:?}", outcome.metered);
    let bad = compile(&[("schema.q".into(), source.replace("range(a + 1, b * 2)", "range('a', b)"))]);
    assert!(!bad.diagnostics.is_empty());
}

#[test]
fn guessed_spellings_are_mechanical_refusals_with_exact_rewrites() {
    for (source, expected) in [
        ("query q(cond: bool, a: int, b: int):\n  return cond ? a : b\n", "a if cond else b"),
        ("query q():\n  a = { b: 1 }\n  return a?.b\n", "."),
        ("query q(x: [int] <=10):\n  return len(x)\n", "count(x)"),
        ("// guessed\nquery q():\n  return 1\n", "--"),
        ("# guessed\nquery q():\n  return 1\n", "--"),
    ] {
        let compiled = compile(&[("schema.q".into(), source.into())]);
        let refusal = compiled.diagnostics.iter().find(|d| d.code == "E_QUARRY_UNSUPPORTED").expect("one spelling refusal");
        assert_eq!(refusal.rewrite, expected, "{source}");
        assert!(refusal.mechanical);
    }
    let mut engine = engine("-- canonical\nquery q(cond: bool):\n  a = { b: 1 }\n  return { pick: 1 if cond else 2, member: a.b if a != null else null, count: count([1, 2]) }\n");
    let result = query(&mut engine, "q", &[("cond", Value::Bool(true))]);
    assert_eq!(result.field("pick").unwrap(), &Value::Int(1));
    assert_eq!(result.field("member").unwrap(), &Value::Int(1));
    assert_eq!(result.field("count").unwrap(), &Value::Int(2));
}

#[test]
fn named_probe_equalities_need_only_a_total_unique_key() {
    let source = include_str!("../../snapback4-sim/tests/fixtures/probe-equalities.q");
    for extra_index in ["", "  by byKeyAdmin: key, admin\n"] {
        let compiled = bound(&source.replace("  unique byKey: key\n", &format!("  unique byKey: key\n{extra_index}")));
        let rule = &compiled.schema.tables["members"].rules.insert;
        let snapback4_core::schema::RuleExpr::Or(terms) = rule else { panic!("{rule:?}") };
        let snapback4_core::schema::RuleExpr::Exists { index, key, equalities, .. } = &terms[1] else { panic!("{rule:?}") };
        assert_eq!(index, "byKey");
        assert_eq!((key.len(), equalities.len()), (1, 1));
        for name in ["get", "probe"] {
            let sites = snapback4_core::ir::read_sites(&compiled.programs.iter().find(|p| p.program.name == name).unwrap().program);
            assert_eq!(sites.len(), 1);
            assert_eq!((sites[0].kind, sites[0].index.as_str()), ("point", "byKey"));
        }
    }
    for replacement in ["by byKey: key", "unique byKey: key"] {
        let source = source.replace("unique byKey: key", replacement);
        let source = if replacement.starts_with("unique") { source.replace("key: text 1..64", "key: text 1..64 ?") } else { source };
        let bad = compile(&[("schema.q".into(), source)]);
        assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND" && d.rewrite.contains("first N")), "{:?}", bad.diagnostics);
    }
    for extra in ["missing = viewer", "admin = 2", "admin = unknown"] {
        let bad = compile(&[("schema.q".into(), source.replace("admin = viewer", extra))]);
        assert!(!bad.diagnostics.is_empty(), "{extra}");
    }
    let roster = include_str!("../../snapback4-sim/tests/fixtures/membership.q");
    let plain = "exists memberships[chatKey = .chatKey, principal = viewer]";
    for sync in ["sync", "sync to memberships[.chatKey]"] {
        let source = roster.replace(".principal = viewer or exists memberships[.chatKey, viewer]", &format!("{plain}\n  {sync}"));
        bound(&source);
        let bad = compile(&[("schema.q".into(), source.replace(plain, "exists memberships[chatKey = .chatKey, principal = viewer, role = 'admin']"))]);
        assert!(bad.diagnostics.iter().any(|d| d.code == "E_SYNC"), "{:?}", bad.diagnostics);
    }

}

#[test]
fn module_schedule_diagnostic_names_the_canonical_job() {
    let source = "table profiles:\n  public 'profiles'\njob backfillTimeline():\n  chunk p in profiles first 100 by byId:\n    return\nschedule repairTimeline every 1m: backfillTimeline\n";
    let bad = compile(&[("timeline.q".into(), source.into())]);
    assert_eq!(bad.diagnostics.len(), 1, "{:?}", bad.diagnostics);
    let diagnostic = &bad.diagnostics[0];
    assert_eq!(diagnostic.code, "E_QUARRY_UNKNOWN");
    assert_eq!(diagnostic.message, "schedule repairTimeline names bare job backfillTimeline; timeline.q declares it as timeline.backfillTimeline");
    assert_eq!(diagnostic.rewrite, "timeline.backfillTimeline");
    assert!(diagnostic.mechanical);
    let good = compile(&[("timeline.q".into(), source.replace(": backfillTimeline\n", ": timeline.backfillTimeline\n"))]);
    assert!(good.diagnostics.is_empty(), "{:?}", good.diagnostics);
    assert_eq!(good.schema.schedules[0].target, "timeline.backfillTimeline");
    let root = bound(source);
    assert_eq!(root.schema.schedules[0].target, "backfillTimeline");
    let ambiguous = compile(&[("timeline.q".into(), source.into()), ("other.q".into(), "job backfillTimeline():\n  chunk p in profiles first 100 by byId:\n    return\n".into())]);
    assert!(ambiguous.diagnostics.iter().all(|d| !d.mechanical));
}

#[test]
fn null_checks_narrow_snapshot_fields_and_surviving_paths() {
    let schema = "table feedReady:\n  principal: principal\n  changedAt: time ?\n  unique byPrincipal: principal\n  public 'readiness'\n";
    for body in [
        "return readiness = null or readiness.changedAt = null or readiness.changedAt < periodStart",
        "if readiness = null:\n    return false\n  if readiness.changedAt = null:\n    return false\n  return readiness.changedAt < periodStart",
        "require readiness != null and readiness.changedAt != null else NOT_READY\n  return readiness.changedAt < periodStart",
        "return readiness.changedAt < periodStart if readiness != null and readiness.changedAt != null else false",
        "return not (readiness = null or readiness.changedAt = null) and readiness.changedAt < periodStart",
    ] {
        let compiled = bound(&format!("{schema}query repair(periodStart: time):\n  readiness = feedReady[principal = viewer]\n  {body}\n"));
        let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
        for (at, expected) in [(None, false), (Some(0), true), (Some(20), false)] {
            engine.seed([("feedReady".into(), snapback4_core::value::object([("id", Value::Id("r".into())), ("principal", Value::Id("alice".into())), ("changedAt", at.map_or(Value::Null, Value::Int))]))]).unwrap();
            let result = engine.query("repair", Context::new("alice", BTreeMap::from([("periodStart".into(), Value::Int(10))])));
            if body.starts_with("require") && at.is_none() { assert!(result.is_err()); }
            else { assert_eq!(result.unwrap().data, Value::Bool(if body.starts_with("return readiness =") && at.is_none() { true } else { expected })); }
        }
    }
    for body in [
        "if readiness.changedAt != null:\n    return true\n  return readiness.changedAt < periodStart",
        "if readiness.changedAt != null:\n    readiness = feedReady[principal = viewer]\n    return readiness.changedAt < periodStart",
        "if readiness.changedAt != null:\n    for i in range(0, 2):\n      x = readiness.changedAt < periodStart\n      readiness = feedReady[principal = viewer]\n  return false",
        "if readiness.changedAt != null:\n    if periodStart > 0:\n      readiness = feedReady[principal = viewer]\n    return readiness.changedAt < periodStart",
        "if feedReady[principal = viewer].changedAt != null:\n    return feedReady[principal = viewer].changedAt < periodStart",
    ] {
        let bad = compile(&[("schema.q".into(), format!("{schema}query repair(periodStart: time):\n  readiness = feedReady[principal = viewer] ! else MISSING\n  {body}\n"))]);
        assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{body}: {:?}", bad.diagnostics);
    }
}
