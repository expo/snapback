use super::*;
use crate::{ast::Stmt, parser::parse_document};

fn planned(cap: &str, expression: &str) -> Catalog {
    let source = format!("table messages:\n  conversationId: id\n  at: time\n  tombstone: bool\n  score: int\n  public 'messages'\n{cap}query digest(c: id, s: time, e: time):\n  return {expression}\n");
    let (doc, mut diagnostics) = parse_document("schema.q", &source);
    let mut catalog = Catalog::build(vec![doc], &mut diagnostics);
    intent::plan(&mut catalog, &mut diagnostics);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    catalog
}

fn read(catalog: &Catalog) -> &ReadExpr {
    let Stmt::Return { value, .. } = &catalog.documents[0].programs[0].body[0] else { panic!("return") };
    match value {
        Expr::Exists { read, .. } | Expr::Read(read) => read,
        Expr::Call { args, .. } => { let Expr::Read(read) = &args[0] else { panic!("aggregate read") }; read },
        _ => panic!("read consumer"),
    }
}

#[test]
fn digest_aggregate_seek_plan_is_independent_of_cap_admission() {
    let domain = "messages where .conversationId = c and .at >= s and .at < e and not .tombstone";
    for cap in ["", "  cap 50 by conversationId\n"] {
        for expression in [format!("count({domain})"), format!("sum({domain}, .score)"), format!("exists {domain}")] {
            let catalog = planned(cap, &expression);
            let read = read(&catalog);
            assert_eq!(read.order_keys, ["at", "id"]);
            assert_eq!(read.seeks.iter().map(|s| (s.column.as_str(), s.op.as_str())).collect::<Vec<_>>(), [("at", ">="), ("at", "<")]);
            let index = catalog.tables["messages"].indexes.iter().find(|index| Some(&index.name) == read.index.as_ref()).unwrap();
            assert_eq!(index.columns, ["conversationId", "tombstone", "at", "id"]);
            assert!(index.name.starts_with("$intent:"));
            assert!(read.range.is_none(), "planning cannot grant a page bound or admission");
        }
    }
}

#[test]
fn aggregate_planning_preserves_observable_and_authored_order() {
    let domain = "messages where .conversationId = c and .at >= s and .at < e";
    for expression in [domain.to_owned(), format!("count({domain} first 1)"), format!("count({domain} by .id)")] {
        let catalog = planned("", &expression);
        assert_eq!(read(&catalog).order_keys, ["id"]);
        assert!(read(&catalog).seeks.is_empty());
    }
}

#[test]
fn aggregate_range_choice_is_canonical_and_prefers_finite_windows() {
    for predicate in [".score > 0 and .at >= s and .at < e", ".at < e and .score > 0 and .at >= s"] {
        let catalog = planned("", &format!("count(messages where {predicate})"));
        assert_eq!(read(&catalog).order_keys, ["at", "id"]);
    }
}

#[test]
fn aggregate_lone_range_uses_the_one_sided_fallback() {
    let catalog = planned("", "count(messages where .at > s)");
    assert_eq!(read(&catalog).order_keys, ["at", "id"]);
    assert_eq!(read(&catalog).seeks.iter().map(|seek| (seek.column.as_str(), seek.op.as_str())).collect::<Vec<_>>(), [("at", ">")]);
}
