use snapback4_lang::guide;
#[test]
fn shipped_cards_exclude_internal_work_labels_and_open_with_content() {
    for name in guide::KEYWORDS {
        let text = guide::card(name).unwrap();
        for forbidden in ["RULES3", "KIT2", "wave-13 lanes", "SURF4", "DAY3"] {
            assert!(!text.contains(forbidden), "{name}: internal label {forbidden}");
        }
        if let Some(overview) = guide::overview(name, text) {
            let sections = guide::sections(text);
            let first = sections.iter().find(|section| text.lines().skip(section.2 + 1).take(section.3 - section.2 - 1).any(|line| !line.trim().is_empty())).unwrap();
            let content = text.lines().skip(first.2).take((first.3 - first.2).min(3)).collect::<Vec<_>>().join("\n");
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

#[test]
fn release_json_reference_is_discoverable_without_growing_the_deploy_card() {
    let deploy = guide::card("deploy").unwrap();
    assert!(deploy.lines().count() <= 150);
    assert!(deploy.contains("guide release-json"));
    let reference = guide::card("release-json").unwrap();
    for field in ["release", "previous_active", "latest", "generation", "revision", "native_digest", "events_after", "items_after", "workers", "selected"] {
        assert!(reference.contains(field), "missing release JSON field {field}");
    }
    assert!(reference.contains("startServe") && reference.contains("timeoutMs"));
}

#[test]
fn long_overview_skips_empty_group_headings_and_shows_real_content() {
    let card = format!("# Example\n\nA lead.\n\n## Reference\n\n## Useful\n\nFirst useful body.\n\n{}\n## Later\n\nLater body.", "more body\n".repeat(160));
    let preview = guide::overview("example", &card).unwrap();
    assert!(preview.contains("First useful body."));
    assert!(preview.contains("--section 2"));
}
