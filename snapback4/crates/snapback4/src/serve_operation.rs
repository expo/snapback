//! Wire judgment follows the bound receipt, and refusals authenticate their cut.
use super::*;

pub(super) struct Prepared {
    pub capability: snapback4_core::identity::Capability,
    pub payload: Json,
    pub args_json: Json,
    pub args: BTreeMap<String, snapback4_core::Value>,
    pub delivery_fingerprint: Option<String>,
    pub ephemeral: bool,
}
pub(super) struct Reply { pub status: u16, pub body: Json }

struct Judgment { status: u16, why: Refusal, argument: bool, pending: Option<String> }
impl Judgment {
    fn operation(status: u16, why: Refusal) -> Self { Self { status, why, argument: false, pending: None } }
    fn argument(why: Refusal) -> Self { Self { status: 200, why, argument: true, pending: None } }
    fn reply(self, mutation: bool, payload: &Json, metadata: (String, u64, u64)) -> Reply {
        let (store_id, head, generation) = metadata;
        if let Some(viewer) = self.pending { return Reply { status: 200, body: json!({"loading":true,"complete":false,"data":null,"store_id":store_id,"seq":head,"generation":generation,"tables":[],"viewer":viewer}) }; }
        let body = if self.argument && mutation {
            mutation_reply(json!({"state":"failed","id":payload.get("id"),"why":self.why,"store_id":store_id,"head":head,"generation":generation}))
        } else { json!({"denied":self.why,"store_id":store_id,"head":head,"generation":generation}) };
        Reply { status: if self.argument && !mutation {400} else {self.status}, body }
    }
}

fn judge(shared: &Shared, engine: Option<&Engine>, name: &str, payload: Json, capability: snapback4_core::identity::Capability, mutation: bool) -> Result<Prepared, Judgment> {
    let args_json = payload.get("args").cloned().unwrap_or(json!({}));
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — all of these judgments run only after a keyed preflight miss.
    let bound = lock(&shared.bound);
    let program = match engine { Some(engine) => engine.program(name).cloned(), None => bound.programs.iter().find(|p| p.program.name == name).map(|p| p.program.clone()) };
    let schema = engine.map_or(&bound.schema, |e| e.schema());
    let delivery_fingerprint = if mutation {
        let fingerprint = ephemeral::delivery_fingerprint(&payload).map_err(|why| Judgment::operation(200, why))?;
        schema.check_delivery(name, fingerprint.as_deref()).map_err(|e| Judgment::argument(e.refusal()))?;
        fingerprint
    } else { None };
    let ephemeral = mutation && schema.operations.get(name).is_some_and(|fact| fact.ephemeral);
    let Some(program) = program else {
        if !mutation && lock(&shared.readers).pending(name) { return Err(Judgment { status: 200, why: Refusal::new("E_OP", "op", "pending operation"), argument: false, pending: Some(capability.0) }); }
        return Err(Judgment::operation(404, dev_doors::stale(shared, Refusal::new("E_OP", "op", format!("unknown operation {name}")).guide("programs"))));
    };
    drop(bound);
    // Ephemeral admission retains its own decoder and response envelope.
    let args = if ephemeral { BTreeMap::new() } else {
        if let Some(why) = dev_doors::persona_argument(shared, &program.args, &args_json) { return Err(Judgment::argument(why)); }
        wire::arguments_from_json_with_refusal(&program, &args_json).map_err(|why| {
            Judgment::argument(if why.guide.as_deref() == Some("programs") { dev_doors::stale(shared, why) } else { why })
        })?
    };
    if !mutation && program.kind != ProgramKind::Query {
        return Err(Judgment::operation(400, Refusal::new("E_OP", "op", format!("{name} is a mutation; POST /m/{name}"))));
    }
    if mutation && program.kind == ProgramKind::Query {
        return Err(Judgment::operation(400, Refusal::new("E_OP", "op", format!("{name} is a query; POST /q/{name}"))));
    }
    if mutation && program.kind == ProgramKind::Job {
        return Err(Judgment::operation(400, Refusal::new("E_OP", "op", format!("{name} is a job: a schedule fires it, or `snapback4 run {name}` does (in dev also POST /dev/jobs/{name} with {{\"args\":{{..}}}}); no client call can")).guide("jobs")));
    }
    Ok(Prepared { capability, payload, args_json, args, delivery_fingerprint, ephemeral })
}

fn denied(why: Refusal) -> Reply { Reply { status: if why.retryable {503} else {401}, body: json!({"denied":why}) } }

pub(super) fn prepare(request: &Request, shared: &Shared, name: &str, body: &str, capability: snapback4_core::identity::Capability) -> Result<Prepared, Reply> {
    let mutation = request.url().starts_with("/m/");
    let admission = session_identity::Admission::capture(request, shared).map_err(denied)?;
    let payload: Json = match serde_json::from_str(if body.is_empty() {"{}"} else {body}) {
        Ok(value) => value,
        Err(error) => {
            let judgment = Judgment::operation(400, Refusal::new("E_INPUT", "input", format!("the request body is not JSON: {error}")));
            let reply = shared.request_snapshot(admission, move |_, engine, _, snapshot| Ok(judgment.reply(mutation, &Json::Null, (snapshot.store_id.clone(), snapshot.head, engine.generation())))).map_err(denied)?;
            return Err(reply);
        }
    };
    if mutation { #[cfg(test)] test_work(&shared.mutation_wait); }
    let prepared = if mutation && payload.get("id").and_then(Json::as_str).is_some() {
        let name = name.to_owned();
        let principal = capability.0.clone();
        let result = shared.request_snapshot(admission, move |shared, engine, capability, snapshot| {
            if capability.0 != principal { return Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again")); }
            let metadata = (snapshot.store_id.clone(), snapshot.head, engine.generation());
            let id = payload["id"].as_str().unwrap();
            let args = payload.get("args").cloned().unwrap_or(json!({}));
            let receipt = snapshot.replay_bound(&principal, id, &name, &args).map_err(|e| e.refusal());
            // Fetch together; in memory the store binding still has precedence
            // over either the receipt hit or its name/digest mismatch.
            let replay = head::intent_store_id(&payload, Some(&snapshot.store_id)).and(receipt);
            match replay {
                Ok(Some(outcome)) => {
                    let mut body = outcome.reply(Some(id));
                    body["store_id"] = json!(snapshot.store_id); body["head"] = json!(snapshot.head); body["generation"] = json!(engine.generation());
                    Ok(Err(Reply { status: 200, body }))
                }
                Err(why) => Ok(Err(Reply { status: if why.retryable {503} else {200}, body: mutation_reply(json!({"state":"failed","id":id,"why":why,"store_id":snapshot.store_id,"head":snapshot.head,"generation":engine.generation()})) })),
                Ok(None) => Ok(judge(shared, Some(engine), &name, payload.clone(), capability, true).map_err(|why| why.reply(true, &payload, metadata))),
            }
        }).map_err(denied)?;
        result?
    } else {
        let binding = if mutation { head::intent_store_id(&payload, lock(&shared.wake).store_id.as_deref()).map_err(Judgment::argument) } else { Ok(()) };
        match binding.and_then(|()| judge(shared, None, name, payload.clone(), capability, mutation)) {
            Ok(value) => value,
            Err(_) => {
                let name = name.to_owned();
                // The program may change while reader checkout waits. Re-judge
                // against the generation authenticated by the refusal snapshot.
                shared.request_snapshot(admission, move |shared, engine, capability, snapshot| {
                    let binding = if mutation { head::intent_store_id(&payload, Some(&snapshot.store_id)).map_err(Judgment::argument) } else { Ok(()) };
                    Ok(binding.and_then(|()| judge(shared, Some(engine), &name, payload.clone(), capability, mutation))
                        .map_err(|why| why.reply(mutation, &payload, (snapshot.store_id.clone(), snapshot.head, engine.generation()))))
                }).map_err(denied)??
            }
        }
    };
    if mutation { #[cfg(test)] test_work(&shared.mutation_wait); }
    Ok(prepared)
}

// A handoff can change the argument contract after ingress judgment. Its early
// refusal still authenticates a fresh metadata cut, just like prepare's errors.
pub(super) fn query_argument_refusal(request: Request, shared: &Shared, name: String, args: Json, context: Context) {
    let reply = session_identity::Admission::capture(&request, shared).and_then(|admission| {
        shared.request_snapshot(admission, move |shared, engine, _, snapshot| {
            let why = match query_readers::query_context(engine, shared, &name, &args, context) {
                Err(why) => why,
                Ok(_) => return Err(snapback4_core::RuntimeError::Generation("the query argument contract changed; retry the request".into()).refusal()),
            };
            Ok(Judgment::argument(why).reply(false, &Json::Null,
                (snapshot.store_id.clone(), snapshot.head, engine.generation())))
        })
    }).unwrap_or_else(denied);
    respond_timed(request, shared, reply.status, reply.body)
}

// The wire envelope carries no reliable adoption provenance: stale readers and
// foreign activation share E_GENERATION. Use the lead's bounded-retry fallback.
pub(super) fn generation_reply(body: Json) -> Json {
    let mut why = body.get("denied").or_else(|| body.get("why")).expect("generation refusal").clone();
    why["retryable"] = json!(true);
    json!({"denied":why,"complete":false})
}
