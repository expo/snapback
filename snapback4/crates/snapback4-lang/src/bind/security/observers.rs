//! Logical observer obligations, separate from the whole declaration verdict.
// @ref LLP 3000.036.004#101-separate-observer-obligations — pull group authority back to each contributor.
use super::*;

#[derive(Clone, Debug, Serialize)]
pub struct Obligation {
    pub path: String,
    pub status: Status,
    pub reason: String,
    pub repair: Option<String>,
}
impl Obligation {
    fn implication(path: String, admission: Result<RuleExpr, String>, policy: &RuleExpr) -> Self {
        let result = admission.and_then(|a| kernel::implies(&a, policy));
        let (status, reason, repair) = match result {
            Ok(true) => (Status::Proved, "every admitted logical contributor satisfies this policy".into(), None),
            Ok(false) => (Status::Unproved, "observer authority does not imply the source policy".into(),
                Some("retain the privacy fields as bare group keys and apply the source privacy policy to this observer".into())),
            Err(why) => (Status::Unproved, why, Some("use ordinary group keys and a read rule over those keys; keep opaque/temporal derivations private".into())),
        };
        Self { path, status, reason, repair }
    }
}

pub(super) fn obligations(bound: &Bound, inv: &Invariant) -> Vec<Obligation> {
    if inv.target != "read" { return Vec::new(); }
    let Some(policy) = &inv.policy else { return Vec::new(); };
    let table = &bound.schema.tables[&inv.table];
    let mut out = vec![Obligation::implication(
        "server point/scan/planned view/count/sum/exists payload".into(),
        Ok(super::temporal::admission(table)), policy)];
    for m in bound.schema.maintains.iter().filter(|m| m.source == inv.table) {
        let admission = (|| {
            if m.row_key.is_some() || m.parent_key.is_some() || m.private.is_some()
                || !m.aliases.is_empty() || !m.computed.is_empty() || m.own_keys.is_some()
                || table.read_lifetime_sensitive()
            { return Err(format!("{} -> {}: captured/private/computed/temporal maintenance needs a contributor reduction", m.source, m.target)); }
            let target = bound.schema.table(&m.target).ok_or_else(|| format!("{}: maintained-column observer needs its owning table/field authority", m.target))?;
            if target.through.is_some() || target.read_lifetime_sensitive() {
                return Err(format!("{}: derived observer has inherited/temporal authority", m.target));
            }
            // A target group field equals that field on every contributing
            // source row. Its id/value and all lost fields have no such law.
            pullback(&target.rules.read, &m.by)
        })();
        out.push(Obligation::implication(format!("maintained {:?}: {} -> {}", m.kind, m.source, m.target), admission, policy));
        for next in bound.schema.maintains.iter().filter(|n| n.source == m.target) {
            out.push(Obligation { path: format!("derived chain {} -> {} -> {}", inv.table, m.target, next.target),
                status: Status::Unproved, reason: "downstream contributor substitution is not implemented".into(),
                repair: Some("query the directly protected aggregate, or declare and verify privacy on each derived observer".into()) });
        }
    }
    out
}

fn pullback(rule: &RuleExpr, keys: &[String]) -> Result<RuleExpr, String> {
    fn term(t: &RuleTerm, keys: &[String]) -> Result<RuleTerm, String> {
        match t {
            RuleTerm::Viewer | RuleTerm::Literal(_) => Ok(t.clone()),
            RuleTerm::Field(f) if keys.contains(f) => Ok(t.clone()),
            _ => Err("derived rule reads a value/id/lost group field or a reference without a contributor identity".into()),
        }
    }
    Ok(match rule {
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public {..} => rule.clone(),
        RuleExpr::Eq(a,b) => RuleExpr::Eq(term(a,keys)?,term(b,keys)?),
        RuleExpr::Ne(a,b) => RuleExpr::Ne(term(a,keys)?,term(b,keys)?),
        RuleExpr::Compare(op,a,b) => RuleExpr::Compare(*op,term(a,keys)?,term(b,keys)?),
        RuleExpr::And(xs) => RuleExpr::And(xs.iter().map(|r|pullback(r,keys)).collect::<Result<_,_>>()?),
        RuleExpr::Or(xs) => RuleExpr::Or(xs.iter().map(|r|pullback(r,keys)).collect::<Result<_,_>>()?),
        RuleExpr::Not(x) => RuleExpr::Not(Box::new(pullback(x,keys)?)),
        RuleExpr::Exists {table,index,key,provenance,equalities} => RuleExpr::Exists {table:table.clone(),index:index.clone(),
            key:key.iter().map(|t|term(t,keys)).collect::<Result<_,_>>()?,provenance:*provenance,
            equalities:equalities.iter().map(|(n,t)|Ok((n.clone(),term(t,keys)?))).collect::<Result<_,String>>()?},
        RuleExpr::Created {..} => return Err("created probe has no derived read contributor reduction".into()),
    })
}
