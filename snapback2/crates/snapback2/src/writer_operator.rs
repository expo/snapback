use super::*;
use snapback2_core::OperatorId;

pub(super) fn operator_json(execution: &Execution) -> Json {
    let mut response = execution_json(execution);
    response["principal"] = json!("system");
    response
}

impl State {
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — the local control secret admits the seat; a dev persona name attributes it, never impersonates system.
    pub(super) fn require_operator(&mut self, by: &str) -> Result<(), Refusal> {
        if self.mode != "dev" {
            return Err(Refusal::operator_required());
        }
        let now = self.now();
        self.runtime_mut()
            .ensure_persona(by, now)
            .map_err(|error| Refusal::from_identity(&error))?;
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
        let result = self
            .runtime_mut()
            .execute_operator_at(op, values, OperatorId(by.clone()), now)
            .map_err(|error| Refusal::from_runtime(&error));
        if kind == ProgramKind::Query {
            self.log_operator_read(op, &by);
        }
        let execution = result?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
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
        self.require_operator(&by)?;
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
