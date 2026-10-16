//! Effect worker HTTP arms, kept outside the general server dispatcher.

use super::*;

fn effect_json(run: &snapback4_core::EffectRun) -> Json {
    json!({ "id": run.id, "effect": run.effect, "payload": wire::to_json(&run.payload), "state": run.state, "attempt": run.attempts, "seq": run.seq, "at": run.at, "nextAt": run.next_at, "leaseUntil": run.lease_until, "leaseToken": run.lease_token, "deadline": run.deadline, "cancelled": run.cancelled, "result": run.result.as_ref().map(wire::to_json), "error": run.error, "errorCode": run.error_code })
}

fn claim_json(run: &snapback4_core::EffectRun) -> Json {
    let mut answer = effect_json(run);
    answer["declarationContract"] = json!(run.declaration_contract);
    answer
}

fn decode_id(encoded: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(encoded.len());
    let mut chars = encoded.bytes();
    while let Some(byte) = chars.next() {
        bytes.push(if byte == b'%' {
            let high = (chars.next()? as char).to_digit(16)?;
            let low = (chars.next()? as char).to_digit(16)?;
            (high * 16 + low) as u8
        } else { byte });
    }
    String::from_utf8(bytes).ok()
}

fn worker_token(request: &Request) -> Result<String, Refusal> {
    let refused = || Refusal::new("E_AUTH", "auth", "this is a worker's door: send a live service token (`snapback4 token --service <name>`)").guide("effects");
    if !matches!(single_header(request, "x-snapback-persona"), Ok(None)) { return Err(refused()); }
    crate::auth::bearer_token(request).map(str::to_owned).map_err(|_| refused())
}

fn sample(shared: &Shared) -> snapback4_core::identity::ServiceSample {
    snapback4_core::identity::ServiceSample {
        now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire),
    }
}

fn answer_error(request: Request, error: snapback4_core::RuntimeError) {
    let refusal = error.refusal();
    let status = if refusal.code == "E_AUTH" { 401 } else if refusal.code == "E_EFFECT_UNKNOWN" { 404 } else if refusal.retryable { 503 } else { 200 };
    respond(request, status, json!({ "denied": refusal_json(&refusal) }));
}

fn field_type(field: &str, expected: &str) -> Refusal {
    Refusal::new("E_INPUT", "input", format!("{field} must be {expected} when present"))
}

fn string_field<'a>(payload: &'a Json, field: &str) -> Result<Option<&'a str>, Refusal> {
    match payload.get(field) {
        None => Ok(None),
        Some(value) => value.as_str().map(Some).ok_or_else(|| field_type(field, "a string")),
    }
}

fn bool_field(payload: &Json, field: &str) -> Result<Option<bool>, Refusal> {
    match payload.get(field) {
        None => Ok(None),
        Some(value) => value.as_bool().map(Some).ok_or_else(|| field_type(field, "a boolean")),
    }
}

fn unsigned_field(payload: &Json, field: &str) -> Result<Option<u64>, Refusal> {
    match payload.get(field) {
        None => Ok(None),
        Some(value) => value.as_u64().map(Some).ok_or_else(|| field_type(field, "a nonnegative integer")),
    }
}

fn integer_field(payload: &Json, field: &str) -> Result<Option<i64>, Refusal> {
    match payload.get(field) {
        None => Ok(None),
        Some(value) => value.as_i64().map(Some).ok_or_else(|| field_type(field, "an integer")),
    }
}

enum StepOutcome {
    Began(snapback4_core::EffectStep),
    Completed(snapback4_core::EffectStep),
    Parked,
}

pub(super) fn claim(request: Request, shared: &Shared, body: &str) {
    let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { body }) {
        Ok(Json::Object(fields)) => Json::Object(fields),
        _ => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "claim takes an object")) })),
    };
    let effect = match string_field(&payload, "effect") { Ok(value) => value.map(str::to_owned), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    let declaration_contract = match string_field(&payload, "declarationContract") { Ok(value) => value.map(str::to_owned), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    let limit = match unsigned_field(&payload, "limit") { Ok(value) => value.unwrap_or(1).clamp(1, 100) as usize, Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    let lease_ms = match integer_field(&payload, "lease") { Ok(value) => value.unwrap_or(60).clamp(1, 900) * 1_000, Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    let fenced = match bool_field(&payload, "fenced") { Ok(value) => value.unwrap_or(false), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    let wait = match unsigned_field(&payload, "wait") { Ok(value) => value.unwrap_or(0).min(25), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
    if declaration_contract.is_some() && (!fenced || effect.as_deref().is_none_or(str::is_empty)) {
        let refusal = Refusal::new("E_INPUT", "input", "declarationContract requires one nonempty effect and fenced true");
        return respond(request, 400, json!({ "denied": refusal_json(&refusal) }));
    }
    let token = match worker_token(&request) { Ok(token) => token, Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })) };
    let deadline = Instant::now() + Duration::from_secs(wait);
    loop {
        // @ref LLP 3000.009#5.2 — every long-poll turn rechecks service,
        // supervisor revision, declaration and claimability in one writer transaction.
        let claimed = {
            let mut engine = producing_engine(shared);
            if shared.hold_effects {
                engine.authorize_effect_poll_strict(&token, effect.as_deref(), declaration_contract.as_deref(), fenced, || sample(shared)).map(|()| Vec::new())
            } else {
                engine.claim_effects_strict(&token, effect.as_deref(), limit, lease_ms, fenced, declaration_contract.as_deref(), || sample(shared))
            }
        };
        if claimed.as_ref().is_ok_and(|runs| !runs.is_empty()) { shared.durable_committed(&lock(&shared.engine)); }
        match claimed {
            Ok(runs) if runs.is_empty() && Instant::now() < deadline => {
                let seq = lock(&shared.seq);
                let remaining = deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(2));
                let _ = shared.committed.wait_timeout(seq, remaining).unwrap_or_else(|poisoned| poisoned.into_inner());
                #[cfg(test)]
                test_work(&shared.effect_wait);
            }
            Ok(runs) => return respond(request, 200, json!({ "effects": runs.iter().map(claim_json).collect::<Vec<_>>() })),
            Err(error) => return answer_error(request, error),
        }
    }
}

pub(super) fn post(request: Request, shared: &Shared, path: &str, body: &str) {
    if let Some(id) = path.strip_prefix("/effects/").and_then(|tail| tail.strip_suffix("/cancel")) {
        if let Err(refusal) = service_of(&request, shared) { return respond(request, 401, json!({ "denied": refusal_json(&refusal) })); }
        let outcome = { producing_engine(shared).cancel_effect(id, shared.now()) };
        if outcome.is_ok() { shared.durable_committed(&lock(&shared.engine)); }
        return match outcome {
            Ok(run) => respond(request, 200, json!({ "ok": true, "effect": effect_json(&run) })),
            Err(error) => answer_error(request, error),
        };
    }

    if let Some(encoded_id) = path.strip_prefix("/effects/").and_then(|tail| tail.strip_suffix("/status")) {
        let Some(id) = decode_id(encoded_id).filter(|id| !id.is_empty()) else {
            return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "the effect id must be percent-encoded UTF-8")) }));
        };
        let lease = match single_header(&request, "x-snapback-effect-lease") {
            Ok(Some(token)) if !token.trim().is_empty() => token.trim().to_owned(),
            _ => return respond(request, 200, json!({ "denied": refusal_json(&Refusal::new("E_EFFECT_LEASE", "schema", "send exactly one nonempty effect claim token")) })),
        };
        let service_token = match worker_token(&request) { Ok(token) => token, Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })) };
        let outcome = { producing_engine(shared).effect_status_strict(&service_token, &id, &lease, || sample(shared)) };
        return match outcome {
            Ok(run) => respond(request, 200, json!({ "id": run.id, "attempt": run.attempts, "state": run.state, "deadline": run.deadline, "cancelled": run.cancelled, "errorCode": run.error_code })),
            Err(error) => answer_error(request, error),
        };
    }

    let payload: Json = match serde_json::from_str(if body.is_empty() { "{}" } else { body }) {
        Ok(Json::Object(fields)) => Json::Object(fields),
        _ => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "effect settlement takes an object")) })),
    };
    if let Some(tail) = path.strip_prefix("/effects/").and_then(|tail| tail.split_once("/steps/")) {
        if let Some((name, verb)) = tail.1.rsplit_once('/') {
            let (Some(id), Some(name)) = (decode_id(tail.0), decode_id(name)) else {
                return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "effect and step ids must be percent-encoded UTF-8")) }));
            };
            let field = match verb { "begin" => Some("input"), "done" => Some("result"), _ => None };
            if field.is_some_and(|field| payload.get(field).is_none()) {
                return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "a step begin requires input and a step done requires result (null is explicit)")) }));
            }
            if !matches!(verb, "begin" | "done" | "park") {
                return answer_error(request, snapback4_core::RuntimeError::Input("step routes are begin, done or park".into()));
            }
            let reconcile = if verb == "begin" {
                match bool_field(&payload, "reconcile") { Ok(value) => value.unwrap_or(false), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) }
            } else { false };
            let error = if verb == "park" {
                match string_field(&payload, "error") { Ok(value) => value.unwrap_or("the provider outcome is unknown").to_owned(), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) }
            } else { String::new() };
            let lease = match single_header(&request, "x-snapback-effect-lease") {
                Ok(Some(token)) if !token.trim().is_empty() => token.trim().to_owned(),
                _ => return respond(request, 200, json!({ "denied": refusal_json(&Refusal::new("E_EFFECT_LEASE", "schema", "send exactly one nonempty effect claim token")) })),
            };
            let service_token = match worker_token(&request) { Ok(token) => token, Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })) };
            let input = payload.get("input").unwrap_or(&Json::Null);
            let result = payload.get("result").unwrap_or(&Json::Null);
            let outcome: Result<StepOutcome, snapback4_core::RuntimeError> = {
                let mut engine = producing_engine(shared);
                (|| Ok(match verb {
                    "begin" => StepOutcome::Began(engine.begin_effect_step_strict(&service_token, &id, &lease, &name, input, reconcile, || sample(shared))?),
                    "done" => StepOutcome::Completed(engine.complete_effect_step_strict(&service_token, &id, &lease, &name, result, || sample(shared))?),
                    "park" => { engine.park_effect_step_strict(&service_token, &id, &lease, &name, &error, || sample(shared))?; StepOutcome::Parked }
                    _ => unreachable!("step verb validated before taking the engine guard"),
                }))()
            };
            shared.durable_committed(&lock(&shared.engine));
            return match outcome {
                Ok(StepOutcome::Began(step)) => respond(request, 200, json!({ "step": step })),
                Ok(StepOutcome::Completed(step)) => respond(request, 200, json!({ "ok": true, "step": step })),
                Ok(StepOutcome::Parked) => respond(request, 200, json!({ "ok": true })),
                Err(error) => answer_error(request, error),
            };
        }
    }

    let service_token = match worker_token(&request) { Ok(token) => token, Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })) };
    let (encoded_id, done) = if let Some(id) = path.strip_prefix("/effects/").and_then(|tail| tail.strip_suffix("/done")) { (id, true) }
        else if let Some(id) = path.strip_prefix("/effects/").and_then(|tail| tail.strip_suffix("/failed")) { (id, false) }
        else { return respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_EFFECT_UNKNOWN", "schema", "no effect settlement at this path")) })); };
    let Some(id) = decode_id(encoded_id) else { return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "the effect id must be percent-encoded UTF-8")) })); };
    let lease = match single_header(&request, "x-snapback-effect-lease") {
        Ok(token) => token,
        Err(()) => return respond(request, 200, json!({ "denied": refusal_json(&Refusal::new("E_EFFECT_LEASE", "schema", "send one effect claim token")) })),
    };
    let settled = if done {
        let result = match payload.get("result") {
            None | Some(Json::Null) => None,
            Some(json) => match wire::untyped(json) { Ok(value) => Some(value), Err(why) => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", format!("result: {why}"))) })) },
        };
        snapback4_core::Settled::Done { result }
    } else {
        let error = match string_field(&payload, "error") { Ok(value) => value.unwrap_or("the worker failed").to_owned(), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
        let retry = match bool_field(&payload, "retry") { Ok(value) => value.unwrap_or(true), Err(refusal) => return respond(request, 400, json!({ "denied": refusal_json(&refusal) })) };
        snapback4_core::Settled::Failed { error, retry }
    };
    let outcome = {
        let mut engine = producing_engine(shared);
        engine.settle_effect_strict(&service_token, &id, lease, settled, || sample(shared))
    };
    if outcome.is_ok() { shared.durable_committed(&lock(&shared.engine)); }
    match outcome {
        Ok(run) => {
            if !done && shared.personas { snapback4_core::diagnostic!("snapback4: effect {} {} attempt {} settled {}: {}", run.effect, run.id, run.attempts, run.state, serde_json::to_string(&run.error).unwrap_or_default()); }
            respond(request, 200, json!({ "ok": true, "effect": effect_json(&run) }))
        },
        Err(error) => answer_error(request, error),
    }
}

pub(super) fn list(request: Request, shared: &Shared, url: &str) {
    if let Err(refusal) = service_of(&request, shared) { return respond(request, 401, json!({ "denied": refusal_json(&refusal) })); }
    let params = query_params(url);
    let state = params.get("state").cloned();
    let limit: usize = params.get("limit").and_then(|value| value.parse().ok()).unwrap_or(100);
    let outcome = { producing_engine(shared).effects(state.as_deref(), limit) };
    match outcome {
        Ok(runs) => respond(request, 200, json!({ "effects": runs.iter().map(effect_json).collect::<Vec<_>>() })),
        Err(error) => answer_error(request, error),
    }
}
