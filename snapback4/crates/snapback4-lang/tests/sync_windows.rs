//! @ref LLP 3000.019#3.1 — ordered window intent and actionable device coverage advice.
use snapback4_lang::{Bound, ast::SyncOrder, compile, parser::parse_document};

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
    assert!(note.rewrite.contains("last 2 by .at, .id"));
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
    assert!(bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER" && note.message.contains("oldest first")));
    let helper = ascending.replace("query thread(", "fn history(") + "\nquery thread(conversationId: conversations, c: cursor ?):\n  return { rows: history(conversationId, c) }\n";
    let bound = bind(&helper);
    assert!(bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER" && note.site.line == 22));
    let server = ascending.replace("return messages where", "parent = conversations[conversationId]\n  return messages where");
    let bound = bind(&server);
    assert_eq!(bound.schema.operations["thread"].runs.as_deref(), Some("server"));
    assert!(!bound.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
    let mutation = bind(&ascending.replace("query thread(", "mutation thread("));
    assert!(!mutation.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
}

#[test]
fn held_order_note_does_not_promise_server_fallback() {
    let bound = bind(&SOURCE.replace("c: cursor ?):", "c: cursor ?) held:").replace("last 2 by", "first 2 by"));
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
    let repaired = source.replace("  at: time", "  by bySyncWindow: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by bySyncWindow")
        .replace("messages where .conversationId = conversationId where .sender = viewer last 2 by .at, .ordinal after c",
            "messages[conversationId = conversationId] by bySyncWindow where .sender = viewer last 2 after c");
    assert!(!bind(&repaired).notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
}

#[test]
fn intrinsic_id_is_not_duplicated_when_followed_by_another_column() {
    let source = SOURCE.replace(".at, .ordinal", ".at, .id, .ordinal");
    let bound = bind(&source);
    let table = &bound.schema.tables["messages"];
    assert_eq!(table.index(&table.sync.as_ref().unwrap().horizon.as_ref().unwrap().by).unwrap().columns(), ["conversationId", "at", "id", "ordinal"]);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, id, ordinal"));
    let repaired = source.replace("  at: time", "  by bySyncWindow: conversationId, at, id, ordinal\n  at: time")
        .replace("sync last 10000 by .at, .id, .ordinal", "sync last 10000 by bySyncWindow")
        .replace("messages where .conversationId = conversationId last 2 by .at, .id, .ordinal after c",
            "messages[conversationId = conversationId] last 2 by bySyncWindow after c");
    assert!(!bind(&repaired).notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
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
    assert!(!bind(&source.replace("last 2 by byOther", "last 2 by byWindow")).notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
}

#[test]
fn online_only_is_not_a_query_modifier_in_the_current_language() {
    // This is the concrete reason the RFC's second suggested rewrite is
    // stopped, rather than publishing a diagnostic that recommends it.
    let bound = compile(&[("schema.q".into(), SOURCE.replace("c: cursor ?):", "c: cursor ?) online only:"))]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_SYNTAX" && d.site.line == 21));
}

#[test]
fn legacy_implicit_id_index_gets_a_repair_that_selects_the_window_index() {
    let source = SOURCE.replace("  at: time", "  by byLegacy: conversationId, at, ordinal\n  at: time").replace(" after c", "");
    let bound = bind(&source);
    let note = bound.notes.iter().find(|note| note.code == "N_SYNC_ORDER").unwrap();
    assert!(note.rewrite.contains("by bySyncWindow: conversationId, at, ordinal, id"));
    let repaired = source.replace("  at: time", "  by bySyncWindow: conversationId, at, ordinal, id\n  at: time")
        .replace("sync last 10000 by .at, .ordinal", "sync last 10000 by bySyncWindow")
        .replace("messages where .conversationId = conversationId last 2 by .at, .ordinal", "messages[conversationId] last 2 by bySyncWindow");
    let corrected = bind(&repaired);
    assert!(!corrected.notes.iter().any(|note| note.code == "N_SYNC_ORDER"));
    assert!(corrected.notes.iter().any(|note| note.code == "N_NO_CURSOR"), "the separate missing cursor advice remains");
}
