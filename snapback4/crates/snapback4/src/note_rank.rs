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
        "N_WRITE_DENIED" | "N_DELETE_ORPHANS" | "N_NEVER_COMPLETE" | "N_PROBE_ONLY_READ" | "N_VACUOUS_RULE" | "N_LOOKUP_HIDDEN" | "N_SHAPE_METER" | "N_HELD_UNKNOWN" | "N_SEQUENCE_READ"
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

pub(crate) struct Note {
    pub site: String,
    pub code: String,
    pub summary: String,
    /// A compiled complete form (`N_NEVER_COMPLETE`'s branched or per-party
    /// query): its lead line and the code. Printed under the first note of
    /// each lead, so the default output carries the fix, not only `--verbose`.
    pub form: Option<(String, String)>,
}

/// The compiled form leading a note's rewrite: the text before "Otherwise:",
/// when it holds code (a lead line ending in `:` and the declaration under it).
// @ref LLP 3000.036#15.5 — the compiled owner-or-X rewrite prints by default, once per form.
pub(crate) fn compiled_form(code: &str, rewrite: &str) -> Option<(String, String)> {
    if code != "N_NEVER_COMPLETE" { return None; }
    let head = rewrite.split("\n\nOtherwise:").next()?;
    let (lead, body) = head.split_once('\n')?;
    (lead.ends_with(':') && body.trim_start().starts_with("query ")).then(|| (lead.to_owned(), body.trim_end().to_owned()))
}

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
    let mut shown_forms = Vec::new();
    // @ref LLP 3000.036#16.5 — wave 6 #25: a code's repeats share one line naming each subject.
    let mut repeats: Vec<(String, Vec<String>)> = Vec::new();
    let flush = |lines: &mut Vec<String>, repeats: &mut Vec<(String, Vec<String>)>| {
        for (code, subjects) in repeats.drain(..) {
            lines.push(format!("note: {code} (as above) also for {}", subjects.join("; ")));
        }
    };
    for i in order {
        let (note, count) = &unique[i];
        let group = tier(&note.code);
        if current != Some(group) { flush(&mut lines, &mut repeats); lines.push(heading(group).to_owned()); current = Some(group); }
        let times = if *count > 1 { format!(" (×{count} at this site)") } else { String::new() };
        let new_form = note.form.as_ref().is_some_and(|(lead, _)| !shown_forms.contains(lead));
        if shown_codes.contains(&note.code) && !new_form {
            // A repeat of a code already explained above: its subject and site, on the code's one line.
            let subject = format!("{} ({}){times}", subject(&note.summary), note.site);
            match repeats.iter_mut().find(|(code, _)| *code == note.code) {
                Some((_, subjects)) => subjects.push(subject),
                None => repeats.push((note.code.clone(), vec![subject])),
            }
            continue;
        }
        flush(&mut lines, &mut repeats);
        if shown_codes.contains(&note.code) {
            // A repeat that carries a form not printed yet keeps its own line, then the form.
            lines.push(format!("note: {} — {}: (as above) {}{times}", note.site, note.code, short(&note.summary)));
        } else {
            let below = note.form.as_ref().is_some_and(|(lead, _)| !shown_forms.contains(lead));
            let summary = match note.summary.strip_suffix(" (check --verbose)") { Some(text) if below => format!("{text} (below)"), _ => note.summary.clone() };
            lines.push(format!("note: {} — {}: {summary}{times}", note.site, note.code));
            shown_codes.push(note.code.clone());
        }
        if let Some((lead, code)) = &note.form && !shown_forms.contains(lead) {
            lines.push(format!("  rewrite: {lead}"));
            lines.extend(code.lines().map(|line| format!("    {line}")));
            shown_forms.push(lead.clone());
        }
    }
    flush(&mut lines, &mut repeats);
    lines
}

/// The operation or table a repeat is about (`query b`), else its short subject.
fn subject(summary: &str) -> String {
    let mut words = summary.splitn(3, ' ');
    match (words.next(), words.next()) {
        (Some(kind @ ("query" | "mutation" | "job" | "action" | "table" | "view")), Some(name)) => format!("{kind} {}", name.trim_end_matches(':')),
        _ => short(summary),
    }
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
    fn note(site: &str, code: &str, summary: &str) -> Note { Note { site: site.into(), code: code.into(), summary: summary.into(), form: None } }

    #[test]
    fn a_compiled_complete_form_prints_once_per_lead_by_default() {
        let rewrite = "Branch on the grant and pin the owner for everyone else; both pages are complete:\nquery q(c: cursor ?):\n  if exists staff[viewer]:\n    return t last 50 by .at after c\n  return t where .owner = viewer last 50 by .at after c\n\nOtherwise: pin .owner";
        let form = compiled_form("N_NEVER_COMPLETE", rewrite);
        assert_eq!(form.as_ref().map(|(lead, _)| lead.as_str()), Some("Branch on the grant and pin the owner for everyone else; both pages are complete:"));
        assert!(compiled_form("N_NEVER_COMPLETE", "pin .owner with where equalities").is_none());
        assert!(compiled_form("N_SYNC_ORDER", rewrite).is_none());
        let with = |site: &str| Note { form: form.clone(), ..note(site, "N_NEVER_COMPLETE", "query q: never complete") };
        let lines = render(vec![with("schema.q:1:1"), with("schema.q:9:1")]);
        assert_eq!(lines[2..8], [
            "note: schema.q:1:1 — N_NEVER_COMPLETE: query q: never complete".to_owned(),
            "  rewrite: Branch on the grant and pin the owner for everyone else; both pages are complete:".into(),
            "    query q(c: cursor ?):".into(),
            "      if exists staff[viewer]:".into(),
            "        return t last 50 by .at after c".into(),
            "      return t where .owner = viewer last 50 by .at after c".into(),
        ], "{lines:#?}");
        assert_eq!(lines.len(), 9, "the second note of the same form is the short repeat: {lines:#?}");
        assert_eq!(lines[8], "note: N_NEVER_COMPLETE (as above) also for query q (schema.q:9:1)", "{lines:#?}");
    }

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
            "note: N_SYNC_ORDER (as above) also for query b (schema.q:87:10)",
        ]);
        assert!(render(Vec::new()).is_empty());
    }
}
