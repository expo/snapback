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

#[test]
fn fitting_heading_does_not_lose_the_renderers_safety_margin() {
    let source=format!("# Edge\n\n## Heading\n\n{}\n\n{}\n", "a".repeat(8800), "b".repeat(8900));
    let card=guide::reader_card("edge",&source);
    assert!(!card.contains("continued"));
    let section=guide::section("edge",&card,"Heading").unwrap();
    assert!(section.len()<=guide::REFERENCE_BYTES);
    assert!(section.contains(&"b".repeat(8900)));
}

#[test]
fn continued_parts_and_packed_fences_fit_their_destination_allowance() {
    for (name, limit) in [("edge", guide::REFERENCE_BYTES), ("package-reference edge", guide::FULL_BYTES)] {
        let raw=format!("# Edge\n\n## Heading\n\nShort lead.\n\n{}\n\n{}\n", "a ".repeat(limit), "b ".repeat(limit));
        let card=guide::reader_card(name,&raw);
        assert!(card.contains("continued"));
        for n in 1..=guide::sections(&card).len() {
            assert!(guide::section(name,&card,&n.to_string()).unwrap().len()<=limit);
        }
    }
    // This fence fits the initial heading allowance but not a continued label.
    // The known packed-source mechanism must retain it rather than clip it.
    let raw=format!("# Edge\n\n## Heading\n\nShort lead.\n\n```js\n// day2-accounts\n{}\n```\n", "x".repeat(17_950));
    let card=guide::reader_card("testing",&raw);
    assert!(card.contains("dist/recipes/day2-accounts.mjs"));
    for n in 1..=guide::sections(&card).len() {
        assert!(guide::section("testing",&card,&n.to_string()).unwrap().len()<=guide::REFERENCE_BYTES);
    }
}
