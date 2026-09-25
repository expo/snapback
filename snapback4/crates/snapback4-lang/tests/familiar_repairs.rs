//! Round 2: actual pasted repairs, nullable presence semantics, and seek scope.
use snapback4_lang::{Bound, Diagnostic, compile};

const MEMBERS: &str = "table members:\n  conversation: id\n  active: bool\n  public\n";
const TASKS: &str = "table tasks:\n  due: time ?\n  title: text <=80\n  open: bool\n  public\n";
fn checked(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) {
    let bound = checked(source);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:#?}", bound.diagnostics);
}
fn refusal(source: &str) -> Diagnostic {
    let bound = checked(source);
    bound.diagnostics.into_iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY")
        .unwrap_or_else(|| panic!("missing self-comparison refusal: {source}"))
}

#[test]
fn multiline_repair_uses_tokens_and_preserves_the_whole_declaration() {
    let next = "query next():\n  return 1\n";
    for eol in ["\n", "\r\n"] {
        for trailing in ["", next] {
            let declaration = "query q(c: cursor ?):\n  label = 'héllo \\'query'\n  return members where (\n    .active = .active\n) first 20 after c { active, label: label }\n";
            let source = format!("{MEMBERS}{declaration}{trailing}").replace('\n', eol);
            let d = refusal(&source);
            assert!(d.rewrite.starts_with("query q(active: bool, c: cursor ?):"), "{d:?}");
            assert!(d.rewrite.contains("label = 'héllo \\'query'"), "{d:?}");
            assert!(d.rewrite.contains("first 20 after c { active, label: label }"), "{d:?}");
            assert!(!d.rewrite.contains("query next"));
            clean(&format!("{MEMBERS}{}\n{trailing}", d.rewrite));
        }
    }
    // An unmatched delimiter does not provide a trustworthy declaration span.
    let d = refusal(&format!("{MEMBERS}query q(c: cursor ?):\n  return members where .active = .active first 20 after c {{"));
    assert!(d.rewrite.is_empty(), "{d:?}");
}

#[test]
fn optional_inclusive_comparisons_preserve_presence_in_early_late_and_other_modules() {
    for op in ["<=", ">="] {
        for predicate in [format!(".due {op} .due or .title = title"), format!("exists tasks[open = (.due {op} .due)]")] {
            let query = format!("query open(title: text <=80, c: cursor ?):\n  return tasks where {predicate} first 20 after c\n");
            for sources in [vec![("schema.q".into(), format!("{TASKS}{query}"))],
                vec![("schema.q".into(), format!("{query}{TASKS}"))],
                vec![("q.q".into(), query.clone()), ("schema.q".into(), TASKS.into())]] {
                let bound = compile(&sources);
                assert!(bound.diagnostics.is_empty(), "{sources:?}\n{:#?}", bound.diagnostics);
            }
        }
        // Maintains already reject nullable ordering. Preserve that refusal,
        // without an E_SELF_EQUALITY rewrite to the incorrect constant true.
        let declaration = format!("view counts: count tasks where .due {op} .due by .title\n");
        for source in [format!("{TASKS}{declaration}"), format!("{declaration}{TASKS}")] {
            let b = checked(&source);
            assert_eq!(b.diagnostics.len(), 1, "{:#?}", b.diagnostics);
            assert_eq!(b.diagnostics[0].code, "E_QUARRY_MAINTAIN");
            assert!(b.diagnostics[0].message.contains("time ? and time ?"));
        }
    }
    for predicate in [".due = .due", ".due != .due", ".due < .due", ".due > .due", ".due in [.due]"] {
        refusal(&format!("{TASKS}query q(c: cursor ?):\n  return tasks where {predicate} first 20 after c\n"));
    }
}

#[test]
fn nested_key_repairs_keep_conjuncts_bounds_and_order() {
    for suffix in ["first 20", "first 20 by .active", "first 20 by .active where .active"] {
        let nested = format!("members where .active and .conversation = .conversation {suffix}");
        let source = format!("{MEMBERS}query q(c: cursor ?):\n  return members first 20 after c {{ roster: {nested} }}\n");
        let d = refusal(&source);
        assert!(d.rewrite.starts_with("members[conversation = .conversation]"), "{d:?}");
        assert!(d.rewrite.contains("first 20") && d.rewrite.contains("where .active"), "{d:?}");
        if suffix.contains("by") { assert!(d.rewrite.contains("by .active"), "{d:?}"); }
        clean(&source.replace(&nested, &d.rewrite));
    }
    let model = MEMBERS.replace("  public", "  by byConversation: conversation, active\n  public");
    let nested = "members where .active and .conversation = .conversation first 20 by byConversation";
    let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ roster: {nested} }}\n");
    let d = refusal(&source);
    assert_eq!(d.rewrite, "members[conversation = .conversation] where .active and true first 20 by byConversation");
    clean(&source.replace(nested, &d.rewrite));
    // The other table lacks .body: a key would incorrectly bind the member.
    let model = format!("{MEMBERS}table notes:\n  body: text <=80\n  public\n");
    let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ notes: notes where .body = .body first 20 }}\n");
    let d = refusal(&source);
    assert!(d.rewrite.starts_with("query q(body: text <=80,"), "{d:?}");
    assert!(!d.rewrite.contains("notes[body = .body]"));
    clean(&format!("{model}{}", d.rewrite));
    // A bare key has no cap here. Retain the scalar count and its meter-bound
    // scan, and compare with the operation argument instead of inventing a key.
    let source = format!("{MEMBERS}query q(chat: id, c: cursor ?):\n  return members first 20 after c {{ total: count(members where .conversation = .conversation) }}\n");
    let d = refusal(&source);
    assert_eq!(d.rewrite, "where .conversation = chat");
    clean(&source.replace("where .conversation = .conversation", &d.rewrite));
}

#[test]
fn projected_view_repairs_use_inferred_field_types() {
    let view = "view activeMembers:\n  members where .active { active, renamed: .active, computed: not .active }\n";
    for field in ["active", "renamed", "computed"] {
        let query = format!("query q(c: cursor ?):\n  return activeMembers where .{field} = .{field} first 20 after c\n");
        let sources = [("q.q".into(), query), ("schema.q".into(), format!("{MEMBERS}{view}"))];
        let bound = compile(&sources);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
        assert!(d.rewrite.contains(&format!("{field}: bool")), "{d:?}");
        clean(&format!("{MEMBERS}{view}{}", d.rewrite));
    }
    let view = "view taskView:\n  tasks { due }\n";
    clean(&format!("{TASKS}{view}query q(c: cursor ?):\n  return taskView where .due >= .due first 20 after c\n"));
}

#[test]
fn seek_operands_are_checked_in_the_enclosing_predicate_scope() {
    let source = format!("{MEMBERS}query q(c: cursor ?):\n  return members where exists members[active >= (.active = .active)] first 20 after c\n");
    let d = refusal(&source);
    assert!(d.message.contains("filtered members") && d.rewrite.contains("active: bool"), "{d:?}");
    // This exact reviewer probe has an independent unsupported point-seek.
    // A paged seek supplies a runnable witness for the same operand traversal.
    let model = MEMBERS.replace("  public", "  by byActive: active\n  public");
    let source = format!("{model}query q(c: cursor ?):\n  return members where count(members[active >= (.active = .active)] first 20 by byActive) > 0 first 20 after c\n");
    let d = refusal(&source);
    clean(&format!("{model}{}", d.rewrite));
}

#[test]
fn ambiguous_count_star_refuses_without_prose_in_the_replacement() {
    let source = format!("{MEMBERS}{TASKS}query q():\n  return count(*)\n");
    let b = checked(&source);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_UNSUPPORTED").unwrap();
    assert!(d.rewrite.is_empty(), "{d:?}");
    assert!(d.message.contains("pass the table or filtered read to count"));
}
