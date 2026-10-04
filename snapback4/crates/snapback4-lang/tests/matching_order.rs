use snapback4_lang::{compile, guide};

fn recipe() -> String {
    guide::quarry(guide::card("search").unwrap()).into_iter()
        .find(|source| source.contains("ordinal: sequence by")).unwrap()
}

#[test]
fn named_plain_search_index_prints_a_compiling_order_rewrite() {
    for ordinal in ["sequence by conversation", "int"] {
        for source_read in [
            "messages[conversation = chat] matching needle last 7 by byConversationOrdinal after next",
            "messages[chat] matching needle last 7 by byConversationOrdinal after next",
            "messages where .conversation = chat matching needle last 7 by byConversationOrdinal after next",
        ] {
            let schema = recipe().split("query searchChat").next().unwrap().replace("sequence by conversation", ordinal);
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
            assert!(bound.notes.is_empty(), "{:?}", bound.notes);
            let indexes = &bound.schema.tables["messages"].indexes;
            assert!(indexes["byConversationOrdinal"].unique);
            assert!(indexes.values().any(|index| index.word_component().is_some() && index.columns() == ["conversation", "ordinal", "id"]));
        }
    }
}

#[test]
fn search_order_repair_keeps_nested_operands_filters_and_shape_context() {
    let schema = recipe().split("query searchChat").next().unwrap().to_owned();
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
    let recipe = recipe();
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
    for fact in ["the named index is declared", "computed key", "scope keys", "snapback4 guide search"] {
        assert!(why.contains(fact), "missing {fact}: {why}");
    }
    let diagnostic = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "");
    assert!(diagnostic.explanation_section().is_some());
}
