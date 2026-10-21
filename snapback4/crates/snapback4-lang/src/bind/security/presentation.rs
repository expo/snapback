//! Repairs lead; uncertainty stays visible without repeating every proof blocker.
// @ref LLP 3000.036.004#144-actions-precede-coverage-details — advice is separate from replayed failures.
use super::{Report, Status};

fn rank(code: &str) -> u8 {
    match code {
        "N_PRIVILEGE_ESCALATION" | "N_SELF_CLAIMED_RELATIONSHIP" => 0,
        "N_ROLE_WIDE_READ" | "N_BROAD_READ" => 1,
        "N_CALLER_TIME" | "N_SWEEP_ONLY_DEADLINE" => 2,
        "N_INVARIANT_RESTATES_RULE" => 4,
        "N_SECURITY_INTENT" => 5,
        _ => 3,
    }
}

impl Report {
    /// Full structured evidence remains in the report; this is a human action list.
    pub fn action_text(&self, limit: usize) -> String {
        let failures = self.invariants.iter().filter(|v| v.status == Status::Refuted &&
            v.counterexample.as_ref().is_some_and(|c| c.reachability.is_reachable())).collect::<Vec<_>>();
        let mut notes = self.notes.iter().collect::<Vec<_>>();
        notes.sort_by_key(|n| (rank(&n.code), n.site.to_string(), &n.code, &n.message));
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
            (i < limit || rank(&n.code) == 0).then_some(*n)) {
            shown += 1;
            out.push_str(&format!("  REVIEW {} {}: {}\n    {}\n",note.site,note.code,note.message,note.rewrite));
        }
        if shown < notes.len() { out.push_str(&format!("  {} more reviews: snapback4 audit --all or check --verbose\n", notes.len()-shown)); }
        let proved = self.invariants.iter().filter(|v| v.status == Status::Proved).count();
        let refuted = self.invariants.iter().filter(|v|v.status==Status::Refuted).count();
        let unproved = self.invariants.len()-proved-refuted;
        out.push_str(&format!("security: {proved} proved, {refuted} refuted, {unproved} unproved ({} failing)\n", failures.len()));
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
