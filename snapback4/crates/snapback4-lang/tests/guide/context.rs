//! Shared compilation context for every published-guide corpus witness.
use snapback4_lang::guide::{card, quarry, TEMPLATE};

// Small excerpts are checked in their exact, already-compiled reference recipe.
// This is an explicit context list, not an exemption from binding or note checks.
pub fn source(block: &str) -> String {
    if TEMPLATE.contains(block.trim()) { return TEMPLATE.to_owned(); }
    for name in ["maintains", "search", "feeds"] {
        let text = card(name).unwrap();
        let (opening, reference) = text.split_once("\n## Reference").unwrap();
        if quarry(opening).iter().any(|example| example == block) {
            return quarry(reference).into_iter().find(|recipe| recipe.contains(block.trim()))
                .unwrap_or_else(|| panic!("{name}: excerpt must occur verbatim in a complete compiled recipe"));
        }
    }
    if block.lines().any(|line| line.trim_start().starts_with("table ")) { block.to_owned() }
    else { format!("{}\n{block}", snapback4_lang::guide::language()) }
}
