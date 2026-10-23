//! An admitted program invocation is private process state, not an HTTP id.
use super::{Context, Engine, MutationAcknowledgement};
use crate::{Refusal, identity::{RequestAuthority, ServiceSample}};
use std::{sync::{Arc, Mutex}, time::{Duration, Instant}};

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
}
pub(super) struct Identity {
    binding: Option<(String, String, String, String)>,
    pub result: Option<Result>,
}
impl Invocation {
    pub fn new(name: impl Into<String>, id: Option<String>, context: Context) -> Self {
        let admitted = Instant::now();
        Self { name: name.into(), id, context, authority: None,
            identity: Arc::new(Mutex::new(Identity { binding: None, result: None })),
            admitted, deadline: admitted + Duration::from_millis(100), minted: Vec::new() }
    }
    /// The resolver and authority clock are sampled again for every attempt.
    pub fn authorized(mut self, digest: String,
        sample: impl FnMut() -> ServiceSample + Send + 'static,
        check: impl FnMut(RequestAuthority) -> std::result::Result<(), Refusal> + Send + 'static,
    ) -> Self {
        self.authority = Some(Authority { digest, sample: Box::new(sample), check: Box::new(check) });
        self
    }
    pub(super) fn bind(&self, engine: &Engine) -> std::result::Result<(), Refusal> {
        let raw = self.context.wire_args.clone().unwrap_or_else(|| serde_json::Value::Object(crate::wire::map_to_json(&self.context.args)));
        let binding = (engine.store_id.clone(), self.context.viewer.clone(), self.name.clone(),
            crate::receipts::payload_digest(&serde_json::json!([raw, self.id, self.context.kind, self.context.now, self.context.new_ids, self.context.delivery_fingerprint])));
        let mut identity = self.identity.lock().unwrap();
        if identity.binding.as_ref().is_some_and(|previous| previous != &binding) {
            return Err(Refusal::new("E_STORE_REPLACED", "store", "private invocation identity belongs to different intent or store incarnation"));
        }
        identity.binding = Some(binding);
        Ok(())
    }
    pub(super) fn remember(&self, result: Result) -> Result {
        self.identity.lock().unwrap().result = Some(result.clone());
        result
    }
    pub(super) fn cached(&self) -> Option<Result> { self.identity.lock().unwrap().result.clone() }
}

impl Engine {
    /// Execute one admitted invocation. The queue supplies admission time; a
    /// duplicated internal command receives the same terminal outcome.
    pub fn invoke_program(&mut self, invocation: &mut Invocation) -> Result {
        invocation.bind(self)?;
        if let Some(result) = invocation.cached() { return result; }
        let result = if let Some(authority) = invocation.authority.as_mut() {
            self.mutate_authorized(&invocation.name, invocation.id.as_deref(), invocation.context.clone(),
                &authority.digest, &mut authority.sample, &mut authority.check)
        } else {
            self.mutate_acknowledged(&invocation.name, invocation.id.as_deref(), invocation.context.clone()).map_err(|error| error.refusal())
        };
        invocation.remember(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_internal_command_and_new_unkeyed_invocation() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table counts:\n  n: int\n  public\n  insert <- allow\n  update <- allow\nmutation increment():\n  c = counts[\"c\"]\n  upsert counts[\"c\"] { n: (c.n ?? 0) + 1 }\n  return counts[\"c\"]\n".into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
        let programs = bound.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap());
        let mut engine = Engine::new_at(crate::store_port::AnyStore::memory().unwrap(), schema, programs, 1000).unwrap();
        let mut first = Invocation::new("increment", None, Context::new("alice", Default::default()).at(1000));
        let a = engine.invoke_program(&mut first).unwrap();
        let b = engine.invoke_program(&mut first).unwrap();
        assert_eq!(a.outcome, b.outcome);
        assert_eq!(engine.seq().unwrap(), 1);
        let mut second = Invocation::new("increment", None, Context::new("alice", Default::default()).at(1000));
        engine.invoke_program(&mut second).unwrap();
        assert_eq!(engine.seq().unwrap(), 2);
        assert_eq!(engine.store().test_support_conn().query_row("SELECT count(*) FROM _ops", [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
}
