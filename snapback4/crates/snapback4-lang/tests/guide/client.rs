use super::card;
#[path = "published.rs"]
mod published;

#[test]
fn client_aliases_keep_typing_on_ephemeral() {
    let client = card("client").unwrap();
    assert!(client.lines().count() <= 130);
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
