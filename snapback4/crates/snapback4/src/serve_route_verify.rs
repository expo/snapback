//! Ephemeral verification fences. Lock order is engine, then ticket registry;
//! no callback, network operation or wait runs under either lock.
use super::*;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Claim { routes: Vec<String>, #[serde(default = "one")] limit: usize,
    #[serde(default = "ten")] lease: u64, #[serde(default)] wait: u64 }
fn one() -> usize { 1 }
fn ten() -> u64 { 10 }

pub(in crate::serve) fn claim(request: Request, shared: &Shared, body: &str) {
    let payload = match serde_json::from_str::<Claim>(body) {
        Ok(p) if !p.routes.is_empty() && p.routes.len() <= 128 && p.routes.iter().all(|name| !name.is_empty() && name.len() <= 128) => p,
        _ => return refuse(request, 400, "E_ROUTE_INPUT", "verification claim needs 1..128 route names and bounded limit, lease and wait"),
    };
    let limit = payload.limit.clamp(1, 4);
    let lease = Duration::from_secs(payload.lease.clamp(1, 25));
    let deadline = Instant::now() + Duration::from_secs(payload.wait.min(25));
    loop {
        let (worker, claimed) = {
            let engine = lock(&shared.engine);
            let worker = match service_of_locked(&request, shared, &engine) {
                Ok(worker) => worker, Err(why) => { drop(engine); return respond(request, 401, json!({ "denied": why })); }
            };
            let now = Instant::now();
            let now_ms = shared.now();
            let mut claimed = Vec::new();
            for (id, ticket) in lock(&shared.route_verification.tickets).iter_mut() {
                if ticket.outcome.is_some() || ticket.deadline <= now || ticket.deadline_ms <= now_ms
                    || ticket.lease.as_ref().is_some_and(|held| held.until > now) || !payload.routes.contains(&ticket.name) { continue; }
                if !matches!(engine.route_service_generation(&ticket.name, &ticket.contract), Ok((_, generation)) if generation == ticket.generation) {
                    ticket.outcome = Some(Verified::Unavailable); continue;
                }
                let token = match verification_token() { Ok(token) => token, Err(_) => { ticket.outcome = Some(Verified::Unavailable); continue; } };
                let until = ticket.deadline.min(now + lease);
                let claim_deadline = ticket.deadline_ms.min(now_ms.saturating_add(until.saturating_duration_since(now).as_millis() as i64));
                claimed.push(json!({ "id": id, "route": ticket.name, "contract": ticket.contract, "now": now_ms,
                    "deadline": claim_deadline, "leaseToken": token, "request": ticket.envelope }));
                ticket.lease = Some(Lease { worker: worker.clone(), token, until });
                if claimed.len() >= limit { break; }
            }
            (worker, claimed)
        };
        shared.committed.notify_all();
        if !claimed.is_empty() || Instant::now() >= deadline || crate::lifecycle::stopping() {
            return respond(request, 200, json!({ "requests": claimed, "worker": worker }));
        }
        pause(shared, deadline);
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Settlement { disposition: Disposition }
#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum Disposition { Allow, Deny, Unavailable }

pub(in crate::serve) fn settle(request: Request, shared: &Shared, path: &str, body: &str) {
    let Some(id) = path.strip_prefix("/routes/verify/").and_then(|s| s.strip_suffix("/settle"))
        .filter(|s| !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) else {
        return refuse(request, 404, "E_ROUTE_LEASE", "no verification ticket at this path");
    };
    let token = match single_header(&request, "x-snapback-route-lease") { Ok(Some(token)) => token, _ => return refuse(request, 400, "E_ROUTE_LEASE", "send exactly one verification claim fence") };
    let payload = match serde_json::from_str::<Settlement>(body) { Ok(payload) => payload, Err(_) => return refuse(request, 400, "E_ROUTE_INPUT", "verification settlement needs allow, deny or unavailable") };
    let answer = {
        let mut engine = lock(&shared.engine);
        let worker = match service_of_locked(&request, shared, &engine) { Ok(worker) => worker, Err(why) => { drop(engine); return respond(request, 401, json!({ "denied": why })); } };
        let mut tickets = lock(&shared.route_verification.tickets);
        match tickets.get_mut(id) {
            Some(ticket) if ticket.outcome.is_none() && ticket.deadline > Instant::now() && ticket.deadline_ms > shared.now()
                && ticket.lease.as_ref().is_some_and(|lease| lease.worker == worker && lease.token == token && lease.until > Instant::now()) => {
                ticket.outcome = Some(match payload.disposition {
                    Disposition::Allow => match engine.request_verified_route(&ticket.name, &ticket.contract, &ticket.envelope, ticket.generation, shared.now()) {
                        Ok((run, _)) => Verified::Allowed { id: run.id, principal: run.principal },
                        Err(_) => Verified::Unavailable,
                    },
                    Disposition::Deny => Verified::Denied,
                    Disposition::Unavailable => Verified::Unavailable,
                });
                true
            }
            _ => false,
        }
    };
    shared.committed.notify_all();
    if answer { respond(request, 200, json!({ "ok": true })); }
    else { refuse(request, 409, "E_ROUTE_LEASE", "the verification ticket or claim fence is no longer live"); }
}
