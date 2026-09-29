//! A fact must be reachable in actual rendered output, never just its source.
use snapback4_lang::guide::{card, explain_code, quarry, WHY_MAX_BYTES};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

fn normalized(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }
#[test]
fn check_output_guidance_distinguishes_summaries_from_verbose_details() {
    let bounds = card("bounds").unwrap();
    assert!(bounds.contains("Default text `check` gives note summaries"));
    assert!(bounds.contains("`check --verbose` adds rewrites"));
    assert!(!bounds.contains("Every successful `check` summarizes"));
    assert!(!super::README.contains("`snapback4 check` ends with a scale line"));
    for name in ["maintains", "search"] {
        let text = card(name).unwrap();
        assert!(!text.contains("`check` prints this key"), "{name}");
        assert!(!text.contains("With horizon-free sources, `check` reports"), "{name}");
    }
    let held = explain_code("E_QUERY_HELD").unwrap();
    assert!(!held.contains("`check` prints\n`runs: device"));
}

#[derive(Deserialize)]
struct Fact { id: String, card: String, home: String, text: String }
#[test]
fn every_moved_fact_has_its_why_or_details_home() {
    let facts: Vec<Fact> = serde_json::from_str(include_str!("../fixtures/guide-fact-homes.json")).unwrap();
    assert_eq!(facts.len(), 133, "review additions/removals to the baseline fact inventory");
    let mut ids = BTreeSet::new();
    for fact in facts {
        assert!(ids.insert(fact.id.clone()), "duplicate fact {}", fact.id);
        let home = if fact.home == "Details" {
            card(&fact.card).unwrap().split_once("## Details").unwrap().1.to_owned()
        } else {
            let why = explain_code(&fact.home).unwrap_or_else(|| panic!("{} lost {}", fact.id, fact.home));
            assert!(why.len() + 1 <= WHY_MAX_BYTES, "{} is too large: {} bytes", fact.home, why.len()+1);
            assert!(!why.contains("[excerpt truncated]"), "{} is not fully reachable", fact.home);
            // CLI why selects the current project's matching diagnostic card.
            // That context must not replace moved facts with an opening fallback.
            for keyword in snapback4_lang::guide::KEYWORDS {
                let contextual = snapback4_lang::Diagnostic::new(&Default::default(), &fact.home, "", "")
                    .guide(keyword).explanation().unwrap();
                assert!(contextual.len() + 1 <= WHY_MAX_BYTES, "{} / {keyword}: too large", fact.home);
                assert!(normalized(&contextual).contains(&normalized(&fact.text)), "{} lost its home with {keyword} context", fact.id);
            }
            why
        };
        assert!(normalized(&home).contains(&normalized(&fact.text)), "{} lost its {} home", fact.id, fact.home);
    }
}
#[derive(Deserialize)]
struct Before { words: usize, opening_words: usize, blocks: Vec<String> }
#[test]
fn cards_meet_word_targets_and_preserve_every_original_compiled_block() {
    use sha2::{Digest, Sha256};
    let before: BTreeMap<String, Before> = serde_json::from_str(include_str!("../fixtures/guide-before.json")).unwrap();
    let mut old_total = 0;
    let mut total = 0;
    for (name, old) in before {
        let text = card(&name).unwrap();
        let words = text.split_whitespace().count();
        let opening = text.split_once("## Limits").unwrap().0.split_whitespace().count();
        assert!(opening * 3 <= old.opening_words, "{name}: opening {opening}, before {}", old.opening_words);
        let hashes: BTreeSet<_> = quarry(text).iter().map(|s| format!("{:x}", Sha256::digest(s.as_bytes()))).collect();
        for hash in old.blocks { assert!(hashes.contains(&hash), "{name} lost compiled block {hash}"); }
        old_total += old.words;
        total += words;
    }
    assert!(total * 100 <= old_total * 70, "{old_total} -> {total}: less than 30% reduction");
}
#[test]
fn the_rosetta_card_is_reachable_and_covers_the_requested_idioms() {
    let rosetta = card("from-sql").unwrap();
    for alias in ["sql", "convex", "rosetta"] { assert_eq!(card(alias), Some(rosetta)); }
    assert!(card("language").unwrap().split_once("```quarry").unwrap().0.contains("guide from-sql"));
    assert!(include_str!("../../../../packages/snapback4/README.md").lines().take(15).any(|line| line.contains("guide from-sql")));
    for idiom in ["NOT NULL", "DEFAULT", "PRIMARY KEY", "REFERENCES", "UNIQUE", "CHECK", "ORDER BY", "Keyset", "OFFSET", "LEFT JOIN", "Correlated", "EXISTS", "IN (...)", "GROUP BY", "SUM", "Full-text", "RLS", "Trigger", "after insert", "Cron", "TTL", "ON DELETE CASCADE", "Soft delete", "Convex `query`", "Convex `mutation`", "Convex `action`", "ctx.db.query().withIndex().order().paginate()", "ctx.auth", "Scheduled action"] {
        assert!(rosetta.contains(idiom), "missing {idiom}");
    }
}
