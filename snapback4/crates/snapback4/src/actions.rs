//! The request waits here; the engine never calls the application's worker.
use super::*;
use snapback4_core::engine::actions::{ActionClaim, ActionRequest, ActionSettled, SESSION_SECONDS};

fn failure(error: &snapback4_core::RuntimeError) -> Refusal {
    error.refusal()
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

fn outcome(run: &ActionRequest, replayed: bool) -> Json {
    let mut body = match run.state.as_str() {
        "done" => json!({ "state": "done", "id": run.id, "result": run.result }),
        "failed" => json!({ "state": "failed", "id": run.id, "why": Refusal::new("E_ACTION_FAILED", "action", run.error.as_deref().unwrap_or("the handler failed")).guide("actions") }),
        _ => {
            let mut why = Refusal::new("E_ACTION_PENDING", "action", "the action is still pending; retry with the same id to collect its result").guide("actions");
            why.retryable = true;
            json!({ "state": "pending", "id": run.id, "why": why })
        }
    };
    if replayed { body["replayed"] = json!(true); }
    body
}

fn claim_json(claim: &ActionClaim) -> Json {
    let run = &claim.request;
    let session = &claim.session;
    json!({ "id": run.id, "action": run.action, "args": wire::map_to_json(&run.args), "principal": run.principal, "attempt": run.attempt, "at": run.at, "session": { "principal": session.principal, "kind": session.kind, "token": session.token, "expiresAt": session.expires_at } })
}

fn arguments(program: &snapback4_core::Program, json: &Json) -> Result<BTreeMap<String, snapback4_core::Value>, snapback4_core::RuntimeError> {
    let fields = json.as_object().ok_or_else(|| snapback4_core::RuntimeError::Input("action args must be an object".into()))?;
    fields.iter().map(|(name, value)| {
        let kind = program.args.get(name).ok_or_else(|| snapback4_core::RuntimeError::Input(format!("undeclared action argument {name}")))?;
        wire::from_json(kind, value).map(|value| (name.clone(), value)).map_err(snapback4_core::RuntimeError::Input)
    }).collect()
}

pub(super) fn call(request: Request, shared: &Shared, name: &str, body: &str) {
    let principal = match principal_of(&request, shared) { Ok(p) => p, Err(why) => return respond(request, 401, json!({ "denied": why })) };
    let payload: Json = match serde_json::from_str(body) { Ok(Json::Object(p)) => Json::Object(p), _ => return respond(request, 400, json!({ "denied": Refusal::new("E_INPUT", "input", "an action takes { id, args }") })) };
    let Some(id) = payload.get("id").and_then(Json::as_str) else { return respond(request, 400, json!({ "denied": Refusal::new("E_INPUT", "input", "mint an id on the client and reuse it when retrying this action") })); };
    let admitted = {
        let mut engine = lock(&shared.engine);
        // Replays are independent of a later schema change, but stay private
        // to their original principal and operation.
        match engine.action_request(id, &principal) {
            Ok(run) if run.action == name => Ok((run, true)),
            _ => {
                let args = engine.program(name).filter(|p| p.kind == ProgramKind::Action).ok_or_else(|| snapback4_core::RuntimeError::Structural { code: "E_ACTION_UNKNOWN", message: format!("no action {name} is declared") })
                    .and_then(|p| arguments(p, payload.get("args").unwrap_or(&json!({}))));
                args.and_then(|args| engine.request_action(name, id, Context::new(&principal, args)))
            }
        }
    };
    let (mut run, replayed) = match admitted { Ok(run) => run, Err(error) => { let why = failure(&error); return respond(request, if why.retryable { 503 } else { 200 }, json!({ "denied": why })); } };
    shared.committed.notify_all();
    let wait = query_params(request.url()).get("wait").and_then(|s| s.parse::<u64>().ok()).unwrap_or(25).min(25);
    let deadline = Instant::now() + Duration::from_secs(wait);
    while !matches!(run.state.as_str(), "done" | "failed") && Instant::now() < deadline {
        {
            let seq = lock(&shared.seq);
            let _ = shared.committed.wait_timeout(seq, deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(250))).unwrap_or_else(|p| p.into_inner());
        }
        // The caller's session may expire or be revoked while the handler runs.
        if let Err(why) = principal_of(&request, shared) { return respond(request, 401, json!({ "denied": why })); }
        run = match lock(&shared.engine).action_request(id, &principal) { Ok(run) => run, Err(error) => return respond(request, 503, json!({ "denied": failure(&error) })) };
    }
    if let Err(why) = principal_of(&request, shared) { return respond(request, 401, json!({ "denied": why })); }
    respond(request, if matches!(run.state.as_str(), "done" | "failed") { 200 } else { 202 }, outcome(&run, replayed));
}

pub(super) fn claim(request: Request, shared: &Shared, body: &str) {
    let payload: Json = match serde_json::from_str(body) { Ok(Json::Object(p)) => Json::Object(p), _ => return respond(request, 400, json!({ "denied": Refusal::new("E_INPUT", "input", "claim takes an object") })) };
    let action = payload.get("action").and_then(Json::as_str);
    let limit = payload.get("limit").and_then(Json::as_u64).unwrap_or(1).clamp(1, 100) as usize;
    let lease = payload.get("lease").and_then(Json::as_i64).unwrap_or(60).clamp(1, 900) * 1_000;
    let session = payload.get("session").and_then(Json::as_i64).unwrap_or(SESSION_SECONDS);
    let deadline = Instant::now() + Duration::from_secs(payload.get("wait").and_then(Json::as_u64).unwrap_or(0).min(25));
    loop {
        let worker = match service_of(&request, shared) { Ok(worker) => worker, Err(why) => return respond(request, 401, json!({ "denied": why })) };
        let claimed = lock(&shared.engine).claim_actions(&worker, action, limit, lease, session, snapback4_core::now_ms());
        match claimed {
            Ok(claims) if claims.is_empty() && Instant::now() < deadline => {
                let seq = lock(&shared.seq);
                let _ = shared.committed.wait_timeout(seq, deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(1))).unwrap_or_else(|p| p.into_inner());
            }
            Ok(claims) => return respond(request, 200, json!({ "requests": claims.iter().map(claim_json).collect::<Vec<_>>(), "worker": worker })),
            Err(error) => return respond(request, 503, json!({ "denied": failure(&error) })),
        }
    }
}

pub(super) fn settle(request: Request, shared: &Shared, path: &str, body: &str) {
    let worker = match service_of(&request, shared) { Ok(worker) => worker, Err(why) => return respond(request, 401, json!({ "denied": why })) };
    let token = match single_header(&request, "x-snapback-action-lease") { Ok(Some(token)) => token.to_owned(), _ => return respond(request, 200, json!({ "denied": Refusal::new("E_ACTION_LEASE", "action", "settle with the claim's session.token in x-snapback-action-lease").guide("actions") })) };
    let payload: Json = match serde_json::from_str(body) { Ok(Json::Object(p)) => Json::Object(p), _ => return respond(request, 400, json!({ "denied": Refusal::new("E_INPUT", "input", "settlement takes { result } or { error, retry }") })) };
    let (id, done) = if let Some(id) = path.strip_prefix("/actions/").and_then(|p| p.strip_suffix("/done")) { (id, true) }
        else if let Some(id) = path.strip_prefix("/actions/").and_then(|p| p.strip_suffix("/failed")) { (id, false) }
        else { return respond(request, 404, json!({ "denied": Refusal::new("E_ACTION_UNKNOWN", "action", "no action settlement at this path") })); };
    let settled = if done { ActionSettled::Done(payload.get("result").cloned().unwrap_or(Json::Null)) }
        else { ActionSettled::Failed { error: payload.get("error").and_then(Json::as_str).unwrap_or("the handler failed").to_owned(), retry: payload.get("retry").and_then(Json::as_bool).unwrap_or(true) } };
    let Some(id) = decode_id(id) else { return respond(request, 400, json!({ "denied": Refusal::new("E_INPUT", "input", "the action id must be percent-encoded UTF-8") })); };
    let answer = lock(&shared.engine).settle_action(&id, &worker, &token, settled, snapback4_core::now_ms());
    match answer {
        Ok(run) => { shared.committed.notify_all(); respond(request, 200, json!({ "ok": true, "request": outcome(&run, false) })); }
        Err(error) => { let why = failure(&error); respond(request, if why.retryable { 503 } else { 200 }, json!({ "denied": why })); }
    }
}
