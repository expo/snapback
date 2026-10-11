//! Card discovery and the schema-evolution recipe.
use super::{ALIASES, KEYWORDS, SERVER_KEYWORDS};

pub fn listing() -> String {
    format!("cards: {}\nwith use server: {}\nStart here: snapback4 guide start (eight short patterns; guide <card> for reference).\nLarge cards: guide <card> --sections lists headings; guide <card> --section <heading> prints one.\nMessaging app: snapback4 new <dir> --template social; guide social carries the client recipes.\nBackground notifications: snapback/workers/<service>.mjs runs with dev and serve; guide effects shows ledger: true and provider idempotency.\naliases: {}", KEYWORDS.iter().filter(|word| !SERVER_KEYWORDS.contains(word)).copied().collect::<Vec<_>>().join(", "), SERVER_KEYWORDS.join(", "), ALIASES.iter().map(|(word, target)| format!("{word} -> {target}")).collect::<Vec<_>>().join(", "))
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

/// Rank names and aliases first, then exact words in card contents, then typos.
pub fn nearest(word: &str) -> Vec<&'static str> {
    let word = word.to_lowercase();
    let score = |term: &str| (!term.contains(&word) && !word.contains(term), distance(&word, term));
    let mut cards: Vec<_> = KEYWORDS.iter().map(|&card| {
        let best = ALIASES.iter().filter(|(_, target)| *target == card).map(|(alias, _)| score(alias)).chain([score(card)]).min().unwrap();
        let in_card = super::card(card).is_some_and(|text| text.split(|c: char| !c.is_alphanumeric()).any(|token| token.eq_ignore_ascii_case(&word)));
        let rank = if !best.0 { 0 } else if in_card { 1 } else { 2 };
        ((rank, in_card && card != "language", best.1), card)
    }).collect();
    cards.sort_unstable();
    let mut nearest: Vec<_> = cards.into_iter().take(3).map(|(_, card)| card).collect();
    if super::LANGUAGE.split(|c: char| !c.is_alphanumeric()).any(|token| token.eq_ignore_ascii_case(&word)) && !nearest.contains(&"language") {
        nearest[2] = "language";
    }
    nearest
}

pub(super) const EVOLUTION: &str = r##"# Evolution: adopting a schema

Schema adoption applies a new backend definition to existing data.
The stored rows must fit the new types, keys and constraints.

```quarry
table notes:
  body: text <=200
  archived: bool default false  -- fills this field in older rows
  label: text <=40 ?            -- older rows read null
  read <- .owner = viewer
  owner: principal
```

New optional columns, required columns with literal defaults, non-unique
indexes, tables and operations adopt without ceremony. Literal defaults
fill older row images on the server and device, including in new indexes,
without rewriting stored rows or logging partition events.

Required columns without literal defaults, tighter types, unique indexes
and stronger constraints need the existing rows to fit. A new required
`default now` or `default viewer` column needs an empty table.

## Operations

Run `snapback4 check` against the dev store, or `check --store <path>`:
each failed successor step is E_ADOPT at its column, index or table, with
a rewrite. `dev` refuses that step on save and keeps the previous generation.
A green check means the current rows fit; a later write can change that.
Without a store, check only compiles. This is `guide evolution`; client development commands are in CLIENT-AND-OPERATIONS.md §5."##;

/// A card's `##`/`###` headings outside code fences: (level, heading, first line, end line).
pub fn sections(card: &str) -> Vec<(usize, String, usize, usize)> {
    let lines: Vec<&str> = card.lines().collect();
    let mut fenced = false;
    let mut found: Vec<(usize, String, usize, usize)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if line.trim_start().starts_with("```") { fenced = !fenced; continue; }
        if fenced { continue; }
        let level = line.chars().take_while(|c| *c == '#').count();
        if !(2..=3).contains(&level) || !line[level..].starts_with(' ') { continue; }
        found.push((level, line[level..].trim().to_owned(), index, lines.len()));
    }
    // A section runs to the next heading at its level or above.
    for i in 0..found.len() {
        let level = found[i].0;
        if let Some(next) = found[i + 1..].iter().find(|next| next.0 <= level) { found[i].3 = next.2; }
    }
    found
}

/// `guide <card> --sections`: the heading index, one line per section.
pub fn section_index(name: &str, card: &str) -> String {
    let found = sections(card);
    if found.is_empty() { return format!("{name}: one section ({} lines); print it with snapback4 guide {name}", card.lines().count()); }
    let mut out = format!("{name}: {} lines; snapback4 guide {name} --section <heading> prints one\n", card.lines().count());
    for (level, heading, start, end) in &found {
        out.push_str(&format!("{}{heading} ({} lines)\n", "  ".repeat(level - 2), end - start));
    }
    out.trim_end().to_owned()
}

/// `guide <card> --section <heading>`: the title line and the one section whose
/// heading equals the words (any case), or else uniquely contains them.
pub fn section(name: &str, card: &str, words: &str) -> Result<String, String> {
    let found = sections(card);
    let wanted = words.trim().to_lowercase();
    let exact: Vec<_> = found.iter().filter(|s| s.1.to_lowercase() == wanted).collect();
    let matches = if exact.is_empty() { found.iter().filter(|s| !wanted.is_empty() && s.1.to_lowercase().contains(&wanted)).collect() } else { exact };
    match matches.as_slice() {
        [(_, _, start, end)] => {
            let lines: Vec<&str> = card.lines().collect();
            let title = lines.first().filter(|line| line.starts_with("# ")).map(|line| format!("{line}\n\n")).unwrap_or_default();
            Ok(format!("{title}{}", lines[*start..*end].join("\n").trim_end()))
        }
        [] => Err(format!("no section of guide {name} matches {words:?}\n{}", section_index(name, card))),
        many => Err(format!("{words:?} matches {} sections of guide {name}: {}; use more of the heading", many.len(), many.iter().map(|s| s.1.as_str()).collect::<Vec<_>>().join(" · "))),
    }
}
