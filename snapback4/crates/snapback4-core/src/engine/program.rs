//! An admitted program invocation is private process state, not an HTTP id.
use super::{Context, Engine, MutationAcknowledgement};
use crate::{
    Refusal,
    identity::{RequestAuthority, ServiceSample},
};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

type Result = std::result::Result<MutationAcknowledgement, Refusal>;
pub(super) struct Authority {
    pub digest: String,
    pub sample: Box<dyn FnMut() -> ServiceSample + Send>,
    pub check: Box<dyn FnMut(RequestAuthority) -> std::result::Result<(), Refusal> + Send>,
}

/// Owned immutable intent plus attempt-local state. Creating another invocation
/// (even with identical bytes) deliberately creates another private identity.
// @ref LLP 3000.009.001.000.002#3.1 — ordinary unkeyed HTTP has no durable internal receipt.
pub struct Invocation {
    pub(super) name: String,
    pub(super) id: Option<String>,
    pub(super) context: Context,
    pub(super) authority: Option<Authority>,
    pub(super) identity: Arc<Mutex<Identity>>,
    pub(super) admitted: Instant,
    pub(super) deadline: Instant,
    pub(super) minted: Vec<String>,
    pub(super) final_dispatch: Option<Arc<dyn Fn(&mut dyn FnMut()) -> std::result::Result<(), crate::RuntimeError> + Send + Sync>>,
    pub(super) final_check: Option<Box<dyn Fn() -> std::result::Result<(), crate::RuntimeError> + Send>>,
    pub(super) attempts: Vec<super::program_transcript::Attempt>,
    pub(super) scope: Option<Box<dyn FnMut(&mut dyn FnMut()) + Send>>,
    #[cfg(any(test, feature = "test-support"))]
    pub(super) attribution: Option<crate::round_trips::Handle>,
}
pub(super) struct Identity {
    binding: Option<(String, String, String, String)>,
    pub result: Option<Result>,
}
impl Invocation {
    pub fn new(name: impl Into<String>, id: Option<String>, context: Context) -> Self {
        let admitted = Instant::now();
        Self {
            name: name.into(),
            id,
            context,
            authority: None,
            identity: Arc::new(Mutex::new(Identity {
                binding: None,
                result: None,
            })),
            admitted,
            deadline: admitted + Duration::from_millis(100),
            minted: Vec::new(),
            final_check: None,
            final_dispatch: None,
            attempts: Vec::new(),
            scope: None,
            #[cfg(any(test, feature = "test-support"))]
            attribution: None,
        }
    }
    /// The resolver and authority clock are sampled again for every attempt.
    pub fn authorized(
        mut self,
        digest: String,
        sample: impl FnMut() -> ServiceSample + Send + 'static,
        check: impl FnMut(RequestAuthority) -> std::result::Result<(), Refusal> + Send + 'static,
    ) -> Self {
        self.authority = Some(Authority {
            digest,
            sample: Box::new(sample),
            check: Box::new(check),
        });
        self
    }
    pub(super) fn bind(&self, engine: &Engine) -> std::result::Result<(), Refusal> {
        let raw = self.context.wire_args.clone().unwrap_or_else(|| {
            serde_json::Value::Object(crate::wire::map_to_json(&self.context.args))
        });
        let binding = (
            engine.store_id.clone(),
            self.context.viewer.clone(),
            self.name.clone(),
            crate::receipts::payload_digest(&serde_json::json!([
                raw,
                self.id,
                self.context.kind,
                self.context.now,
                self.context.supplied_ids().collect::<Vec<_>>(),
                self.context.delivery_fingerprint
            ])),
        );
        let mut identity = self.identity.lock().unwrap();
        if identity
            .binding
            .as_ref()
            .is_some_and(|previous| previous != &binding)
        {
            return Err(Refusal::new(
                "E_STORE_REPLACED",
                "store",
                "private invocation identity belongs to different intent or store incarnation",
            ));
        }
        identity.binding = Some(binding);
        Ok(())
    }
    pub(super) fn remember(&self, result: Result) -> Result {
        self.identity.lock().unwrap().result = Some(result.clone());
        result
    }
    pub(super) fn cached(&self) -> Option<Result> {
        self.identity.lock().unwrap().result.clone()
    }
    /// Host instrumentation is entered separately for each serial attempt;
    /// process state never leaks from one member to its neighbour.
    pub fn instrument(mut self, scope: impl FnMut(&mut dyn FnMut()) + Send + 'static) -> Self {
        self.scope = Some(Box::new(scope));
        self
    }
    pub(super) fn eligible(&self, engine: &Engine) -> bool {
        engine.ceilings == crate::meter::Ceilings::default()
            && !engine
                .schema
                .tables
                .values()
                .any(|table| table.not_before.is_some())
            && engine
                .programs
                .get(&self.name)
                .is_some_and(|p| {
                    if p.kind != crate::ir::ProgramKind::Mutation || p.native { return false; }
                    // @ref LLP 3000.009.001.000.002#3.2 — Postgres defers these physical rows until the vector tail; readers must stay solo.
                    let effects = crate::ir::effects::Effects::of(p, &engine.schema);
                    !effects.reads.iter().chain(&effects.writes).any(|table| matches!(table.as_str(),
                        "_commits" | "_log" | "_change_evidence" | "_outbox" | "_effect_presence" | "_ops"))
                })
            && !engine
                .schema
                .operations
                .get(&self.name)
                .is_some_and(|p| p.ephemeral)
    }
}

impl Engine {
    /// Execute one admitted invocation. The queue supplies admission time; a
    /// duplicated internal command receives the same terminal outcome.
    pub fn invoke_program(&mut self, invocation: &mut Invocation) -> Result {
        invocation.bind(self)?;
        if let Some(result) = invocation.cached() {
            return result;
        }
        #[cfg(any(test, feature = "test-support"))]
        let _guard = invocation
            .attribution
            .clone()
            .map(crate::round_trips::Handle::enter);
        let mut scope = invocation.scope.take();
        let mut result = None;
        let mut run = || {
            if result.is_some() {
                return;
            }
            let value = if let Some(authority) = invocation.authority.as_mut() {
                self.mutate_authorized_until(
                    &invocation.name,
                    invocation.id.as_deref(),
                    invocation.context.clone(),
                    &authority.digest,
                    &mut authority.sample,
                    &mut authority.check,
                    invocation.deadline,
                )
            } else {
                self.mutate_inner(
                    &invocation.name,
                    invocation.id.as_deref(),
                    invocation.context.clone(),
                    true,
                    None,
                    None,
                    invocation.deadline,
                )
                .map_err(|error| error.refusal())
            };
            result = Some(invocation.remember(value));
        };
        if let Some(scope) = scope.as_mut() {
            scope(&mut run);
        } else {
            run();
        }
        invocation.scope = scope;
        result.unwrap()
    }
}

#[cfg(test)]
#[path = "../store/program_invocation_tests.rs"]
mod tests;
