use snapback4_lang::guide;

#[test]
fn honest_full_prints_small_cards_and_explains_large_ones() {
    for name in ["evolution", "day2", "staging"] {
        let card = guide::card(name).unwrap();
        assert!(card.len() <= guide::REFERENCE_BYTES, "{name}: {}", card.len());
        assert_eq!(guide::full(name, card), card);
    }
    for name in ["deploy", "language", "rules", "production", "security", "rule-recipes"] {
        let card = guide::card(name).unwrap();
        let shown = guide::full(name, card);
        assert!(shown.contains("too long to print whole"), "{name}");
        assert!(shown.contains("--section") && shown.len() <= guide::REFERENCE_BYTES);
    }
    let exact = "x".repeat(guide::REFERENCE_BYTES);
    assert_eq!(guide::full("edge", &exact), exact);
    assert!(guide::full("edge", &(exact + "x")).contains("too long"));
}

#[test]
fn deploy_persistent_production_is_one_complete_heading() {
    let raw = guide::card("deploy").unwrap();
    let card = guide::reader_card("deploy", raw);
    let sections = guide::sections(&card);
    let (_, heading, _, _) = &sections[14];
    assert!(heading.to_lowercase().contains("persistent"), "{heading}");
    assert!(!card.contains("persistent production (continued"));
    let shown = guide::section("deploy", &card, "15").unwrap();
    assert!(shown.len() <= guide::REFERENCE_BYTES);
    let (_, _, start, end) = guide::sections(raw).into_iter().find(|s| s.1 == *heading).unwrap();
    let recipe = raw.lines().skip(start).take(end - start).collect::<Vec<_>>().join("\n");
    let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(normalize(&shown).contains(&normalize(&recipe)), "the entire heading recipe survives paragraph normalization");
}
