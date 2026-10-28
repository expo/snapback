//! Card discovery and the schema-evolution recipe.
use super::{ALIASES, KEYWORDS, SERVER_KEYWORDS};

// @ref LLP 3000.007#20.1 — the ~200 aliases moved behind `guide aliases`; the bare listing stays one screen.
pub fn listing() -> String {
    format!("cards: {}\nwith use server: {}\nBy task: snapback4 guide tasks (exact commands for sign-in, roles, uploads, deadlines and proofs).\nStart here: snapback4 guide start (one compiling schema; read feature sections on demand).\nExact signatures: guide api proof | client | auth | generated. Do not read the cheatsheet before start.\nCards over {FULL_LINES} lines or {FULL_BYTES} bytes print content (opening and first section) plus a truncation hint and section index. Narrow with guide <card> --section <heading or number> prints one (a topic word prints the section that mentions it most), --find <words> prints the lines holding every word (a|b or a OR b for either), --full lists bounded sections.\nMessaging app: snapback4 new <dir> --template social; guide social carries the client recipes.\nBackground notifications: snapback/workers/<service>.mjs runs with dev and serve; guide effects shows ledger: true and provider idempotency.\nAliases: {} words open a card, or one section of it (pagination, roles, capacity, aggregates, …); snapback4 guide aliases lists them.", KEYWORDS.iter().filter(|word| !SERVER_KEYWORDS.contains(word)).copied().collect::<Vec<_>>().join(", "), SERVER_KEYWORDS.join(", "), ALIASES.len())
}

/// `guide aliases`: every alias, one per line, with the card (and section) it opens.
pub fn aliases() -> String {
    let mut out = format!("{} aliases; `snapback4 guide <alias>` prints what it names (`--full` lists bounded sections for large cards):\n", ALIASES.len());
    for (word, target) in ALIASES {
        match super::alias_section(word) {
            Some((_, heading)) => out.push_str(&format!("{word} -> {target} --section {heading:?}\n")),
            None => out.push_str(&format!("{word} -> {target}\n")),
        }
    }
    out.trim_end().to_owned()
}

/// The section number (1-based, as the index numbers it) and heading whose
/// words start with `heading`'s: how an alias's section is found.
fn numbered_heading(card: &str, heading: &str) -> Option<(usize, String)> {
    let wanted = words_of(heading);
    sections(card).into_iter().enumerate().find(|(_, s)| words_of(&s.1).starts_with(&wanted)).map(|(n, s)| (n + 1, s.1))
}

/// `guide <alias>` for an alias that names a section of `card` (the card
/// `name`, as printed): the title, a line saying where this is and how to
/// read the rest, then the section. `None` for an alias of a whole card.
pub fn alias_landing(word: &str, name: &str, card: &str) -> Option<String> {
    let (target, heading) = super::alias_section(word)?;
    if target != name { return None; }
    let (n, heading) = numbered_heading(card, heading)?;
    let (_, _, start, end) = sections(card).into_iter().nth(n - 1)?;
    let lines: Vec<&str> = card.lines().collect();
    let title = lines.first().filter(|line| line.starts_with("# ")).copied().unwrap_or_default();
    Some(format!("{title}\n({} -> guide {name}, section {n}. {heading}; the section list: snapback4 guide {name} --full · its sections: --sections)\n\n{}",
        word.trim(), lines[start..end].join("\n").trim_end()))
}

/// `--section`/`--find` with an alias of this card that no heading or line
/// holds: the section it names, or the card's opening for a whole-card alias.
fn alias_inside(name: &str, card: &str, words: &str) -> Option<String> {
    if let Some(landing) = alias_landing(words, name, card) { return Some(landing); }
    if super::resolve(words.trim()) != Some(name) || KEYWORDS.contains(&words.trim()) { return None; }
    let found = sections(card);
    let lines: Vec<&str> = card.lines().collect();
    Some(format!("{} is an alias of the whole guide {name} card, which no line names; here is its opening (the rest: --sections, --full):\n\n{}",
        words.trim(), lines[..opening_end(card, &found)].join("\n").trim_end()))
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

// @ref LLP 3000.000.000#21 — extraction widening and guarded rollback use the reviewed release contract.
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
Without a store, check only compiles.

## Release rollback and hot activation

`deploy <dir>` and `rollback <dir> [--to N]` activate atomically while `serve`
is running. Rollback keeps removed durable tables, columns and index definitions
as dormant storage, invisible to old programs and sync. Forward restores their
values. Older updates preserve dormant cells; deletion removes them. New older-
release rows receive the forward literal default or optional null. A required
field can declare a conditional/derived `backfill` in the candidate schema;
deploy previews exact transformed-row counts and commits the patch with the
release. Keep declarations across later releases; rollback restores untouched
preimages or names a conflict, and forward catches up older writes. Contextual
defaults never invent history. `guide deploy` contains the complete persistent
production recipe. REL5 owns release selection and compatibility narration.

An incompatible enum/text/type value becomes a dormant row during release activation,
with its original values restored on compatible forward. Dev adoption still refuses
incompatible values with E_ADOPT. Restored uniqueness
and parent-lifetime/audience checks can also refuse; failure keeps the old release.
`--allow-destructive` never bypasses these checks.

Reusing dormant names with new source requires `deploy <dir> --restore-dormant`;
`rollback --to N` explicitly selects an immutable release and restoration.
`prune <dir>` previews counts/bytes/ids; `prune <dir> --allow-destructive`
permanently removes all dormant storage. Assets stay retained but unreadable
while dormant. `releases <dir>` inspects database-authoritative history.

Clients reacquire a fresh generation for changed execution content, including
native-only module changes. A failed hot adoption leaves the old release serving.
For a truthful scalar old view, declare `down table name(typedInputs): {oldField: expression}` in newer source. Saved old preimages win; receipts name their rows. Computed down cannot manufacture files/images, collections, references or missing tables. For required → optional media/money and empty albums, `rollback DIR --to N --check --bridge NEW_DIR` generates a current-workflow repair source and checklist with loosened domains and retained new tables. Review nullable UI reads, current safety guards and the checklist, then preview/deploy that NEW release with `deploy DIR --schema NEW_DIR --restore-dormant --check`. New tables may still have no old read path. `table newName renamed from oldName:` preserves table/row/reference identity across both directions; asset-column renames preserve the single asset home. Cross-table indexed existence/unique lookups and migration-only `fileText` are declarative inputs; see the packed-tested language example and `guide deploy`.

Full lifecycle, concurrency, failure and recovery semantics:
[SERVER.md — Release lifecycle](SERVER.md#release-lifecycle).

### Move media into a child table

`extract` is asset-only: map an image/file/video (or bounded asset list).
For a scalar-only split, use a named backfill/down and an authored child-writing
mutation; `extract` refuses this form explicitly.

Save the previous source before removing `orders.scan`. The new child retains
private reads through the same parent. `customer renamed from buyer` carries
reference lifetime evidence; it does not convert the reference type.

```quarry
table people:
  read <- deny
  online only
table orders:
  customer: people renamed from buyer
  owner: principal
  immutable owner
  read <- .owner = viewer
  online only
table scans:
  order: orders on delete restrict
  scan: file <=100000
  immutable order
  read through .order
  online only
extract scans from orders via order: {scan:scan}
```

Preview the whole migration with deploy --check. Initial child ids equal parent
ids; independent destinations refuse. Bytes move without reuploading. Exact
scalar reversal needs a valid parent lifetime and one unambiguous child. A
compatible registered current-workflow view can retain v2-native parents with
several children on default rollback; otherwise `rollback --bridge` supplies a
repair source and checklist. Preview before selecting it.

An ordinary extracted payload may widen required → optional while retaining its
underlying kind, bounds and lifetime; reversal still validates the old required
payload. Keep its read policy: a compatible stricter child policy needs no
intermediate bridge release. Missing bytes, other incompatible type changes or
broader read audiences refuse atomically. Image and bounded asset-list columns
use the same ordinary extraction form.

### One record per photo in a list

For a historical `albums.photos: [image <=10000] <=8`, declare the complete
new source below. The `each` modifier moves one element into each child;
plain `extract` moves a whole list into one child. Element types must match.

```quarry
use identity password
table albums:
  owner: principal
  immutable owner
  read <- .owner = viewer
  delete <- .owner = viewer
  online only
table albumPhotos:
  album: albums on delete cascade
  photo: image <=10000
  immutable album
  cap 8 by album
  read through .album
  online only
extract albumPhotos from albums via album each: {photo:photos}
mutation removeAlbum(album: albums):
  delete albums[album]
```

Child IDs stay stable across rollback/forward and old-client reordering.
Reverse selection collects current child photos, including native v2 children,
in receipt order with native children appended by ID. It moves their homes
back into the old list; it never truncates an old list to its declared bound.
An unrepresentable population becomes dormant under the ordinary old-domain
rules. Empty lists create no children. Repeated asset IDs refuse because one
asset cannot have two homes. Missing bytes, independent destination history,
pruned children, invalid parent lifetimes and broader audiences refuse atomically.
If populated children are dormant under a narrowed child domain, reverse
selection refuses rather than omitting their photos. Restore those rows with
a loosened child-domain bridge first; migration-owned null removals stay dormant.
A temporarily retired child table resumes its validated current homes under the
same extraction; it never replays consumed lists or recaptures independent children.

This is `guide evolution`; client development commands are in CLIENT-AND-OPERATIONS.md §5."##;

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

// @ref LLP 3000.007#20.1 — a card longer than a tool window prints its opening and a numbered index; --full lists bounded reading sections.
/// Cards up to this many lines print whole. Above it, `guide <card>` prints
/// the card's opening and a numbered section index: agents batch several
/// cards per command and their tools truncate long output (the start card,
/// 124 lines at most, stays whole).
pub const FULL_LINES: usize = 240;
/// Dense cards with very long lines need the same bounded first read.
pub const FULL_BYTES: usize = 8_000;
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
// @ref LLP 3000.007#20.1 — the run-on hint sits under the title, so a short opening never reads as the whole card.
pub fn overview(name: &str, card: &str) -> Option<String> { overview_with(name, card, true) }

/// The same overview with the card's first section printed between the
/// opening and the index: what `guide <card>` prints when stdout is not a
/// terminal (an agent's tool), so one call shows the card's first content
/// and not only its table of contents. A first section longer than
/// [`FIRST_SECTION_LINES`] is cut at a paragraph boundary with the command
/// that prints the rest.
// @ref LLP 3000.007#20.1 — 11 lanes re-ran --section/--full 3–4 times after an index-only opening.
pub fn overview_and_first_section(name: &str, card: &str) -> Option<String> { overview_with(name, card, true) }

/// The most lines of a card's first section the piped overview prints.
const FIRST_SECTION_LINES: usize = 80;

/// Tool reads use the same bounded discovery view as terminal reads.
// @ref LLP 3000.000.000.000.000#8 — hint before the body survives batched tool truncation.
pub fn piped(name: &str, card: &str) -> String {
    if name == "start" { return bounded_default(name, card); }
    bounded_default(name, &overview_and_first_section(name, card).unwrap_or_else(|| card.to_owned()))
}

/// The last paragraph boundary (a blank line outside a fence) in
/// `lines[from..to]` at or before `limit`, as an absolute line number.
fn boundary(lines: &[&str], from: usize, to: usize, limit: usize) -> Option<usize> {
    let mut fenced = false;
    let mut best = None;
    let mut content = false;
    for (i, line) in lines.iter().enumerate().take(to).skip(from) {
        if line.trim_start().starts_with("```") { fenced = !fenced; }
        else if !fenced && content && line.trim().is_empty() && i <= limit { best = Some(i); }
        if !line.trim().is_empty() { content = true; }
    }
    best
}

fn overview_with(name: &str, card: &str, first_section: bool) -> Option<String> {
    let total = card.lines().count();
    let found = sections(card);
    if total <= FULL_LINES && card.len() <= FULL_BYTES { return None; }
    let lines: Vec<&str> = card.lines().collect();
    if found.is_empty() {
        // A single long fenced recipe is indivisible. Show its prose opening,
        // never half of a runnable code fence; --full prints the entire recipe.
        let end = lines.iter().position(|line| line.trim_start().starts_with("```"))
            .and_then(|start| lines.iter().enumerate().skip(start + 1).find(|(_, line)| line.trim() == "```").map(|(end, _)| end + 1))
            .unwrap_or(total);
        let title = lines.first().copied().unwrap_or("");
        return Some(format!("{title}\n(Truncated: first content of a {total}-line card with one indivisible recipe; snapback4 guide {name} --full prints the whole recipe.)\n{}\n\nSections of guide {name}:\nSingle recipe: snapback4 guide {name} --full", lines[1..end.max(1)].join("\n").trim_end()));
    }
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
    let shown = if first_section { "opening, first section and section index" } else { "opening and section index" };
    let hint = format!("(Truncated: this is the {shown} of a {total}-line card: snapback4 guide {name} --section <number or words> prints one section · --find <words> prints matching lines · --full lists all sections.)");
    let mut out = match lines.first().filter(|line| line.starts_with("# ")) {
        Some(title) => format!("{title}\n{hint}\n{}", lines[1..cut].join("\n")),
        None => format!("{hint}\n\n{}", lines[..cut].join("\n")),
    }.trim_end().to_owned();
    if first_section {
        if cut < first { out.push_str(&format!("\n\n… the opening continues for {} lines: snapback4 guide {name} --section 0", first - cut)); }
        let (section, (_, heading, start, end)) = found.iter().enumerate().find(|(_, (_, _, start, end))| lines[start + 1..*end].iter().any(|line| !line.trim().is_empty())).unwrap_or((0, &found[0]));
        let section = section + 1;
        let limit = start + FIRST_SECTION_LINES;
        let stop = if end - start <= FIRST_SECTION_LINES { *end } else {
            boundary(&lines, start + 1, *end, limit).unwrap_or_else(|| {
                // An indivisible first code block must stay runnable. If no
                // earlier paragraph fits, finish that block before shortening.
                let mut fenced = false;
                for (i, line) in lines.iter().enumerate().take(*end).skip(start + 1) {
                    if line.trim_start().starts_with("```") { fenced = !fenced; }
                    if i >= limit && !fenced && line.trim().is_empty() { return i; }
                }
                *end
            })
        };
        out.push_str("\n\n");
        out.push_str(lines[*start..stop].join("\n").trim_end());
        if stop < *end { out.push_str(&format!("\n\n… section {section} ({heading}) continues for {} lines: snapback4 guide {name} --section {section}", end - stop)); }
    }
    out.push_str(&format!("\n\nSections of guide {name}:\n"));
    out.push_str(&index_lines(card, &found));
    out.push_str(&format!("More: snapback4 guide {name} --section <number or words> prints one section · --find <words> prints matching lines · --full lists all sections"));
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

/// The alternatives of a search: `a|b` and `a OR b`.
fn alternatives(words: &str) -> Vec<String> {
    words.split('|').flat_map(|part| part.split(" OR ")).map(|alternative| alternative.trim().to_owned()).filter(|alternative| !alternative.is_empty()).collect()
}

/// A word as written, and its singular (`loops` finds "loop", `queries` "query").
fn forms(word: &str) -> Vec<String> {
    let mut forms = vec![word.to_owned()];
    if let Some(stem) = word.strip_suffix("ies").filter(|stem| stem.len() > 2) { forms.push(format!("{stem}y")); }
    else if let Some(stem) = word.strip_suffix('s').filter(|stem| stem.len() > 2 && !stem.ends_with('s')) { forms.push(stem.to_owned()); }
    forms
}

// @ref LLP 3000.007#20.1 — `--find a b` is every word on one line; `a|b` and `a OR b` are either.
/// Line numbers (0-based) whose text holds an alternative: its phrase, or
/// every one of its words (each as written or singular).
fn mentions(card: &str, words: &str) -> Vec<usize> {
    let lines: Vec<String> = card.lines().map(str::to_lowercase).collect();
    let mut found = Vec::new();
    for alternative in alternatives(words) {
        let phrase = alternative.to_lowercase();
        let each: Vec<Vec<String>> = words_of(&phrase).split_whitespace().map(forms).collect();
        found.extend((0..lines.len()).filter(|&i| {
            if lines[i].contains(&phrase) { return true; }
            let line = words_of(&lines[i]);
            !each.is_empty() && each.iter().all(|forms| forms.iter().any(|w| line.contains(w.as_str())))
        }));
    }
    found.sort_unstable();
    found.dedup();
    found
}

/// Lines holding any one of several words (connectives dropped), for a
/// search whose words no single line holds together.
fn any_mentions(card: &str, words: &str) -> Vec<usize> {
    if alternatives(words).len() != 1 { return Vec::new(); }
    let each: Vec<&str> = words.split_whitespace().filter(|w| !["or", "and", "OR", "AND"].contains(w)).collect();
    if each.len() < 2 { return Vec::new(); }
    mentions(card, &each.join("|"))
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
        if let Some((_,heading,start,end))=found.first() {
            if heading == "Opening" {return Ok(print(*start,*end));}
        }
        return Ok(lines[..opening].join("\n").trim_end().to_owned());
    }
    if let Ok(n) = wanted.parse::<usize>() {
        return match found.get(n.wrapping_sub(1)) {
            Some((_, _, start, end)) => Ok(print(*start, *end)),
            // `1000` is an alias of the bounds card, not its thousandth section.
            None => alias_inside(name, card, words).ok_or_else(|| format!("guide {name} has no section {n}\n{}", section_index(name, card))),
        };
    }
    // An alias that names a section of this card lands there (`subpaths` would match two headings).
    if super::alias_section(words).is_some_and(|(target, _)| target == name) {
        if let Some(landing) = alias_inside(name, card, words) { return Ok(landing); }
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
    // No heading matches. A curated alias naming a section of another card
    // lands there, saying so (`guide wire --section acceptance`).
    // @ref LLP 3000.007#20.1 — acceptance under wire, statements under language, loops under writes.
    let hits = mentions(card, words);
    if let Some((target, _)) = super::alias_section(words).filter(|(target, _)| *target != name) {
        if let Some(landing) = super::card(target).and_then(|text| alias_landing(words, target, text)) {
            let here = match hits.len() {
                0 => String::new(),
                1 => format!(" (one line of guide {name} mentions it: --find {words:?})"),
                n => format!(" ({n} lines of guide {name} mention it: --find {words:?})"),
            };
            return Ok(format!("No heading of guide {name} is named {words:?}; it is a section of guide {target}{here}:\n\n{landing}"));
        }
    }
    // When the words occur, print the section holding most of their mentions
    // (a strict plurality), or every mention when sections tie for the most.
    // @ref LLP 3000.007#20.1 — a topic word (audience, React, Reference) prints what it names instead of failing.
    if !hits.is_empty() {
        let mut counts: Vec<(usize, usize)> = Vec::new();
        for &i in &hits {
            let (n, _) = section_of(&found, i);
            match counts.iter_mut().find(|(section, _)| *section == n) { Some(entry) => entry.1 += 1, None => counts.push((n, 1)) }
        }
        let &(best, count) = counts.iter().max_by_key(|(n, count)| (*count, std::cmp::Reverse(*n))).expect("a hit has a section");
        // @ref LLP 3000.007#20.1 — a plurality lands (`client --section react` listed 4 sections); only a tie lists mentions.
        if counts.iter().filter(|(_, other)| *other == count).count() == 1 {
            let (heading, start, end) = if best == 0 { ("Opening", 0, opening) } else { let s = &found[best - 1]; (s.1.as_str(), s.2, s.3) };
            let share = match (hits.len(), count == hits.len()) {
                (1, _) => "the one line that mentions it".to_owned(),
                (total, true) => format!("all {total} lines that mention it"),
                (total, false) => {
                    let mut others: Vec<(usize, usize)> = counts.iter().copied().filter(|(n, _)| *n != best).collect();
                    others.sort_by_key(|&(n, count)| (std::cmp::Reverse(count), n));
                    let others = others.iter().take(3).map(|&(n, count)| format!("{n}. {} ({count})", if n == 0 { "Opening" } else { found[n - 1].1.as_str() })).collect::<Vec<_>>().join(", ");
                    format!("{count} of the {total} lines that mention it; also {others} (--find {words:?} prints them all)")
                }
            };
            let note = format!("guide {name}: keyword {words:?} opens {best}. {heading} ({share}).");
            let body = if best == 0 { lines[start..end].join("\n").trim_end().to_owned() } else { print(start, end) };
            return Ok(format!("{note}\n\n{body}"));
        }
        let note = format!("guide {name}: keyword {words:?} appears in {} sections; matching lines:\n", counts.len());
        return find(name, card, words).map(|lines| format!("{note}{lines}"));
    }
    // A whole-card alias no line mentions prints the card's opening.
    if let Some(opening) = alias_inside(name, card, words) { return Ok(opening); }
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
/// each word on one line; `a|b` either), with a line of context, under its
/// section's number and heading. When no line holds every word, the lines
/// holding any of them print and the result is still an error (exit 1).
pub fn find(name: &str, card: &str, words: &str) -> Result<String, String> {
    let found = sections(card);
    let lines: Vec<&str> = card.lines().collect();
    let mut hits = mentions(card, words);
    // No line holds every word: print the lines holding any of them, still exiting 1.
    let mut any = false;
    if hits.is_empty() {
        // An alias of this card no line holds: the section it names, or the opening.
        if let Some(landing) = alias_inside(name, card, words) { return Ok(landing); }
        hits = any_mentions(card, words);
        if hits.is_empty() { return Err(format!("no line of guide {name} mentions {words:?}\n{}", section_index(name, card))); }
        any = true;
    }
    // Merge each hit's one line of context into ranges.
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for &i in &hits {
        let (start, end) = (i.saturating_sub(1), (i + 2).min(lines.len()));
        match ranges.last_mut() { Some(last) if start <= last.1 => last.1 = end, _ => ranges.push((start, end)) }
    }
    let mut out = if any {
        format!("no line of guide {name} mentions all of {words:?}; {} {} one of them (a|b searches for either; words with spaces must share a line)\n", hits.len(), if hits.len() == 1 { "line mentions" } else { "lines mention" })
    } else { format!("guide {name}: {} {} {words:?}\n", hits.len(), if hits.len() == 1 { "line mentions" } else { "lines mention" }) };
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
    if any { Err(out) } else { Ok(out) }
}


/// Paragraphs and complete fences are the units of reading and project deltas.
// @ref LLP 3000.037.000#8 — never cut a runnable fence in half.
pub fn reading_blocks(text: &str) -> Vec<String> {
    let mut blocks = Vec::new(); let mut block = String::new(); let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") { fenced = !fenced; }
        if line.is_empty() && !fenced {
            if !block.is_empty() { blocks.push(std::mem::take(&mut block)); }
        } else { block.push_str(line); block.push('\n'); }
    }
    if !block.is_empty() { blocks.push(block); } blocks
}

/// Conservative byte-token ceiling: any UTF-8 byte needs at most one byte token.
pub fn bounded_default(name: &str, text: &str) -> String {
    if text.len() < FULL_BYTES { return text.to_owned(); }
    let hint = format!("\nTruncated: default budget is {FULL_BYTES} bytes. New question: snapback4 guide {name} --section <words>; section list: --full.\n");
    let mut out = String::new();
    for block in reading_blocks(text) {
        if out.len() + block.len() + hint.len() + 1 >= FULL_BYTES { break; }
        out.push_str(&block); out.push('\n');
    }
    out.push_str(&hint); out
}
