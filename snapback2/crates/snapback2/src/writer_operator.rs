use super::*;
use snapback2_core::OperatorId;

pub(super) fn operator_json(execution: &Execution) -> Json {
    let mut response = execution_json(execution);
    response["principal"] = json!("system");
    response
}

impl State {
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — attribution is ledger text only; admitting the seat never creates a principal or receipt.
    pub(super) fn require_operator(&self, by: &str) -> Result<(), Refusal> {
        if self.mode != "dev" {
            return Err(Refusal::operator_required());
        }
        if by == "system" {
            let mut refusal =
                Refusal::from_identity(&snapback2_core::IdentityError::ReservedSystem)
                    .with_site("by");
            refusal.rewrite =
                Some("set by to the operator's name, such as operator-alice".to_owned());
            return Err(refusal);
        }
        if !crate::control::valid_name(by) {
            return Err(Refusal::new(
                "E_ARGS_NAME",
                "args",
                "operator by must be 1..80 letters, numbers, dashes, or underscores",
                "set by to a name such as operator-alice",
                "operator",
            )
            .with_site("by"));
        }
        Ok(())
    }

    pub(super) fn log_operator_read(&self, op: &str, by: &str) {
        crate::watch::log(
            &self.root,
            json!({
                "kind": "operator", "principal": "system", "op": op, "by": by,
                "action": "read", "at": self.now(),
            }),
        );
    }

    pub(super) fn operator_execution(
        &mut self,
        op: &str,
        args: Json,
        by: String,
    ) -> Result<Execution, Refusal> {
        self.require_operator(&by)?;
        let kind = self.operation_kind(op, None)?;
        let values = operation_args(self.runtime().generation(), op, &args)?;
        let now = self.now();
        let execution = self
            .runtime_mut()
            .execute_operator_at(op, values, OperatorId(by.clone()), now)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if kind == ProgramKind::Query
            && matches!(
                execution.state,
                ExecutionState::Complete | ExecutionState::Capped
            )
        {
            self.log_operator_read(op, &by);
        }
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        }
        if matches!(execution.state, ExecutionState::Rejected { .. }) {
            let rejected = json!({
                "kind": "operator", "op": op, "by": by, "at": now, "seq": execution.seq,
                "principal": "system", "result": operator_json(&execution), "trace": execution.trace,
            });
            crate::watch::log(&self.root, rejected.clone());
            self.operator_rejection = Some(rejected);
        }
        Ok(execution)
    }

    pub(super) fn operator_why(
        &mut self,
        op: String,
        args: Json,
        by: String,
        query_only: bool,
    ) -> Result<Json, Refusal> {
        self.operation_kind(&op, query_only.then_some(ProgramKind::Query))?;
        let execution = self.operator_execution(&op, args, by.clone())?;
        let certificate = &self.runtime().generation().programs()[&op].1;
        Ok(json!({
            "op": op, "principal": "system", "by": by,
            "certificatePlanHash": certificate.plan_hash,
            "result": operator_json(&execution), "trace": execution.trace,
            "subscriptions": [],
        }))
    }
}
