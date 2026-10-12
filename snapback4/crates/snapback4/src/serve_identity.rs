use super::*;

/// Who is asking: a bearer session, or (in `dev`, from loopback) a persona.
pub(crate) fn principal_of(request: &Request, shared: &Shared) -> Result<snapback4_core::identity::Capability, Refusal> {
    principal_with_owner(request, shared, None)
}

fn principal_with_owner(request: &Request, shared: &Shared, owner: Option<&Engine>) -> Result<snapback4_core::identity::Capability, Refusal> {
    // Declared public bearer routes keep their existing development admission.
    if !(request.method() == &Method::Post && routes::declared(shared, request.url()).is_some()
        && !request.headers().iter().any(|h| h.field.equiv("x-snapback-persona"))) {
        dev_request(request, shared)?;
    }
    let mut persona = None;
    let mut bearer = None;
    for header in request.headers() {
        let name = header.field.as_str().as_str().to_ascii_lowercase();
        let value = header.value.as_str().trim();
        if name == "x-snapback-persona" {
            if persona.is_some()
                || value.is_empty()
                || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err(Refusal::new("E_AUTH", "auth", "send exactly one valid x-snapback-persona header").guide("personas"));
            }
            persona = Some(value.to_owned());
        }
        if name == "authorization" {
            let Some(token) = crate::auth::parse_bearer(value) else {
                return Err(Refusal::new("E_AUTH", "auth", "send Authorization: Bearer <token>").guide("personas"));
            };
            if bearer.replace(token.to_owned()).is_some() {
                return Err(Refusal::new("E_AUTH", "auth", "send exactly one Authorization header").guide("personas"));
            }
        }
    }
    if persona.is_some() && bearer.is_some() {
        return Err(Refusal::new("E_AUTH", "auth", "send one credential: a development persona or a bearer token").guide("personas"));
    }
    if let Some(persona) = persona {
        if shared.personas {
            // `use personas` is the cast: a test expecting an outsider to be
            // refused must not see it signed in. A schema with no declaration
            // keeps admitting any well-formed name. (Taken briefly; the engine
            // guard, when held, is always acquired before this one.)
            let declared = lock(&shared.bound).personas.clone();
            if !declared.is_empty() && !declared.contains(&persona) {
                return Err(Refusal::new("E_AUTH", "auth", format!(
                    "persona {persona} is not declared; `use personas {}` is this project's cast. Add {persona} to it (dev re-adopts on save) or send a declared persona", declared.join(", ")))
                    .rewrite(format!("use personas {}, {persona}", declared.join(", "))).guide("personas"));
            }
            return Ok((persona_principal(&persona), "persona".into(), snapback4_core::identity::SessionScope::Full));
        }
        return Err(Refusal::new("E_AUTH", "auth", "personas are a development door; a deployed server takes bearer tokens (snapback4/auth)").guide("personas"));
    }
    if let Some(token) = bearer {
        // Reads may authenticate against the committed generation during adoption.
        // Keep write authentication behind the writer: time queued for adoption
        // must not preserve a session that expired or was revoked in that wait.
        let path = request.url().split('?').next().unwrap_or("");
        let read = detached_request(request.method(), path);
        let resolve = |engine: &Engine, identity: Option<&str>, detached: bool| {
            let now = shared.now();
            let sample = snapback4_core::identity::ServiceSample { now, supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
            let result = if detached {
                snapback4_core::identity::resolve_read_only_supervised(engine.store(), &token, sample, identity)
            } else {
                snapback4_core::identity::resolve_supervised(engine.store(), &token, sample)
            };
            let result=result.map_err(|error| error.refusal()).and_then(|value|value.ok_or_else(||
                snapback4_core::identity::diagnostics::refused(engine.store(), &token, now, trusted_dev_request(request, shared))));
            if result.is_err() {crate::release_requests::stamp(engine.generation());}
            result
        };
        return if let Some(engine) = owner { resolve(engine, None, false) }
        else if read { match shared.reader() {
            Ok((epoch, reader)) => {
                let identity = lock(&shared.wake).store_id.clone();
                let result = resolve(&reader, identity.as_deref(), true);
                lock(&shared.readers).put(&epoch, reader.into_inner());
                result
            }
            Err(_) if shared.memory_store() => resolve(&lock(&shared.engine), None, false),
            Err(error) => Err(error.refusal()),
        } } else { resolve(&lock(&shared.engine), None, false) };
    }
    Err(Refusal::new("E_AUTH", "auth", "sign in: send a bearer token (snapback4/auth), or x-snapback-persona in development").guide("personas"))
}

// @ref LLP 3000.019#3.6 — adoption's writer queue cannot retain expired bearer authority.
pub(super) fn mutation_authority(request: &Request, shared: &Shared, engine: &Engine, principal: &str) -> Result<(), Refusal> {
    if principal_with_owner(request, shared, Some(engine))?.0 == principal { Ok(()) }
    else { Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")) }
}

// @ref LLP 3000.033#1.2 — additions require an explicit decision here.
pub(super) fn read_permitted(method: &Method, path: &str) -> bool {
    match method {
        Method::Get => matches!(path, "/changes" | "/probe" | "/schema") || path.starts_with("/assets/"),
        Method::Post => matches!(path, "/sync" | "/probe" | "/auth/refresh" | "/auth/logout") || path.starts_with("/q/"),
        _ => false,
    }
}
