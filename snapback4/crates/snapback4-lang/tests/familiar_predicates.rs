//! Round 1 blind-review counterexamples and literal diagnostic-paste witnesses.
use snapback4_lang::{Bound, Diagnostic, compile};

const MODEL: &str = "table members:\n  conversation: id\n  principal: principal\n  active: bool\n  unique conversation, principal\n  cap 50 by conversation\n  public\n";
fn checked(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) {
    let b = checked(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:#?}", b.diagnostics);
}
fn refusal(source: &str, code: &str) -> Diagnostic {
    let b = checked(source);
    let d = b.diagnostics.into_iter().find(|d| d.code == code).unwrap_or_else(|| panic!("expected {code}: {source}"));
    assert!(d.site.line > 0 && d.site.col > 0);
    assert!(!d.mechanical, "scope repairs require the author's intent");
    d
}
fn comparison(op: &str) -> String {
    if op == "in" { ".conversation in ['other', .conversation]".into() }
    else { format!(".conversation {op} .conversation") }
}
#[test]
fn every_self_comparison_refuses_in_top_level_and_nested_filters_and_repairs_paste() {
    for op in ["=", "!=", "<", "<=", ">", ">=", "in"] {
        let predicate = comparison(op);
        let original = format!("{MODEL}query q(chat: id, c: cursor ?):\n  return members where {predicate} first 20 after c\n");
        let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
        assert!(d.rewrite.starts_with("where ") && d.rewrite.contains(".conversation = chat"), "{d:?}");
        clean(&original.replace(&format!("where {predicate}"), &d.rewrite));
        let nested = format!("members where {predicate} first 50");
        let original = format!("{MODEL}query q(c: cursor ?):\n  return members first 20 after c {{ conversation, roster: {nested} }}\n");
        let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
        assert_eq!(d.rewrite, "members[conversation = .conversation]");
        clean(&original.replace(&nested, &d.rewrite));
    }
    // Grok's exact singleton-list example, plus a wrapped contradiction.
    for predicate in [".conversation in [.conversation]", "not (.conversation != .conversation)"] {
        refusal(&format!("{MODEL}query q(c: cursor ?):\n  return members where {predicate} first 20 after c\n"), "E_QUARRY_SELF_EQUALITY");
    }
}
#[test]
fn nested_read_keys_keep_the_enclosing_predicate_scope() {
    // Astra's exact example: the key expression is evaluated on the outer member.
    let original = format!("{MODEL}query q(c: cursor ?):\n  return members where exists members[active = (.conversation = .conversation)] first 20 after c\n");
    let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
    assert!(d.message.contains("filtered members"));
    assert!(d.rewrite.contains("conversation: id"), "{d:?}");
    clean(&format!("{MODEL}{}", d.rewrite));
    for key in ["active = (.conversation >= .conversation)", "active = (.conversation in [.conversation])", "(.conversation != .conversation)"] {
        refusal(&format!("{MODEL}query q(c: cursor ?):\n  return members where exists members[{key}] first 20 after c\n"), "E_QUARRY_SELF_EQUALITY");
    }
    // Comparisons outside a filter may deliberately calculate a boolean; the
    // inner filter still establishes its own focal row and gets its own repair.
    clean(&format!("{MODEL}query q(c: cursor ?):\n  return members first 20 after c {{ same: .conversation = .conversation, roster: members[conversation = .conversation] }}\n"));
    let nested = "members where .conversation >= .conversation";
    let original = format!("{MODEL}query q(c: cursor ?):\n  return members where exists ({nested}) first 20 after c\n");
    let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
    clean(&original.replace(nested, &d.rewrite));
}
#[test]
fn no_argument_repairs_add_a_typed_argument_without_losing_the_body() {
    for (predicate, parameter) in [(".conversation >= .conversation", "conversation: id"), (".active in [.active]", "active: bool")] {
        let original = format!("{MODEL}query q(c: cursor ?):\n  marker = 7\n  return members where {predicate} first 20 after c {{ conversation, marker: marker }}\n");
        let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
        assert!(d.rewrite.contains(parameter), "{d:?}");
        assert!(d.rewrite.contains("marker = 7"));
        clean(&format!("{MODEL}{}", d.rewrite));
    }
    let original = format!("{MODEL}fn choose(): count(members where .active = .active)\nquery q():\n  return choose()\n");
    let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
    clean(&format!("{MODEL}{}\nquery q():\n  return choose(true)\n", d.rewrite));
}
#[test]
fn aggregates_columns_views_and_timelines_share_the_refusal_and_repairs_compile() {
    for op in ["=", "!=", "<", "<=", ">", ">=", "in"] {
        // Astra's aggregate example, broadened to all operators.
        let declaration = format!("view counts: count members where {} by .conversation\n", comparison(op));
        let d = refusal(&format!("{MODEL}{declaration}"), "E_QUARRY_SELF_EQUALITY");
        clean(&format!("{MODEL}{}", d.rewrite));
    }
    let declaration = "view planned:\n  members where .conversation = .conversation { conversation }\n";
    let d = refusal(&format!("{MODEL}{declaration}"), "E_QUARRY_SELF_EQUALITY");
    clean(&format!("{MODEL}{}", d.rewrite));
    let columns = include_str!("fixtures/maintained-columns.q");
    let original = columns.replace("count likes where .active by", "count likes where .active = .active by");
    let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
    let end = original.find("table likes:").unwrap();
    clean(&format!("{}\n{}", d.rewrite, &original[end..]));
    let timeline = include_str!("fixtures/timeline-v2.q");
    let original = timeline.replace(".parentId = null and not .removed", ".at >= .at");
    let d = refusal(&original, "E_QUARRY_SELF_EQUALITY");
    let start = original.find("maintain feed:").unwrap();
    let end = original.find("mutation post(").unwrap();
    clean(&format!("{}{}\n{}", &original[..start], d.rewrite, &original[end..]));
}
#[test]
fn count_star_names_the_scoped_table_and_each_concrete_repair_compiles() {
    for original in [
        format!("{MODEL}query q():\n  return count(*)\n"),
        format!("query q():\n  return count(*)\n{MODEL}"),
        format!("{MODEL}table others:\n  public\nquery q(c: cursor ?):\n  return members first 20 after c {{ total: count(*) }}\n"),
        format!("{MODEL}table others:\n  public\nquery q(c: cursor ?):\n  return members where count(*) > 0 first 20 after c\n"),
    ] {
        let d = refusal(&original, "E_QUARRY_UNSUPPORTED");
        assert_eq!(d.rewrite, "count(members)");
        clean(&original.replace("count(*)", &d.rewrite));
    }
}

#[test]
fn repairs_use_late_and_other_module_column_types_and_preserve_quoted_tails() {
    let query = "query q(c: cursor ?):\n  return members where .active = .active and .principal = 'bob' first 20 after c\n";
    for sources in [
        vec![("schema.q".into(), format!("{query}{MODEL}"))],
        vec![("q.q".into(), query.into()), ("schema.q".into(), MODEL.into())],
    ] {
        let b = compile(&sources);
        let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
        assert!(d.rewrite.contains("active: bool"), "{d:?}");
        clean(&format!("{MODEL}{}", d.rewrite));
    }
    let query = "query q():\n  return count(*)\n";
    let b = compile(&[("q.q".into(), query.into()), ("schema.q".into(), MODEL.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_UNSUPPORTED").unwrap();
    assert_eq!(d.rewrite, "count(members)");
    clean(&format!("{MODEL}{}", query.replace("count(*)", &d.rewrite)));
}
