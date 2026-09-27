//! Editorial regressions exercise rendered cards and the actual `why` selector.
use snapback4_lang::guide::{KEYWORDS, card, explain_code};
#[path = "refusal_actions.rs"]
mod refusal_actions;

fn normalize(text: &str) -> String { text.split_whitespace().collect::<Vec<_>>().join(" ") }

// Exclude the registered one-line explanation: the card excerpt must carry
// the definition independently, including when printed by repeated diagnostics.
fn excerpt(text: &str) -> String {
    normalize(&text.lines().skip_while(|line| !line.starts_with('#'))
        .take_while(|line| !line.starts_with("Full card:")).collect::<Vec<_>>().join("\n"))
}

#[test]
fn why_bound_defines_the_ceiling_and_withheld_count() {
    let text = excerpt(&explain_code("E_BOUND").unwrap());
    for fact in ["8,192 rows examined", "1,024 rows written per mutation", "a mutation aborts with E_BOUND naming the meter, the ceiling and the site", "never the count: it would measure rows the viewer may not read"] {
        assert!(text.contains(fact), "why E_BOUND excerpt omits {fact}: {text}");
    }
    assert!(!text.contains("as above"));
}

#[test]
fn why_rule_carries_the_target_visibility_contract() {
    let text = excerpt(&explain_code("E_RULE").unwrap());
    // Each sentence is paired with a write-executing test in rules.rs.
    let facts = [
        // [rules::insert_rule_refusals](rules.rs)
        "`insert` and `insert ... if absent` return E_RULE when the insert rule denies the viewer.",
        // [rules::insert_collision_visibility](rules.rs)
        "A unique clash with a hidden row returns E_RULE for either insert form.",
        // [rules::insert_collision_visibility](rules.rs)
        "For a readable secondary unique clash without a custom refusal, ordinary insert returns E_CONSTRAINT naming the index, while `insert ... if absent` succeeds with null.",
        // [rules::update_rule_refusals](rules.rs)
        "If the update rule denies an update or upsert-patch, it returns E_RULE for a readable target and NOT_FOUND for an unreadable target.",
        // [rules::admitted_hidden_updates](rules.rs)
        "A valid update or upsert-patch admitted by the update rule can change a hidden row; if the resulting row remains hidden, it returns null.",
        // [rules::update_collision_visibility](rules.rs)
        "Without a custom unique refusal, an update or upsert-patch with a secondary unique clash returns NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is unreadable, and E_CONSTRAINT naming the index if both are readable.",
        // [rules::update_rule_refusals / update_conditions / update_collision_visibility](rules.rs)
        "For rule denial, an update condition or a secondary unique clash on an unreadable target, NOT_FOUND carries no row, index, column or branch detail.",
        // [rules::missing_update_and_incomplete_upsert](rules.rs)
        "A missing update target or an incomplete upsert insert patch returns NOT_FOUND.",
        // [rules::update_conditions](rules.rs)
        "An update condition on an unreadable target returns NOT_FOUND even if it would match; on a readable target, a false condition returns E_CONFLICT with a read-rule `current`.",
        // [rules::delete_rule_refusals](rules.rs)
        "Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses.",
        // [rules::admitted_hidden_updates](rules.rs)
        "Reading a hidden row returns null.",
        // [rules::update_rule_refusals / admitted_hidden_updates / missing_update_and_incomplete_upsert](rules.rs)
        "Use a write admitted by its rule; NOT_FOUND on an update or upsert-patch does not prove absence.",
    ];
    assert!(text.starts_with(&format!("# Rules {}", facts.join(" "))), "the original write-executing witness paragraph must stay intact: {text}");
}

#[test]
fn search_membership_heading_is_a_separate_output_line() {
    assert!(card("search").unwrap().lines().any(|line| line == "## Search every chat I'm in"));
}

#[test]
fn every_card_separates_headings_from_prose() {
    for name in KEYWORDS {
        let mut fence = None;
        let mut previous_blank = true;
        for line in card(name).unwrap().lines() {
            let trimmed = line.trim_start();
            if let Some(marker) = fence {
                if trimmed.starts_with(marker) { fence = None; }
            } else if let Some(marker) = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m)) {
                fence = Some(marker);
            } else if let Some(at) = line.find("# ") {
                assert!(line[..at].chars().all(|c| c == '#' || c.is_whitespace()), "{name}: heading glued to prose: {line}");
                assert!(previous_blank, "{name}: blank line missing before heading: {line}");
            }
            previous_blank = trimmed.is_empty();
        }
    }
}

#[test]
// @ref LLP 3000.007#20.19 — the first matching paragraph must define the code, not merely mention it.
fn w11_every_registered_code_quotes_its_definition() {
    use std::collections::BTreeSet;
    let registered = snapback4_lang::guide::codes().into_iter().collect::<BTreeSet<_>>();
    let pinned = DEFINITIONS.iter().map(|(code, _)| *code).collect::<BTreeSet<_>>();
    assert_eq!(registered, pinned, "review a defining fact for each registered code");
    assert_eq!(pinned.len(), DEFINITIONS.len(), "duplicate definition pin");
    let actionable = refusal_actions::ACTIONS.iter().map(|(code, _)| *code).collect::<BTreeSet<_>>();
    assert_eq!(registered, actionable, "review recovery and boundary facts for every code");
    assert_eq!(actionable.len(), refusal_actions::ACTIONS.len(), "duplicate action pin");
    let mut missing = Vec::new();
    for &(code, fact) in DEFINITIONS {
        let why = explain_code(code).unwrap();
        let inline = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "")
            .explanation_section().unwrap();
        assert_eq!(why, inline, "{code}: CLI and repeated diagnostics must agree");
        if !excerpt(&why).contains(fact) { missing.push(format!("{code}: {fact}")); }
    }
    for &(code, facts) in refusal_actions::ACTIONS {
        assert!(!facts.is_empty(), "{code}: no recovery facts");
        let text = excerpt(&explain_code(code).unwrap());
        for fact in facts {
            if !text.contains(fact) { missing.push(format!("{code} action/boundary: {fact}")); }
        }
    }
    assert!(missing.is_empty(), "first card paragraph lacks its defining fact:\n{}", missing.join("\n"));
}

// Hand-reviewed defining facts from every default-card excerpt. Keep these
// independent of the paragraph selector: do not regenerate them to bless a new
// first mention. Whitespace may change; the reason for the code must survive.
const DEFINITIONS: &[(&str, &str)] = &[
    ("E_DELIVERY_BINDING", "a report's binding changed or was removed"),
    ("E_DELIVERY_CLAUSE", "requires exactly a reference to the group table and two `int` arguments"),
    ("RUNS_FULL", "`RUNS_FULL` refuses a disjoint 65th run"),
