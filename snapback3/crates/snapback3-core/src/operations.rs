//! Durable named operations, independent of transport and client ID allocation.
// @ref LLP 2000#durable-operation-ownership — retry identity and terminal commit belong to the runtime.
use crate::{Context, ProgramKind, ReplayCommit, ReplayTrace, Runtime, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationRequest {
    pub intent: String,
    pub op: String,
    pub args: Json,
    pub plan_hash: String,
    pub schema_hash: String,
    #[serde(default)]
    pub trace: ReplayTrace,
}

#[derive(Debug, Error)]
pub enum OperationError {
    #[error(
        "S3_INTENT_INVALID: intent must be 1–128 ASCII letters, digits, hyphens or underscores"
    )]
    InvalidIntent,
    #[error("S3_INTENT_REUSED: this operation ID already has different request content")]
    IntentReused,
    #[error(
        "S3_OPERATION_CHANGED: operation or schema changed; preserve pending work for explicit resolution"
    )]
    Changed,
    #[error("S3_OPERATION_KIND: only named mutations accept durable operation IDs")]
    Kind,
    #[error(transparent)]
    Runtime(#[from] RuntimeError),
}

/// The engine's transaction settlement is shared with inherited replay.
/// Allocation is present only for that older internal entry point.
pub(crate) struct TerminalCommit {
    pub intent: String,
    pub request_digest: String,
    pub trace: ReplayTrace,
    pub at: i64,
    pub allocation: Option<(String, u32, u32)>,
}

impl From<&ReplayCommit> for TerminalCommit {
    fn from(replay: &ReplayCommit) -> Self {
        Self {
            intent: replay.intent.clone(),
            request_digest: replay.request_digest.clone(),
            trace: replay.trace.clone(),
            at: replay.at,
            allocation: Some((replay.grant.clone(), replay.offset, replay.count)),
        }
    }
}

impl Runtime {
    /// The caller must authenticate the actor; Context is representation, not a credential.
    /// The sole runtime owner serializes lookup, execution and successor installation.
    pub fn execute_operation(
        &mut self,
        request: &OperationRequest,
        mut context: Context,
    ) -> Result<Json, OperationError> {
        if request.intent.is_empty()
            || request.intent.len() > 128
            || !request
                .intent
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(OperationError::InvalidIntent);
        }
        let request_digest = crate::value::digest(request);
        let principal = context.viewer().to_owned();
        // Lookup precedes current schema/argument parsing: a committed operation's
        // exact response survives renamed programs and changed argument types.
        if let Some(stored) = self.store().stored_operation(&principal, &request.intent)? {
            return if stored.request_digest == request_digest {
                Ok(stored.response)
            } else {
                Err(OperationError::IntentReused)
            };
        }
        let Some((program, certificate)) = self.generation().programs().get(&request.op).cloned()
        else {
            return Err(OperationError::Changed);
        };
        if certificate.plan_hash != request.plan_hash
            || certificate.schema_hash != request.schema_hash
        {
            return Err(OperationError::Changed);
        }
        if program.kind != ProgramKind::Mutation || request.op.starts_with("__") {
            return Err(OperationError::Kind);
        }
        let at = context
            .now
            .ok_or_else(|| RuntimeError::Input("mutation needs authoritative time".into()))?;
        // Include the principal in an unambiguous canonical digest. No caller can
        // choose another principal's generated IDs by reusing an intent string.
        let namespace = crate::value::digest(&(principal.as_str(), request.intent.as_str()));
        context.use_operation_ids(namespace);
        let terminal = TerminalCommit {
            intent: request.intent.clone(),
            request_digest,
            trace: request.trace.clone(),
            at,
            allocation: None,
        };
        context.args = match crate::wire::program_args(&program, &request.args) {
            Ok(args) => args,
            Err(error) => return self.reject_operation_input(&principal, &terminal, error),
        };
        self.executions = self.executions.saturating_add(1);
        let execution = match self.engine.execute_terminal(&program, &certificate, context, &terminal) {
            Ok(execution) => execution,
            Err(error @ (RuntimeError::Input(_) | RuntimeError::Value(_) | RuntimeError::Fanout)) =>
                return self.reject_operation_input(&principal, &terminal, error),
            Err(error) => return Err(error.into()),
        };
        // Constraint handling rolls back the attempted transaction. Persist that
        // terminal separately only after rollback, with no application writes.
        if self
            .store()
            .stored_operation(&principal, &request.intent)?
            .is_none()
        {
            let response = crate::replay_mutation_response(&execution, &request.intent, None);
            self.store().record_operation_refusal(
                &principal,
                &terminal,
                &response,
                execution.seq,
            )?;
        }
        Ok(self
            .store()
            .stored_operation(&principal, &request.intent)?
            .expect("settled operation has a durable terminal")
            .response)
    }

    fn reject_operation_input(&self, principal: &str, terminal: &TerminalCommit, error: RuntimeError) -> Result<Json, OperationError> {
        // Input refusal either precedes a transaction or follows its rollback.
        // A permanent bad request must settle, not block the durable queue forever.
        let seq = self.store().commit_seq()?;
        let response = serde_json::json!({"state":"rejected","intent":terminal.intent,
            "seq":seq,"code":error.code(),"message":error.to_string()});
        self.store().record_operation_refusal(principal, terminal, &response, seq)?;
        Ok(response)
    }
}
