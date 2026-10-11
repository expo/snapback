use snapback4_lang::{compile, guide};

fn recipe() -> String {
    guide::quarry(guide::card("search").unwrap()).into_iter()
        .find(|source| source.contains("ordinal: sequence by")).unwrap()
        .replace("last 20 by byConversationOrdinal", "last 20 by .ordinal")
}

fn plain_recipe() -> String {
    recipe().replace("unique byConversationOrdinal: conversation, ordinal", "by byConversationOrdinal: conversation, ordinal")
        .replace(" last 500 by byConversationOrdinal", "")
}

#[test]
fn named_unique_search_order_accepts_scopes_directions_and_browse_variants() {
    for ordinal in ["sequence by conversation", "int"] {
        for prefix in ["messages[conversation = conversation]", "messages[conversation]", "messages where .conversation = conversation"] {
            for direction in ["first", "last"] {
                let schema = recipe().split("query searchChat").next().unwrap().replace("sequence by conversation", ordinal)
                    .replace(" last 500 by byConversationOrdinal", "");
                let source = format!("{schema}query searchChat(conversation: conversations, q: text <=100, c: cursor ?):\n  return {prefix} matching q {direction} 20 by byConversationOrdinal after c {{ *, chat: conversations[.conversation].id }}\n");
                let bound = compile(&[("schema.q".into(), source)]);
                assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                assert!(bound.notes.iter().all(|note| note.code == "N_NO_HORIZON"), "{:?}", bound.notes);
                let indexes = &bound.schema.tables["messages"].indexes;
                assert!(indexes["byConversationOrdinal"].unique);
                assert!(indexes.values().any(|index| index.word_component().is_some() && index.columns() == ["conversation", "ordinal", "id"]));
            }
        }
    }
}

#[test]
fn unique_order_refuses_keys_outside_its_declared_prefix_with_exact_text() {
    let source = recipe().replace("conversation = conversation] matching q last 20 by .ordinal", "ordinal = 7] matching q last 20 by byConversationOrdinal");
    let bound = compile(&[("schema.q".into(), source)]);
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    let refusal = &bound.diagnostics[0];
    assert_eq!(refusal.code, "E_QUARRY_MATCHING_INDEX");
    assert!(refusal.rewrite.is_empty(), "a non-prefix key must not suggest an unscoped search: {refusal:?}");
    assert_eq!(refusal.message, "messages.byConversationOrdinal is a plain unique index; matching scope keys must name its leading columns; missing leading column: conversation");
    assert_eq!(refusal.guide, "search");
}

#[test]
fn named_unique_search_keeps_explicit_browse_choice_among_competing_indexes() {
    for prefix in ["messages[conversation = conversation]", "messages[conversation]", "messages where .conversation = conversation"] {
        let schema = recipe().split("query searchChat").next().unwrap().replace(
            "  unique byConversationOrdinal: conversation, ordinal",
            "  unique byConversationOrdinal: conversation, ordinal\n  by byConversationOrdinalId: conversation, ordinal, id");
        let source = format!("{schema}query page(conversation: conversations, q: text <=100, c: cursor ?):\n  return {prefix} matching q last 20 by byConversationOrdinal after c\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let scans = snapback4_core::ir::scans(&bound.programs[0].program);
        let browse: Vec<_> = scans.iter().filter(|scan| bound.schema.tables["messages"].indexes[&scan.index].word_component().is_none()).collect();
        assert_eq!(browse.len(), 1);
        assert_eq!(browse[0].index, "byConversationOrdinal");
    }
}

#[test]
fn valid_named_prefix_without_a_page_bound_requests_a_bound() {
    let source = recipe().replace("last 20 by .ordinal after c", "by byConversationOrdinal");
    let bound = compile(&[("schema.q".into(), source)]);
    assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
    let refusal = &bound.diagnostics[0];
    assert_eq!(refusal.code, "E_QUARRY_BOUND", "{refusal:?}");
    assert!(refusal.message.contains("no cap over this prefix"), "{refusal:?}");
    assert!(refusal.rewrite.contains("cap N by conversation"), "{refusal:?}");
    // A synced table's page rewrite reads newest first, as its horizon keeps (LLP 3000.036 §13.3).
    assert!(refusal.rewrite.contains("last N"), "{refusal:?}");
    assert_eq!(refusal.guide, "bounds");
}

#[test]
fn valid_named_prefix_uses_its_cap_without_an_explicit_page_bound() {
    let source = recipe().replace("  search body", "  search body\n  cap 20 by conversation")
        .replace("last 20 by .ordinal after c", "by byConversationOrdinal");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let scans = snapback4_core::ir::scans(&bound.programs[0].program);
    assert_eq!(scans.len(), 2);
    assert!(scans.iter().all(|scan| scan.take == snapback4_core::ir::Bound::Literal(20)));
}

#[test]
fn named_composite_order_keeps_all_unpinned_columns_and_suffix_pins() {
    for (prefix, columns) in [
        ("messages[conversation = conversation]", vec!["conversation", "bucket", "ordinal", "id"]),
        ("messages[conversation = conversation] where .bucket = 'A'", vec!["bucket", "conversation", "ordinal", "id"]),
        ("messages", vec!["conversation", "bucket", "ordinal", "id"]),
    ] {
        let schema = recipe().split("query searchChat").next().unwrap()
            .replace("  body:", "  bucket: text <=10\n  body:")
            .replace("byConversationOrdinal: conversation, ordinal", "byOrder: conversation, bucket, ordinal")
            .replace(" last 500 by byConversationOrdinal", "");
        let source = format!("{schema}query page(conversation: conversations, q: text <=100, c: cursor ?):\n  return {prefix} matching q last 2 by byOrder after c\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let scans = snapback4_core::ir::scans(&bound.programs[0].program);
        let search = scans.iter().find(|scan| bound.schema.tables["messages"].indexes[&scan.index].word_component().is_some()).unwrap();
        assert_eq!(bound.schema.tables["messages"].indexes[&search.index].columns(), columns);
    }
}

#[test]
fn named_plain_search_index_prints_a_compiling_order_rewrite() {
    for ordinal in ["sequence by conversation", "int"] {
        for source_read in [
            "messages[conversation = chat] matching needle last 7 by byConversationOrdinal after next",
            "messages[chat] matching needle last 7 by byConversationOrdinal after next",
            "messages where .conversation = chat matching needle last 7 by byConversationOrdinal after next",
        ] {
            let schema = plain_recipe().split("query searchChat").next().unwrap().replace("sequence by conversation", ordinal);
            let source = format!("{schema}query page(chat: conversations, needle: text <=100, next: cursor ?):\n  return {source_read} {{ id, ordinal }}\n");
            let refused = compile(&[("schema.q".into(), source.clone())]);
            assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
            let diagnostic = &refused.diagnostics[0];
            assert_eq!(diagnostic.code, "E_QUARRY_MATCHING_INDEX");
            assert_eq!(diagnostic.guide, "search");
            assert!(diagnostic.message.contains("plain index, not a words index"));
            assert_eq!(diagnostic.rewrite, "messages where .conversation = chat matching needle last 7 by .ordinal after next");
            let repaired = source.replace(source_read, &diagnostic.rewrite);
            let bound = compile(&[("schema.q".into(), repaired)]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            assert!(bound.notes.iter().all(|note| note.code == "N_NO_HORIZON"), "{:?}", bound.notes);
            let indexes = &bound.schema.tables["messages"].indexes;
            assert!(!indexes["byConversationOrdinal"].unique);
            assert!(indexes.values().any(|index| index.word_component().is_some() && index.columns() == ["conversation", "ordinal", "id"]));
        }
    }
}

#[test]
fn search_order_repair_keeps_nested_operands_filters_and_shape_context() {
    let schema = plain_recipe().split("query searchChat").next().unwrap().to_owned();
    let read = "messages[conversation = chat] matching ('cof' if needle = '' else needle) first 3 by byConversationOrdinal after next where .body != 'skip'";
    let source = format!("{schema}fn hits(chat: conversations, needle: text <=100, next: cursor ?):\n  return {read} {{ id, ordinal }}\nquery page(chat: conversations, needle: text <=100, next: cursor ?):\n  return hits(chat, needle, next)\n");
    let refused = compile(&[("schema.q".into(), source.clone())]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let rewrite = &refused.diagnostics[0].rewrite;
    assert!(rewrite.contains("('cof' if needle = '' else needle)"), "{rewrite}");
    assert!(rewrite.contains(".body != 'skip'"), "{rewrite}");
    assert!(rewrite.contains("first 3 by .ordinal after next"), "{rewrite}");
    let repaired = compile(&[("schema.q".into(), source.replace(read, rewrite))]);
    assert!(repaired.diagnostics.is_empty(), "{:?}", repaired.diagnostics);
}

#[test]
fn inadmissible_search_order_repairs_are_not_printed() {
    let recipe = plain_recipe();
    for source in [
        recipe.replace("  search body\n", ""),
        recipe.replace("query searchChat", "mutation searchChat"),
    ] {
        let refused = compile(&[("schema.q".into(), source.replace("last 20 by .ordinal", "last 20 by byConversationOrdinal"))]);
        let diagnostic = refused.diagnostics.iter().find(|d| d.message.contains("plain index, not a words index")).unwrap();
        assert!(diagnostic.rewrite.is_empty(), "uncompilable repair: {diagnostic:?}");
    }
}

#[test]
fn words_index_with_wrong_scope_keeps_its_distinct_diagnostic() {
    let source = recipe().replace("  search body", "  search body\n  by byWords: conversation, words(body), ordinal, id")
        .replace("messages[conversation = conversation] matching q last 20 by .ordinal", "messages matching q last 20 by byWords");
    let refused = compile(&[("schema.q".into(), source)]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let diagnostic = &refused.diagnostics[0];
    assert_eq!(diagnostic.code, "E_QUARRY_MATCHING_INDEX");
    assert_eq!(diagnostic.guide, "search");
    assert!(diagnostic.message.contains("has its words after 1 column"), "{diagnostic:?}");
    assert!(!refused.diagnostics.iter().any(|d| d.message.contains("plain index")));
}

#[test]
fn computed_nonwords_index_is_known_but_incompatible_without_a_rewrite() {
    let source = recipe().replace("  search body", "  at: time\n  search body\n  by byDay: conversation, day(at), id")
        .replace("last 20 by .ordinal", "last 20 by byDay");
    let refused = compile(&[("schema.q".into(), source)]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    let diagnostic = &refused.diagnostics[0];
    assert_eq!(diagnostic.code, "E_QUARRY_MATCHING_INDEX");
    assert_eq!(diagnostic.guide, "search");
    assert!(diagnostic.message.contains("has a computed key"), "{diagnostic:?}");
    assert!(!diagnostic.message.contains("plain index"), "{diagnostic:?}");
    assert!(diagnostic.rewrite.is_empty(), "{diagnostic:?}");
}

#[test]
fn undeclared_search_index_keeps_unknown_name_code() {
    let source = recipe().replace("last 20 by .ordinal", "last 20 by missingIndex");
    let refused = compile(&[("schema.q".into(), source)]);
    assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
    assert_eq!(refused.diagnostics[0].code, "E_QUARRY_UNKNOWN");
    assert!(refused.diagnostics[0].message.contains("has no index missingIndex"));
}

#[test]
fn matching_index_code_has_its_own_registry_entry_explanation_and_guide() {
    let code = "E_QUARRY_MATCHING_INDEX";
    assert!(guide::codes().contains(&code));
    assert_eq!(snapback4_lang::diag::guide_for(code), "search");
    let why = guide::explain_code(code).unwrap();
    assert!(why.contains("missing leading column and offers no rewrite"), "{why}");
    for fact in ["the named index is declared", "computed key", "scope keys", "snapback4 guide search"] {
        assert!(why.contains(fact), "missing {fact}: {why}");
    }
    let diagnostic = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "");
    assert!(diagnostic.explanation_section().is_some());
}
