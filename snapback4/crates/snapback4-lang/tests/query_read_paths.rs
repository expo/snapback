use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;

const TABLES: &str = "table roles:
  principal: principal
  role: enum('staff', 'captain', 'officer', 'lead', 'member')
  unique principal
  cap 100
  read <- .principal = viewer or exists roles[principal = viewer, role = 'staff']
  online only
table requests:
  owner: principal
  at: time
  cap 1000
  read <- .owner = viewer or exists roles[principal = viewer, role = 'staff'] or exists roles[principal = viewer, role = 'captain'] or exists roles[principal = viewer, role = 'officer'] or exists roles[principal = viewer, role = 'lead']
  online only
";

#[test]
fn branch_and_straight_queries_return_the_same_visible_rows() {
    let source = format!("{TABLES}
query direct(c: cursor ?):
  return requests last 50 by .at after c
query branch(c: cursor ?):
  if exists roles[principal = viewer, role = 'staff'] or exists roles[principal = viewer, role = 'captain'] or exists roles[principal = viewer, role = 'officer'] or exists roles[principal = viewer, role = 'lead']:
    return requests last 50 by .at after c
  return requests where .owner = viewer last 50 by .at after c
");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);

    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("roles".into(), object([("id", Value::Id("r".into())), ("principal", Value::Id("staff".into())), ("role", Value::String("staff".into()))])),
        ("requests".into(), object([("id", Value::Id("q".into())), ("owner", Value::Id("member".into())), ("at", Value::Int(1))])),
    ]).unwrap();
    for viewer in ["staff", "member", "stranger"] {
        let context = || Context::new(viewer, [("c".into(), Value::Null)].into());
        let direct = engine.query("direct", context()).unwrap();
        let branch = engine.query("branch", context()).unwrap();

        assert_eq!(branch.data, direct.data);
        assert!(branch.complete && direct.complete);
        assert_eq!(branch.data.as_array().unwrap().len(), usize::from(viewer != "stranger"));
    }
}

fn checked(body: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), format!("{TABLES}{body}"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn missing_return_names_the_uncovered_path_without_breaking_old_queries() {
    for (body, path) in [
        ("query missing(flag: bool):\n  if flag:\n    return []\n", "is false"),
        ("query missing():\n  for row in requests first 1 by .id:\n    return row\n", "zero iterations"),
        ("query missing():\n  x = 1\n", "entry → end"),
        ("query missing(a: bool, b: bool):\n  if a:\n    if b:\n      return []\n  else:\n    return []\n", "is false"),
    ] {
        let bound = checked(body);
        let note = bound.notes.iter().find(|note| note.code == "N_QUERY_FALLTHROUGH").unwrap();
        assert!(note.message.contains(path), "{note}");
        assert!(note.rewrite.contains("return []") && note.rewrite.contains("return null"));
        assert_eq!(note.guide, "programs");
    }
    for body in [
        "query total(flag: bool):\n  if flag:\n    return []\n  return []\n",
        "query total(flag: bool):\n  if flag:\n    []\n  else:\n    []\n",
        "query total(flag: bool):\n  if flag:\n    require false else STOP\n  else:\n    return []\n",
        "query total():\n  for row in requests first 1 by .id:\n    return row\n  return null\n",
        "fn notify(flag: bool):\n  if flag:\n    return null\nquery total(flag: bool):\n  notify(flag)\n",
        "mutation writes(flag: bool):\n  if flag:\n    return null\n",
    ] {
        let bound = checked(body);
        assert!(!bound.notes.iter().any(|note| note.code == "N_QUERY_FALLTHROUGH"), "{body}: {:?}", bound.notes);
    }
}

#[test]
fn physical_reservation_adds_sequential_reads_and_conservatively_sums_loop_arms() {
    let page = "requests last 50 by .id";
    for body in [
        format!("query q(flag: bool):\n  if flag:\n    a = {page}\n  else:\n    b = {page}\n  return []\n"),
        format!("query q(flag: bool):\n  if flag:\n    return {page}\n  return {page}\n"),
        format!("query q(flag: bool):\n  if flag:\n    require false else STOP\n  return {page}\n"),
    ] {
        let bound = checked(&body);
        let (price, allowance) = snapback4_core::engine::rules::bounded_query_work(&bound.schema, &bound.programs[0].program).unwrap();
        assert_eq!((price, allowance), (5005, 8192), "{body}");
        assert!(!bound.notes.iter().any(|note| note.code == "N_QUERY_RESERVATION"));
    }
    for body in [
        format!("query q():\n  a = {page}\n  return {page}\n"),
        format!("query q(flag: bool):\n  for i in range(0, 2):\n    if flag:\n      a = {page}\n    else:\n      b = {page}\n  return []\n"),
    ] {
        let bound = checked(&body);
        let (price, allowance) = snapback4_core::engine::rules::bounded_query_work(&bound.schema, &bound.programs[0].program).unwrap();
        assert_eq!((price, allowance), (10010, 8192), "{body}");
        assert!(bound.notes.iter().any(|note| note.code == "N_QUERY_RESERVATION" && note.message.contains("10010")));
    }
}

#[test]
fn loop_occurrences_cannot_reuse_their_prepaid_physical_allowance() {
    let bound = checked("query q():\n  rows = []\n  for i in range(0, 2):\n    rows = rows + [requests last 50 by .id]\n  return rows\n");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("requests".into(), object([("id", Value::Id("q".into())), ("owner", Value::Id("member".into())), ("at", Value::Int(1))]))]).unwrap();
    let result = engine.query("q", Context::new("member", Default::default())).unwrap();
    assert!(!result.complete);
    let rows = result.data.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].as_array().unwrap().len(), 1);
    assert!(rows[1].as_array().unwrap().is_empty());
}

#[test]
fn conditions_expression_blocks_and_alternating_loop_arms_keep_all_their_work() {
    use snapback4_core::ir::{self, Expr, Stmt};
    let bound = checked("query q():\n  return requests last 50 by .id\n");
    let mut program = bound.programs[0].program.clone();
    let page = program.body.last().unwrap().clone();
    let Stmt::Return(value) = &page else { panic!("page return") };
    let yes = Expr::Literal(Value::Bool(true));
    program.body = vec![Stmt::If {
        condition: Expr::Block { body: vec![Stmt::Let { name: "conditionRead".into(), value: value.clone() }], value: Box::new(yes.clone()) },
        then_body: vec![page.clone()], else_body: vec![page.clone()],
    }];
    assert_eq!(snapback4_core::engine::rules::bounded_query_work(&bound.schema, &program), Some((10010, 8192)));
    program.body = vec![Stmt::Return(Expr::Block { body: vec![Stmt::If {
        condition: yes, then_body: vec![Stmt::Let { name: "yes".into(), value: value.clone() }],
        else_body: vec![Stmt::Let { name: "no".into(), value: value.clone() }],
    }], value: Box::new(ir::var("yes")) })];
    assert_eq!(snapback4_core::engine::rules::bounded_query_work(&bound.schema, &program), Some((10010, 8192)));

    let source = format!("{}query alternate():\n  rows = []\n  for i in range(0, 2):\n    if i = 0:\n      rows = rows + [requests last 50 by .id]\n    else:\n      rows = rows + [requests last 50 by .id]\n  return rows\n", TABLES.replace("cap 1000", "cap 700"));
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(snapback4_core::engine::rules::bounded_query_work(&bound.schema, &bound.programs[0].program), Some((7010, 8192)));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("requests".into(), object([("id", Value::Id("q".into())), ("owner", Value::Id("member".into())), ("at", Value::Int(1))]))]).unwrap();
    let answer = engine.query("alternate", Context::new("member", Default::default())).unwrap();
    assert!(answer.complete);
    assert!(answer.data.as_array().unwrap().iter().all(|rows| rows.as_array().unwrap().len() == 1));
}

#[test]
fn returned_branches_match_straight_pages_at_real_meter_cuts_and_hidden_populations() {
    let bound = checked("query direct(flag: bool, c: cursor ?):\n  return requests where .owner = viewer last 1 by .id after c\nquery branched(flag: bool, c: cursor ?):\n  if flag:\n    return requests where .owner = viewer last 1 by .id after c\n  return requests where .owner = viewer last 1 by .id after c\n");
    let mut worlds = Vec::new();
    for hidden in [0, 8] {
        let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        let mut rows = vec![];
        for at in 0..3 + hidden {
            rows.push(("requests".into(), object([("id", Value::Id(format!("q{at}"))), ("owner", Value::Id(if at < 3 { "member" } else { "other" }.into())), ("at", Value::Int(at))])));
        }
        engine.seed(rows).unwrap(); worlds.push(engine);
    }
    let mut cut = false;
    for examined in 0..5 {
        let mut previous = None;
        for engine in &mut worlds {
            let mut ceilings = snapback4_core::Ceilings::default(); ceilings.examined = examined; engine.set_ceilings(ceilings);
            for flag in [true, false] {
                let ctx = || Context::new("member", [("flag".into(), Value::Bool(flag)), ("c".into(), Value::Null)].into());
                let direct = engine.query("direct", ctx()).unwrap();
                let branch = engine.query("branched", ctx()).unwrap();
                cut |= !branch.complete;
                assert_eq!(branch.data, direct.data);
                assert_eq!((branch.complete, branch.cut, branch.next.is_some()), (direct.complete, direct.cut, direct.next.is_some()));
                let normalize = |meter| { let mut value = serde_json::to_value(meter).unwrap(); value.as_object_mut().unwrap().remove("steps"); value };
                assert_eq!(normalize(branch.metered), normalize(direct.metered));
                let outcome = (branch.data, branch.complete, branch.cut, branch.next, normalize(branch.metered));
                if let Some(previous) = &previous { assert_eq!(&outcome, previous); }
                previous = Some(outcome);
            }
        }
    }
    assert!(cut, "the witness must actually cut");
}
