//! The short path has the same examples, diagnostics and budgets as its cards.
use super::{card, KEYWORDS};
use snapback4_lang::guide::START_CARDS;

#[test]
fn start_is_the_same_eight_openings_in_order_with_registered_mistakes() {
    let mut expected = String::new();
    for name in START_CARDS {
        let (opening, reference) = card(name).unwrap().split_once("\n## Reference").unwrap();
        assert!(opening.lines().count() <= 15, "{name}: {} lines", opening.lines().count());
        assert!(opening.contains("**Start here:**"));
        assert!(!reference.trim().is_empty());
        let mistakes: Vec<_> = opening.lines().filter(|line| line.starts_with("- `")).collect();
        assert!((2..=3).contains(&mistakes.len()), "{name}: two or three first mistakes");
        for line in mistakes {
            let code = line.split('`').nth(1).unwrap();
            assert!(snapback4_lang::guide::codes().contains(&code), "{name}: unknown {code}");
            assert!(line.contains("; "), "{name}: a one-line fix follows the mistake");
        }
        expected.push_str(opening.trim_end()); expected.push_str("\n\n");
    }
    let start = card("start").unwrap();
    assert!(start.ends_with(&expected));
    assert!(start.lines().count() <= 124, "{} lines", start.lines().count());
    assert_eq!(card("index"), Some(start));
    assert!(snapback4_lang::guide::listing().contains("snapback4 guide start"));
}

#[test]
fn openings_fit_without_growing_the_eight_reference_cards() {
    for (name, limit) in [("language", 825), ("sync", 524), ("maintains", 879),
        ("rules", 374), ("prediction", 368), ("client", 114), ("search", 405), ("feeds", 401)] {
        let lines = card(name).unwrap().lines().count();
        assert!(lines <= limit, "{name}: {lines} > {limit}");
    }
}

#[test]
fn every_card_introduces_the_feature_before_examples_and_reference_details() {
    for name in KEYWORDS {
        let text = card(name).unwrap();
        if *name == "start" { continue; }
        let mut paragraphs = text.split("\n\n");
        assert!(paragraphs.next().unwrap().starts_with("# "), "{name}: title first");
        let lead = paragraphs.next().unwrap();
        assert!(!lead.starts_with(['#', '`']), "{name}: introduce the feature before syntax");
        assert!(lead.split_whitespace().count() <= 45, "{name}: keep the introduction short");
        assert!((1..=2).contains(&lead.matches('.').count()), "{name}: one or two sentences");
        let (opening, _) = text.split_once("```").expect("every card has an example");
        assert!(!opening.contains("--") && !opening.contains("E_") && !opening.contains("N_"), "{name}: flags and refusals follow the example");
        if *name != "feeds" {
            // Feeds introduces its Global example with the named feature section.
            assert!(paragraphs.next().unwrap().starts_with("```"), "{name}: show the example next");
        }
    }
}
