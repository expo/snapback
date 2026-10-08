//! Which row images an update rule judges.
// @ref LLP 3000.007#8 — item 7(a): an unnamed `update <- R` judges the row before and after the write, `R[old] and R[next]`.
//
// The rules card and `why NOT_FOUND` say "the update rule judges old and
// next", as Postgres applies an `UPDATE` policy's `USING` to the old row and
// (absent `WITH CHECK`) to the new one. Judging only the next image let any
// caller take over another principal's row under `update <- .owner = viewer`
// by writing `owner: viewer` (found by the Lean oracle, LLP 3000.035 §5.2).
use super::{RuleExpr, RuleTerm, Table};

impl RuleExpr {
    fn terms_mut(&mut self, term: &mut dyn FnMut(&mut RuleTerm)) {
        match self {
            Self::Eq(a, b) | Self::Ne(a, b) | Self::Compare(_, a, b) => { term(a); term(b); }
            Self::And(items) | Self::Or(items) => for item in items { item.terms_mut(term); },
            Self::Not(inner) => inner.terms_mut(term),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } =>
                key.iter_mut().chain(equalities.iter_mut().map(|(_, value)| value)).for_each(term),
            Self::Public { .. } | Self::Allow | Self::Deny => {}
        }
    }

    /// An unnamed update rule's meaning: `R[old] and R[next]`, old first.
    /// In the old copy `.f` becomes `old.f` and reference hops start from the
    /// old row; literals and `viewer` are unchanged.
    pub fn old_and_next(&self) -> RuleExpr {
        let mut old = self.clone();
        old.terms_mut(&mut |term| match term {
            RuleTerm::Field(field) => *term = RuleTerm::OldField(std::mem::take(field)),
            RuleTerm::Reference { old, .. } | RuleTerm::ReferenceChain { old, .. } => *old = true,
            _ => {}
        });
        Self::And(vec![old, self.clone()])
    }
}

impl Table {
    /// Whether the engine judges this table's update rule over the old image
    /// as well: true for an unnamed rule that reads a column a patch can
    /// change. A named `update (old, next)` transition is judged as written.
    /// A rule reading only `id` and immutable columns is judged once: a patch
    /// cannot change those inputs (a hidden target drops immutable patch
    /// fields; a readable mismatch is refused), so both images give one
    /// verdict at one prepaid probe cost. The decision is static, so the
    /// meter never depends on the row.
    pub fn judges_old_image(&self) -> bool {
        !self.update_transition && self.rules.update.any_term(&|term| matches!(term,
            RuleTerm::Field(column) | RuleTerm::Reference { column, .. } | RuleTerm::ReferenceChain { column, .. }
                if column != "id" && !self.constraints.iter().any(|constraint| matches!(constraint, super::Constraint::Immutable { fields } if fields.contains(column)))))
    }

    /// The update rule exactly as the engine evaluates it, for cost reports.
    pub fn update_rule_judged(&self) -> std::borrow::Cow<'_, RuleExpr> {
        if self.judges_old_image() { std::borrow::Cow::Owned(self.rules.update.old_and_next()) } else { std::borrow::Cow::Borrowed(&self.rules.update) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Constraint;
    use crate::value::Value;

    fn owner_rule() -> RuleExpr { RuleExpr::Eq(RuleTerm::Field("owner".into()), RuleTerm::Viewer) }

    #[test]
    fn unnamed_rule_judges_both_images_unless_its_inputs_are_immutable() {
        let mut table = crate::schema::public_table(Default::default(), Default::default());
        table.rules.update = owner_rule();
        assert!(table.judges_old_image());
        assert_eq!(*table.update_rule_judged(), RuleExpr::And(vec![
            RuleExpr::Eq(RuleTerm::OldField("owner".into()), RuleTerm::Viewer), owner_rule()]));
        table.constraints.push(Constraint::Immutable { fields: vec!["owner".into()] });
        assert!(!table.judges_old_image(), "immutable inputs agree on both images");
        assert_eq!(*table.update_rule_judged(), owner_rule());
        table.rules.update = RuleExpr::Eq(RuleTerm::Field("id".into()), RuleTerm::Literal(Value::Id("x".into())));
        assert!(!table.judges_old_image(), "id never changes");
        table.update_transition = true;
        table.rules.update = RuleExpr::Eq(RuleTerm::NextField("state".into()), RuleTerm::Literal(Value::Int(1)));
        assert!(!table.judges_old_image(), "a named transition is judged as written");
    }
}
