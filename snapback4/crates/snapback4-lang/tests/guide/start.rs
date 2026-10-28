//! The short path has the same examples, diagnostics and budgets as its cards.
use super::{card, KEYWORDS};
use snapback4_lang::guide::START_CARDS;

#[test]
fn start_routes_to_one_compiling_workflow_before_feature_reference_reads() {
    let start = card("start").unwrap();
    assert!(START_CARDS.is_empty(), "start no longer concatenates eight cards");
    assert!(start.len() <= 8000);
    for word in ["guide workflow", "guide api", "probe:check"] { assert!(start.contains(word), "{word}"); }
    let workflow = card("workflow").unwrap();
    assert!(workflow.len() <= 8000);
    for word in ["use identity password", "mutation approve", "evidence: file", "price: money", "deliveredAt !", "## Acceptance"] { assert!(workflow.contains(word), "{word}"); }
    assert_eq!(card("index"), Some(start));
    assert!(snapback4_lang::guide::listing().contains("snapback4 guide start"));
}

#[test]
fn openings_fit_without_growing_the_eight_reference_cards() {
    for (name, limit) in [("language", 825), ("sync", 524), ("maintains", 879),
        ("rules", 374), ("prediction", 368), ("client", 114), ("search", 405), ("feeds", 401)] {
        let text = card(name).unwrap();
        let lines = if name == "language" {
            let (before, added) = text.split_once("## Nullable values and inserts").unwrap();
            let (idioms, after) = added.split_once("## Limits").unwrap();
            assert!(idioms.lines().count() <= 15);
            format!("{before}## Limits{after}").lines().count()
        } else { text.lines().count() };
        assert!(lines <= limit, "{name}: {lines} > {limit}");
    }
}

#[test]
fn every_card_introduces_the_feature_before_examples_and_reference_details() {
    for name in KEYWORDS {
        let text = card(name).unwrap();
        if ["start", "package-reference"].contains(name) { continue; }
        let mut paragraphs = text.split("\n\n");
        assert!(paragraphs.next().unwrap().starts_with("# "), "{name}: title first");
        let lead = paragraphs.next().unwrap();
        assert!(!lead.starts_with(['#', '`']), "{name}: introduce the feature before syntax");
        assert!(lead.split_whitespace().count() <= 45, "{name}: keep the introduction short");
        assert!((1..=2).contains(&lead.matches('.').count()), "{name}: one or two sentences");
        let (opening, _) = text.split_once("```").expect("every card has an example");
        // Table separators and qualification markers are Markdown structure, not flags.
        let visible_opening = opening.lines().filter(|line| !line.trim().starts_with("|---") && !line.trim().starts_with("<!--")).collect::<Vec<_>>().join("\n");
        assert!(!visible_opening.contains("--") && !visible_opening.contains("E_") && !visible_opening.contains("N_"), "{name}: flags and refusals follow the example");
        if *name == "wire" {
            assert!(paragraphs.next().unwrap().starts_with("## First raw HTTP proof"));
            assert!(opening.contains("POST /q/name") && opening.contains("POST /m/name"), "wire: literal envelopes precede the runnable proof");
        }
        if !["feeds", "wire", "workflow"].contains(name) {
            // Feeds names its Global example; wire opens with the literal HTTP table.
            assert!(paragraphs.next().unwrap().starts_with("```"), "{name}: show the example next");
        }
    }
}

#[test]
fn staging_is_visible_in_the_default_builder_cards() {
    for name in ["cheatsheet", "personas"] {
        let text = snapback4_lang::guide::piped(name, card(name).unwrap());
        assert!(text.contains("guide staging"), "default {name}: {text}");
        if name == "cheatsheet" {
            assert!(text.contains("deploy staging --staging"), "{text}");
            assert!(text.contains("serve staging"), "{text}");
        }
    }
}

#[test]
fn workflow_calendar_anniversary_clamps_leap_day_and_preserves_utc_time() {
    use snapback4_core::{Context, Engine, Value};
    let recipe = snapback4_lang::guide::quarry(card("workflow").unwrap()).remove(0);
    let source = format!("{recipe}\nquery calendarDeadline(t: time):\n  return nextYear(t)\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    for (at, expected) in [(1709210096789, 1740746096789), (1675144800000, 1706680800000)] {
        let args = std::collections::BTreeMap::from([("t".into(), Value::Int(at))]);
        let read = engine.query("calendarDeadline", Context::new("tester", args)).unwrap();
        assert_eq!(read.data, Value::Int(expected));
    }
}

#[test]
fn nullable_idioms_are_executed_from_the_language_card_not_unchecked_prose() {
    use snapback4_core::{Context, Engine, Value};
    let section = card("language").unwrap().split_once("## Nullable values and inserts").unwrap().1.split_once("## Limits").unwrap().0;
    let source = snapback4_lang::guide::quarry(section).remove(0);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    for (flag, expected) in [(Value::Null, 0), (Value::Bool(false), 0), (Value::Bool(true), 1)] {
        let args = std::collections::BTreeMap::from([("flag".into(), flag)]);
        assert_eq!(engine.query("optionalFlag", Context::new("tester", args)).unwrap().data, Value::Int(expected));
    }
    let args = std::collections::BTreeMap::from([("at".into(), Value::Int(1000))]);
    assert_eq!(engine.query("after", Context::new("tester", args)).unwrap().data, Value::Int(86401000));
    let args = std::collections::BTreeMap::from([("at".into(), Value::Null)]);
    assert_eq!(engine.query("after", Context::new("tester", args)).unwrap_err().code, "NOT_DELIVERED");
}
