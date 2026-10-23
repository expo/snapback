use super::*;

/// Who is asking: a bearer session, or (in `dev`, from loopback) a persona.
pub(crate) fn principal_of(request: &impl RequestInfo, shared: &Shared) -> Result<snapback4_core::identity::Capability, Refusal> {
    principal_with_owner(request, shared, None, false)
}

pub(crate) fn ingress_of(request: &impl RequestInfo, shared: &Shared) -> Result<snapback4_core::identity::Capability, Refusal> {
    principal_with_owner(request, shared, None, true)
}

// @ref LLP 3000.009.001.000.000#3.6 — credentials are owned admission inputs; live authority and time are resolved on the executing writer.
#[derive(Clone)]
pub(crate) struct Admission {
    persona: Option<String>,
    bearer: Option<String>,
    trusted_dev: bool,
}
impl Admission {
    pub(crate) fn capture(request: &impl RequestInfo, shared: &Shared) -> Result<Self, Refusal> {
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
        Ok(Self { persona, bearer, trusted_dev: trusted_dev_request(request, shared) })
    }
    fn resolve_ingress(&self, shared: &Shared, engine: &Engine, identity: Option<&str>) -> Result<snapback4_core::identity::Capability, Refusal> {
        let Some(token) = &self.bearer else { return self.resolve(shared, engine); };
        let sample = self.sample(shared);
        let result = snapback4_core::identity::resolve_ingress_supervised(engine.store(), &self.digest(), sample, identity)
            .map_err(|e| e.refusal()).and_then(|value| value.ok_or_else(|| snapback4_core::identity::diagnostics::refused(engine.store(), token, sample.now, self.trusted_dev)));
        if result.is_err() { crate::release_requests::stamp(engine.generation()); }
        result
    }
    pub(crate) fn digest(&self) -> String { self.bearer.as_deref().map(snapback4_core::identity::session_digest).unwrap_or_default() }
    pub(crate) fn sample(&self, shared: &Shared) -> snapback4_core::identity::ServiceSample {
        snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }
    }
    pub(crate) fn persona(&self, shared: &Shared, engine: &Engine) -> Result<Option<snapback4_core::identity::Capability>, Refusal> {
        self.persona.as_ref().map(|_| self.resolve(shared, engine)).transpose()
    }
    pub(crate) fn check_facts(&self, expected: &snapback4_core::identity::Capability, facts: &snapback4_core::identity::RequestAuthority, persona: Option<snapback4_core::identity::Capability>) -> Result<(), Refusal> {
        let current = persona.or_else(|| facts.capability.clone()).ok_or_else(|| Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas"))?;
        if current.0 != expected.0 { return Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")); }
        if current.2 != expected.2 {
            let mut why = Refusal::new("E_AUTH", "auth", "the session scope changed while the request waited; retry with current authority").guide("personas");
            why.retryable = true;
            return Err(why);
        }
        Ok(())
    }
    pub(crate) fn with_snapshot<T>(&self, shared: &Shared, engine: &Engine,
        run: impl FnOnce(snapback4_core::identity::Capability, &snapback4_core::identity::RequestSnapshot<'_, '_>) -> Result<T, Refusal>,
    ) -> Result<T, Refusal> {
        let persona = if self.persona.is_some() { Some(self.resolve(shared, engine)?) } else { None };
        let digest = self.bearer.as_deref().map(snapback4_core::identity::session_digest).unwrap_or_default();
        let sample = snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
        snapback4_core::identity::with_request_snapshot(engine.store(), &digest, sample, |snapshot| {
            let capability = persona.or_else(|| snapshot.capability.clone()).ok_or_else(|| Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas"))?;
            run(capability, &snapshot)
        }).map_err(|e| e.refusal())?
    }
    pub(crate) fn resolve(&self, shared: &Shared, engine: &Engine) -> Result<snapback4_core::identity::Capability, Refusal> {
        self.resolve_at(shared, engine, None, false)
    }
    pub(crate) fn resolve_detached(&self, shared: &Shared, engine: &Engine) -> Result<snapback4_core::identity::Capability, Refusal> {
        let identity = lock(&shared.wake).store_id.clone();
        self.resolve_at(shared, engine, identity.as_deref(), true)
    }
    pub(crate) fn check_detached(&self, shared: &Shared, engine: &Engine, principal: &str) -> Result<(), Refusal> {
        if self.resolve_detached(shared, engine)?.0 == principal { Ok(()) }
        else { Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")) }
    }
    fn resolve_at(&self, shared: &Shared, engine: &Engine, identity: Option<&str>, detached: bool) -> Result<snapback4_core::identity::Capability, Refusal> {
    if let Some(persona) = self.persona.clone() {
        shared.dev_authority(engine)?;
        if shared.dev_doors() {
            // `use personas` is the cast: a test expecting an outsider to be
            // refused must not see it signed in. No declaration admits none.
            // (Taken briefly; the engine
            // guard, when held, is always acquired before this one.)
            let declared = lock(&shared.bound).personas.clone();
            if !declared.contains(&persona) {
                return Err(Refusal::new("E_AUTH", "auth", format!(
                    "persona {persona} is not declared; `use personas {}` is this project's cast. Add {persona} to it (dev re-adopts on save) or send a declared persona", declared.join(", ")))
                    .rewrite(format!("use personas {}{persona}", if declared.is_empty() { String::new() } else { format!("{}, ", declared.join(", ")) })).guide("personas"));
            }
            return Ok((persona_principal(&persona), "persona".into(), snapback4_core::identity::SessionScope::Full));
        }
        return Err(Refusal::new("E_AUTH", "auth", "personas are a development door; a deployed server takes bearer tokens (snapback4/auth)").guide("personas"));
    }
    if let Some(token) = &self.bearer {
        let now = shared.now();
        let sample = snapback4_core::identity::ServiceSample { now, supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
        let result = if detached {
            snapback4_core::identity::resolve_read_only_supervised(engine.store(), token, sample, identity)
        } else {
            snapback4_core::identity::resolve_supervised(engine.store(), token, sample)
        };
        let result = result.map_err(|error| error.refusal()).and_then(|value| value.ok_or_else(||
            snapback4_core::identity::diagnostics::refused(engine.store(), token, now, self.trusted_dev)));
        if result.is_err() { crate::release_requests::stamp(engine.generation()); }
        return result;
    }
    Err(Refusal::new("E_AUTH", "auth", "sign in: send a bearer token (snapback4/auth), or x-snapback-persona in development").guide("personas"))
    }
    pub(crate) fn check(&self, shared: &Shared, engine: &Engine, principal: &str) -> Result<(), Refusal> {
        if self.resolve(shared, engine)?.0 == principal { Ok(()) }
        else { Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")) }
    }
}
fn principal_with_owner(request: &impl RequestInfo, shared: &Shared, owner: Option<&Engine>, ingress: bool) -> Result<snapback4_core::identity::Capability, Refusal> {
    let admission = Admission::capture(request, shared)?;
    if let Some(engine) = owner { return admission.resolve(shared, engine); }
    let path = request.url().split('?').next().unwrap_or("");
    let ephemeral = request.method() == &Method::Post && path.strip_prefix("/m/").is_some_and(|name|
        lock(&shared.bound).schema.operations.get(name).is_some_and(|fact| fact.ephemeral));
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — ingress refuses before buffering, but never waits for or authorizes the writer.
    if detached_request(request.method(), path) || ephemeral || path.starts_with("/m/") {
        match shared.reader() {
            Ok((epoch, reader)) => {
                let identity = lock(&shared.wake).store_id.clone();
                let result = if ingress { admission.resolve_ingress(shared, &reader, identity.as_deref()) } else { admission.resolve_at(shared, &reader, identity.as_deref(), true) };
                lock(&shared.readers).put(&epoch, reader.into_inner());
                result
            }
            Err(_) if shared.memory_store() => shared.engine.attempt(move |engine, shared| admission.resolve(shared, engine)),
            Err(error) => Err(error.refusal()),
        }
    } else {
        shared.engine.submit(move |engine, shared| admission.resolve(shared, engine))?
    }
}

// @ref LLP 3000.000.000.001#4-development-doors — a persona cannot cross from authentication into a replacement password-only reader.
pub(crate) fn persona_read_authority(request: &impl RequestInfo, shared: &Shared, engine: &Engine) -> Result<(), Refusal> {
    let Some(persona) = request.headers().iter().find(|header| header.field.equiv("x-snapback-persona")) else { return Ok(()) };
    shared.dev_authority(engine)?;
    let bound = lock(&shared.bound);
    if (!shared.unsafe_dev_doors && bound.schema.auth.password && !bound.schema.auth.guests)
        || !bound.personas.iter().any(|name| name == persona.value.as_str().trim()) {
        return Err(Refusal::new("E_AUTH", "auth", "persona authority changed while this read waited; sign in with a password or use the current declared development cast").guide("staging"));
    }
    // The cast is checked at this read's admission. Never hold its publication
    // mutex during I/O: concurrent ordinary writes still need to authenticate.
    // The engine transaction fences a replaced execution schema.
    Ok(())
}

// @ref LLP 3000.019#3.6 — adoption's writer queue cannot retain expired bearer authority.
pub(crate) fn mutation_authority(request: &impl RequestInfo, shared: &Shared, engine: &Engine, principal: &str) -> Result<(), Refusal> {
    if principal_with_owner(request, shared, Some(engine), false)?.0 == principal { Ok(()) }
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
