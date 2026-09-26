//! Apply the diagnostic's actual text, then execute both complete populations.
use super::{bind, SOURCE};
use snapback4_core::{Context, Engine, Value, value::object};

pub(super) const PAGE: &str = "messages where .conversationId = conversationId last 2 by .at, .ordinal after c";

pub(super) fn apply_repair(source: &str, original: &str) -> String {
    let bound = bind(source);
    let note = bound.notes.iter().find(|n| n.code == "N_SYNC_ORDER").expect("order note");
    let quoted: Vec<_> = note.rewrite.split('`').skip(1).step_by(2).collect();
    let page = *quoted.last().expect("paste-ready page");
    assert!(page.starts_with("messages["), "{note}");
    assert!(!page.contains('$'), "{note}");
    let mut repaired = source.to_string();
    if quoted.len() == 3 {
        repaired = repaired.replace("table messages:\n", &format!("table messages:\n  {}\n", quoted[0]));
        let mut in_messages = false;
        repaired = repaired.lines().map(|line| {
            if line.starts_with("table ") { in_messages = line == "table messages:"; }
            if in_messages && line.trim_start().starts_with("sync ") && let Some((before, _)) = line.split_once("last ") {
                return format!("{before}{}", quoted[1]);
            }
            line.to_owned()
        }).collect::<Vec<_>>().join("\n") + "\n";
    } else { assert_eq!(quoted.len(), 1, "{note}"); }
    assert!(repaired.contains(original), "missing replacement site: {original}");
    repaired = repaired.replace(original, page);
    if original.contains("after c") { assert!(page.contains("after c"), "cursor lost: {note}"); }
    let fixed = bind(&repaired);
    assert!(!fixed.notes.iter().any(|n| matches!(n.code.as_str(), "N_SYNC_ORDER" | "N_NEVER_COMPLETE")), "{note}: {:?}", fixed.notes);
    // Existing independent notes may remain; no rewrite may introduce one.
    assert!(fixed.notes.iter().all(|n| bound.notes.iter().any(|old| old.code == n.code)), "new note from {note}: {:?}", fixed.notes);
    repaired
}

pub(super) fn words_only(source: &str) {
    let bound = bind(source);
    let notes: Vec<_> = bound.notes.iter().filter(|n| n.code == "N_SYNC_ORDER").collect();
    assert!(!notes.is_empty());
    for note in notes {
        assert!(!note.message.contains('$'), "{note}");
        assert!(!note.rewrite.contains('`') && !note.rewrite.contains('$'), "{note}");
        assert!(note.rewrite.contains("newest first") && note.rewrite.contains("index"), "{note}");
        assert!(note.rewrite.contains("cursor") && note.rewrite.contains("predicates"), "{note}");
    }
}

fn named() -> String {
    SOURCE.replace("  at: time", "  by byWindow: conversationId, at, ordinal, id\n  by byOrdinal: conversationId, ordinal, id\n  sender: principal\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byWindow")
}

fn id(value: &str) -> Value { Value::Id(value.into()) }

fn engine(source: &str) -> Engine {
    let b = bind(source);
    let sender = b.schema.tables["messages"].columns.contains_key("sender");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut rows = vec![
        ("conversations".into(), object([("id", id("room"))])),
        ("conversations".into(), object([("id", id("other"))])),
        ("members".into(), object([("id", id("m")), ("conversationId", id("room")), ("principal", id("alice"))])),
        ("members".into(), object([("id", id("m2")), ("conversationId", id("other")), ("principal", id("alice"))])),
    ];
    // Time and ordinal order disagree. A second readable audience and a
    // sender distractor expose dropped audience/residual predicates.
    for (name, room, at, ordinal, who) in [
        ("a", "room", 80, 1, "alice"), ("b", "room", 60, 2, "alice"),
        ("c", "room", 70, 3, "alice"), ("d", "room", 40, 4, "alice"),
        ("e", "room", 50, 5, "alice"), ("low", "room", 100, 0, "alice"),
        ("sender", "room", 110, 6, "bob"), ("other", "other", 120, 7, "alice"),
    ] {
        let mut fields = vec![("id", id(name)), ("conversationId", id(room)), ("at", Value::Int(at * 86_400_000)), ("ordinal", Value::Int(ordinal))];
        if sender { fields.push(("sender", id(who))); }
        rows.push(("messages".into(), object(fields)));
    }
    e.seed(rows).unwrap();
    e
}

fn page(e: &mut Engine, cursor: Value) -> snapback4_core::QueryOutcome {
    e.query("thread", Context::new("alice", [("conversationId".into(), id("room")), ("c".into(), cursor)].into()).at(1000)).unwrap()
}

fn drain(e: &mut Engine, second_page: bool) -> Vec<Value> {
    let mut cursor = Value::Null;
    let mut rows = Vec::new();
    let mut pages = 0;
    loop {
        let result = page(e, cursor);
        assert!(result.complete, "{result:?}");
        rows.extend(result.data.as_array().unwrap().iter().cloned());
        pages += 1;
        assert!(pages < 12, "cursor failed to advance");
        match result.next { Some(next) => cursor = Value::String(next), None => break }
    }
    if second_page { assert!(pages >= 2, "exercise continuation"); }
    rows
}

fn same_population(source: &str, original: &str, second_page: bool) -> String {
    let repaired = apply_repair(source, original);
    let fixed = bind(&repaired);
    assert!(fixed.notes.is_empty(), "{:?}", fixed.notes);
    let before = drain(&mut engine(source), second_page);
    let after = drain(&mut engine(&repaired), second_page);
    let canonical = |rows: &[Value]| {
        let mut values = rows.iter().map(|row| serde_json::to_string(row).unwrap()).collect::<Vec<_>>();
        values.sort(); values
    };
    assert_eq!(canonical(&before), canonical(&after), "exact same rows across changed page order");
    let ordered: Vec<_> = after.iter().map(|row| (row.field("at").unwrap().as_int().unwrap(), row.field("ordinal").unwrap().as_int().unwrap(), row.field("id").unwrap().as_str().unwrap())).collect();
    assert!(ordered.windows(2).all(|pair| pair[0] > pair[1]), "window order: {ordered:?}");
    repaired
}

#[test]
fn named_where_pages_lift_audience_and_keep_second_page() {
    for original in [
        "messages where .conversationId = conversationId last 2 by .ordinal after c",
        "messages where .conversationId = conversationId first 2 by .at, .ordinal after c",
        "messages where conversationId = .conversationId first 2 by .at, .ordinal after c",
        "messages where .conversationId = conversationId and .sender = viewer first 2 by .ordinal after c",
    ] {
        let source = named().replace(PAGE, original);
        let repaired = same_population(&source, original, true);
        assert!(repaired.contains("messages[conversationId = conversationId] after c last 2 by byWindow"));
    }
}

#[test]
fn count_applies_the_same_audience_page_repair_and_preserves_continuation() {
    let original = "messages where .conversationId = conversationId first 2 by .at, .ordinal after c";
    let source = named().replace(PAGE, &format!("count({original})"));
    let repaired = apply_repair(&source, original);
    assert!(bind(&repaired).notes.is_empty());
    let mut counted = engine(&repaired);
    assert_eq!(page(&mut engine(&source), Value::Null).data, Value::Int(2));
    assert_eq!(page(&mut counted, Value::Null).data, Value::Int(2));
    // Count consumes a page and does not return that page's cursor. Use a
    // companion page of the identical source to supply its second cursor.
    let page_source = repaired.replace("return count(", "return ").replace("by byWindow)\n", "by byWindow\n");
    let first = page(&mut engine(&page_source), Value::Null);
    let cursor = Value::String(first.next.unwrap());
    assert_eq!(page(&mut counted, cursor).data, Value::Int(2));
    same_population(&named().replace(PAGE, original), original, true);
}

#[test]
fn moved_range_keeps_existing_residual_and_second_page() {
    let original = "messages[conversationId, ordinal > 0] first 2 by byOrdinal after c where .sender = viewer";
    let repaired = same_population(&named().replace(PAGE, original), original, true);
    assert!(repaired.contains("where .sender = viewer and .ordinal > 0"));
    let rows = drain(&mut engine(&repaired), true);
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().all(|r| r.field("ordinal").unwrap().as_int().unwrap() > 0 && r.field("sender").unwrap() == &id("alice")));
}

#[test]
fn generated_indexes_calendar_ranges_and_named_locals_apply_and_run() {
    // Every remaining printed repair shape also executes, including repairs
    // that declare an explicit name for a generated window index.
    for source in [
        SOURCE.replace("sync last 10000 by .at, .ordinal", "sync last 10000 by .at"),
        SOURCE.replace("  at: time", "  sender: principal\n  at: time")
            .replace(PAGE, "messages where .conversationId = conversationId and .sender = viewer last 2 by .at, .ordinal after c"),
        SOURCE.replace(".at, .ordinal", ".at, .id, .ordinal"),
        named().replace("  at: time", "  by byOther: conversationId, at, ordinal, id\n  at: time")
            .replace(PAGE, "messages[conversationId] last 2 by byOther after c"),
    ] {
        let original = source.lines().find_map(|line| line.strip_prefix("  return ")).unwrap();
        same_population(&source, original, true);
    }
    let base = named().replace("  at: time", "  by byDay: conversationId, day(at), id\n  at: time");
    for original in [
        "messages[conversationId] last 2 by byDay after c",
        "messages[conversationId, day > 0] first 2 by byDay after c",
        "messages[conversationId, at > 0] first 2 by byWindow after c",
    ] { same_population(&base.replace(PAGE, original), original, true); }
    let original = "messages[conversationId, ordinal > floor] first 2 by byOrdinal after c where .sender = viewer";
    let source = named().replace("  return ", "  floor = 0\n  return ").replace(PAGE, original);
    same_population(&source, original, true);
}

#[test]
fn capped_read_without_range_gets_last_from_its_bound() {
    let original = "messages where .conversationId = conversationId and .sender = viewer";
    let source = named().replace("table messages:", "table messages:\n  cap 50 by conversationId").replace(PAGE, original);
    let repaired = same_population(&source, original, false);
    assert!(repaired.contains("last 50 by byWindow"));
}

#[test]
fn membership_and_explicit_merges_only_name_the_window_in_words() {
    for nullable in [false, true] {
        for predicate in [".sender in [viewer]", ".sender in [viewer, null]"] {
            let mut source = named();
            if nullable { source = source.replace("sender: principal", "sender: principal ?"); }
            source = source.replace(PAGE, &format!("messages where .conversationId = conversationId and {predicate} first 2 by .at, .ordinal after c"));
            words_only(&source);
        }
    }
    let source = named().replace(PAGE, "merge messages after c first 2 by byOrdinal:\n    [conversationId]");
    words_only(&source);
}

#[test]
fn advice_falls_back_if_an_index_or_cap_cannot_preserve_continuation() {
    let source = named().replace("by byWindow: conversationId, at, ordinal, id", "by byWindow: conversationId, at, ordinal")
        .replace(PAGE, "messages where .conversationId = conversationId first 2 by .ordinal after c");
    words_only(&source);
    let source = named().replace("table messages:", "table messages:\n  cap 50 by conversationId, sender")
        .replace(PAGE, "messages where .conversationId = conversationId and .sender = viewer");
    words_only(&source);
    // This predicate would become a lone explicit-index filter and introduce
    // N_SEEK. It needs scope/type information to move safely into a key.
    let source = named().replace(PAGE, "messages where .conversationId = conversationId and .at > 0 first 2 by .ordinal after c");
    words_only(&source);
}

#[test]
fn outer_threshold_stays_outer_and_never_becomes_a_candidate_filter() {
    let source = r#"
table messages:
  at: time
  ordinal: int
  threshold: int
  by byOrdinal: ordinal, id
  by byWindow: at, ordinal, id
  public
  sync public last 100 by byWindow
query outer(rowId: messages, c: cursor ?):
  return messages[rowId] { *, later: messages[ordinal > .threshold] first 2 by byOrdinal after c }
"#;
    words_only(source);
    let b = bind(source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([("outer", 0, 5), ("below", 3, 0), ("above", 6, 0)].map(|(name, ordinal, threshold)|
        ("messages".into(), object([("id", id(name)), ("at", Value::Int(ordinal)), ("ordinal", Value::Int(ordinal)), ("threshold", Value::Int(threshold))])))).unwrap();
    let result = e.query("outer", Context::new("alice", [("rowId".into(), id("outer")), ("c".into(), Value::Null)].into())).unwrap();
    let later = result.data.field("later").unwrap().as_array().unwrap();
    assert_eq!(later.len(), 1);
    assert_eq!(later[0].field("id").unwrap(), &id("above"));
    words_only(&source.replace("ordinal > .threshold", "ordinal > .ordinal"));
}
