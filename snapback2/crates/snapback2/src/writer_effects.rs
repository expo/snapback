// @ref LLP 1003#4-in-the-owner — effect lifecycle operations remain on the sole writer.

use super::*;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EffectsStatus {
    pub(super) engine: String,
    pub(super) queued: u64,
    pub(super) running: u64,
    pub(super) then_pending: u64,
    pub(super) sent: u64,
    pub(super) failed: u64,
    pub(super) sent_unknown: u64,
}

impl State {
    pub(super) fn effect_declarations(
        &self,
        effect: &str,
        generation: Option<&str>,
    ) -> Result<Json, Refusal> {
        let current_generation = self.runtime().generation().hash.clone();
        let current = self.runtime().generation().effects.get(effect).cloned();
        let bound = generation
            .map(|generation| format!("effects_json:{generation}"))
            .map(|key| self.runtime().store().meta(&key))
            .transpose()
            .map_err(|error| Refusal::from_runtime(&error))?
            .flatten()
            .map(|encoded| {
                serde_json::from_str::<BTreeMap<String, snapback2_core::EffectDecl>>(&encoded)
                    .map_err(|error| {
                        Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                            error.to_string(),
                        ))
                    })
            })
            .transpose()?
            .and_then(|declarations| declarations.get(effect).cloned());
        Ok(json!({
            "currentGeneration": current_generation,
            "bound": bound,
            "current": current,
        }))
    }

    pub(super) fn wake_effects(&self) {
        if let Some(wake) = &self.effects_wake {
            let _ = wake.try_send(());
        }
    }

    pub(super) fn execute_then(
        &mut self,
        op: &str,
        args: Json,
        outbox_id: &str,
    ) -> Result<Json, Refusal> {
        let values = match operation_args(self.runtime().generation(), op, &args) {
            Ok(values) => values,
            Err(refusal) => {
                let execution = self
                    .runtime_mut()
                    .reject_then(op, outbox_id, &refusal.code, &refusal.message)
                    .map_err(|error| Refusal::from_runtime(&error))?;
                return Ok(execution_json(&execution));
            }
        };
        let now = self.now();
        let mut context = Context::system();
        context.args = values;
        context.now = Some(now);
        context.read_time = Some(now);
        context.new_ids = (0..1024).map(|_| next_id()).collect::<VecDeque<_>>();
        let execution = self
            .runtime_mut()
            .execute_then(op, context, outbox_id)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if matches!(execution.state, ExecutionState::Committed { .. }) {
            self.after_commit(execution.seq)?;
        }
        Ok(execution_json(&execution))
    }
}

pub(super) fn effects_engine() -> &'static str {
    snapback2_effects::describe()
}

pub(super) fn settle_outbox(
    runtime: &Runtime,
    id: &str,
    state: &str,
    result: Option<&Json>,
    last_error: Option<&str>,
    next_at: Option<i64>,
) -> Result<Json, Refusal> {
    runtime
        .store()
        .outbox_settle(id, state, result, last_error, next_at)
        .map_err(|error| Refusal::from_runtime(&error))?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::effects_engine;

    #[test]
    fn status_names_the_linked_effect_engine() {
        assert_eq!(effects_engine(), snapback2_effects::describe());
    }
}
