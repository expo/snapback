//! Card discovery and the schema-evolution recipe.
use super::{ALIASES, KEYWORDS, SERVER_KEYWORDS};

pub fn listing() -> String {
    format!("cards: {}\nwith use server: {}\nStart here: snapback4 guide start (eight short patterns; guide <card> for reference).\nOne screen of the common forms: snapback4 guide cheatsheet; package exports: guide api.\nCards over {FULL_LINES} lines print their opening and a numbered section index: guide <card> --section <heading or number> prints one (a topic word prints the section that mentions it most), --find <words> prints matching lines (a|b for either), --full prints the whole card.\nMessaging app: snapback4 new <dir> --template social; guide social carries the client recipes.\nBackground notifications: snapback/workers/<service>.mjs runs with dev and serve; guide effects shows ledger: true and provider idempotency.\naliases: {}", KEYWORDS.iter().filter(|word| !SERVER_KEYWORDS.contains(word)).copied().collect::<Vec<_>>().join(", "), SERVER_KEYWORDS.join(", "), ALIASES.iter().map(|(word, target)| format!("{word} -> {target}")).collect::<Vec<_>>().join(", "))
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

// @ref LLP 3000.007#20.1 — a card longer than a tool window prints its opening and a numbered index; --full prints it whole.
/// Cards up to this many lines print whole. Above it, `guide <card>` prints
/// the card's opening and a numbered section index: agents batch several
/// cards per command and their tools truncate long output (the start card,
/// 124 lines at most, stays whole).
pub const FULL_LINES: usize = 130;
/// The most opening lines the overview prints before its section index.
const OPENING_LINES: usize = 40;

/// Lowercase words, punctuation and backticks dropped: `sync to` == "Sync to".
fn words_of(text: &str) -> String {
    text.chars().map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { ' ' }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where the opening (the text before the first `##`) ends.
fn opening_end(card: &str, found: &[(usize, String, usize, usize)]) -> usize {
    found.first().map(|s| s.2).unwrap_or_else(|| card.lines().count())
}

fn index_lines(card: &str, found: &[(usize, String, usize, usize)]) -> String {
    let opening = opening_end(card, found);
    let mut out = String::new();
    if opening > 5 { out.push_str(&format!("    0. Opening ({opening} lines)\n")); }
    for (n, (level, heading, start, end)) in found.iter().enumerate() {
        out.push_str(&format!("{}{:>2}. {heading} ({} lines)\n", "   ".repeat(level - 1), n + 1, end - start));
    }
    out
}

/// `guide <card>` for a card over [`FULL_LINES`]: its title, then how to read
/// more, then its opening cut at a paragraph boundary, then the numbered
/// section index (and the ways to read more again). `None` when the card
/// prints whole.
// @ref LLP 3000.007#20.1 — the run-on hint sits under the title, so a short opening never reads as the whole card (wave 4).
pub fn overview(name: &str, card: &str) -> Option<String> {
    let total = card.lines().count();
    let found = sections(card);
    if total <= FULL_LINES || found.is_empty() { return None; }
    let lines: Vec<&str> = card.lines().collect();
    let first = opening_end(card, &found);
    // The opening's paragraph boundaries outside fences; keep the title and lead at least.
    let mut cut = first;
    if first > OPENING_LINES {
        let (mut fenced, mut boundaries) = (false, Vec::new());
        for (i, line) in lines[..first].iter().enumerate() {
            if line.trim_start().starts_with("```") { fenced = !fenced; }
            else if !fenced && line.trim().is_empty() { boundaries.push(i); }
        }
        cut = boundaries.iter().copied().filter(|&b| b <= OPENING_LINES).max().unwrap_or(first);
        if let Some(&lead_end) = boundaries.get(1) { cut = cut.max(lead_end.min(first)); }
    }
    // The title line, then the hint in the same paragraph, then the rest of the opening.
    let hint = format!("(This is the opening and section index of a {total}-line card: snapback4 guide {name} --section <number or words> prints one section · --find <words> prints matching lines · --full prints all of it.)");
    let mut out = match lines.first().filter(|line| line.starts_with("# ")) {
        Some(title) => format!("{title}\n{hint}\n{}", lines[1..cut].join("\n")),
        None => format!("{hint}\n\n{}", lines[..cut].join("\n")),
    }.trim_end().to_owned();
    out.push_str(&format!("\n\nSections of guide {name}:\n"));
    out.push_str(&index_lines(card, &found));
    out.push_str(&format!("More: snapback4 guide {name} --section <number or words> prints one section · --find <words> prints matching lines · --full prints all {total} lines"));
    Some(out)
}

/// `guide <card> --sections`: the numbered heading index, one line per section.
pub fn section_index(name: &str, card: &str) -> String {
    let found = sections(card);
    if found.is_empty() { return format!("{name}: one section ({} lines); print it with snapback4 guide {name} --full", card.lines().count()); }
    let mut out = format!("{name}: {} lines; snapback4 guide {name} --section <number or words> prints one\n", card.lines().count());
    out.push_str(&index_lines(card, &found));
    out.trim_end().to_owned()
}

/// The innermost section holding a line: its number (0 for the opening) and heading.
fn section_of(found: &[(usize, String, usize, usize)], line: usize) -> (usize, &str) {
    found.iter().enumerate().filter(|(_, s)| s.2 <= line && line < s.3).max_by_key(|(_, s)| s.0)
        .map(|(n, s)| (n + 1, s.1.as_str())).unwrap_or((0, "Opening"))
}

/// Line numbers (0-based) whose text holds the phrase, or else every one of its
/// words; `a|b` is either alternative (wave 4 searched `sum|outer|column`).
fn mentions(card: &str, words: &str) -> Vec<usize> {
    if words.contains('|') {
        let mut found: Vec<usize> = words.split('|').flat_map(|alternative| mentions(card, alternative)).collect();
        found.sort_unstable();
        found.dedup();
        return found;
    }
    let phrase = words.trim().to_lowercase();
    if phrase.is_empty() { return Vec::new(); }
    let lines: Vec<String> = card.lines().map(str::to_lowercase).collect();
    let exact: Vec<usize> = (0..lines.len()).filter(|&i| lines[i].contains(&phrase)).collect();
    if !exact.is_empty() { return exact; }
    let each: Vec<String> = words_of(&phrase).split(' ').map(str::to_owned).collect();
    (0..lines.len()).filter(|&i| { let line = words_of(&lines[i]); each.iter().all(|w| line.contains(w.as_str())) }).collect()
}

/// `guide <card> --section <words>`: the title line and one section, found by
/// its number in the index (`0` or `opening` for the text before the first
/// heading), its heading (any case, punctuation ignored), a unique prefix, a
/// unique substring, or headings holding every word. When no heading matches
/// but the words occur, the section holding most of their mentions prints, or
/// every mention when they spread; only words no line mentions refuse, naming
/// the nearest heading by spelling.
pub fn section(name: &str, card: &str, words: &str) -> Result<String, String> {
    let found = sections(card);
    let lines: Vec<&str> = card.lines().collect();
    let title = lines.first().filter(|line| line.starts_with("# ")).map(|line| format!("{line}\n\n")).unwrap_or_default();
    let wanted = words_of(words);
    let print = |start: usize, end: usize| format!("{title}{}", lines[start..end].join("\n").trim_end());
    let opening = opening_end(card, &found);
    if matches!(wanted.as_str(), "0" | "opening" | "intro" | "introduction") {
        return Ok(lines[..opening].join("\n").trim_end().to_owned());
    }
    if let Ok(n) = wanted.parse::<usize>() {
        return match found.get(n.wrapping_sub(1)) {
            Some((_, _, start, end)) => Ok(print(*start, *end)),
            None => Err(format!("guide {name} has no section {n}\n{}", section_index(name, card))),
        };
    }
    let numbered: Vec<(usize, &(usize, String, usize, usize), String)> = found.iter().enumerate().map(|(n, s)| (n + 1, s, words_of(&s.1))).collect();
    let stages: [&dyn Fn(&str) -> bool; 4] = [
        &|heading| heading == wanted,
        &|heading| heading.starts_with(&wanted),
        &|heading| heading.contains(&wanted),
        &|heading| wanted.split(' ').all(|w| heading.split(' ').any(|h| h.starts_with(w))),
    ];
    for stage in stages {
        if wanted.is_empty() { break; }
        let matches: Vec<_> = numbered.iter().filter(|(_, _, heading)| stage(heading)).collect();
        match matches.as_slice() {
            [] => continue,
            [(_, (_, _, start, end), _)] => return Ok(print(*start, *end)),
            many => return Err(format!("{words:?} matches {} sections of guide {name}: {}; pick one by number: snapback4 guide {name} --section {}", many.len(), many.iter().map(|(n, s, _)| format!("{n}. {}", s.1)).collect::<Vec<_>>().join(" · "), many[0].0)),
        }
    }
    // No heading matches. When the words occur, print the section holding most
    // of their mentions, or every mention when no section holds most of them.
    // @ref LLP 3000.007#20.1 — a topic word (audience, React, Reference) prints what it names instead of failing (wave 4).
    let hits = mentions(card, words);
    if !hits.is_empty() {
        let mut counts: Vec<(usize, usize)> = Vec::new();
        for &i in &hits {
            let (n, _) = section_of(&found, i);
            match counts.iter_mut().find(|(section, _)| *section == n) { Some(entry) => entry.1 += 1, None => counts.push((n, 1)) }
        }
        let &(best, count) = counts.iter().max_by_key(|(n, count)| (*count, std::cmp::Reverse(*n))).expect("a hit has a section");
        if count * 2 > hits.len() {
            let (heading, start, end) = if best == 0 { ("Opening", 0, opening) } else { let s = &found[best - 1]; (s.1.as_str(), s.2, s.3) };
            let share = match (hits.len(), count == hits.len()) {
                (1, _) => "the one line that mentions it".to_owned(),
                (total, true) => format!("all {total} lines that mention it"),
                (total, false) => format!("{count} of the {total} lines that mention it (--find {words:?} prints them all)"),
            };
            let note = format!("No heading of guide {name} is named {words:?}; {best}. {heading} holds {share}.");
            let body = if best == 0 { lines[start..end].join("\n").trim_end().to_owned() } else { print(start, end) };
            return Ok(format!("{note}\n\n{body}"));
        }
        let note = format!("No heading of guide {name} is named {words:?}, and its mentions span {} sections; here they are:\n", counts.len());
        return find(name, card, words).map(|lines| format!("{note}{lines}"));
    }
    // A miss: the nearest heading by spelling (a typo), and the index.
    let mut out = format!("no section of guide {name} is named {words:?}, and no line mentions it");
    let mut near: Vec<(usize, usize, &str)> = numbered.iter().map(|(n, s, heading)| {
        let best = heading.split(' ').map(|h| distance(&wanted, h)).chain([distance(&wanted, heading)]).min().unwrap_or(usize::MAX);
        (best, *n, s.1.as_str())
    }).collect();
    near.sort();
    if let Some(&(_, n, heading)) = near.first().filter(|(best, _, _)| *best <= wanted.chars().count().div_ceil(2)) {
        out.push_str(&format!("; nearest heading: {n}. {heading}"));
    }
    Err(format!("{out}\n{}", section_index(name, card)))
}

/// The most lines `--find` prints before it summarizes the rest.
const FIND_LINES: usize = 80;

/// `guide <card> --find <words>`: every line holding the words (the phrase, or
/// else each word), with a line of context, under its section's number and heading.
pub fn find(name: &str, card: &str, words: &str) -> Result<String, String> {
    let found = sections(card);
    let lines: Vec<&str> = card.lines().collect();
    let hits = mentions(card, words);
    if hits.is_empty() {
        return Err(format!("no line of guide {name} mentions {words:?}\n{}", section_index(name, card)));
    }
    // Merge each hit's one line of context into ranges.
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for &i in &hits {
        let (start, end) = (i.saturating_sub(1), (i + 2).min(lines.len()));
        match ranges.last_mut() { Some(last) if start <= last.1 => last.1 = end, _ => ranges.push((start, end)) }
    }
    let mut out = format!("guide {name}: {} line{} mention {words:?}\n", hits.len(), if hits.len() == 1 { "" } else { "s" });
    let (mut printed, mut shown, mut current) = (0, 0, usize::MAX);
    for (start, end) in ranges {
        if printed >= FIND_LINES { break; }
        let (n, heading) = section_of(&found, start.max(hits.iter().copied().find(|&h| h >= start).unwrap_or(start)));
        if n != current { out.push_str(&format!("{n}. {heading}\n")); current = n; } else { out.push_str("  …\n"); }
        for (i, line) in lines.iter().enumerate().take(end).skip(start) {
            let hit = hits.binary_search(&i).is_ok();
            out.push_str(&format!("{:>5}{} {line}\n", i + 1, if hit { ':' } else { ' ' }));
            printed += 1;
            shown += usize::from(hit);
        }
    }
    if shown < hits.len() { out.push_str(&format!("… {} more; narrow the words or read one section with --section <number>\n", hits.len() - shown)); }
    out.push_str(&format!("Whole sections: snapback4 guide {name} --section <number>"));
    Ok(out)
}
