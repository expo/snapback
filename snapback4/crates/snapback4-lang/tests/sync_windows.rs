//! @ref LLP 3000.019#3.1 — ordered window intent and actionable device coverage advice.
use snapback4_lang::{Bound, ast::SyncOrder, compile, parser::parse_document};

#[path = "sync_windows/repairs.rs"]
mod repairs;
use repairs::apply_repair;

const SOURCE: &str = include_str!("fixtures/sync-windows.q");

fn bind(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

#[test]
fn parser_keeps_column_order_for_every_audience_spelling() {
    for audience in ["", "public ", "to .owner ", "to members[.room] by .principal "] {
        let source = format!("table messages:\n  sync {audience}last 10000 by .at, .ordinal, .id\n");
        let (doc, diagnostics) = parse_document("schema.q", &source);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(doc.tables[0].sync.as_ref().unwrap().horizon,
            Some((10000, SyncOrder::Columns(vec!["at".into(), "ordinal".into(), "id".into()]))));
    }
}

#[test]
fn parser_refuses_duplicate_and_malformed_column_lists_with_rewrites() {
    for (order, fragment) in [(".at, .ordinal, .at", "twice"), (".at, ordinal", "leading dot"), (".at,", "leading dot"), ("byTime, .ordinal", "unexpected")] {
        let source = format!("table messages:\n  sync last 50 by {order}\n");
        let (_, diagnostics) = parse_document("schema.q", &source);
        let refusal = diagnostics.iter().find(|d| d.code == "E_QUARRY_SYNTAX" && d.message.contains(fragment)).expect("located syntax refusal");
        assert_eq!(refusal.site.line, 2);
        assert!(!refusal.rewrite.is_empty());
        if fragment == "twice" { assert_eq!(refusal.rewrite, "last 50 by .at, .ordinal"); }
    }
}

#[test]
fn generated_window_and_query_share_the_full_order_and_one_id() {
    for suffix in ["", ", .id"] {
        let bound = bind(&SOURCE.replace(".at, .ordinal", &format!(".at, .ordinal{suffix}")));
        assert!(bound.notes.is_empty(), "{:?}", bound.notes);
        let table = &bound.schema.tables["messages"];
        let horizon = table.sync.as_ref().unwrap().horizon.as_ref().unwrap();
        assert_eq!(horizon.last, 10000);
        assert_eq!(table.index(&horizon.by).unwrap().columns(), ["conversationId", "at", "ordinal", "id"]);
        assert_eq!(snapback4_core::ir::scans(&bound.programs[0].program)[0].index, horizon.by);
    }
}

#[test]
fn named_and_single_column_windows_keep_their_meaning() {
    let declared = SOURCE.replace("  at: time", "  by byThread: conversationId, at, ordinal, id\n  at: time");
    let intent = bind(&declared);
    let named = bind(&declared.replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byThread"));
    assert_eq!(intent.schema.tables, named.schema.tables);
    assert!(intent.notes.is_empty() && named.notes.is_empty());
    let single = bind(&SOURCE.replace(".at, .ordinal", ".at"));
    assert!(single.notes.is_empty());
    let table = &single.schema.tables["messages"];
    assert_eq!(table.index(&table.sync.as_ref().unwrap().horizon.as_ref().unwrap().by).unwrap().columns(), ["conversationId", "at", "id"]);
}

#[test]
fn audience_columns_are_refused_for_inferred_and_explicit_sync() {
    for audience in ["", "to members[.conversationId] "] {
        let source = SOURCE.replace("sync last 10000 by .at, .ordinal", &format!("sync {audience}last 10000 by .at, .conversationId, .ordinal"));
        let bound = compile(&[("schema.q".into(), source)]);
        let refusal = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_SYNTAX").expect("audience repetition is syntax, not an index error");
        assert!(refusal.message.contains("audience columns .conversationId"));
        assert_eq!(refusal.rewrite, "last 10000 by .at, .ordinal");
        assert_eq!(refusal.site.line, 19);
    }
    let source = "table notes:\n  owner: principal\n  at: time\n  read <- .owner = viewer\n  sync last 50 by .owner, .at\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX" && d.rewrite == "last 50 by .at"));
}

#[test]
fn unknown_columns_and_nonplain_or_wrong_prefix_indexes_still_refuse() {
    for source in [
        SOURCE.replace("sync last 10000 by .at, .ordinal", "sync last 10000 by .at, .missing"),
        SOURCE.replace("  at: time", "  by byBad: at, ordinal, id\n  at: time").replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byBad"),
        SOURCE.replace("  at: time", "  body: text <=100\n  by byBad: conversationId, words(body), at, id\n  at: time").replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byBad"),
    ] {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(!bound.diagnostics.is_empty());
        assert!(bound.diagnostics.iter().all(|d| d.site.file == "schema.q" && !d.rewrite.is_empty()));
    }
}

#[test]
fn builder_mismatch_is_noted_and_both_supported_order_repairs_remove_it() {
    let mismatch = SOURCE.replace("sync last 10000 by .at, .ordinal", "sync last 10000 by .at");
    let bound = bind(&mismatch);
    let notes: Vec<_> = bound.notes.iter().filter(|note| note.code == "N_SYNC_ORDER").collect();
    assert_eq!(notes.len(), 1);
    let note = notes[0];
    assert_eq!(note.site.to_string(), "schema.q:22:10");
    for text in ["query thread", "by .at, .ordinal, .id, newest first", "window is last 10000 by .at, .id, newest first", "needs the server"] { assert!(note.message.contains(text), "{note}"); }
    assert!(!note.message.contains("$intent:"));
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, id"));
    apply_repair(&mismatch, repairs::PAGE);
    assert_eq!(note.guide, "sync");
    assert!(snapback4_lang::guide::explain_code("N_SYNC_ORDER").unwrap().contains("newest-first"));
    assert_eq!(bound.schema.operations["thread"].runs.as_deref(), Some("device"));
    assert!(bind(SOURCE).notes.is_empty());
    assert!(bind(&mismatch.replace("last 2 by .at, .ordinal", "last 2 by .at, .id")).notes.is_empty());
}

#[test]
fn ascending_and_nested_helper_reads_are_located_but_server_queries_and_mutations_are_not_noted() {
    let ascending = SOURCE.replace("last 2 by", "first 2 by");
    let bound = bind(&ascending);
    apply_repair(&ascending, &repairs::PAGE.replace("last 2", "first 2"));
    assert!(bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER" && note.message.contains("oldest first")));
    let helper = ascending.replace("query thread(", "fn history(") + "\nquery thread(conversationId: conversations, c: cursor ?):\n  return { rows: history(conversationId, c) }\n";
    let bound = bind(&helper);
    assert!(bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER" && note.site.line == 22));
    apply_repair(&helper, &repairs::PAGE.replace("last 2", "first 2"));
    let server = ascending.replace("return messages where", "parent = conversations[conversationId]\n  return messages where");
    let bound = bind(&server);
    assert_eq!(bound.schema.operations["thread"].runs.as_deref(), Some("server"));
    assert!(!bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
    let mutation = bind(&ascending.replace("query thread(", "mutation thread("));
    assert!(!mutation.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
}

#[test]
fn held_order_note_does_not_promise_server_fallback() {
    let source = SOURCE.replace("c: cursor ?):", "c: cursor ?) held:").replace("last 2 by", "first 2 by");
    let bound = bind(&source);
    apply_repair(&source, &repairs::PAGE.replace("last 2", "first 2"));
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.message.contains("held query stays on the device"));
    assert!(!note.message.contains("needs the server"));
}

#[test]
fn extra_equality_pins_get_an_explicit_index_rewrite_that_clears_the_note() {
    let source = SOURCE.replace("  at: time", "  sender: principal\n  at: time")
        .replace("last 2 by", "where .sender = viewer last 2 by");
    let bound = bind(&source);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.message.contains("conversationId, sender, at, ordinal, id"));
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, ordinal, id"));
    apply_repair(&source, "messages where .conversationId = conversationId where .sender = viewer last 2 by .at, .ordinal after c");
}

#[test]
fn intrinsic_id_is_not_duplicated_when_followed_by_another_column() {
    let source = SOURCE.replace(".at, .ordinal", ".at, .id, .ordinal");
    let bound = bind(&source);
    let table = &bound.schema.tables["messages"];
    assert_eq!(table.index(&table.sync.as_ref().unwrap().horizon.as_ref().unwrap().by).unwrap().columns(), ["conversationId", "at", "id", "ordinal"]);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, id, ordinal"));
    apply_repair(&source, "messages where .conversationId = conversationId last 2 by .at, .id, .ordinal after c");
}

#[test]
fn named_indexes_with_identical_columns_still_have_distinct_window_coverage() {
    let source = SOURCE.replace("  at: time", "  by byWindow: conversationId, at, ordinal, id\n  by byOther: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byWindow")
        .replace("messages where .conversationId = conversationId last 2 by .at, .ordinal after c", "messages[conversationId] last 2 by byOther after c");
    let bound = bind(&source);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.message.contains("index byOther") && note.message.contains("index byWindow"));
    assert!(note.rewrite.contains("last 2 by byWindow"));
    apply_repair(&source, "messages[conversationId] last 2 by byOther after c");
}

#[test]
fn online_only_is_not_a_query_modifier_in_the_current_language() {
    // This is the concrete reason the RFC's second suggested rewrite is
    // stopped, rather than publishing a diagnostic that recommends it.
    let bound = compile(&[("schema.q".into(), SOURCE.replace("c: cursor ?):", "c: cursor ?) online only:"))]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX" && d.site.line == 21));
}

#[test]
fn invalid_horizons_return_e_sync_without_advice_or_panics() {
    let source = r#"
table members:
  house: int
  room: int
  principal: principal
  unique house, room, principal
  cap 50 by house, room
  read <- exists members[.house, .room, viewer]
  sync

table messages:
  house: int
  room: int
  at: time
  by bad: at
  read <- exists members[.house, .room, viewer]
  sync to members[.house, .room] last 10 by bad

query thread(c: cursor ?):
  return messages where .house = 1 and .room = 2 first 2 by .at after c
"#;
    // Short, wrong-prefix and zero-length horizons all belong to E_SYNC.
    for source in [source.to_string(), source.replace("by bad: at", "by bad: room, house, at, id"),
        source.replace("by bad: at", "by bad: house, room, at, id").replace("last 10", "last 0")] {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(!bound.diagnostics.is_empty());
        assert!(bound.diagnostics.iter().all(|d| d.code == "E_SYNC" && d.site.file == "schema.q" && d.site.line > 0), "{:?}", bound.diagnostics);
        assert!(!bound.notes.iter().any(|n| n.code == "N_SYNC_ORDER"), "{:?}", bound.notes);
    }
}

#[test]
fn legacy_implicit_id_index_gets_a_repair_that_selects_the_window_index() {
    let source = SOURCE.replace("  at: time", "  by byLegacy: conversationId, at, ordinal\n  at: time").replace(" after c", "");
    let bound = bind(&source);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, ordinal, id"));
    let corrected = bind(&apply_repair(&source, &repairs::PAGE.replace(" after c", "")));
    assert!(corrected.notes.iter().any(|note| note.code == "N_NO_CURSOR"), "the separate missing cursor advice remains");
}

#[test]
fn capped_whole_domain_aggregates_do_not_get_page_order_advice() {
    let source = SOURCE.replace("  at: time", "  cap 50\n  at: time")
        .replace("messages where .conversationId = conversationId last 2 by .at, .ordinal after c", "count(messages)");
    let bound = bind(&source);
    assert_eq!(bound.schema.operations["thread"].runs.as_deref(), Some("device"));
    let scans = snapback4_core::ir::scans(&bound.programs[0].program);
    assert!(scans.iter().any(|scan| scan.table == "messages" && scan.take == snapback4_core::ir::Bound::Literal(50)),
        "a schema cap can make a whole-domain aggregate finite");
    assert!(!bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
    assert!(bound.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"), "retain the independent authorization advice");
}

#[test]
fn calendar_pages_get_order_advice_and_the_window_repair_clears_it() {
    let source = SOURCE.replace("  at: time", "  by byDay: conversationId, day(at), id\n  by byWindow: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byWindow")
        .replace("messages where .conversationId = conversationId last 2 by .at, .ordinal after c", "messages[conversationId] last 2 by byDay after c");
    let bound = bind(&source);
    let note = bound.notes.iter().find(|n| n.code == "N_SYNC_ORDER").expect("calendar order differs from the window");
    assert!(note.message.contains("day(.at)"), "{note}");
    assert!(!note.message.contains("by .day,"), "calendar keys are functions, not row fields: {note}");
    let page = note.rewrite.split('`').nth(1).unwrap();
    assert!(page.contains("last 2 by byWindow"));
    apply_repair(&source, "messages[conversationId] last 2 by byDay after c");
}

#[test]
fn index_repair_moves_an_incompatible_explicit_range_into_a_residual_filter() {
    let original = "messages[conversationId, ordinal > 0] first 2 by byOrdinal after c";
    let source = SOURCE.replace("  at: time", "  by byOrdinal: conversationId, ordinal, id\n  by byWindow: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byWindow")
        .replace("messages where .conversationId = conversationId last 2 by .at, .ordinal after c", original);
    let bound = bind(&source);
    let note = bound.notes.iter().find(|n| n.code == "N_SYNC_ORDER").unwrap();
    let page = note.rewrite.split('`').nth(1).unwrap();
    assert!(page.starts_with("messages[conversationId = conversationId]"), "{note}");
    assert!(page.contains("where .ordinal > 0"), "{note}");
    let repaired = bind(&apply_repair(&source, original));
    assert!(!repaired.notes.iter().any(|n| n.code == "N_SYNC_ORDER"));
    let scans = snapback4_core::ir::scans(&repaired.programs[0].program);
    assert_eq!(scans[0].index, "byWindow");
    assert!(scans[0].range.is_none() && scans[0].filter.is_some());
    // The reviewer's exact supported spelling also remains valid.
    assert!(!bind(&source.replace(original, "messages[conversationId] last 2 by byWindow after c where .ordinal > 0"))
        .notes.iter().any(|n| n.code == "N_SYNC_ORDER"));
}

#[test]
fn view_advice_does_not_offer_a_single_branch_as_a_whole_read() {
    let source = SOURCE.replace("  at: time", "  sender: principal\n  at: time")
        .replace("query thread(", "view activity:\n  messages where .sender = viewer { conversationId, at, ordinal }\n\nquery thread(")
        .replace("return messages where", "return activity where");
    repairs::words_only(&source);
}

#[test]
fn replacement_preserves_compatible_ranges_and_moves_calendar_ranges() {
    let base = SOURCE.replace("  at: time", "  by byDay: conversationId, day(at), id\n  by byWindow: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by byWindow");
    let original = "messages where .conversationId = conversationId last 2 by .at, .ordinal after c";
    let compatible = "messages[conversationId, at > 0] first 2 by byWindow after c";
    let source = base.replace(original, compatible);
    let bound = bind(&source);
    let note = bound.notes.iter().find(|n| n.code == "N_SYNC_ORDER").unwrap();
    assert!(note.rewrite.contains("at > 0"));
    apply_repair(&source, compatible);

    let calendar = "messages[conversationId, day > 0] first 2 by byDay after c";
    let source = base.replace(original, calendar);
    let bound = bind(&source);
    let note = bound.notes.iter().find(|n| n.code == "N_SYNC_ORDER").unwrap();
    let page = note.rewrite.split('`').nth(1).unwrap();
    assert!(page.contains("where day(.at) > 0"), "{note}");
    apply_repair(&source, calendar);
}

#[test]
fn word_search_keeps_its_separate_coverage_requirement() {
    let source = SOURCE.replace("  at: time", "  body: text <=100\n  search body\n  at: time")
        .replace("c: cursor ?):", "q: text <=100, c: cursor ?):")
        .replace("last 2 by .at, .ordinal", "matching q last 2 by .at, .ordinal");
    let bound = bind(&source);
    assert!(!bound.notes.iter().any(|n| n.code == "N_SYNC_ORDER"), "{:?}", bound.notes);
}
