//! Card discovery and the schema-evolution recipe.
use super::{ALIASES, KEYWORDS};

pub fn listing() -> String {
    format!("cards: {}\naliases: {}", KEYWORDS.join(", "), ALIASES.iter().map(|(word, target)| format!("{word} -> {target}")).collect::<Vec<_>>().join(", "))
}

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, a) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, b) in b.iter().enumerate() {
            let old = row[j + 1];
            row[j + 1] = (diagonal + usize::from(a != *b)).min(row[j] + 1).min(old + 1);
            diagonal = old;
        }
    }
    row[b.len()]
}

/// Rank each card by its closest keyword or alias; show three distinct cards.
pub fn nearest(word: &str) -> Vec<&'static str> {
    let word = word.to_lowercase();
    let score = |term: &str| (!term.contains(&word) && !word.contains(term), distance(&word, term));
    let mut cards: Vec<_> = KEYWORDS.iter().map(|&card| {
        let best = ALIASES.iter().filter(|(_, target)| *target == card).map(|(alias, _)| score(alias)).chain([score(card)]).min().unwrap();
        (best, card)
    }).collect();
    cards.sort_unstable();
    cards.into_iter().take(3).map(|(_, card)| card).collect()
}

pub(super) const EVOLUTION: &str = r##"# Evolution: adopting a schema

New optional columns, required columns with literal defaults, non-unique
indexes, tables and operations adopt without ceremony. Literal defaults
fill older row images on the server and device, including in new indexes,
without rewriting stored rows or logging partition events.

Required columns without literal defaults, tighter types, unique indexes
and stronger constraints need the existing rows to fit. A new required
`default now` or `default viewer` column needs an empty table.

Run `snapback4 check` against the dev store, or `check --store <path>`:
each failed successor step is E_ADOPT at its column, index or table, with
a rewrite. `dev` refuses that step on save and keeps the previous generation.
A green check means the current rows fit; a later write can change that.
Without a store, check only compiles. See package README §5, Schema evolution."##;
