//! Authenticated, bounded controller transport. Custody is per consumer, never
//! an operation-global cursor shared by tabs. Bodies contain no work counters.
use super::*;
use snapback4_core::engine::following_history::{Request as UnitRequest, projection};

pub(super) fn serve(request: Request, shared: &Shared, operation: &str, body: &str) {
    if body.len() > 64 * 1024 {
        return respond_timed(
            request,
            shared,
            400,
            json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}),
        );
    }
    let capability = match principal_of(&request, shared) {
        Ok(p) => p,
        Err(r) => return respond_timed(request, shared, 401, json!({"denied":refusal_json(&r)})),
    };
    let (principal, _, scope) = &capability;
    // @ref LLP 3000.033#1.2 — Following custody is outside the closed read allow-list.
    // The outer guard refuses before body intake; retain the boundary here too.
    if *scope == snapback4_core::identity::SessionScope::Read {
        let why = Refusal::new(
            "E_READ_ONLY",
            "auth",
            "Following history requires a full session; ordinary inbox queries remain available",
        )
        .guide("read-only");
        return respond_timed(request, shared, 403, json!({"denied":refusal_json(&why)}));
    }
    let payload: Json = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => {
            return respond_timed(
                request,
                shared,
                400,
                json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}),
            );
        }
    };
    let facts = RequestFacts::capture(&request);
    let principal = principal.clone();
    let operation = operation.to_owned();
    #[cfg(test)]
    super::test_work(&shared.query_wait);
    let (status, bytes, pinned) = shared.engine.attempt(move |engine, shared| {
        let operation = operation.as_str();
    // Lock order is engine then controller. Authentication is checked again at
    // the same engine incarnation that owns the source read transaction.

    crate::release_requests::stamp(engine.generation());
    if let Err(r) = session_identity::Admission::capture(&facts, shared)
        .and_then(|admission| admission.check_expected(shared, engine, &capability)) {

        return (if r.retryable {503} else {401}, json!({"denied":refusal_json(&r)}).to_string(), false);
    }
    #[cfg(test)]
    super::test_work(&shared.changes_refresh);
    let Some(program) = engine.program(operation) else {

        return (200, json!({"phase":"restart"}).to_string(), false);
    };
    let Some(plan) = projection::plan(engine.schema(), program) else {

        return (200, json!({"phase":"refused","code":"E_FOLLOWING_DECLARATION"}).to_string(), false);
    };
    let binding = plan.binding;
    let mut args = BTreeMap::new();
    let Some(fields) = payload.get("args").and_then(Json::as_object) else {

        return (400, json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}).to_string(), false);
    };
    if let Some(why)=super::dev_doors::persona_argument(shared,&program.args,&Json::Object(fields.clone())) {
        return (400, json!({"phase":"refused","code":"E_FOLLOWING_INPUT","message":why.message,"denied":why}).to_string(), false);
    }
    for (name, value) in fields {
        let Some(value) = program
            .args
            .get(name)
            .and_then(|kind| wire::from_json(kind, value).ok())
        else {

            return (400, json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}).to_string(), false);
        };
        args.insert(name.clone(), value);
    }
    let now = shared.now();
    let mut reader = lock(&shared.following);
    let action = payload
        .get("action")
        .and_then(Json::as_str)
        .unwrap_or("unit");
    let answer = if action == "open" {
        reader
            .opening_projected(engine, operation, Context::new(&principal, args).at(now))
            .map(|o| json!({"opening":o.request.opening}).to_string())
    } else if let Some(opening) = payload.get("opening").and_then(Json::as_str) {
        if action == "cancel" {
            reader
                .cancel_projected(
                    engine,
                    opening,
                    operation,
                    Context::new(&principal, args).at(now),
                )
                .map(|_| json!({"phase":"restart"}).to_string())
        } else if action == "refresh" {
            let mounted = serde_json::from_value::<
                Vec<snapback4_core::engine::following_history::Mounted>,
            >(payload.get("mounted").cloned().unwrap_or(json!([])));
            let seen = serde_json::from_value::<Vec<String>>(
                payload.get("seen").cloned().unwrap_or(json!([])),
            );
            match (mounted, seen) {
                (Ok(mounted), Ok(seen)) => reader
                    .refresh_slice_metered(
                        engine,
                        opening,
                        operation,
                        Context::new(&principal, args).at(now),
                        &mounted,
                        &seen,
                    )
                    .map(|(r, _)| serde_json::to_string(&r).unwrap()),
                _ => Ok(json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}).to_string()),
            }
        } else if action == "unit"
            && payload
                .get("token")
                .is_some_and(|v| !v.is_null() && !v.is_string())
        {
            Ok(json!({"phase":"restart"}).to_string())
        } else if action == "unit" {
            let q = UnitRequest {
                declaration: binding.declaration,
                page_size: binding.page_size,
                opening: opening.into(),
                token: payload
                    .get("token")
                    .and_then(Json::as_str)
                    .map(str::to_owned),
            };
            reader
                .request_projected(
                    engine,
                    q,
                    Context::new(&principal, args).at(now),
                    operation,
                )
                .map(|out| out.answer.bytes().to_owned())
        } else {
            Ok(json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}).to_string())
        }
    } else {
        Ok(json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}).to_string())
    };
    drop(reader);

    let bytes = match answer {
        Ok(bytes) => bytes,
        Err(error) => {
            let why = error.refusal();
            // @ref LLP 3000.009.001.000.001#6-increments — RT3b source refusals leave the pinned success protocol for a metadata-free 503.
            if why.code == "E_GENERATION" {
                return (503, json!({"denied":why}).to_string(), false);
            }
            json!({"phase":"refused","code":why.code}).to_string()
        }
    };
    (200, bytes, true)
    });
    if !pinned { return respond_timed(request, shared, status, serde_json::from_str::<Json>(&bytes).expect("owned reply")); }
    // Do not parse/re-encode a pinned response or attach a fresh store counter.
    let mut response = Response::from_string(bytes).with_status_code(status);
    if let Some(header)=crate::serve::generation_header(){response.add_header(header);}
    response.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "private, no-store").unwrap());
    for header in super::merge_exposed_headers(cors(&request).into_iter().chain(latency::header())) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}
