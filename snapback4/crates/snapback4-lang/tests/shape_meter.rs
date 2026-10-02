//! Calibration #29: a complete count in each inbox row can exhaust a fresh meter.
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("shape_meter/schema.q");

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn notes(source: &str) -> Vec<snapback4_lang::Diagnostic> {
    checked(source).notes.into_iter().filter(|d| d.code == "N_SHAPE_METER").collect()
}

const TABLES: &str = "table parents:\n  public 'test'\ntable children:\n  parent: parents\n  amount: int\n  public 'test'\n";

#[test]
fn raw_aggregate_and_transitive_helper_name_the_field_and_read_site() {
    let findings = notes(SOURCE);
    assert_eq!(findings.len(), 2, "{findings:?}");
    for (note, name) in findings.iter().zip(["inbox", "unreadPreview"]) {
        assert!(note.message.contains(&format!("query {name} shape field `unread`")), "{note}");
        assert!(note.message.contains(&format!("programs.{name}.1")), "{note}");
        assert_eq!(note.guide, "reads");
        for advice in ["maintained count/view", "guide views", "first N", "last N", "out of the returned shape"] {
            assert!(note.message.contains(advice), "default check summaries must carry the repair: {note}");
        }
        assert!(note.rewrite.contains("unreadCounts[.id]"));
        assert!(note.rewrite.contains("first N"));
        assert!(!note.mechanical);
    }
    assert_eq!(findings[0].site.line, 21);
    assert_eq!(findings[1].site.line, 23);
    assert!(findings[1].message.contains("unreadIn at schema.q:25"));
    let source = format!("{TABLES}fn total(p: parents): count(children where .parent = p)\nfn indirect(p: parents): total(p)\nquery q(c: cursor ?):\n  return parents first 2 after c {{ total: indirect(.id) }}\n");
    let n = notes(&source);
    assert_eq!(n.len(), 1);
    assert!(n[0].message.contains("indirect at") && n[0].message.contains("total at"));
}

#[test]
fn count_sum_and_extrema_over_unbounded_candidates_are_advised() {
    for aggregate in ["count(children[parent = .id])", "sum(children[parent = .id], .amount)", "max(children[parent = .id], .amount + 1)", "min(children[parent = .id], .amount + 1)"] {
        let source = format!("{TABLES}query q(c: cursor ?):\n  return parents first 2 after c {{ total: {aggregate} }}\n");
        assert_eq!(notes(&source).len(), 1, "{source}");
    }
}

#[test]
fn maintained_count_capped_populations_and_bounded_pages_stay_clean() {
    let fixture = SOURCE.split("query inbox").next().unwrap();
    let maintained = format!("{fixture}view unreadCounts: count messages by members m\n  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal and .sender != m.principal and not .tombstone\nquery inbox(c: cursor ?):\n  return members where .principal = viewer first 50 by .conversation after c {{ unread: unreadCounts[.id] }}\n");
    assert!(checked(&maintained).notes.is_empty());
    for (cap, field) in [
        ("", "children[parent = .id] first 10"),
        ("", "children[parent = .id] last 10"),
        ("  by byAmount: parent, amount, id\n", "min(children[parent = .id] by byAmount, .amount)"),
        ("  by byAmount: parent, amount, id\n", "max(children[parent = .id] by byAmount, .amount)"),
        ("", "count(children[parent = .id] first 10)"),
        ("  cap 100\n", "sum(children where .amount > 0, .amount)"),
        ("  cap 100 by parent\n", "count(children[parent = .id] where .amount > 0)"),
        ("", "children['one']"),
    ] {
        let source = format!("{TABLES}{cap}query q(c: cursor ?):\n  return parents first 2 after c {{ detail: {field} }}\n");
        assert!(checked(&source).notes.is_empty(), "{source}: {:?}", checked(&source).notes);
    }
}

#[test]
fn unbounded_nested_collection_keeps_its_existing_refusal() {
    let source = format!("{TABLES}query q(c: cursor ?):\n  return parents first 2 after c {{ children: children[parent = .id] }}\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert_eq!(b.diagnostics.len(), 1, "{:?}", b.diagnostics);
    assert_eq!(b.diagnostics[0].code, "E_QUARRY_BOUND");
    assert!(b.diagnostics[0].rewrite.contains("first N"));
}

#[test]
fn unpinned_caps_and_residual_filters_do_not_bound_candidates() {
    for (cap, field) in [
        ("  cap 100 by parent\n", "count(children where .amount > 0)"),
        ("  cap 9000\n", "count(children)"),
        ("", "children[parent = .id] where .amount > 0 first 10"),
    ] {
        let source = format!("{TABLES}{cap}query q(c: cursor ?):\n  return parents first 2 after c {{ detail: {field} }}\n");
        assert_eq!(notes(&source).len(), 1, "{source}");
    }
}

#[test]
fn assigned_and_named_shapes_are_checked_but_separate_totals_are_not() {
    let source = format!("{TABLES}shape card = {{ total: count(children[parent = .id]) }}\nquery q(c: cursor ?):\n  cards = parents first 2 after c card\n  return {{ cards }}\nquery separate(p: parents):\n  return count(children where .parent = p)\n");
    assert_eq!(notes(&source).len(), 1);
}

#[test]
fn calibration_inbox_refuses_on_the_no_progress_follow() {
    let bound = compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    println!("compile notes: {:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("conversations".into(), object([("id", Value::Id("chat".into())), ("title", Value::String("busy".into()))])),
        ("members".into(), object([("id", Value::Id("member".into())), ("conversation", Value::Id("chat".into())), ("principal", Value::Id("alice".into())), ("seenOrdinal", Value::Int(0)), ("joinedOrdinal", Value::Int(0))])),
    ].into_iter().chain((0..9000).map(|n| ("messages".into(), object([
        ("id", Value::Id(format!("m{n:05}"))), ("conversation", Value::Id("chat".into())),
        ("sender", Value::Id("bob".into())), ("ordinal", Value::Int(n + 1)),
        ("at", Value::Int(1)), ("tombstone", Value::Bool(false)),
    ]))))).unwrap();
    for op in ["inbox", "unreadPreview"] {
        let context = |c: Value| {
            let mut args = BTreeMap::from([("c".into(), c)]);
            if op == "unreadPreview" {
                args.insert("periodStart".into(), Value::Int(0));
                args.insert("periodEnd".into(), Value::Int(2));
            }
            Context::new("alice", args)
        };
        let first = engine.query(op, context(Value::Null)).unwrap();
        assert!(first.data.as_array().unwrap().is_empty());
        assert!(!first.complete);
        let next = first.next.expect("inclusive retry at unfinished member");
        let refused = engine.query(op, context(Value::String(next))).unwrap_err();
        assert_eq!(refused.code, "E_SHAPE_EXCEEDS_METER");
        println!("{op}, 9000 messages: {refused}");
    }
}
