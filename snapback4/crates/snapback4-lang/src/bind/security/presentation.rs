//! Repairs lead; uncertainty stays visible without repeating every proof blocker.
// @ref LLP 3000.036.004#144-actions-precede-coverage-details — advice is separate from replayed failures.
use super::{Report, Status};

/// Compact human questionnaire; original diagnostics remain in Report.notes.
pub fn questionnaire_notes(notes:&[crate::Diagnostic])->Vec<crate::Diagnostic>{
    let mut groups=std::collections::BTreeMap::<String,Vec<&crate::Diagnostic>>::new();
    let mut out=Vec::new();
    for n in notes{
        if !matches!(n.code.as_str(),"N_INVARIANT_RESTATES_RULE"|"N_ROLE_WIDE_READ"|"N_ROLE_WIDE_WRITE"){out.push(n.clone());continue;}
        let table=if n.code=="N_ROLE_WIDE_WRITE"{n.message.split("write any ").nth(1).and_then(|s|s.split_whitespace().next())}
            else{n.message.split_whitespace().next().filter(|s|s.contains('.')).and_then(|s|s.split('.').next())};
        if let Some(table)=table.filter(|s|!s.is_empty()){groups.entry(table.into()).or_default().push(n);}else{out.push(n.clone());}
    }
    for (table,notes) in groups{
        let site=notes.iter().map(|n|&n.site).min_by_key(|s|(&s.file,s.line,s.col)).unwrap();
        let subjects=notes.iter().map(|n|n.message.split(": ").next().unwrap_or(&n.message).split(" matches").next().unwrap_or("").to_owned()).collect::<std::collections::BTreeSet<_>>();
        let subjects=subjects.into_iter().filter(|s|s.len()<100).collect::<Vec<_>>().join(", ");
        let code=if notes.iter().any(|n|matches!(n.code.as_str(),"N_ROLE_WIDE_READ"|"N_ROLE_WIDE_WRITE")){"N_TABLE_QUESTIONNAIRE"}else{"N_INVARIANT_RESTATES_RULE"};
        out.push(crate::Diagnostic::new(site,code,format!("{table}: confirm role, row relationship, lifecycle and private-column intent ({subjects}; {} underlying questions). Answer the per-table questionnaire in snapback/generated/security-invariants.q.draft; check --json keeps every audience, source site and individual review ID",notes.len()),"keep confirmed specification intent; narrow unintended authority; record individual decisions with check --ack-security <ID> --reason '<spec rationale>'").guide("security"));
    }
    out
}


/// One registry for blocking individual reviews and their human presentation.
pub const GATED_NOTE_CODES: &[&str] = &[
    "N_RETAINED_ROLE_GRANT", "N_OPTIONAL_UPLOAD_CREATE", "N_CREATE_EDIT_ASYMMETRY",
    "N_PRIVATE_CREATE_EDIT_ASYMMETRY", "N_PRESENCE_LOOSENING",
];
pub fn gated_note(code: &str) -> bool { GATED_NOTE_CODES.contains(&code) }

/// One consequence ordering shared by check and audit. Lower means more urgent.
pub fn note_priority(code: &str) -> u8 {
    match code {
        "N_RETAINED_ROLE_GRANT" | "N_OPTIONAL_UPLOAD_CREATE" | "N_PRESENCE_LOOSENING" => 0,
        "N_PRIVILEGE_ESCALATION" | "N_SELF_CLAIMED_RELATIONSHIP" | "N_PRIVATE_CREATE_EDIT_ASYMMETRY" => 1,
        "N_GRANT_OUTLIVES_ROLE" | "N_OPTIONAL_EVIDENCE" | "N_ROLE_WIDE_READ" |
        "N_BROAD_READ" | "N_CALLER_TIME" | "N_SWEEP_ONLY_DEADLINE" |
        "N_CREATION_REASON" | "N_CREATION_MONEY" | "N_CONSTANT_APPROVAL" |
        "N_TRANSITION_BYPASS" | "N_STALE_CREATION_CHECK" | "N_DURATION_BOUNDS" |
        "N_TABLE_QUESTIONNAIRE" | "N_APPROVAL_NOT_ENFORCED" | "N_EDIT_AFTER_APPROVAL" |
        "N_CHILD_EVIDENCE_PRESENCE" | "N_TIME_TRANSITION" | "N_GUARD_NOT_CONSUMED" |
        "N_CALENDAR_DURATION" | "N_DEPENDENT_WINDOW" | "N_ROLE_WIDE_WRITE" | "N_CREATE_EDIT_ASYMMETRY" | "N_EVIDENCE_REMOVAL" => 2,
        "N_DERIVED_WRITE_AUTHORITY" | "N_INSERT_WRITE_INTENT" | "N_ARGUMENT_GRANT" | "N_WRITE_DENIED" | "N_PROBE_ONLY_READ" | "N_UNREADABLE_PROBE" | "N_MAINTAIN_AUTHORIZATION" => 3,
        "N_LOOKUP_FILTERED" | "N_QUERY_FILTERED" | "N_UNIQUE_HIDDEN" | "N_SPARSE_FILTER" | "N_MAINTAINED_COLUMN_DISCLOSURE" => 6,
        "N_COLUMN_RESULT_EXPOSURE" => 5,
        "N_INVARIANT_RESTATES_RULE" => 6,
        "N_SECURITY_INTENT" => 7,
        _ if gated_note(code) => 0,
        _ => 4,
    }
}

impl Report {
    /// Full structured evidence remains in the report; this is a human action list.
    pub fn action_text(&self, limit: usize) -> String {
        let failures = self.invariants.iter().filter(|v| v.status == Status::Refuted &&
            v.counterexample.as_ref().is_some_and(|c| c.reachability.is_reachable())).collect::<Vec<_>>();
        let compact=questionnaire_notes(&self.notes);
        let mut notes = compact.iter().collect::<Vec<_>>();
        notes.sort_by_key(|n| (note_priority(&n.code), n.site.file.clone(), n.site.line, n.site.col, &n.code, &n.message));
        notes.dedup_by(|a,b| a.site == b.site && a.code == b.code && a.message == b.message);
        let mut out = format!("security actions: {} fix{}, {} review{}\n", failures.len(),
            if failures.len() == 1 { "" } else { "es" }, notes.len(), if notes.len() == 1 { "" } else { "s" });
        for v in &failures {
            let c = v.counterexample.as_ref().unwrap();
            out.push_str(&format!("  FIX {}: {} via {} as {} ({}); tighten enforcement to the declared intent, then run snapback4 test\n",
                v.invariant.site, v.invariant.target_label(), c.operation, c.viewer, serde_json::to_value(&c.reachability).unwrap().as_str().unwrap()));
        }
        let mut shown = 0;
        for note in notes.iter().enumerate().filter_map(|(i,n)|
            (i < limit || note_priority(&n.code) <= 3).then_some(*n)) {
            shown += 1;
            let message=if note.code=="N_INSERT_WRITE_INTENT"{note.message.replace("insert/upsert","insert, or edit an existing row via upsert")}else{note.message.clone()};
            out.push_str(&format!("  DECISION {} {}: {}; is this intended?\n    Repair: {}\n    Intended: check --json for the source-bound decision ID; check --ack-security ID --reason '<spec rationale>'\n",note.site,note.code,message.trim_end_matches(['.', '?']),note.rewrite));
        }
        if shown < notes.len() { out.push_str(&format!("  {} more reviews: snapback4 audit --all or check --verbose\n", notes.len()-shown)); }
        let proved = self.invariants.iter().filter(|v| v.status == Status::Proved).count();
        let refuted = self.invariants.iter().filter(|v|v.status==Status::Refuted).count();
        let unproved = self.invariants.len()-proved-refuted;
        let enforced=self.invariants.iter().filter(|v|v.status==Status::Unproved&&v.direct_rule==Status::Proved).count();
        out.push_str(&format!("security: {proved} proved, {refuted} refuted; {enforced} enforced by rule (additional paths not proved); {} other unproved ({} failing)\n",unproved-enforced, failures.len()));
        let supplemental = self.invariants.iter().filter(|v| v.status == Status::Refuted &&
            v.counterexample.as_ref().is_some_and(|c| !c.reachability.is_reachable())).count();
        if supplemental > 0 {out.push_str(&format!("  {supplemental} seed/synthetic observations are non-failing\n"));}
        if unproved > 0 || !self.campaign_coverage.is_empty() {
            out.push_str(&format!("  next: snapback4 test; {} coverage gaps (audit --all/JSON keeps every reason)\n",self.campaign_coverage.len()));
        }
        if self.invariants.is_empty() {out.push_str("  next: answer snapback/generated/security-invariants.q.draft from the spec; declare intent and run snapback4 test\n");}
        out
    }
}
