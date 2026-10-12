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
    let (principal, _, scope) = match principal_of(&request, shared) {
        Ok(p) => p,
        Err(r) => return respond_timed(request, shared, 401, json!({"denied":refusal_json(&r)})),
    };
    // @ref LLP 3000.033#1.2 — Following custody is outside the closed read allow-list.
    // The outer guard refuses before body intake; retain the boundary here too.
    if scope == snapback4_core::identity::SessionScope::Read {
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
    // Lock order is engine then controller. Authentication is checked again at
    // the same engine incarnation that owns the source read transaction.
    let mut engine = lock(&shared.engine);
    if let Err(r) = mutation_authority(&request, shared, &engine, &principal) {
        drop(engine);
        return respond_timed(request, shared, 401, json!({"denied":refusal_json(&r)}));
    }
    let Some(program) = engine.program(operation) else {
        drop(engine);
        return respond_timed(request, shared, 200, json!({"phase":"restart"}));
    };
    let Some(plan) = projection::plan(engine.schema(), program) else {
        drop(engine);
        return respond_timed(
            request,
            shared,
            200,
            json!({"phase":"refused","code":"E_FOLLOWING_DECLARATION"}),
        );
    };
    let binding = plan.binding;
    let mut args = BTreeMap::new();
    let Some(fields) = payload.get("args").and_then(Json::as_object) else {
        drop(engine);
        return respond_timed(
            request,
            shared,
            400,
            json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}),
        );
    };
    for (name, value) in fields {
        let Some(value) = program
            .args
            .get(name)
            .and_then(|kind| wire::from_json(kind, value).ok())
        else {
            drop(engine);
            return respond_timed(
                request,
                shared,
                400,
                json!({"phase":"refused","code":"E_FOLLOWING_INPUT"}),
            );
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
            .opening_projected(&engine, operation, Context::new(&principal, args).at(now))
            .map(|o| json!({"opening":o.request.opening}).to_string())
    } else if let Some(opening) = payload.get("opening").and_then(Json::as_str) {
        if action == "cancel" {
            reader
                .cancel_projected(
                    &mut engine,
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
                        &mut engine,
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
                    &mut engine,
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
    drop(engine);
    let bytes =
        answer.unwrap_or_else(|e| json!({"phase":"refused","code":e.refusal().code}).to_string());
    // Do not parse/re-encode a pinned response or attach a fresh store counter.
    let mut response = Response::from_string(bytes);
    if let Some(header)=crate::serve::generation_header(){response.add_header(header);}
    response.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "private, no-store").unwrap());
    for header in cors(&request).into_iter().chain(latency::header()) {
        response.add_header(header);
    }
    let _ = request.respond(response);
}
