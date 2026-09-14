use snapback4_core::engine::QueryOutcome;
use snapback4_core::value::{object, Value};
use std::collections::BTreeSet;

pub const SOURCE: &str = r#"
use personas alice

table items:
  n: int
  scope: int
  by byN: n, id
  by byScopeN: scope, n, id
  read <- allow
  sync public

query ownedAgain(c: cursor ?):
  return items[1] after c last 5 by byScopeN

query ownedOnly(c: cursor ?):
  return items[1] after c last 5 by byScopeN

query interruptedTwice(c: cursor ?):
  result = []
  for scope in range(0, 2):
    for i in items[scope] after c last 5 by byScopeN:
      result = result + [{ id: i.id, n: i.n }]
      break
  return result

query stillWhole(c: cursor ?):
  rows = items[] after c last 5 by byN
  for i in rows:
    break
  return rows

query differentResult(c: cursor ?):
  rows = items[] after c last 5 by byN
  result = []
  for i in rows:
    result = result + [{ id: i.id, n: i.n }]
    break
  alias = { result }
  return alias

query wholeAndDifferent(c: cursor ?):
  rows = items[] after c last 5 by byN
  result = []
  for i in rows:
    result = result + [i]
    break
  return { rows, result }

query auxiliaryFinishes(c: cursor ?):
  rows = items[] after c last 5 by byN
  unused = []
  for i in rows:
    unused = unused + [i.n]
  return rows

query auxiliaryBreaks(c: cursor ?):
  rows = items[] after c last 5 by byN
  unused = []
  for i in rows:
    unused = unused + [i.n]
    break
  return rows

query overwrittenCollector(c: cursor ?):
  rows = items[] after c last 5 by byN
  result = []
  for i in rows:
    result = result + [i]
    break
  result = rows
  return result

query auxiliaryField(c: cursor ?):
  rows = items[] after c last 5 by byN
  unused = []
  for i in rows:
    unused = unused + [i]
    break
  wrapped = { rows, unused }
  alias = wrapped
  return alias.rows

query repeatedCount(c: cursor ?):
  result = 0
  for scope in range(0, 2):
    rows = items[scope] after c last 5 by byScopeN
    result = result + count(rows)
  return result
"#;

pub fn rows(scopes: [usize; 2]) -> Vec<(String, Value)> {
    scopes.into_iter().enumerate().flat_map(|(scope, count)| (0..count).map(move |n| {
        ("items".into(), object([("id", Value::Id(format!("s{scope}n{n}"))),
            ("n", Value::Int((scope * 10 + n) as i64)), ("scope", Value::Int(scope as i64))]))
    })).collect()
}

pub fn check(name: &str, scopes: [usize; 2], read: QueryOutcome) {
    let count = scopes.iter().sum::<usize>();
    let (len, next, complete) = match name {
        "interruptedTwice" => (scopes.iter().filter(|n| **n > 0).count(), false, scopes.iter().all(|n| *n <= 1)),
        "differentResult" => (usize::from(count > 0), false, count <= 1),
        "wholeAndDifferent" => {
            assert_eq!(read.data.field("rows").unwrap().as_array().unwrap().len(), count.min(5));
            (usize::from(count > 0), count > 5, count <= 1)
        }
        "repeatedCount" => {
            assert_eq!(read.data, Value::Int(scopes.iter().map(|n| n.min(&5)).sum::<usize>() as i64));
            assert!(read.next.is_none());
            assert_eq!(read.complete, scopes.iter().all(|n| *n <= 5), "{name}/{scopes:?}: {read:?}");
            return;
        }
        _ => (count.min(5), count > 5, true),
    };
    let values = if matches!(name, "differentResult" | "wholeAndDifferent") { read.data.field("result").unwrap() } else { &read.data };
    println!("{name}/{scopes:?}: rows={}, next={}, complete={}", values.as_array().unwrap().len(), read.next.is_some(), read.complete);
    assert_eq!(values.as_array().unwrap().len(), len);
    assert_eq!(read.next.is_some(), next, "{name}/{scopes:?}: {read:?}");
    assert_eq!(read.complete, complete, "{name}/{scopes:?}: {read:?}");
}

#[derive(Clone, Copy, Debug)]
pub struct Shape { pub depth: usize, pub breaks: bool, pub auxiliary: bool }

pub fn shapes() -> Vec<Shape> {
    (0..=2).flat_map(|depth| [false, true].into_iter().flat_map(move |breaks| {
        [false, true].into_iter().map(move |auxiliary| Shape { depth, breaks, auxiliary })
    })).collect()
}

pub fn generated(shape: Shape) -> String {
    let mut source = format!("{SOURCE}\nquery generated(c: cursor ?):\n");
    if shape.depth == 0 {
        source.push_str("  return items[] after c last 5 by byN\n");
        return source;
    }
    if shape.auxiliary { source.push_str("  rows = items[] after c last 5 by byN\n"); }
    source.push_str("  result = []\n");
    let indent = if shape.depth == 2 {
        source.push_str("  for scope in range(0, 2):\n");
        "    "
    } else { "  " };
    let domain = if shape.auxiliary { "rows" } else if shape.depth == 2 {
        "items[scope] after c last 5 by byScopeN"
    } else { "items[] after c last 5 by byN" };
    source.push_str(&format!("{indent}for i in {domain}:\n{indent}  result = result + [i]\n"));
    if shape.breaks { source.push_str(&format!("{indent}  break\n")); }
    source.push_str(if shape.auxiliary { "  return rows\n" } else { "  return result\n" });
    source
}

// Independent oracle: enumerate input identities and modeled page executions,
// project the rows the authored loops emit, and account for each continuation.
// This does not inspect the IR, the ownership plan, or engine loss flags.
pub fn oracle(shape: Shape, scopes: [usize; 2], read: QueryOutcome) {
    let input = rows(scopes).into_iter().map(|(_, row)| row).collect::<Vec<_>>();
    let mut all = input.iter().collect::<Vec<_>>();
    all.sort_by_key(|row| -row.field("n").unwrap().as_int().unwrap());
    let pages = if shape.depth == 2 && !shape.auxiliary {
        (0..2).map(|scope| all.iter().copied().filter(|row| row.field("scope").unwrap() == &Value::Int(scope)).collect::<Vec<_>>()).collect::<Vec<_>>()
    } else { vec![all] };
    let owns = shape.depth == 0 || shape.auxiliary || (shape.depth == 1 && !shape.breaks);
    let mut expected = Vec::new();
    let mut missing = BTreeSet::new();
    for page in &pages {
        let emitted = if shape.depth > 0 && !shape.auxiliary && shape.breaks { 1 } else { 5 };
        expected.extend(page.iter().take(emitted).map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
        for (n, row) in page.iter().enumerate() {
            let reached = n < emitted;
            let continued = owns && n >= 5;
            if !reached && !continued { missing.insert(row.field("id").unwrap().as_str().unwrap().to_owned()); }
        }
    }
    let actual = read.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(actual, expected, "{shape:?}/{scopes:?}");
    assert_eq!(read.next.is_some(), owns && pages.last().is_some_and(|page| page.len() > 5), "{shape:?}/{scopes:?}");
    assert_eq!(read.complete, missing.is_empty(), "{shape:?}/{scopes:?}, missing={missing:?}: {read:?}");
}

// An IR site can execute before its final returned execution. Reuse the exact
// compiled scan (including its site) inside a loop, with an earlier scope.
// The ownership contract is last execution, not a transfer of earlier cursors.
pub fn repeat_owned_site(program: &mut snapback4_core::ir::Program) {
    use snapback4_core::ir::*;
    if program.name != "ownedAgain" { return; }
    let mut scan = (*scans(program).last().unwrap()).clone();
    scan.prefix = vec![IndexKeyExpr::Scalar(Expr::Literal(Value::Int(0)))];
    program.body.insert(0, Stmt::For {
        binding: "repeat".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 2 },
        body: vec![Stmt::Let { name: "discarded".into(), value: Expr::Scan(scan) }],
    });
}

pub fn check_owned(scopes: [usize; 2], repeated: QueryOutcome, last: QueryOutcome) {
    assert_eq!(repeated.data, last.data, "last execution's returned rows");
    assert_eq!(repeated.next, last.next, "last execution's exact cursor, never the earlier cursor");
    assert_eq!(repeated.next.is_some(), scopes[1] > 5);
    assert_eq!(repeated.complete, scopes[0] <= 5, "{scopes:?}: {repeated:?}");
    assert!(last.complete);
}
