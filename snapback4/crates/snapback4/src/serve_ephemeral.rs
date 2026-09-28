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
            store_id: engine.store().meta("store_id").unwrap_or(None),
            generation: engine.generation(),
            eph: engine.ephemeral_hub().snapshot().expect("new hub"),
        }
    }
}
#[derive(Default)]
pub(super) struct Rate {
    buckets: Mutex<BTreeMap<String, (Instant, f64)>>,
}
impl Rate {
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
        if let Ok(seq) = engine.seq() {
            let store_id = engine.store().meta("store_id").unwrap_or(None);
            let generation = engine.generation();
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
        }
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
        json!({"state":"failed","id":id,"why":refusal_json(&why),"store_id":store_id,"head":head}),
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
        Ok(p) => p,
        Err(e) => return failed(request, e),
    };
    // A name may have been durable in a previous generation. Receipt custody
    // precedes signature decoding, rate admission and ephemeral execution.
    // @ref LLP 3000.022#6 — a stored success never executes a replacement body.
    let fingerprint = match delivery_fingerprint(&payload) {
        Ok(value) => value,
        Err(why) => return failed(request, why),
    };
    {
        let mut engine = lock(&shared.engine);
        let preflight = mutation_authority(&request, shared, &engine, &principal)
            .and_then(|()| intent_store(&engine, &payload))
            .and_then(|()| {
                let args = payload.get("args").cloned().unwrap_or(json!({}));
                id.as_deref().map(|id| engine.replay_mutation(&principal, id, op, &args))
                    .transpose().map(Option::flatten).map_err(|e| e.refusal())
            });
        match preflight {
            Ok(Some(out)) => {
                let (store_id, head) = match response_head(&mut engine) {
                    Ok(value) => value,
                    Err(why) => return respond_timed(request, shared, 503, json!({"denied":why})),
                };
                let mut reply = out.reply(id.as_deref());
                reply["store_id"] = json!(store_id);
                reply["head"] = json!(head);
                return respond_timed(request, shared, 200, reply);
            }
            Err(why) => return failed(request, why),
            Ok(None) => {
                if let Err(error) = engine.schema().check_delivery(op, fingerprint.as_deref()) {
                    return failed(request, error.refusal());
                }
            }
        }
    }
    // Bearer digests identify sessions without retaining secrets. Dev personas
    // have no session token and each principal is their development session.
    let key = crate::auth::bearer_token(&request)
        .map(|token| snapback4_core::value::digest(&token))
        .unwrap_or_else(|_| format!("persona:{principal}"));
    if !shared.ephemeral_rate.admit(key, Instant::now()) {
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
        .map(|p| p.program.args.clone());
    let Some(signature) = signature else {
        return failed(
            request,
            Refusal::new("E_OP", "op", format!("unknown operation {op}")),
        );
    };
    let empty = json!({});
    let args_json = payload.get("args").unwrap_or(&empty);
    let Some(fields) = args_json.as_object() else {
        return failed(
            request,
            Refusal::new("E_INPUT", "input", "args must be an object"),
        );
    };
    let mut args = BTreeMap::new();
    for (name, value) in fields {
        let Some(kind) = signature.get(name) else {
            return failed(
                request,
                Refusal::new("E_INPUT", "input", format!("{op} takes no argument {name}")),
            );
        };
        match wire::from_json(kind, value) {
            Ok(value) => {
                args.insert(name.clone(), value);
            }
            Err(why) => {
                return failed(
                    request,
                    Refusal::new("E_INPUT", "input", format!("argument {name}: {why}")),
                );
            }
        }
    }
    #[cfg(test)]
    test_work(&shared.mutation_wait);
    let reader = {
        let engine = lock(&shared.engine);
        // @ref LLP 3000.019#3.6 — ephemeral writes also lose authority while queued for adoption.
        if let Err(why) = mutation_authority(&request, shared, &engine, &principal) {
            return failed(request, why);
        }
        shared.take_reader(&engine)
    };
    let mut context = Context::new(principal.clone(), args).at(shared.now());
    context.delivery_fingerprint = fingerprint;
    let result = match reader {
        Ok((epoch, mut reader)) => {
            let _timing = latency::EngineSpan::new();
            let result = intent_store(&reader, &payload).and_then(|()| {
                reader
                    .mutate_ephemeral(op, context)
                    .map_err(|e| e.refusal())
            });
            let store_id = reader.store().meta("store_id").ok().flatten();
            if result.is_ok() {
                lock(&shared.readers).put(&epoch, reader);
            }
            result.map(|out| (out, store_id))
        }
        // In-memory test stores have no detached SQLite connection.
        Err(_) => {
            #[cfg(test)]
            test_work(&shared.mutation_wait);
            let mut engine = lock(&shared.engine);
            mutation_authority(&request, shared, &engine, &principal)
                .and_then(|()| intent_store(&engine, &payload))
                .and_then(|()| {
                    engine
                        .mutate_ephemeral(op, context)
                        .map_err(|e| e.refusal())
                })
                .map(|out| (out, engine.store().meta("store_id").ok().flatten()))
        }
    };
    match result {
        Ok((out, store_id)) => {
            respond_timed(
                request,
                shared,
                200,
                json!({"state":"sent","id":id,"result":wire::to_json(&out.result),"ephemeral":out.ephemeral,"store_id":store_id,"head":out.seq}),
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
