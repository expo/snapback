//! Round 3: a pasted repair must preserve both source and the answer it gives.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, Diagnostic, compile};

const MODEL: &str = "table members:\n  conversation: id\n  active: bool\n  public\n";
fn checked(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let bound = checked(source);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:#?}", bound.diagnostics);
    bound
}
fn refusal(source: &str) -> Diagnostic {
    let bound = checked(source);
    bound.diagnostics.into_iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY")
        .unwrap_or_else(|| panic!("missing self-comparison refusal: {source}"))
}
fn engine(source: &str) -> Engine {
    let bound = clean(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("a", "one"), ("b", "a")].map(|(id, conversation)| ("members".into(), object([
        ("id", Value::Id(id.into())), ("conversation", Value::Id(conversation.into())), ("active", Value::Bool(true)),
    ])))).unwrap();
    engine
}

#[test]
fn nested_key_repair_preserves_the_reviewers_two_row_answer() {
    let retained = "count(members[conversation = .id] first 20 by .active) > 0";
    // Include the exact review reproduction and a pre-existing key insertion.
    for prefix in ["members", "members[]", "members[active = .active]"] {
        let nested = format!("{prefix} where .conversation = .conversation and {retained} first 20");
        let declaration = format!("query q(c: cursor ?):\n  return members first 20 after c {{\n    id,\n    roster: {nested}\n  }}\n");
        let d = refusal(&format!("{MODEL}{declaration}"));
        let keyed = match prefix {
            "members" | "members[]" => "members[conversation = .conversation]",
            _ => "members[active = .active, conversation = .conversation]",
        };
        let mut engine = engine(&format!("{MODEL}{}", declaration.replace(&nested, &d.rewrite)));
        let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
        assert!(page.complete);
        let rows = page.data.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].field("id").unwrap(), &Value::Id("a".into()));
        let roster = rows[0].field("roster").unwrap().as_array().unwrap();
        assert_eq!(roster.len(), 1, "reprinting the retained key silently emptied a's roster");
        assert_eq!(roster[0].field("id").unwrap(), &Value::Id("a".into()));
        assert!(rows[1].field("roster").unwrap().as_array().unwrap().is_empty());
        assert_eq!(d.rewrite, format!("{keyed} where {retained} first 20"));
    }
}

#[test]
fn argument_repairs_splice_only_the_comparison_and_keep_nested_source_and_results() {
    let comparison = ".active   =   .active";
    let predicate = format!("({comparison}) and count(members[\n    conversation = .id -- this dot belongs to the enclosing member\n  ] first 20 by .active) > 0");
    for parameters in ["c: cursor ?", "active: bool, c: cursor ?"] {
        let declaration = format!("query q({parameters}):\n  return members where {predicate} first 20 after c\n");
        let original = format!("{MODEL}{declaration}");
        let d = refusal(&original);
        let expected = declaration.replace(comparison, ".active = active").replace("q(c:", "q(active: bool, c:");
        let repaired = if parameters.starts_with("active:") {
            assert_eq!(d.rewrite, format!("where {}", predicate.replace(comparison, ".active = active")));
            declaration.replace(&format!("where {predicate}"), &d.rewrite)
        } else {
            assert_eq!(d.rewrite, expected);
            d.rewrite
        };
        assert_eq!(repaired, expected, "all source outside the comparison and argument insertion survives verbatim");
        let mut engine = engine(&format!("{MODEL}{repaired}"));
        let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null), ("active".into(), Value::Bool(true))].into())).unwrap();
        assert!(page.complete);
        let rows = page.data.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field("id").unwrap(), &Value::Id("a".into()));
    }
}

#[test]
fn fresh_parameters_consider_nested_bindings_only_in_the_current_declaration() {
    let later = "query later():\n  active = true\n  activeArgument = false\n  return active\n";
    for (body, name) in [("", "active"), ("  if true:\n    active = false\n", "activeArgument"),
        ("  if true:\n    if true:\n      active = false\n      activeArgument = true\n", "activeArgumentArgument")] {
        let declaration = format!("query q(c: cursor ?):\n{body}  return members where .active = .active first 20 after c\n");
        let d = refusal(&format!("{MODEL}{declaration}{later}"));
        let expected = declaration.replace("q(c:", &format!("q({name}: bool, c:")).replace(".active = .active", &format!(".active = {name}"));
        assert_eq!(d.rewrite, expected, "later operation bindings must not affect this parameter's name");
        clean(&format!("{MODEL}{}{later}", d.rewrite));
    }
}

#[test]
fn same_named_columns_with_different_types_use_the_argument_fallback() {
    let model = format!("{MODEL}table notes:\n  active: text <=80\n  public\n");
    let declaration = "query q(c: cursor ?):\n  return members first 20 after c { notes: notes where .active = .active first 20 }\n";
    let d = refusal(&format!("{model}{declaration}"));
    let expected = declaration.replace("q(c:", "q(active: text <=80, c:").replace(".active = .active", ".active = active");
    assert_eq!(d.rewrite, expected, "an enclosing bool must not become a key for the inner text column");
    clean(&format!("{model}{}", d.rewrite));
}
