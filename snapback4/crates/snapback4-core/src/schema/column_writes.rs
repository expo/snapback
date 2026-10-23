//! Conjunctive payload write authority shared by all write arms.
// @ref LLP 3000.036.004.000#2-column-write-authority — defaults and both upsert arms use the ordinary rule boundary.
use super::*;
impl Table {
    pub fn guarded_rule(&self, effect: Effect) -> std::borrow::Cow<'_, RuleExpr> {
        let base = if effect == Effect::Update { self.update_rule_judged() } else { std::borrow::Cow::Borrowed(self.rules.for_effect(effect)) };
        if self.column_writes.is_empty() || !matches!(effect,Effect::Insert|Effect::Update) { return base; }
        let mut rules=vec![base.into_owned()];
        for (column,policy) in &self.column_writes {
            let same = if effect == Effect::Insert { RuleExpr::Eq(RuleTerm::Field(column.clone()),RuleTerm::Literal(Value::Null)) }
                else { RuleExpr::Eq(RuleTerm::OldField(column.clone()),RuleTerm::Field(column.clone())) };
            rules.push(RuleExpr::Or(vec![same,if effect==Effect::Insert {policy.clone()} else {policy.old_and_next()}]));
        }
        std::borrow::Cow::Owned(RuleExpr::And(rules))
    }
}
pub fn validate(schema:&Schema)->Vec<SchemaIssue>{
    let mut issues=Vec::new();
    for (name,t) in &schema.tables {
        for (column,rule) in t.column_writes.iter().chain(&t.frozen_columns) {
            let path=format!("tables.{name}.column_writes.{column}");
            if column=="id" || !t.columns.contains_key(column) || t.engine_field(column) || t.maintained.contains_key(column) || t.sequences.contains_key(column) || schema.maintain_for(name).is_some() || schema.timelines.iter().any(|timeline|timeline.owns(name)||timeline.maps(name)) || schema.receipts.iter().any(|r|r.messages==*name||r.members==*name||r.runs==*name) || t.written_by.contains_key(column) || t.on_delete.get(column)==Some(&references::OnDelete::SetNull) {
                issues.push(SchemaIssue{path:path.clone(),message:"column write/freeze needs an ordinary payload column without owner-field bypass or on delete set null".into()});
            }
            super::validate_rule(schema,t,rule,false,false,&path,&mut issues);
            if rule.any_term(&|term|matches!(term,RuleTerm::OldField(_)|RuleTerm::NextField(_))) {
                issues.push(SchemaIssue{path,message:"column write/freeze policies use current-row fields, never named transition images".into()});
            }
        }
    }
    issues
}
