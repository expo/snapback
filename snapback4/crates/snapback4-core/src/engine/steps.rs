//! Store-neutral transition policy for durable external steps.
//!
//! A storage adapter is borrowed from an already-authorized writer
//! transaction. The policy here validates values and decides transitions;
//! adapters only read and apply those decisions to their owner's tables.

use crate::RuntimeError;
use serde::Serialize;
use serde_json::Value as Json;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkKind { Action, Effect }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct StepOwner<'a> {
    pub kind: WorkKind,
    pub id: &'a str,
}

impl<'a> StepOwner<'a> {
    pub(crate) fn action(id: &'a str) -> Self { Self { kind: WorkKind::Action, id } }
    pub(crate) fn effect(id: &'a str) -> Self { Self { kind: WorkKind::Effect, id } }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StepClaim(String);

impl StepClaim {
    pub(crate) fn from_token(token: &str) -> Self { Self(crate::identity::digest(token)) }
    pub(crate) fn from_digest(digest: String) -> Self { Self(digest) }
    pub(crate) fn digest(&self) -> &str { &self.0 }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum StepState { Started, Done, Parked, Other(String) }

impl StepState {
    pub(crate) fn from_stored(state: String) -> Self {
        match state.as_str() {
            "started" => Self::Started,
            "done" => Self::Done,
            "parked" => Self::Parked,
            _ => Self::Other(state),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct StepRecord {
    pub input_digest: String,
    pub provider_key: String,
    pub state: StepState,
    pub claim: StepClaim,
    pub result: Option<Json>,
}

/// The mutations one work-kind adapter performs inside its caller's writer
/// transaction. The shared policy decides when to invoke the owner's existing
/// finish helper; the adapter does not define a second finish policy.
pub(crate) trait StepTransaction {
    fn record(&self, owner: StepOwner<'_>, name: &str) -> Result<Option<StepRecord>, RuntimeError>;
    fn insert(&mut self, owner: StepOwner<'_>, step: &PreparedBegin<'_>, at: i64) -> Result<(), RuntimeError>;
    fn take_over(&mut self, owner: StepOwner<'_>, name: &str, claim: &StepClaim) -> Result<(), RuntimeError>;
    fn complete(&mut self, owner: StepOwner<'_>, name: &str, result: &str, at: i64) -> Result<(), RuntimeError>;
    fn park(&mut self, owner: StepOwner<'_>, name: &str, error: &str) -> Result<(), RuntimeError>;
    fn finish_parked(&mut self, owner: StepOwner<'_>, code: &str, error: &str, at: i64) -> Result<(), RuntimeError>;
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Step {
    pub state: String,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Json>,
}

pub(crate) struct PreparedBegin<'a> {
    pub name: &'a str,
    input_digest: String,
    provider_key: String,
    claim: StepClaim,
    reconcile: bool,
}

impl PreparedBegin<'_> {
    pub(crate) fn input_digest(&self) -> &str { &self.input_digest }
    pub(crate) fn provider_key(&self) -> &str { &self.provider_key }
    pub(crate) fn claim(&self) -> &StepClaim { &self.claim }
}

pub(crate) struct PreparedResult<'a> {
    pub name: &'a str,
    value: &'a Json,
    encoded: String,
    oversized: bool,
    claim: StepClaim,
}

pub(crate) enum Transition<T> {
    Applied(T),
    Refused(RuntimeError),
    ClaimLost,
    CommitRefusal(RuntimeError),
}

fn invalid(code: &'static str, message: &str) -> RuntimeError {
    RuntimeError::Structural { code, message: message.into() }
}

fn validate_name(name: &str) -> Result<(), RuntimeError> {
    if name.len() > 128 || !crate::value::identity_fits(name) {
        return Err(invalid("E_STEP_INPUT", "a step name is 1–128 printable characters"));
    }
    Ok(())
}

// @ref LLP 3000.009#5.2 — provider identity is stable across attempts and distinct across work kinds.
pub(crate) fn provider_key(owner: StepOwner<'_>, name: &str) -> String {
    let domain = match owner.kind {
        WorkKind::Action => "snapback4:step:v1",
        WorkKind::Effect => "snapback4:effect-step:v1",
    };
    crate::store::payload_digest(&serde_json::json!([domain, owner.id, name]))
}

pub(crate) fn prepare_begin<'a>(owner: StepOwner<'_>, token: &str, name: &'a str, input: &Json, reconcile: bool, input_ceiling: u64) -> Result<PreparedBegin<'a>, RuntimeError> {
    validate_name(name)?;
    if serde_json::to_vec(input).map_err(|_| invalid("E_STEP_INPUT", "step input must be JSON"))?.len() as u64 > input_ceiling {
        return Err(invalid("E_STEP_INPUT", "step input exceeds the heap byte ceiling"));
    }
    Ok(PreparedBegin { name, input_digest: crate::store::payload_digest(input), provider_key: provider_key(owner, name), claim: StepClaim::from_token(token), reconcile })
}

pub(crate) fn prepare_result<'a>(token: &str, name: &'a str, result: &'a Json, output_ceiling: u64) -> Result<PreparedResult<'a>, RuntimeError> {
    validate_name(name)?;
    let encoded = serde_json::to_string(result).map_err(|_| invalid("E_STEP_RESULT", "a step result must be JSON"))?;
    Ok(PreparedResult { name, value: result, oversized: encoded.len() as u64 > output_ceiling, encoded, claim: StepClaim::from_token(token) })
}

pub(crate) fn prepare_park(name: &str) -> Result<(), RuntimeError> { validate_name(name) }

// @ref LLP 3000.009#5.2 — completed work replays; uncertain work reconciles by key or parks instead of repeating blindly.
pub(crate) fn begin(tx: &mut impl StepTransaction, owner: StepOwner<'_>, step: &PreparedBegin<'_>, now: i64) -> Result<Transition<Step>, RuntimeError> {
    let Some(previous) = tx.record(owner, step.name)? else {
        tx.insert(owner, step, now)?;
        return Ok(Transition::Applied(Step { state: "run".into(), key: step.provider_key.clone(), result: None }));
    };
    if previous.input_digest != step.input_digest {
        return Ok(Transition::Refused(invalid("E_STEP_INPUT", "this step name already binds another input")));
    }
    if previous.state == StepState::Done {
        return Ok(Transition::Applied(Step { state: "done".into(), key: previous.provider_key, result: previous.result }));
    }
    if previous.claim == step.claim {
        return Ok(Transition::Refused(invalid("E_STEP_BUSY", "this attempt already started the step; join its in-flight call")));
    }
    if step.reconcile {
        tx.take_over(owner, step.name, &step.claim)?;
        return Ok(Transition::Applied(Step { state: "reconcile".into(), key: previous.provider_key, result: None }));
    }
    tx.park(owner, step.name, "no recorded outcome; reconciliation required")?;
    tx.finish_parked(owner, "E_STEP_PARKED", "an external step has no recorded outcome; reconcile its provider key or inspect it before replacing this work", now)?;
    Ok(Transition::CommitRefusal(invalid("E_STEP_PARKED", "the invocation is parked: an external step needs reconciliation")))
}

pub(crate) fn complete(tx: &mut impl StepTransaction, owner: StepOwner<'_>, step: &PreparedResult<'_>, now: i64) -> Result<Transition<Step>, RuntimeError> {
    let Some(previous) = tx.record(owner, step.name)? else {
        return Ok(Transition::Refused(invalid("E_STEP_UNKNOWN", "begin the step before recording its outcome")));
    };
    if previous.claim != step.claim { return Ok(Transition::ClaimLost); }
    if step.oversized {
        tx.park(owner, step.name, "result exceeds output byte ceiling")?;
        tx.finish_parked(owner, "E_STEP_RESULT", "a step outcome exceeds the output byte ceiling; inspect the provider before replacing this work", now)?;
        return Ok(Transition::CommitRefusal(invalid("E_STEP_RESULT", "the invocation is parked: the external step outcome exceeds the output byte ceiling")));
    }
    match previous.state {
        StepState::Done => {
            if previous.result.as_ref().map(crate::store::payload_digest) != Some(crate::store::payload_digest(step.value)) {
                return Ok(Transition::Refused(invalid("E_STEP_RESULT", "the step already has a different recorded outcome")));
            }
        }
        StepState::Started => tx.complete(owner, step.name, &step.encoded, now)?,
        StepState::Parked | StepState::Other(_) => return Ok(Transition::Refused(invalid("E_STEP_PARKED", "the step is parked"))),
    }
    Ok(Transition::Applied(Step { state: "done".into(), key: previous.provider_key, result: Some(step.value.clone()) }))
}

pub(crate) fn park(tx: &mut impl StepTransaction, owner: StepOwner<'_>, claim: StepClaim, name: &str, error: &str, now: i64) -> Result<Transition<()>, RuntimeError> {
    let Some(previous) = tx.record(owner, name)? else {
        return Ok(Transition::Refused(invalid("E_STEP_UNKNOWN", "begin the step before parking it")));
    };
    if previous.claim != claim || previous.state != StepState::Started { return Ok(Transition::ClaimLost); }
    let error: String = error.chars().take(2_000).collect();
    tx.park(owner, name, &error)?;
    tx.finish_parked(owner, "E_STEP_PARKED", "the handler could not reconcile an external step; inspect it before replacing this work", now)?;
    Ok(Transition::Applied(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_provider_keys_keep_the_v1_bytes_and_effects_have_their_own_domain() {
        let action = provider_key(StepOwner::action("work"), "mail");
        assert_eq!(action, "c3bba5ac56563e1a2d5ca3c2135fa128bbdf1c94444d18e391b339a1332a971f");
        let effect = provider_key(StepOwner::effect("work"), "mail");
        assert_eq!(effect, "568da10fc8539e3f90b8d7dc518efe0687c49fbca8223e9bbb0de45fdb41fd0e");
        assert_ne!(action, effect);
    }
}
