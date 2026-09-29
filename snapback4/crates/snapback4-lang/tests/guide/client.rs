use super::{card, quarry, compile};
#[path = "published.rs"]
mod published;

#[test]
fn client_aliases_keep_typing_on_ephemeral() {
    let client = card("client").unwrap();
    assert!(client.lines().count() <= 130);
    assert!(client.contains("eight queued observation attempts"));
    assert!(client.contains("direct queries and timed presence refreshes use separate paths"));
    for alias in ["client", "react", "hooks", "composer", "unread"] {
        assert_eq!(card(alias), Some(client));
        assert!(snapback4_lang::guide::listing().contains(alias));
    }
    assert_eq!(card("typing"), card("ephemeral"));
}

#[test]
fn published_text_needs_no_checkout_or_lane_reports() {
    let docs = snapback4_lang::guide::KEYWORDS.iter().map(|name| (*name, card(name).unwrap()))
        .chain([("README", include_str!("../../../../packages/snapback4/README.md")),
                ("client reference", include_str!("../../../../packages/snapback4/CLIENT-AND-OPERATIONS.md"))]);
    for (name, doc) in docs {
        // Source annotations explain the code; published prose must explain itself.
        let text = doc.lines().filter(|line| !line.contains(concat!("@", "ref "))).collect::<Vec<_>>().join(" ");
        assert!(!published::contains_llp_reference(&text), "{name}: inaccessible LLP reference");
        for forbidden in ["LLP ", "snapback4/reports/", "../reports/", "ROUND2.md", "round2-measurements.json", "see its report", ".test.mjs", "reports/20", "../llp/"] {
            assert!(!text.contains(forbidden), "{name}: inaccessible {forbidden}");
        }
        for words in text.split_whitespace().collect::<Vec<_>>().windows(2) {
            let lane_name = |word: &str| word.len() <= 3 && word.len() >= 2 && word.chars().all(|c| c.is_ascii_uppercase());
            assert!(!(words[0].eq_ignore_ascii_case("lane") && lane_name(words[1].trim_end_matches("'s"))) && !(lane_name(words[0]) && words[1].starts_with("round-")), "{name}: lane reference {words:?}");
        }
    }
}

#[test]
fn w13e_every_chat_search_has_ordinary_and_explicit_narrower_scopes() {
    let text = card("search").unwrap();
    let section = text.split_once("## Search every chat I'm in").expect("the search forms").1.split("\n## ").next().unwrap();
    let blocks = quarry(section);
    assert_eq!(blocks.len(), 1);
    let block = &blocks[0];
    let (document, errors) = snapback4_lang::parse_document("schema.q", block);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(document.programs.len(), 4);
    for form in ["searchHeld", "searchGrouped", "search", "searchNewest"] {
        let declaration = document.programs.iter().find(|query| query.name == form).expect(form);
        assert_eq!(declaration.args.iter().filter(|arg| arg.type_.kind == snapback4_lang::ast::TypeKind::Cursor).count(), 1, "{form}");
    }
    for sentence in ["do not exchange them", "change both", "never advance past it", "Server batches", "Install the bounded server walk"] {
        assert!(!section.contains(sentence), "obsolete protocol: {sentence}");
    }
    assert!(block.contains("query search(q: text <=100, c: cursor ?):\n  return messages matching q last 20 by .at after c"));
    // The explicit held scope still diagnoses missing sync. Ordinary search's
    // inferred audience requires sync, so exercise this old control separately.
    let explicit_scopes = block.replace("query search(q: text <=100, c: cursor ?):\n  return messages matching q last 20 by .at after c\n", "");
    let server = explicit_scopes.lines().map(|line| if line.trim_start().starts_with("sync to ") { "  online only" } else { line }).collect::<Vec<_>>().join("\n");
    // Turning off every sync deliberately makes searchHeld an unsynced held read.
    let bound = compile(&server);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(!bound.notes.is_empty());
    assert!(bound.notes.iter().all(|note| note.code == "N_HELD_UNKNOWN" && note.message.contains("searchHeld")), "{:?}", bound.notes);
}

#[test]
fn existence_card_and_starters_teach_the_sdk_words() {
    let client = card("client").unwrap();
    assert!(!client.contains("read.presence"));
    assert!(!card("offline-interactions").unwrap().contains("presence"));
    for word in ["existence(read)", "read.existence", "`loading`", "`denied`", "`present`", "`absent`", "`partial`", "absence at the acquired watermark", "no horizon", "conversation's own group", "messages' audience", "existence(member) === \"absent\""] {
        assert!(client.contains(word), "client missing {word}");
    }
    assert!(client.split_whitespace().count() <= 1200, "keep the client card concise");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../snapback4/src/verbs/init");
    fn visit(path: &std::path::Path) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() { visit(&path); }
            else if path.extension().is_some_and(|ext| ext == "ts" || ext == "tsx") {
                let source = std::fs::read_to_string(&path).unwrap();
                assert!(!source.contains("\"loading\" in") && !source.contains("'loading' in"), "{} bypasses SDK existence", path.display());
                assert!(!source.contains("presence"), "{} uses the old read word", path.display());
                assert!(!source.contains("ReadState"), "{} copies a private read classifier", path.display());
            }
        }
    }
    visit(&root);
}

#[test]
fn missing_row_question_opens_client() {
    assert_eq!(card("what does a missing row mean"), card("client"));
}
#[test]
fn loading_or_absent_opens_client() {
    assert_eq!(card("loading or absent"), card("client"));
}
#[test]
fn unknown_membership_offline_opens_interactions() {
    assert_eq!(card("unknown membership offline"), card("offline-interactions"));
}
#[test]
fn connection_presence_keeps_its_card() {
    let connected = card("presence").unwrap();
    assert!(connected.contains("connected[p]"));
    assert_ne!(Some(connected), card("client"));
}
#[test]
fn membership_wording_covers_pending_predictions_and_withdrawals() {
    for name in ["client", "offline-interactions"] {
        let text = card(name).unwrap();
        assert!(text.contains("unless a pending prediction blocks absence"), "{name}");
        assert!(text.contains("`loading` means acquisition or later withdrawal"), "{name}");
    }
}
