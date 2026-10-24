//! `check`'s advisory notes, ranked. A green check printed nine notes in
//! source order, and builders could not tell an FYI about offline coverage
//! from a page that never completes. Notes stay advisory (they never fail a
//! check); security review gates are decided by the caller. This module orders
//! output, names each group and shortens repeats.

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
    if snapback4_lang::security::gated_note(code)||snapback4_lang::security::note_priority(code)<=2{return Tier::Review;}
    match code {
        "N_IMMUTABLE_PATCH" | "N_PERSONA_PRINCIPAL" | "N_UNREADABLE_PROBE" | "N_NO_PRODUCTION_WRITER" | "N_FIXTURE_ARGUMENT_DRIFT" | "N_REFERENCE_UNCHECKED" | "N_MAINTAIN_AUTHORIZATION" | "N_WRITE_DENIED" | "N_DELETE_RESTRICTED" | "N_DELETE_NEEDS_READ" | "N_PATCH_CLEARS" | "N_NEVER_COMPLETE" | "N_CONDITIONAL_COMPLETE" | "N_PROBE_ONLY_READ" | "N_VACUOUS_RULE" | "N_LOOKUP_HIDDEN" | "N_LOOKUP_FILTERED" | "N_UNIQUE_HIDDEN" | "N_LOOKUP_NEVER_VISIBLE" | "N_REQUIRE_HIDDEN" | "N_REQUIRE_REFUSED" | "N_QUERY_FILTERED" | "N_SHAPE_METER" | "N_HELD_UNKNOWN" | "N_SEQUENCE_READ"
        | "N_SWEEP_DEADLINE" | "N_CLOCK_STORE_AHEAD" | "N_PUBLIC_AGGREGATE_COPY" | "N_MAINTAINED_COLUMN_DISCLOSURE" | "N_MAINTAIN_DELTA"
        | "N_INSERT_WRITE_INTENT" | "N_COLUMN_RESULT_EXPOSURE" | "N_SEARCH_UNSCOPED" | "N_SEARCH_OPEN" | "N_TIMELINE_PROFILE_CAP" | "N_PRIVILEGE_ESCALATION" | "N_SELF_CLAIMED_RELATIONSHIP" | "N_CALLER_TIME" | "N_ROLE_WIDE_READ" | "N_INVARIANT_RESTATES_RULE" | "N_ARGUMENT_GRANT" | "N_BROAD_READ" | "N_SECURITY_INTENT" => Tier::Review,
        // @ref LLP 3000.036#13.4 — a cursorless `first N` is what the declaration says: the first N rows (wave 3 #7).
        "N_SYNC_ORDER" | "N_NO_HORIZON" | "N_MAINTAIN_SYNCED" | "N_TIMELINE_COMPAT" | "N_NO_CURSOR" => Tier::Design,
        _ => Tier::Performance,
    }
}

/// Security findings that can grant authority stay ahead of repeated advice.
pub(crate) fn summary_order(code:&str)->(Tier,u8){
    let priority=snapback4_lang::security::note_priority(code);
    (if priority<=2 {Tier::Review}else{tier(code)},priority)
}

pub(crate) fn site_order(site:&str)->(String,u32,u32){
    let mut parts=site.rsplitn(3,':');let col=parts.next().and_then(|s|s.parse().ok()).unwrap_or(0);let line=parts.next().and_then(|s|s.parse().ok()).unwrap_or(0);let file=parts.next().unwrap_or(site);(file.to_owned(),line,col)
}

/// The first words of a note's line: what to do about it, or that nothing
/// needs doing (wave 7 #11: "put a one-line verdict on every advisory note").
// @ref LLP 3000.036#17.7 — the verdict leads; the explanation follows it.
pub(crate) fn verdict(code: &str, summary: &str, form: bool) -> &'static str {
    match code {
        "N_PRIVILEGE_ESCALATION" => "review: restrict authority assignment",
        "N_SELF_CLAIMED_RELATIONSHIP" => "review: verify the relationship before granting access",
        "N_CALLER_TIME" => "review: use server time or bound the supplied time",
        "N_ROLE_WIDE_WRITE" | "N_ROLE_WIDE_READ" | "N_BROAD_READ" => "review: confirm each admitted audience and row state",
        "N_INVARIANT_RESTATES_RULE" => "review: answer the audience questions from the spec",
        "N_SECURITY_INTENT" => "review: write independent intent from the spec",
        "N_NO_PRODUCTION_WRITER" if summary.starts_with("persona-only:") => "no action without use identity",
        "N_NO_PRODUCTION_WRITER" => "fix: add a production bootstrap writer",
        "N_FIXTURE_ARGUMENT_DRIFT" => "fix: update the fixture arguments",
        "N_CONDITIONAL_COMPLETE" => "review: complete for the pinned parent audience; other callers may be capped",
        "N_NEVER_COMPLETE" if summary.contains("the complete form is to add `cap ") => "fix: add the exact source cap below, or accept `complete: false`",
        "N_NEVER_COMPLETE" if summary.contains("no verified complete form for this read") => "review: no verified complete form for this read; expect `capped` and show what arrived",
        "N_NEVER_COMPLETE" if form && summary.contains("the closest form is") => "fix: use the closest form below (one arm stays `complete: false`), or accept `complete: false`",
        "N_NEVER_COMPLETE" if form => "fix: use the complete form below, or accept `complete: false`",
        "N_NEVER_COMPLETE" => "fix: pin the scope, or accept `complete: false`",
        "N_DELETE_RESTRICTED" => "fix: declare the reference's `on delete`, or guard the delete",
        "N_DELETE_NEEDS_READ" => "review: some deleters get NOT_FOUND",
        "N_REFERENCE_UNCHECKED" => "review: this reference argument has no mandatory target lookup",
        "N_MAINTAIN_AUTHORIZATION" => "review: hidden and absent are different caller outcomes",
        "N_PATCH_CLEARS" => "review: an omitted argument clears this column",
        "N_WRITE_DENIED" if summary.contains("admits only 'service:") => "review: a seat require grants no table authority",
        "N_WRITE_DENIED" => "fix: this write refuses E_RULE for callers you admit",
        "N_REQUIRE_REFUSED" => "review: callers you admit may still get E_RULE",
        "N_QUERY_FILTERED" => "review: this query branch may filter rows under table authority",
        "N_READ_DENIED" => "fix: this read always returns null",
        "N_REQUIRE_HIDDEN" if summary.contains("get NOT_FOUND") => "review: the hidden lookup runs before this require",
        "N_REQUIRE_HIDDEN" => "fix: this require cannot see the rows it tests",
        "N_LOOKUP_NEVER_VISIBLE" => "fix: this nullable lookup is always null for the admitted callers",
        "N_LOOKUP_HIDDEN" => "review: a required read gate may hide rows from writers",
        "N_LOOKUP_FILTERED" => "review: confirm lookup authority and the hidden-row outcome",
        "N_UNIQUE_HIDDEN" => "review: hidden unique conflicts retain generic E_RULE",
        "N_PROBE_ONLY_READ" | "N_PUBLIC_AGGREGATE_COPY" | "N_MAINTAINED_COLUMN_DISCLOSURE" => "review: who can read this",
        "N_VACUOUS_RULE" => "review: who can write this",
        "N_INSERT_WRITE_INTENT" => "review: confirm creation authority as well as edit authority",
        "N_COLUMN_RESULT_EXPOSURE" => "review: confirm every result/refusal audience",
        "N_IMMUTABLE_PATCH" => "review: readable conflicts require the original immutable value",
        "N_NO_CURSOR" => "no action for a top-N list",
        _ => match tier(code) {
            Tier::Review => "review",
            Tier::Performance => "no action unless it is slow (`check --cost` measures it)",
            Tier::Design => "no action for an online app",
        },
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
    /// An expanded compiled repair: its lead line and the code. Compact
    /// completeness notes leave this empty and keep the repair in `--verbose`.
    pub form: Option<(String, String)>,
    /// Three-line default rendering for completeness verdicts. Their full
    /// planner proof and compiled repair remain in `check --verbose`.
    pub compact: Option<[String; 3]>,
}

/// The compiled form leading a note's rewrite: the text before "Otherwise:",
/// when it holds code (a lead line ending in `:` and the declaration under it).
// @ref LLP 3000.036#15.5 — the compiled owner-or-X rewrite prints by default, once per form.
pub(crate) fn compiled_form(code: &str, rewrite: &str) -> Option<(String, String)> {
    if !matches!(code, "N_NEVER_COMPLETE" | "N_CONDITIONAL_COMPLETE") { return None; }
    let head = rewrite.split("\n\nOtherwise:").next()?;
    let (lead, body) = head.split_once('\n')?;
    (lead.ends_with(':') && body.trim_start().starts_with("query ")).then(|| (lead.to_owned(), body.trim_end().to_owned()))
}

// Audience questions and repairs differ per rule; repeated codes cannot hide them.
fn per_rule_security(code:&str)->bool {snapback4_lang::security::note_priority(code)<=2||matches!(code,"N_PRIVILEGE_ESCALATION"|"N_SELF_CLAIMED_RELATIONSHIP"|"N_CALLER_TIME"|"N_ROLE_WIDE_READ"|"N_BROAD_READ"|"N_INVARIANT_RESTATES_RULE")}

/// The ranked block printed after `check: ok`; empty for no notes.
pub(crate) fn render(notes: Vec<Note>) -> Vec<String> {
    if notes.is_empty() { return Vec::new(); }
    // Collapse one code's repeats at one site, keeping first-seen order.
    let mut unique: Vec<(Note, usize)> = Vec::new();
    for note in notes {
        match unique.iter_mut().find(|(seen, _)| seen.site == note.site && seen.code == note.code && seen.summary == note.summary && seen.form == note.form && seen.compact == note.compact) {
            Some((_, count)) => *count += 1,
            None => unique.push((note, 1)),
        }
    }
    let total = unique.len();
    // Rank by tier; within a tier, a code's notes stay together in the order the code first appeared.
    let mut order: Vec<usize> = (0..unique.len()).collect();
    order.sort_by_key(|&i| (summary_order(&unique[i].0.code), site_order(&unique[i].0.site), i));
    let mut lines = vec![format!("{total} thing{} to review (advisory; check --verbose explains each, snapback4 why <CODE> one):",
        if total == 1 { "" } else { "s" })];
    let mut current = None;
    let mut shown_codes = Vec::new();
    let mut shown_forms = Vec::new();
    let mut shown_compacts = Vec::new();
    let mut shown_actions = Vec::new();
    let mut shown_context = Vec::new();
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
        if note.code == "N_NO_CURSOR" {
            if !shown_codes.contains(&note.code) {
                let subjects = unique.iter().filter(|(n,_)| n.code == "N_NO_CURSOR").map(|(n,_)|
                    format!("{} ({})", subject(&n.summary), n.site)).collect::<Vec<_>>().join("; ");
                lines.push(format!("note: N_NO_CURSOR: no action for a top-N list. Pages without continuation: {subjects}; if the screen pages, add `c: cursor ?` and `after c`"));
                shown_codes.push(note.code.clone());
            }
            continue;
        }
        let times = if *count > 1 { format!(" (×{count} at this site)") } else { String::new() };
        let new_form = note.form.as_ref().is_some_and(|(_, code)| !shown_forms.contains(code));
        let new_compact = note.compact.as_ref().is_some_and(|parts| !shown_compacts.contains(parts));
        if shown_codes.contains(&note.code) && !new_form && !new_compact && !per_rule_security(&note.code) {
            // A repeat of a code already explained above: its subject and site, on the code's one line.
            let subject = format!("{} ({}){times}", subject(&note.summary), note.site);
            match repeats.iter_mut().find(|(code, _)| *code == note.code) {
                Some((_, subjects)) => subjects.push(subject),
                None => repeats.push((note.code.clone(), vec![subject])),
            }
            continue;
        }
        flush(&mut lines, &mut repeats);
        if let Some(parts @ [action, impact, audience]) = &note.compact {
            if !shown_actions.contains(action) {
                let mut body = action.lines();
                lines.push(format!("note: {} — {} — {}{times}", note.site, note.code, body.next().unwrap_or("review")));
                lines.extend(body.map(str::to_owned));
                shown_actions.push(action.clone());
            } else {
                lines.push(format!("note: {} — {} — {}: checked rewrite or limitation as above{times}", note.site, note.code, subject(&note.summary)));
            }
            for context in [impact, audience] {
                if !shown_context.contains(&(note.code.clone(), context.clone())) {
                    lines.push(format!("  {context}"));
                    shown_context.push((note.code.clone(), context.clone()));
                }
            }
            shown_compacts.push(parts.clone());
            shown_codes.push(note.code.clone());
            continue;
        }
        if shown_codes.contains(&note.code) && !per_rule_security(&note.code) {
            // A repeat that carries a form not printed yet keeps its own line, then the form.
            lines.push(format!("note: {} — {}: (as above) {}{times}", note.site, note.code, short(&note.summary)));
        } else {
            let below = note.form.as_ref().is_some_and(|(_, code)| !shown_forms.contains(code));
            let summary = match note.summary.strip_suffix(" (check --verbose)") { Some(text) if below => format!("{text} (below)"), _ => note.summary.clone() };
            lines.push(format!("note: {} — {}: {}. {summary}{times}", note.site, note.code, verdict(&note.code, &note.summary, below)));
            shown_codes.push(note.code.clone());
        }
        if let Some((lead, code)) = &note.form && !shown_forms.contains(code) {
            lines.push(format!("  rewrite: {lead}"));
            lines.extend(code.lines().map(|line| format!("    {line}")));
            shown_forms.push(code.clone());
        }
    }
    flush(&mut lines, &mut repeats);
    // Every advisory line has a direct route to the acceptance recipe.
    for line in &mut lines {
        if let Some(code) = line.split_whitespace().find(|word| word.starts_with("N_")) {
            let code = code.trim_end_matches(':').to_owned();
            line.push_str(&format!(" — snapback4 why {code}"));
        }
    }
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
    fn note(site: &str, code: &str, summary: &str) -> Note { Note { site: site.into(), code: code.into(), summary: summary.into(), form: None, compact: None } }

    #[test]
    fn security_priority_and_numeric_site_order_survive_rendering() {
        let text=render(vec![note("schema.q:101:1","N_ROLE_WIDE_READ","later audience"),note("schema.q:50:1","N_CREATION_REASON","middle reason"),note("schema.q:41:1","N_ROLE_WIDE_READ","first audience"),note("schema.q:1:1","N_COLUMN_RESULT_EXPOSURE","inventory")]).join("\n");
        assert!(text.find("first audience")<text.find("middle reason"));
        assert!(text.find("middle reason")<text.find("later audience"));
        assert!(text.find("later audience")<text.find("inventory"));
        for code in ["N_OPTIONAL_UPLOAD_CREATE","N_RETAINED_ROLE_GRANT","N_CREATION_REASON"]{assert_eq!(tier(code),Tier::Review);assert!(!verdict(code,"",false).contains("slow"));}
    }

    #[test]
    fn repeated_security_codes_keep_each_rules_audience_and_question() {
        let text=render(vec![note("schema.q:2:1","N_INVARIANT_RESTATES_RULE","notes.read: should coach see other athletes?"),note("schema.q:8:1","N_INVARIANT_RESTATES_RULE","pieces.address: should intake see every owner address?")]).join("\n");
        assert!(text.contains("should coach see other athletes?")&&text.contains("should intake see every owner address?"),"{text}");
    }

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
            "note: schema.q:1:1 — N_NEVER_COMPLETE: fix: use the complete form below, or accept `complete: false`. query q: never complete — snapback4 why N_NEVER_COMPLETE".to_owned(),
            "  rewrite: Branch on the grant and pin the owner for everyone else; both pages are complete:".into(),
            "    query q(c: cursor ?):".into(),
            "      if exists staff[viewer]:".into(),
            "        return t last 50 by .at after c".into(),
            "      return t where .owner = viewer last 50 by .at after c".into(),
        ], "{lines:#?}");
        assert_eq!(lines.len(), 9, "the second note of the same form is the short repeat: {lines:#?}");
        assert_eq!(lines[8], "note: N_NEVER_COMPLETE (as above) also for query q (schema.q:9:1) — snapback4 why N_NEVER_COMPLETE", "{lines:#?}");
    }

    #[test]
    fn distinct_scans_at_one_site_and_distinct_query_repairs_remain_visible() {
        let n = |subject: &str, repair: &str| Note { compact: Some([repair.into(), "impact".into(), "audience".into()]), ..note("s.q:1:1", "N_NEVER_COMPLETE", subject) };
        let lines = render(vec![n("query q: scan a", "rewrite a"), n("query q: scan b", "rewrite b"), n("query r", "rewrite r"), n("query r", "rewrite r")]);
        let output = lines.join("\n");
        for repair in ["rewrite a", "rewrite b", "rewrite r"] { assert_eq!(output.matches(repair).count(), 1, "{output}"); }
        assert!(output.contains("×2 at this site"), "{output}");
    }

    #[test]
    fn identical_actions_keep_different_scan_audiences() {
        let with = |audience: &str| Note { compact: Some(["review query both: missing pin .owner".into(), "same impact".into(), audience.into()]), ..note("s.q:1:1", "N_NEVER_COMPLETE", "query both") };
        let output = render(vec![with("staff are complete (scan tickets)"), with("tutors are complete (scan papers)")]).join("\n");
        assert!(output.contains("staff are complete (scan tickets)"), "{output}");
        assert!(output.contains("tutors are complete (scan papers)"), "{output}");
        assert_eq!(output.matches("same impact").count(), 1, "{output}");
    }

    #[test]
    fn completeness_note_is_three_lines_and_points_to_verbose_detail() {
        let compact = Some([
            "verdict: capped; completeness is not proved".into(),
            "who: no caller group is proved complete by this page".into(),
            "what: pin the scope; check --verbose shows the checked repair".into(),
        ]);
        let lines = render(vec![Note { compact, ..note("schema.q:8:1", "N_NEVER_COMPLETE", "long planner proof") }]);
        assert_eq!(&lines[2..], [
            "note: schema.q:8:1 — N_NEVER_COMPLETE — verdict: capped; completeness is not proved — snapback4 why N_NEVER_COMPLETE",
            "  who: no caller group is proved complete by this page",
            "  what: pin the scope; check --verbose shows the checked repair",
        ]);
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
        assert!(lines[0].starts_with("5 things to review"), "{lines:?}");
        let body: Vec<&str> = lines[1..].iter().map(String::as_str).collect();
        assert_eq!(body, [
            "review — can cost correctness or completeness:",
            "note: schema.q:104:1 — N_WRITE_DENIED: fix: this write refuses E_RULE for callers you admit. mutation rangers inserts rows no caller may insert (×2 at this site) — snapback4 why N_WRITE_DENIED",
            "performance — costs speed, meter headroom or offline coverage:",
            "note: schema.q:95:1 — N_WIDE_MERGE: no action unless it is slow (`check --cost` measures it). query feed: read cost grows — snapback4 why N_WIDE_MERGE",
            "by design — what a declaration implies; no action needed for online use:",
            "note: schema.q:71:1 — N_MAINTAIN_SYNCED: no action for an online app. 2 synced maintains — snapback4 why N_MAINTAIN_SYNCED",
            "note: schema.q:78:10 — N_SYNC_ORDER: no action for an online app. query a reads by .id; the client needs the server — snapback4 why N_SYNC_ORDER",
            "note: N_SYNC_ORDER (as above) also for query b (schema.q:87:10) — snapback4 why N_SYNC_ORDER",
        ]);
        assert!(render(Vec::new()).is_empty());
    }
    #[test]
    fn insert_and_result_privacy_are_review_actions_not_performance_advice(){
        for code in ["N_INSERT_WRITE_INTENT","N_COLUMN_RESULT_EXPOSURE"]{
            assert_eq!(tier(code),Tier::Review);
            assert!(summary_order("N_ROLE_WIDE_READ")<summary_order(code));
            assert!(verdict(code,"",false).starts_with("review:"));
        }
    }

}

#[cfg(test)]
mod integration20_tests {
    use super::*;
    #[test]
    fn source_authority_advice_never_says_to_ignore_it_until_slow() {
        for code in ["N_LOOKUP_FILTERED", "N_UNIQUE_HIDDEN"] {
            assert_eq!(tier(code), Tier::Review);
            assert!(verdict(code, "", false).starts_with("review:"));
        }
    }
}

// @ref LLP 3000.036.004#165-review-clarification-exact-detector-and-command-boundaries — repeated sites must not consume independent advice classes.
pub(crate) fn shortlist(notes:&mut Vec<Note>){
 let mut ordinary=std::collections::BTreeSet::new();
 notes.retain(|note|{
  if snapback4_lang::security::note_priority(&note.code)<=3 || (tier(&note.code)==Tier::Review && !hygiene(&note.code)){return true;}
  if ordinary.contains(&note.code){return true;}
  if ordinary.len()<5{ordinary.insert(note.code.clone());true}else{false}
 });
}
#[cfg(test)]mod shortlist_tests{use super::*;
#[test]fn repeated_classes_keep_distinct_audiences_without_hiding_security(){
 let mut notes=vec![];
 for code in ["N_ROLE_WIDE_READ","N_NO_PRODUCTION_WRITER","N_NEVER_COMPLETE","N_MAINTAIN_SYNCED","N_NO_HORIZON","N_INSERT_WRITE_INTENT","N_SECURITY_INTENT"]{for n in 0..8{notes.push(Note{site:format!("schema.q:{n}:1"),code:code.into(),summary:String::new(),form:None,compact:None});}}
 shortlist(&mut notes);assert_eq!(notes.len(),56);assert!(notes.iter().any(|n|n.code=="N_SECURITY_INTENT"));assert_eq!(notes.iter().filter(|n|n.code=="N_NEVER_COMPLETE").count(),8);
}}

fn hygiene(code:&str)->bool{matches!(code,"N_LOOKUP_FILTERED"|"N_QUERY_FILTERED"|"N_UNIQUE_HIDDEN"|"N_SPARSE_FILTER"|"N_MAINTAINED_COLUMN_DISCLOSURE")}
#[cfg(test)]mod authority_visibility_tests{
 use super::*;
 #[test]fn no_authorization_review_is_cut_while_lookup_hygiene_is_visible(){
   let codes=snapback4_lang::guide::codes();
   let mut notes=codes.iter().map(|code|Note{site:"schema.q:1:1".into(),code:(*code).into(),summary:String::new(),form:None,compact:None}).collect::<Vec<_>>();
   notes.sort_by_key(|n|summary_order(&n.code));shortlist(&mut notes);
   for code in codes.into_iter().filter(|code|tier(code)==Tier::Review&&!hygiene(code)){
     assert!(notes.iter().any(|n|n.code==code),"authorization/correctness review {code} was cut");
   }
   assert!(summary_order("N_INSERT_WRITE_INTENT")<summary_order("N_LOOKUP_FILTERED"));
 }
}

#[cfg(test)] mod gated_note_tests {
    use super::*;
    #[test] fn every_security_gate_is_rendered_as_review_never_performance() {
        for code in snapback4_lang::security::GATED_NOTE_CODES {
            assert!(snapback4_lang::security::gated_note(code));
            assert_eq!(tier(code), Tier::Review, "{code}");
            assert_eq!(summary_order(code).0, Tier::Review, "{code}");
            assert!(!verdict(code, "", false).contains("slow"), "{code}");
            let text=render(vec![Note{site:"schema.q:1:1".into(),code:(*code).into(),summary:"individual decision required".into(),form:None,compact:None}]).join("\n");
            assert!(!text.contains("performance"), "{code}: {text}");
        }
    }
}
