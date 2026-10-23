//! Conditional immutability is a store constraint, including system updates.
// @ref LLP 3000.036.004.000#3-conditional-immutability — judge the preimage; unknown never permits a change.
use super::runner::Runner;
use crate::{schema::{Effect, RuleExpr, materialize_optional_fields}, error::{RuntimeError,MeterKind}, Value};
impl Runner<'_> {
    pub(super) fn check_frozen_columns(&mut self, name:&str, old:&Value, next:&Value)->Result<(),RuntimeError>{
        let table=&self.schema.tables[name];
        let mut old=old.clone();materialize_optional_fields(&mut old,table);
        for (field,condition) in &table.frozen_columns {
            if old.field(field).ok()==next.field(field).ok(){continue;}
            let rule=RuleExpr::Not(Box::new(condition.clone()));
            let permitted=self.authorized_scratch(self.rule_scratch(&rule), &[(MeterKind::RuleProbes,super::rules::rule_probes(&rule))], |runner,allowance|runner.evaluate_sequence_rule(allowance,name,&rule,Effect::Update,None,&old))?;
            if !permitted{return Err(RuntimeError::Constraint(format!("{name}.{field} is immutable while {} holds on the old row",condition.quarry())));}
        }
        Ok(())
    }
}
