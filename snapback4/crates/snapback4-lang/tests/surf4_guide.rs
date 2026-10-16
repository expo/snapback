use snapback4_lang::guide;
#[test]
fn shipped_cards_exclude_internal_work_labels_and_open_with_content() {
    for name in guide::KEYWORDS {
        let text = guide::card(name).unwrap();
        for forbidden in ["RULES3", "KIT2", "wave-13 lanes", "SURF4", "DAY3"] {
            assert!(!text.contains(forbidden), "{name}: internal label {forbidden}");
        }
        if let Some(overview) = guide::overview(name, text) {
            let first = &guide::sections(text)[0];
            let content = text.lines().skip(first.2).take(3).collect::<Vec<_>>().join("\n");
            assert!(overview.contains(&content), "{name}: first section content is visible");
        }
    }
}
#[test]
fn blind_update_explanations_agree() {
    let why = guide::explain_code("N_LOOKUP_HIDDEN").unwrap();
    assert!(why.contains("Do not widen read access solely to permit a blind patch"));
    assert!(why.contains("can change an unreadable"));
    let rules = guide::card("rules").unwrap();
    assert!(rules.contains("A blind update or upsert-patch needs no read rule"));
}
