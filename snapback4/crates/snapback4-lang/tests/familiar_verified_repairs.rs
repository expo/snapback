//! Round 4: every offered key repair is pasted, compiled and executed.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::{Bound, compile};

const MODEL: &str = "table members:\n  conversation: id\n  active: bool\n  score: int\n  by byConversation: conversation, score\n  public\n";

fn checked(source: &str) -> Bound { compile(&[("schema.q".into(), source.into())]) }
fn pasted(model: &str, nested: &str, expected: &str) -> (Bound, Vec<Value>) {
    let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ id, roster: {nested} }}\n");
    let refused = checked(&source);
    let diagnostic = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
    assert_eq!(diagnostic.rewrite, expected, "{nested}: {diagnostic:?}");
    assert!(!diagnostic.rewrite.is_empty());
    let repaired = source.replace(nested, &diagnostic.rewrite);
    let bound = checked(&repaired);
    assert!(bound.diagnostics.is_empty(), "{repaired}\n{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed([("a", "one", true, 10), ("b", "two", false, 20)].map(|(id, conversation, active, score)| ("members".into(), object([
        ("id", Value::Id(id.into())), ("conversation", Value::Id(conversation.into())),
        ("active", Value::Bool(active)), ("score", Value::Int(score)),
    ])))).unwrap();
    let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
    assert!(page.complete);
    (bound, page.data.as_array().unwrap().to_vec())
}
fn rosters(rows: &[Value]) -> Vec<Vec<String>> {
    rows.iter().map(|row| row.field("roster").unwrap().as_array().unwrap().iter()
        .map(|row| match row.field("id").unwrap() { Value::Id(id) => id.clone(), value => panic!("{value:?}") }).collect()).collect()
}

#[test]
fn sole_predicates_preserve_point_and_explicit_page_results() {
    for column in ["id", "conversation"] {
        let model = MODEL.replace("  public", "  unique conversation\n  cap 1 by conversation\n  public");
        let key = format!("members[{column} = .{column}]");
        let comparison = format!(".{column} = .{column}");
        let (bound, rows) = pasted(&model, &format!("members where {comparison}"), &key);
        for (index, row) in rows.iter().enumerate() {
            assert_eq!(row.field("roster").unwrap().field("id").unwrap(), &Value::Id(if index == 0 { "a" } else { "b" }.into()));
        }
        assert!(bound.programs[0].selections().values().any(|s| s.contains("result: row or null")));
        let (_, rows) = pasted(&model, &format!("members where ({comparison}) first 20"), &format!("{key} first 20"));
        assert_eq!(rosters(&rows), vec![vec!["a"], vec!["b"]]);
    }
}

#[test]
fn grouped_reads_and_trailing_comma_keys_keep_source_and_answers() {
    for (prefix, keyed) in [
        ("(members[])", "(members[conversation = .conversation])"),
        ("((members[]))", "((members[conversation = .conversation]))"),
        ("members[active = .active,]", "members[active = .active,conversation = .conversation]"),
        ("members[active = (.score >= 0),]", "members[active = (.score >= 0),conversation = .conversation]"),
    ] {
        let (_, rows) = pasted(MODEL, &format!("{prefix} where .conversation = .conversation first 20"), &format!("{keyed} first 20"));
        let expected = if prefix.contains(".score") { vec![vec!["a"], vec![]] } else { vec![vec!["a"], vec!["b"]] };
        assert_eq!(rosters(&rows), expected);
    }
}

#[test]
fn named_equality_precedes_all_seek_operators_and_retains_other_operands() {
    for op in ["<", "<=", ">", ">="] {
        // Existing equality, nested operand comparison, two seeks, and a
        // trailing comma exercise parser-owned sites instead of token guesses.
        for (prefix, keyed) in [
            (format!("members[score {op} .score]"), format!("members[conversation = .conversation, score {op} .score]")),
            (format!("members[active = (.score >= 0), score {op} .score, score {} 100,]", if op.starts_with('<') { ">=" } else { "<=" }),
             format!("members[active = (.score >= 0), conversation = .conversation, score {op} .score, score {} 100,]", if op.starts_with('<') { ">=" } else { "<=" })),
        ] {
            let extra = if prefix.contains("active") { " by byActiveConversation" } else { " by byConversation" };
            let model = MODEL.replace("  public", "  by byActiveConversation: active, conversation, score\n  public");
            let (_, rows) = pasted(&model, &format!("{prefix} where .conversation = .conversation first 20{extra}"), &format!("{keyed} first 20{extra}"));
            let expected = if op.len() == 1 || (prefix.contains("active") && op.starts_with('<')) { vec![vec![], vec![]] }
                else if prefix.contains("active") { vec![vec!["a"], vec![]] } else { vec![vec!["a"], vec!["b"]] };
            assert_eq!(rosters(&rows), expected, "{prefix}");
        }
    }
}

#[test]
fn delete_only_the_bad_conjunct_at_any_position_or_where_clause() {
    for (predicate, retained) in [
        (".conversation = .conversation and .active", ".active"),
        (".active and .conversation = .conversation", ".active"),
        (".active and .conversation = .conversation and .score > 0", ".active and .score > 0"),
        ("(.conversation = .conversation) and (.active)", "(.active)"),
        ("(.active and (.conversation = .conversation))", "(.active)"),
        (".conversation = .conversation where .active", ".active"),
        (".active where .conversation = .conversation", ".active"),
    ] {
        let (_, rows) = pasted(MODEL, &format!("members where {predicate} first 20"),
            &format!("members[conversation = .conversation] where {retained} first 20"));
        assert_eq!(rosters(&rows), vec![vec!["a"], vec![]]);
    }
}

#[test]
fn independent_declaration_errors_do_not_hide_a_checked_repair() {
    let source = format!("{MODEL}query broken():\n  return missing\nquery q(c: cursor ?):\n  return members first 20 after c {{ twin: members where .id = .id }}\n");
    let bound = checked(&source);
    let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
    assert_eq!(d.rewrite, "members[id = .id]");
}

#[test]
fn a_remaining_error_in_the_affected_declaration_suppresses_the_repair() {
    for tail in ["\n  return missing", " and .active = .active"] {
        let source = if tail.starts_with('\n') {
            format!("{MODEL}query q(c: cursor ?):\n  rows = members where .conversation = .conversation first 20 after c{tail}\n")
        } else {
            format!("{MODEL}query q(c: cursor ?):\n  return members where .conversation = .conversation{tail} first 20 after c\n")
        };
        let bound = checked(&source);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
        assert!(d.rewrite.is_empty(), "{d:?}");
        assert!(!d.message.is_empty());
    }
}

#[test]
fn aggregates_retry_point_keys_as_verified_single_row_pages_and_execute() {
    let model = MODEL.replace("  by byConversation: conversation, score\n", "").replace("  public", "  unique conversation\n  public");
    for aggregate in ["count", "sum"] {
        for column in ["id", "conversation"] {
            for (prefix, keyed) in [("members", format!("members[{column} = .{column}]")),
                ("(members[])", format!("(members[{column} = .{column}])"))] {
                let nested = format!("{prefix} where .{column} = .{column}");
                let selector = if aggregate == "sum" { ", .score" } else { "" };
                let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ id, n: {aggregate}({nested}{selector}) }}\n");
                let refused = checked(&source);
                let d = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
                assert!(!d.rewrite.is_empty(), "{source}\n{d:?}");
                let repaired = source.replace(&nested, &d.rewrite);
                let bound = checked(&repaired);
                assert!(bound.diagnostics.is_empty(), "the offered repair must compile: {repaired}\n{:?}", bound.diagnostics);
                assert_eq!(d.rewrite, format!("{keyed} first 1"));
                assert!(d.message.contains("named read key") && d.message.contains("first 1"), "{d:?}");
                let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
                engine.seed([("a", "one", 10), ("b", "two", 20)].map(|(id, conversation, score)| ("members".into(), object([
                    ("id", Value::Id(id.into())), ("conversation", Value::Id(conversation.into())),
                    ("active", Value::Bool(true)), ("score", Value::Int(score)),
                ])))).unwrap();
                let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
                assert!(page.complete);
                let rows = page.data.as_array().unwrap();
                assert_eq!(rows.len(), 2);
                for (row, score) in rows.iter().zip([10, 20]) {
                    assert_eq!(row.field("n").unwrap(), &Value::Int(if aggregate == "sum" { score } else { 1 }));
                }
            }
        }
    }
}

#[test]
fn failed_key_candidates_have_neither_rewrite_nor_named_key_advice() {
    for value in ["count(members where .id = .id) + true", "sum(members where .id = .id, .active)",
        "members where .id = .id first 20 + true", "count(members[active = .active,] where .id = .id)"] {
        let source = format!("{MODEL}query q(c: cursor ?):\n  return members first 20 after c {{ n: {value} }}\n");
        let refused = checked(&source);
        let d = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
        assert!(d.rewrite.is_empty(), "{d:?}");
        assert!(d.message.ends_with("with itself"), "advice must come from a verified candidate: {d:?}");
        assert!(!d.message.contains("named read key"));
    }
}

#[test]
fn a_capped_nonunique_aggregate_keeps_its_whole_page() {
    let model = MODEL.replace("  public", "  cap 50 by conversation\n  public");
    let nested = "members where .conversation = .conversation";
    let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ n: count({nested}) }}\n");
    let refused = checked(&source);
    let d = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
    assert_eq!(d.rewrite, "members[conversation = .conversation]");
    assert!(!d.message.contains("first 1"));
    let bound = checked(&source.replace(nested, &d.rewrite));
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(["a", "b"].map(|id| ("members".into(), object([
        ("id", Value::Id(id.into())), ("conversation", Value::Id("one".into())),
        ("active", Value::Bool(true)), ("score", Value::Int(10)),
    ])))).unwrap();
    let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 2);
    for row in page.data.as_array().unwrap() { assert_eq!(row.field("n").unwrap(), &Value::Int(2)); }
}

#[test]
fn invalid_helper_body_cannot_offer_a_local_predicate_repair() {
    // Even an otherwise unused helper needs a synthetic invocation to bind its
    // body. The comparison edit cannot repair the independent int + bool error.
    for caller in ["", "query q():\n  return choose(true)\n"] {
        let source = format!("{MODEL}fn choose(active: bool): count(members where .active = .active) + true\n{caller}");
        let refused = checked(&source);
        let d = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
        assert!(d.rewrite.is_empty(), "an unchecked helper body leaked a repair: {d:?}");
        assert!(d.message.ends_with("with itself"), "{d:?}");
    }
}

#[test]
fn nullable_unique_aggregate_keeps_tied_null_rows() {
    let model = MODEL.replace("conversation: id", "conversation: id ?").replace("  public", "  unique conversation\n  public");
    let source = format!("{model}query q(c: cursor ?):\n  return members first 20 after c {{ n: count(members where .conversation = .conversation) }}\n");
    let refused = checked(&source);
    let d = refused.diagnostics.iter().find(|d| d.code == "E_QUARRY_SELF_EQUALITY").unwrap();
    assert_eq!(d.rewrite, "members[conversation = .conversation] by .id");
    assert!(!d.message.contains("first 1"));
    let bound = checked(&source.replace("members where .conversation = .conversation", &d.rewrite));
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(["a", "b"].map(|id| ("members".into(), object([
        ("id", Value::Id(id.into())), ("conversation", Value::Null),
        ("active", Value::Bool(true)), ("score", Value::Int(10)),
    ])))).unwrap();
    let page = engine.query("q", Context::new("alice", [("c".into(), Value::Null)].into())).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 2);
    for row in page.data.as_array().unwrap() { assert_eq!(row.field("n").unwrap(), &Value::Int(2)); }
}
