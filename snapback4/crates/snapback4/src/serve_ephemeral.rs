//! The online-only mutation route and a wake state independent of the writer.
use super::*;
use snapback4_core::engine::ephemeral::{Hub, Snapshot};

pub(super) struct Wake {
    pub seq: u64,
    pub store_id: Option<String>,
    pub generation: u64,
    pub eph: Snapshot,
}
impl Wake {
    pub fn new(engine: &Engine) -> Self {
        Self {
            seq: engine.seq().unwrap_or(0),
            store_id: engine.store().store_identity().unwrap_or(None),
            generation: engine.generation(),
            eph: engine.ephemeral_hub().snapshot().expect("new hub"),
        }
    }
}
#[derive(Default)]
pub(super) struct Rate {
    buckets: Mutex<BTreeMap<String, (Instant, f64)>>,
    #[cfg(test)]
    fixed_now: Mutex<Option<Instant>>,
}
impl Rate {
    fn now(&self) -> Instant {
        #[cfg(test)]
        if let Some(now) = *lock(&self.fixed_now) {
            return now;
        }
        Instant::now()
    }
    #[cfg(test)]
    pub(super) fn set_now(&self, now: Instant) {
        *lock(&self.fixed_now) = Some(now);
    }
    pub fn admit(&self, key: String, now: Instant) -> bool {
        let mut buckets = lock(&self.buckets);
        buckets.retain(|_, (at, _)| now.saturating_duration_since(*at) < Duration::from_secs(60));
        if !buckets.contains_key(&key) && buckets.len() >= 4096 {
            return false;
        }
        let (at, tokens) = buckets.entry(key).or_insert((now, 40.0));
        *tokens = (*tokens + now.saturating_duration_since(*at).as_secs_f64() * 20.0).min(40.0);
        *at = now;
        if *tokens < 1.0 {
            false
        } else {
            *tokens -= 1.0;
            true
        }
    }
}
impl Shared {
    // @ref LLP 3000.017#3.3 — lock order engine → hub → wake.
    pub(super) fn install_ephemeral_wake(self: &Arc<Self>) {
        self.engine.bind(self);
        let owner = Arc::downgrade(self);
        self.ephemeral.set_publisher(move |snapshot| {
            if let Some(shared) = owner.upgrade() {
                let mut wake = lock(&shared.wake);
                wake.store_id = Some(snapshot.identity.clone());
                wake.generation = snapshot.generation;
                wake.eph = snapshot;
                drop(wake);
                shared.polls.notify_all();
            }
        }).expect("new hub publisher");
    }
    pub(super) fn durable_committed(&self, engine: &Engine) {
        self.publish_durable(engine, true);
    }
    pub(super) fn publish_engine(&self, engine: &Engine) {
        self.publish_durable(engine, false);
    }
    fn publish_durable(&self, engine: &Engine, committed: bool) {
        let _ = engine.continue_durable_publication(committed, |committed, seq, store_id, generation| {
            let mut current = lock(&self.seq);
            let mut wake = lock(&self.wake);
            let changed = wake.seq != seq || wake.store_id != store_id || wake.generation != generation;
            *current = seq;
            wake.seq = seq;
            wake.store_id = store_id;
            wake.generation = generation;
            // The hub publisher alone owns wake.eph. Never wait for a running
            // ephemeral program while holding the serving engine here.
            if committed || changed {
                self.polls.notify_all();
                self.committed.notify_all();
            }
            Ok(())
        });
    }
}

pub(super) fn failed(request: Request, shared: &Shared, id: Option<&str>, why: Refusal) {
    let wake = lock(&shared.wake);
    let (store_id, head) = (wake.store_id.clone(), wake.seq);
    drop(wake);
    respond_timed(
        request,
        shared,
        200,
        super::mutation_reply(json!({"state":"failed","id":id,"why":refusal_json(&why),"store_id":store_id,"head":head})),
    );
}

pub(super) fn serve(request: Request, shared: &Shared, op: &str, body: &str) {
    let payload = serde_json::from_str::<Json>(if body.is_empty() { "{}" } else { body });
    let id = payload
        .as_ref()
        .ok()
        .and_then(|p| p.get("id"))
        .and_then(Json::as_str)
        .map(str::to_owned);
    let failed = |request, why| failed(request, shared, id.as_deref(), why);
    let payload = match payload {
        Ok(p) => p,
        Err(e) => {
            return failed(
                request,
                Refusal::new(
                    "E_INPUT",
                    "input",
                    format!("the request body is not JSON: {e}"),
                ),
            );
        }
    };
    let principal = match principal_of(&request, shared) {
        Ok(p) => p.0,
        Err(e) => return failed(request, e),
    };
    // A name may have been durable in a previous generation. Receipt custody
    // precedes signature decoding, rate admission and ephemeral execution.
    // @ref LLP 3000.022#6 — a stored success never executes a replacement body.
    let fingerprint = match delivery_fingerprint(&payload) {
        Ok(value) => value,
        Err(why) => return failed(request, why),
    };
    let admission = match super::session_identity::Admission::capture(&request, shared) {
        Ok(admission) => admission,
        Err(why) => return failed(request, why),
    };
    let (owned_principal, owned_payload, owned_id, owned_op, owned_fingerprint) =
        (principal.clone(), payload.clone(), id.clone(), op.to_owned(), fingerprint.clone());
    // @ref LLP 3000.009.001.000.000#3.1 — read-only admission and checkout
    // must not park ephemeral requests behind a durable command.
    let detached = !shared.memory_store();
    let preflight = move |engine: &mut Engine, shared: &Shared| {
        if detached { admission.check_detached(shared, engine, &owned_principal)?; }
        else { admission.check(shared, engine, &owned_principal)?; }
        intent_store(engine, &owned_payload)?;
        let args = owned_payload.get("args").cloned().unwrap_or(json!({}));
        let replay = owned_id.as_deref().map(|id| engine.replay_mutation(&owned_principal, id, &owned_op, &args)).transpose().map(Option::flatten).map_err(|e| e.refusal())?;
        if let Some(out) = replay { return Ok(Some((out, response_head(engine)?))); }
        engine.require_non_media_ephemeral(&owned_principal, owned_id.as_deref()).map_err(|e| e.refusal())?;
        if owned_payload.get("retry_write").and_then(Json::as_bool) == Some(true) {
            return Err(Refusal::new("E_INPUT", "input", "retry_write requires a durable mutation; refresh the operation signature"));
        }
        engine.schema().check_delivery(&owned_op, owned_fingerprint.as_deref()).map_err(|e| e.refusal())?;
        Ok(None)
    };
    let preflight = match shared.reader() {
        Ok((epoch, mut reader)) => {
            let result = preflight(&mut reader, shared);
            lock(&shared.readers).put(&epoch, reader.into_inner());
            result
        }
        Err(_) if shared.memory_store() => shared.engine.attempt(preflight),
        Err(error) => Err(error.refusal()),
    };
    match preflight {
        Ok(Some((out, (store_id, head)))) => {
            let mut reply = out.reply(id.as_deref());
            reply["store_id"] = json!(store_id); reply["head"] = json!(head);
            return respond_timed(request, shared, 200, reply);
        }
        Err(why) => return failed(request, why),
        Ok(None) => {}
    }
    // Bearer digests identify sessions without retaining secrets. Dev personas
    // have no session token and each principal is their development session.
    let key = crate::auth::bearer_token(&request)
        .map(|token| snapback4_core::value::digest(&token))
        .unwrap_or_else(|_| format!("persona:{principal}"));
    if !shared.ephemeral_rate.admit(key, shared.ephemeral_rate.now()) {
        let mut why = Refusal::new(
            "E_RATE_LIMIT",
            "auth",
            "ephemeral writes allow 20 requests per second, burst 40; retry later",
        )
        .guide("ephemeral");
        why.retryable = true;
        return failed(request, why);
    }
    let signature = lock(&shared.bound)
        .programs
        .iter()
        .find(|p| p.program.name == op)
        .map(|p| p.program.clone());
    let Some(signature) = signature else {
        return failed(
            request,
            Refusal::new("E_OP", "op", format!("unknown operation {op}")),
        );
    };
    let empty = json!({});
    let args_json = payload.get("args").unwrap_or(&empty);
    if let Some(why)=super::dev_doors::persona_argument(shared,&signature.args,args_json) {return failed(request,why);}
    let args = match wire::arguments_from_json(&signature, args_json) {
        Ok(args) => args,
        Err(error) => return failed(request, error.refusal()),
    };
    #[cfg(test)]
    test_work(&shared.mutation_wait);
    let reader = shared.reader().map(|(epoch, reader)| (epoch, reader.into_inner()));
    let sites = shared.personas.then(|| Arc::new(lock(&shared.bound).refusal_sites.clone()));
    if let Err(error) = &reader && !shared.memory_store() { return failed(request, error.refusal()); }
    let mut context = Context::new(principal.clone(), args).at(shared.now());
    context.delivery_fingerprint = fingerprint;
    let result = match reader {
        Ok((epoch, mut reader)) => {
            if let Some(sites) = sites { context = super::dev_refusals::response::context(context, sites, &reader); }
            let _timing = latency::EngineSpan::new();
            let result = super::session_identity::Admission::capture(&request, shared)
                .and_then(|admission| admission.check_detached(shared, &reader, &principal))
                .and_then(|()| intent_store(&reader, &payload)).and_then(|()| {
                reader.require_non_media_ephemeral(&principal,id.as_deref()).map_err(|e|e.refusal())?;
                reader
                    .mutate_ephemeral(&op, context)
                    .map_err(|e| snapback4_core::engine::seat_refusal(reader.schema(),&e,&principal))
            });
            let store_id = reader.store().store_identity().ok().flatten();
            if result.is_ok() {
                lock(&shared.readers).put(&epoch, reader);
            }
            result.map(|out| (out, store_id))
        }
        // In-memory test stores have no detached SQLite connection.
        Err(_) => {
            #[cfg(test)]
            test_work(&shared.mutation_wait);
            let admission = super::session_identity::Admission::capture(&request, shared);
            let (op, id) = (op.to_owned(), id.clone());
            shared.engine.attempt(move |engine, shared| {
            if shared.personas { context = super::dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine); }
            admission?.check(shared, engine, &principal)
                .and_then(|()| intent_store(engine, &payload))
                .and_then(|()| {
                    engine.require_non_media_ephemeral(&principal,id.as_deref()).map_err(|e|e.refusal())?;
                    engine
                        .mutate_ephemeral(&op, context)
                        .map_err(|e| snapback4_core::engine::seat_refusal(engine.schema(),&e,&principal))
                })
                .map(|out| (out, engine.store().store_identity().ok().flatten()))
            })
        }
    };
    match result {
        Ok((out, store_id)) => {
            respond_timed(
                request,
                shared,
                200,
                super::mutation_reply(json!({"state":"sent","id":id,"result":wire::to_json(&out.result),"ephemeral":out.ephemeral,"store_id":store_id,"head":out.seq})),
            );
        }
        Err(why) => failed(request, why),
    }
}

pub(super) fn hub(engine: &Engine) -> Arc<Hub> {
    engine.ephemeral_hub()
}

/// Ordinary handwritten calls keep their spelling; SDK reports name the binding.
pub(super) fn delivery_fingerprint(payload: &Json) -> Result<Option<String>, Refusal> {
    let Some(delivery) = payload.get("delivery") else { return Ok(None) };
    delivery.get("fingerprint").and_then(Json::as_str).filter(|s| !s.is_empty())
        .map(|s| Some(s.to_owned())).ok_or_else(|| {
            let mut why = Refusal::new("E_DELIVERY_BINDING", "schema", "delivery needs the fingerprint collected from its binding").guide("receipts");
            why.site = Some("delivery.fingerprint".into());
            why.rewrite = Some("send delivery: { fingerprint } from the manifest or compiled binding".into());
            why
        })
}
