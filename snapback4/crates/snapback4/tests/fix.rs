//! The exact-rewrite contract is tested independently of lane L's parser arrival.
#![allow(dead_code)]

#[path = "../src/project.rs"] mod project;
#[path = "../src/verbs/fix.rs"] mod fix;

use snapback4_lang::{Diagnostic, Site, diag};

fn repair(source: &str, line: u32, col: u32, rewrite: &str) -> String {
    let diagnostic = Diagnostic::new(&Site::new("schema.q", line, col), "E_QUARRY_UNSUPPORTED", "guessed spelling", rewrite).mechanical();
    let sources = vec![("schema.q".into(), source.into())];
    let (target, start, end, text) = fix::edit(&sources, 0, &diagnostic).expect("exact mechanical repair");
    assert_eq!(target, 0);
    let mut fixed = source.to_owned();
    fixed.replace_range(start..end, &text);
    fixed
}

#[test]
fn spelling_repairs_preserve_the_rest_of_the_line() {
    for (source, rewrite, expected) in [
        ("elif x:\n", "else if x:", "else if x:\n"),
        ("len(xs) + 1 -- keep\n", "count(xs)", "count(xs) + 1 -- keep\n"),
        ("proc helper():\n", "fn helper():", "fn helper():\n"),
        ("// words\n", "-- words", "-- words\n"),
        ("# words\n", "-- words", "-- words\n"),
    ] { assert_eq!(repair(source, 1, 1, rewrite), expected); }
    assert_eq!(repair("query q():\r\n  return len(['é']) -- café\r\n", 2, 10, "count(['é'])"), "query q():\r\n  return count(['é']) -- café\r\n");
}

#[test]
fn conditional_guesses_use_the_exact_expression_span() {
    assert_eq!(repair("  return flag ? 'yes' : 'no', tail\n", 1, 15, "'yes' if flag else 'no'"), "  return ('yes' if flag else 'no'), tail\n");
    assert_eq!(repair("  return flag ? 'if' : 'else'\n", 1, 15, "'if' if flag else 'else'"), "  return ('if' if flag else 'else')\n");
    assert_eq!(repair("  return flag ? '(' : ')'\n", 1, 15, "'(' if flag else ')'"), "  return ('(' if flag else ')')\n");
    assert_eq!(repair("  return row?.title -- keep\n", 1, 13, "row.title if row != null else null"), "  return (row.title if row != null else null) -- keep\n");
    assert_eq!(repair("  return row?.title -- keep\n", 1, 10, "(row.title if row != null else null)"), "  return ((row.title if row != null else null)) -- keep\n");
}

#[test]
fn an_unmarked_or_inexact_rewrite_cannot_change_source() {
    let sources = vec![("schema.q".into(), "len(values)".into())];
    let diagnostic = Diagnostic::new(&Site::new("schema.q", 1, 1), "E_QUARRY_UNSUPPORTED", "guess", "count(values)");
    assert!(fix::edit(&sources, 0, &diagnostic).is_none());
    let wrong = Diagnostic::new(&Site::new("schema.q", 1, 1), "E_QUARRY_UNSUPPORTED", "guess", "'yes' if condition else 'no'").mechanical();
    assert!(fix::edit(&sources, 0, &wrong).is_none());
    let deserialized: Diagnostic = serde_json::from_str(r#"{"site":{"file":"schema.q","line":1,"col":1},"code":"E_QUARRY_UNSUPPORTED","message":"guess","rewrite":"count(values)","guide":"language"}"#).unwrap();
    assert!(!deserialized.mechanical);
}

#[test]
fn the_mechanical_class_is_explicit_on_constructors() {
    let site = Site::new("schema.q", 1, 1);
    assert!(diag::ambiguous(&site, "choose", "t[x] by byX").mechanical);
    assert!(diag::unknown(&site, "index t.byOwner cannot carry a cursor: it neither ends in id nor is unique", "by byOwner: owner, id").mechanical);
    for guessed in ["elif", "? :", "?.", "len", "//", "#", "proc"] { assert!(diag::unsupported(&site, guessed, "exact rewrite").mechanical); }
    assert!(!diag::unsupported(&site, "while", "use a bounded for").mechanical);
    assert!(!diag::unknown(&site, "unknown name", "did you mean something else?").mechanical);
}
