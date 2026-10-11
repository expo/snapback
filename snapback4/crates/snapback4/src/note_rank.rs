//! `check`'s advisory notes, ranked. A green check printed nine notes in
//! source order, and builders could not tell an FYI about offline coverage
//! from a page that never completes. Notes stay advisory (they never fail a
//! check); this only orders them, names each group, and shortens repeats.

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Tier {
    /// Can cost correctness or completeness: a page that never completes, a
    /// write no caller can pass, a disclosure, a read a device cannot answer.
    Review,
    /// Costs speed, meter headroom or offline coverage.
    Performance,
    /// What a declaration implies; nothing to fix for online use.
    Design,
}

pub(crate) fn tier(code: &str) -> Tier {
    match code {
        "N_WRITE_DENIED" | "N_NEVER_COMPLETE" | "N_SHAPE_METER" | "N_HELD_UNKNOWN" | "N_SEQUENCE_READ"
        | "N_CLOCK_STORE_AHEAD" | "N_PUBLIC_AGGREGATE_COPY" | "N_MAINTAINED_COLUMN_DISCLOSURE" | "N_MAINTAIN_DELTA"
        | "N_SEARCH_UNSCOPED" | "N_SEARCH_OPEN" | "N_TIMELINE_PROFILE_CAP" => Tier::Review,
        // @ref LLP 3000.036#13.4 — a cursorless `first N` is what the declaration says: the first N rows (wave 3 #7).
        "N_SYNC_ORDER" | "N_NO_HORIZON" | "N_MAINTAIN_SYNCED" | "N_TIMELINE_COMPAT" | "N_NO_CURSOR" => Tier::Design,
        _ => Tier::Performance,
    }
}

fn heading(tier: Tier) -> &'static str {
    match tier {
        Tier::Review => "review — can cost correctness or completeness:",
        Tier::Performance => "performance — costs speed, meter headroom or offline coverage:",
        Tier::Design => "by design — what a declaration implies; no action needed for online use:",
    }
}

pub(crate) struct Note { pub site: String, pub code: String, pub summary: String }

/// The ranked block printed after `check: ok`; empty for no notes.
pub(crate) fn render(notes: Vec<Note>) -> Vec<String> {
    if notes.is_empty() { return Vec::new(); }
    // Collapse one code's repeats at one site, keeping first-seen order.
    let mut unique: Vec<(Note, usize)> = Vec::new();
    for note in notes {
        match unique.iter_mut().find(|(seen, _)| seen.site == note.site && seen.code == note.code) {
            Some((_, count)) => *count += 1,
            None => unique.push((note, 1)),
        }
    }
    let total = unique.len();
    // Rank by tier; within a tier, a code's notes stay together in the order the code first appeared.
    let first_seen = |code: &str, unique: &[(Note, usize)]| unique.iter().position(|(n, _)| n.code == code).unwrap();
    let mut order: Vec<usize> = (0..unique.len()).collect();
    order.sort_by_key(|&i| (tier(&unique[i].0.code), first_seen(&unique[i].0.code, &unique), i));
    let mut lines = vec![format!("{total} advisory note{} — check passed; notes never block dev, test or deploy (most consequential first; check --verbose explains each, snapback4 why <CODE> one):",
        if total == 1 { "" } else { "s" })];
    let mut current = None;
    let mut shown_codes = Vec::new();
    for i in order {
        let (note, count) = &unique[i];
        let group = tier(&note.code);
        if current != Some(group) { lines.push(heading(group).to_owned()); current = Some(group); }
        let times = if *count > 1 { format!(" (×{count} at this site)") } else { String::new() };
        if shown_codes.contains(&note.code) {
            // A repeat of a code already explained above: its site and subject only.
            lines.push(format!("note: {} — {}: (as above) {}{times}", note.site, note.code, short(&note.summary)));
        } else {
            lines.push(format!("note: {} — {}: {}{times}", note.site, note.code, note.summary));
            shown_codes.push(note.code.clone());
        }
    }
    lines
}

/// The subject of a repeated note: its first clause before any quoted source, at most 100 characters.
fn short(summary: &str) -> String {
    let clause = summary.split("; ").next().unwrap_or(summary);
    // The quoted source is above already; the subject before it names the repeat.
    let clause = clause.split_once(" `").map_or(clause, |(subject, _)| subject).trim_end_matches(':');
    match clause.char_indices().nth(100) {
        Some((at, _)) => format!("{}…", &clause[..at]),
        None => clause.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(site: &str, code: &str, summary: &str) -> Note { Note { site: site.into(), code: code.into(), summary: summary.into() } }

    #[test]
    fn notes_rank_by_consequence_and_collapse_repeats() {
        let lines = render(vec![
            note("schema.q:95:1", "N_WIDE_MERGE", "query feed: read cost grows"),
            note("schema.q:71:1", "N_MAINTAIN_SYNCED", "2 synced maintains"),
            note("schema.q:78:10", "N_SYNC_ORDER", "query a reads by .id; the client needs the server"),
            note("schema.q:87:10", "N_SYNC_ORDER", "query b `t first 5 by .at` reads by .at; the client needs the server"),
            note("schema.q:104:1", "N_WRITE_DENIED", "mutation rangers inserts rows no caller may insert"),
            note("schema.q:104:1", "N_WRITE_DENIED", "mutation rangers inserts rows no caller may insert"),
        ]);
        assert!(lines[0].starts_with("5 advisory notes — check passed; notes never block"), "{lines:?}");
        let body: Vec<&str> = lines[1..].iter().map(String::as_str).collect();
        assert_eq!(body, [
            "review — can cost correctness or completeness:",
            "note: schema.q:104:1 — N_WRITE_DENIED: mutation rangers inserts rows no caller may insert (×2 at this site)",
            "performance — costs speed, meter headroom or offline coverage:",
            "note: schema.q:95:1 — N_WIDE_MERGE: query feed: read cost grows",
            "by design — what a declaration implies; no action needed for online use:",
            "note: schema.q:71:1 — N_MAINTAIN_SYNCED: 2 synced maintains",
            "note: schema.q:78:10 — N_SYNC_ORDER: query a reads by .id; the client needs the server",
            "note: schema.q:87:10 — N_SYNC_ORDER: (as above) query b",
        ]);
        assert!(render(Vec::new()).is_empty());
    }
}
