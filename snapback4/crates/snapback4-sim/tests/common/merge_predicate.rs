//! A discovered lane's predicate must see that lane's selector on every page.
#![allow(dead_code)]
use snapback4_core::{Context, QueryOutcome, Value};
use snapback4_core::ir::{Expr, Merge, Program, Stmt};
use snapback4_core::value::object;

pub const SOURCE: &str = r#"table selectors:
  reader: principal
  owner: principal
  wanted: text <=20
  unique byReaderOwner: reader, owner
  cap 2 by reader
  read <- .reader = viewer
  sync
table items:
  owner: principal
  at: time
  body: text <=20
  by byOwnerTime: owner, at, id
  cap 128
  public 'items'
  sync public
fn desired(p: selectors): p.wanted
query discovered(c: cursor ?):
  return merge items after c first 20 by byOwnerTime where .body = p.wanted:
    [p.owner] for p in selectors[viewer] first 2 by byReaderOwner
query helper(c: cursor ?):
  return merge items after c first 20 by byOwnerTime where .body = desired(p):
    [p.owner] for p in selectors[viewer] first 2 by byReaderOwner
query lexical(c: cursor ?):
  return merge items after c first 20 by byOwnerTime where (.owner = 'dev:a' and .body = 'red') or (.owner = 'dev:b' and .body = 'blue'):
    ['dev:a']
    ['dev:b']
query unfiltered(c: cursor ?):
  return merge items after c first 20 by byOwnerTime:
    [p.owner] for p in selectors[viewer] first 2 by byReaderOwner
"#;

pub fn rows() -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    for (owner, wanted) in [("dev:a", "red"), ("dev:b", "blue")] {
        rows.push(("selectors".into(), object([("id", Value::Id(owner.into())), ("reader", Value::Id("dev:reader".into())), ("owner", Value::Id(owner.into())), ("wanted", Value::String(wanted.into()))])));
        for n in 0..48 {
            let body = if n % 2 == 0 { wanted } else if wanted == "red" { "blue" } else { "red" };
            rows.push(("items".into(), object([("id", Value::Id(format!("{owner}-{n:02}"))), ("owner", Value::Id(owner.into())), ("at", Value::Int(n)), ("body", Value::String(body.into()))])));
        }
    }
    rows
}

pub fn merge(program: &Program) -> &Merge {
    let Stmt::Return(Expr::Merge(merge)) = program.body.last().unwrap() else { panic!("direct merge return") };
    merge
}

pub fn eager(programs: &[Program]) -> Vec<Program> {
    let mut programs = programs.to_vec();
    for program in &mut programs {
        let Stmt::Return(Expr::Merge(merge)) = program.body.last_mut().unwrap() else { panic!("direct merge return") };
        for lane in &mut merge.lanes { lane.setup.push(Stmt::Let { name: "$eager_control".into(), value: Expr::Literal(Value::Null) }); }
    }
    programs
}

pub fn context(cursor: Option<String>) -> Context {
    Context::new("dev:reader", std::collections::BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))])).at(300)
}

pub fn check(host: &str, mut query: impl FnMut(bool, &str, Option<String>) -> QueryOutcome) {
    for name in ["discovered", "helper", "lexical", "unfiltered"] {
        let mut cursor = None;
        let mut ids = Vec::new();
        let mut pages = 0;
        for _ in 0..6 {
            let page = query(false, name, cursor.clone());
            let eager = query(true, name, cursor.clone());
            assert_eq!((&page.data, &page.next, page.complete), (&eager.data, &eager.next, eager.complete), "{host} {name} page {pages}: discovered predicate must keep its own selector");
            if name != "unfiltered" {
                let lexical = query(false, "lexical", cursor.clone());
                assert_eq!((&page.data, &page.next, page.complete), (&lexical.data, &lexical.next, lexical.complete), "{host} {name}: same results as fixed-prefix lazy merge");
            }
            assert!(page.complete);
            assert!(page.capped_at.is_none());
            ids.extend(page.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()));
            pages += 1;
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none(), "pagination terminates");
        let expected: Vec<_> = (0..48).filter(|n| name == "unfiltered" || n % 2 == 0).flat_map(|n| [format!("dev:a-{n:02}"), format!("dev:b-{n:02}")]).collect();
        assert_eq!(ids, expected, "{host} {name}: no missing, wrong-colour or duplicate rows");
        assert_eq!(pages, if name == "unfiltered" { 5 } else { 3 });
        println!("MERGE_BINDING host={host} shape={name} pages={pages} rows={} eager_equal=true", ids.len());
    }
}

pub fn paths(schema: &snapback4_core::Schema, programs: &[Program]) {
    for program in programs {
        let lazy = snapback4_core::engine::rules::lazy_merge(schema, merge(program));
        println!("MERGE_PATH shape={} lazy={lazy}", program.name);
        assert_eq!(lazy, ["lexical", "unfiltered"].contains(&program.name.as_str()));
    }
}
