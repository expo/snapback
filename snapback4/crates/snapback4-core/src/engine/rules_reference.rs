//! Frozen compound traversal from 59fb4ead1b, before update image attribution.
//! Leaves and timeline algebra were not changed by RULES3.
use super::*;
pub(crate) fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe) -> Result<bool, crate::RuntimeError> {
    let prior=probe.replace_expiry(None);
    let result=timeline(rule,viewer,old,next,false,probe);
    probe.replace_expiry(match &result {
        Ok(answer) if answer.value==Verdict::Readable => earliest(prior,answer.changes.first().map(|(t,_)|*t)),
        _ => prior,
    });
    result.map(|answer|answer.value==Verdict::Readable)
}
fn timeline(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Timeline, crate::error::RuntimeError> {
    match rule {
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let conjunction = matches!(rule, RuleExpr::And(_));
            let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
            let mut answer = Timeline::constant(decisive.not());
            for term in terms {
                answer = answer.combine(timeline(term, viewer, old, next, created_allowed, probe)?, conjunction);
                // Whole-rule expiry needs the remaining alternatives unless
                // structure/verdicts alone prove them irrelevant. An exists
                // with a permanent witness visits exactly the same branches
                // as one with a finite witness, under the same physical bound.
                // Logical guard narrowing does not assume this traversal skips
                // an operand: ordinary unique null points return a known miss
                // before touching storage (LLP 3000.013 §2.2).
                if answer.value == decisive && answer.invariant { break; }
            }
            Ok(answer)
        }
        RuleExpr::Not(inner) => {
            let mut answer = timeline(inner, viewer, old, next, created_allowed, probe)?;
            answer.value = answer.value.not();
            for (_, value) in &mut answer.changes { *value = value.not(); }
            Ok(answer)
        }
        _ => {
            probe.take_changes();
            let mut missing = false;
            let value = evaluate_leaf(rule, viewer, old, next, created_allowed, probe, &mut missing)?;
            let expiry = probe.replace_expiry(None);
            let mut answer = Timeline::constant(if probe.take_unknown() || missing { Verdict::Unknown } else if value { Verdict::Readable } else { Verdict::Denied });
            if let Some(changes) = probe.take_changes() {
                answer.changes = changes;
                answer.invariant = false;
                return Ok(answer);
            }
            // An absent witness stays absent as rows expire. Positive probes
            // (including created facts with extra tests) need their alternatives
            // in both lifetime worlds; the observed deadline cannot decide this.
            answer.invariant = rule_probes(rule) == 0 || answer.value == Verdict::Denied;
            if answer.value == Verdict::Readable && let Some(time) = expiry { answer.changes.push((time, Verdict::Denied)); }
            Ok(answer)
        }
    }
}
