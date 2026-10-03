//! Shared compilation context for every published-guide corpus witness.
use snapback4_lang::guide::{card, quarry, TEMPLATE};

// The published grouped-search examples teach this precise words-preview note.
// Require it before checking the remaining notes; an empty note list must fail.
pub fn without_grouped_shape_note<'a>(bound: &'a snapback4_lang::Bound, query: &str) -> Vec<&'a snapback4_lang::Diagnostic> {
    let program = &bound.programs.iter().find(|p| p.program.name == query || p.program.name.ends_with(&format!(".{query}"))).unwrap().program;
    let words = snapback4_core::ir::scans(program).into_iter().find(|scan| !scan.existence
        && scan.prefix.iter().any(|key| matches!(key, snapback4_core::ir::IndexKeyExpr::WordPrefix(_)))).unwrap();
    let (shape, remaining): (Vec<_>, Vec<_>) = bound.notes.iter().partition(|note| note.code == "N_SHAPE_METER");
    assert_eq!(shape.len(), 1, "{query}: {:?}", bound.notes);
    assert!(shape[0].message.starts_with(&format!("query {query} shape field `hits`"))
        && shape[0].message.contains(&format!("read {} on messages:", words.site)), "{:?}", shape[0]);
    remaining
}

// Small excerpts are checked in their exact, already-compiled reference recipe.
// This is an explicit context list, not an exemption from binding or note checks.
pub fn source(block: &str) -> String {
    if TEMPLATE.contains(block.trim()) { return TEMPLATE.to_owned(); }
    for name in ["maintains", "rules", "search", "feeds"] {
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
