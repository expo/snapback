//! App-farm wave 5 (snapback4@0.4.20): rule-language and diagnostic friction
//! (LLP 3000.036 §15). Each test pins `check` against the engine on the
//! lanes' own shapes, or applies a printed rewrite and compiles and runs it.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, Diagnostic, compile};
use std::collections::BTreeMap;

fn bound(source: &str) -> Bound {
    compile(&[("schema.q".into(), source.into())])
}

fn clean(source: &str) -> Bound {
    let b = bound(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
    b
}

#[allow(dead_code)]
fn first(source: &str, code: &str) -> Diagnostic {
    let b = bound(source);
    b.diagnostics.iter().find(|d| d.code == code && d.cascade_of.is_none()).unwrap_or_else(|| panic!("{code}: {:#?}", b.diagnostics)).clone()
}

#[allow(dead_code)]
fn note<'a>(b: &'a Bound, code: &str) -> Option<&'a Diagnostic> {
    b.notes.iter().find(|n| n.code == code)
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn engine(source: &str, rows: Vec<(&str, Vec<(&str, Value)>)>) -> Engine {
    let b = clean(source);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows.into_iter().map(|(table, fields)| (table.to_owned(), object(fields)))).unwrap_or_else(|e| panic!("{source}\n{e:?}"));
    engine
}

fn id(text: &str) -> Value { Value::Id(text.into()) }

// ---- #4: a projection shape must not change prefix coverage ----

/// Lane 100: `cap 500 by route` covers `walks where .route = route`; the same
/// read with a page shape `walkCard` refused "declare `cap N` on walks".
const WALKS: &str = "table routes:
  walker: principal
  read <- .walker = viewer
  online only
table walks:
  route: routes
  note: text <=500 ?
  status: enum('scheduled', 'done') default 'scheduled'
  cap 500 by route
  immutable route
  read <- exists routes[.route, walker = viewer]
  online only

shape walkCard = { id, note, route }
";

#[test]
fn a_page_shape_after_a_capped_prefix_keeps_the_cap() {
    for query in [
        "query q(route: routes):\n  return walks where .route = route walkCard\n",
        "query q(route: routes):\n  return walks where .status = 'done' and .route = route walkCard\n",
        "query q(route: routes):\n  return walks where .route = route and .status = 'done' walkCard\n",
    ] {
        let source = format!("{WALKS}{query}");
        let b = bound(&source);
        assert!(b.diagnostics.is_empty(), "the shape must not change coverage:\n{source}\n{:#?}", b.diagnostics);
        let mut engine = engine(&source, vec![
            ("routes", vec![("id", id("r1")), ("walker", id("wes"))]),
            ("walks", vec![("id", id("w1")), ("route", id("r1")), ("note", Value::String("ok".into())), ("status", Value::String("done".into()))]),
        ]);
        let outcome = engine.query("q", Context::new("wes", args(&[("route", id("r1"))]))).unwrap();
        let rows = outcome.data.as_array().unwrap();
        assert_eq!(rows.len(), 1, "{source}");
        let row = rows[0].as_object().unwrap();
        assert!(row.contains_key("note") && !row.contains_key("status"), "the shape applies to the page's rows: {row:?}");
    }
    // A row-dependent operand keeps its typed recognition in the binder.
    clean(&format!("{WALKS}query q(route: routes, c: cursor ?):\n  return walks where .route = route and .note = .note walkCard first 50 by .id after c\n"));
}
