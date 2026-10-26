use super::*;

/// Who is asking: a bearer session, or (in `dev`, from loopback) a persona.
pub(crate) fn principal_of(request: &impl RequestInfo, shared: &Shared) -> Result<snapback4_core::identity::Capability, Refusal> {
    principal_with_owner(request, shared, None, false)
}

pub(crate) fn ingress_of(request: &impl RequestInfo, shared: &Shared) -> Result<snapback4_core::identity::Capability, Refusal> {
    let admission = Admission::capture(request, shared)?;
    // Retain the resolver's fresh post-checkout clock. If the supervisor fence
    // changes across discovery, remember discards the observation instead.
    let revision = shared.worker_revision.load(Ordering::Acquire);
    let store = lock(&shared.wake).store_id.clone();
    let generation = *lock(&shared.generation);
    let capability = principal_with_owner(request, shared, None, true)?;
    if let Some(store) = store { admission.remember(shared, &capability, &store, generation, revision); }
    Ok(capability)
}

// @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — bounded query/mutation hints never authorize; each final snapshot resolves live facts.
pub(crate) fn operation_ingress(request: &impl RequestInfo, shared: &Shared) -> Result<Option<snapback4_core::identity::Capability>, Refusal> {
    let admission = Admission::capture(request, shared)?;
    if let Some(persona) = &admission.persona {
        return Ok(Some((persona_principal(persona), "persona".into(), snapback4_core::identity::SessionScope::Full)));
    }
    if admission.bearer.is_none() { return Err(Refusal::new("E_AUTH", "auth", "sign in: send a bearer token").guide("personas")); }
    let identity = lock(&shared.wake).store_id.clone();
    // A supervisor fence invalidates discovery hints as an eviction would.
    // Cold discovery can still refuse a retired child while retirement holds
    // the writer lock; successful execution always needs its final snapshot.
    let generation = *lock(&shared.generation);
    let carried = lock(&shared.carried);
    let revision = shared.worker_revision.load(Ordering::Acquire);
    Ok(carried.get(&admission.digest())
        .filter(|(store,_,observed_generation,observed)| Some(store) == identity.as_ref() && *observed_generation == generation && *observed == revision)
        .map(|(_,capability,_,_)| capability.clone()))
}

// @ref LLP 3000.009.001.000.000#3.6 — credentials are owned admission inputs; every final snapshot resolves live authority and time.
#[derive(Clone)]
pub(crate) struct Admission {
    persona: Option<String>,
    bearer: Option<String>,
    trusted_dev: bool,
    planned_ordinary: bool,
    expected_query: Option<snapback4_core::identity::Capability>,
    mutation: bool,
}
impl Admission {
    pub(crate) fn planned(mut self, capability: &snapback4_core::identity::Capability) -> Self { self.planned_ordinary = matches!(capability.1.as_str(), "guest"|"user"|"member"|"account"|"oidc"|"service"); self }
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
        Ok(Self { persona, bearer, planned_ordinary: false, expected_query: None, mutation: request.method() == &Method::Post && request.url().starts_with("/m/"), trusted_dev: trusted_dev_request(request, shared) })
    }
    fn resolve_ingress(&self, shared: &Shared, engine: &Engine, identity: Option<&str>) -> Result<snapback4_core::identity::Capability, Refusal> {
        let Some(token) = &self.bearer else { return self.resolve(shared, engine); };
        let sample = self.sample(shared);
        let result = snapback4_core::identity::resolve_ingress_supervised(engine.store(), &self.digest(), sample, identity)
            .and_then(|value| value.ok_or_else(|| snapback4_core::identity::diagnostics::refused(engine.store(), token, sample.now, self.trusted_dev)));
        if result.is_err() { crate::release_requests::stamp(engine.generation()); }
        result
    }
    // @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — insertion retains the observation's binding and fence; custom kinds evict earlier ordinary hints.
    pub(crate) fn remember(&self, shared: &Shared, capability: &snapback4_core::identity::Capability, store: &str, generation: u64, revision: usize) {
        if self.bearer.is_none() { return; }
        let store_current = lock(&shared.wake).store_id.as_deref() == Some(store);
        let binding_current = store_current && *lock(&shared.generation) == generation;
        let mut carried = lock(&shared.carried);
        let digest = self.digest();
        if !binding_current || shared.worker_revision.load(Ordering::Acquire) != revision
            || !snapback4_core::value::identity_fits(&capability.0)
            || !matches!(capability.1.as_str(), "guest"|"user"|"member"|"account"|"oidc"|"service") {
            carried.remove(&digest);
            return;
        }
        // A bounded factual hint, never an authority cache. Eviction only adds
        // cold discovery work; neither age nor presence can authorize a reply.
        const CARRIED_CAPABILITIES: usize = 1024;
        if carried.len() >= CARRIED_CAPABILITIES && !carried.contains_key(&digest) { carried.pop_first(); }
        carried.insert(digest, (store.to_owned(), capability.clone(), generation, revision));
    }
    pub(crate) fn check_store(&self, shared: &Shared, store: &str) -> Result<(), Refusal> {
        if lock(&shared.wake).store_id.as_deref() != Some(store) {
            return Err(Refusal::new("E_STORE_REPLACED", "store", "the serving store identity changed; reconcile with the original store").guide("sync"));
        }
        Ok(())
    }
    // @ref LLP 3000.033#1.2 — fresh scope must permit the operation independently of the planning hint or token prefix.
    fn check_scope(&self, current: &snapback4_core::identity::Capability) -> Result<(), Refusal> {
        if self.mutation && current.2 != snapback4_core::identity::SessionScope::Full {
            return Err(Refusal::new("E_READ_ONLY", "auth", "this read session permits reads only; use a full session for writes").guide("read-only"));
        }
        Ok(())
    }
    fn check_binding(&self, shared: &Shared, facts: &snapback4_core::identity::RequestAuthority, generation: Option<u64>) -> Result<(), Refusal> {
        self.check_store(shared, &facts.store_id)?;
        if generation.is_some() && facts.generation != generation {
            let mut why=Refusal::new("E_GENERATION","generation","the serving generation changed; retry current admission");
            why.retryable=true;
            return Err(why);
        }
        Ok(())
    }
    pub(crate) fn remember_facts(&self, shared: &Shared, facts: &snapback4_core::identity::RequestAuthority) {
        if let (Some(current), Some(generation)) = (&facts.capability, facts.generation) {
            self.remember(shared, current, &facts.store_id, generation, facts.supervisor_revision);
        }
    }
    pub(crate) fn check_bound_facts(&self, shared: &Shared, expected: &snapback4_core::identity::Capability, facts: &snapback4_core::identity::RequestAuthority, persona: Option<snapback4_core::identity::Capability>, generation: Option<u64>) -> Result<(), Refusal> {
        self.check_binding(shared, facts, generation)?;
        self.remember_facts(shared, facts);
        self.check_facts(expected, facts, persona)
    }
    pub(crate) fn check_mutation_facts(&self, shared: &Shared, expected: &snapback4_core::identity::Capability, facts: &snapback4_core::identity::RequestAuthority, persona: Option<snapback4_core::identity::Capability>, generation: u64) -> Result<(), Refusal> {
        self.check_binding(shared, facts, Some(generation))?;
        self.check_facts(expected, facts, persona)
    }
    pub(crate) fn query_expected(mut self, capability: &snapback4_core::identity::Capability) -> Self { self.expected_query=Some(capability.clone()); self }
    pub(crate) fn digest(&self) -> String { self.bearer.as_deref().map(snapback4_core::identity::session_digest).unwrap_or_default() }
    pub(crate) fn sample(&self, shared: &Shared) -> snapback4_core::identity::ServiceSample {
        snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) }
    }
    pub(crate) fn persona(&self, shared: &Shared, engine: &Engine) -> Result<Option<snapback4_core::identity::Capability>, Refusal> {
        self.persona.as_ref().map(|_| self.resolve(shared, engine)).transpose()
    }
    pub(crate) fn check_facts(&self, expected: &snapback4_core::identity::Capability, facts: &snapback4_core::identity::RequestAuthority, persona: Option<snapback4_core::identity::Capability>) -> Result<(), Refusal> {
        let current = persona.or_else(|| facts.capability.clone()).ok_or_else(|| Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas"))?;
        self.check_capability(expected, current)
    }
    // @ref LLP 3000.009.001.000.001#31-authority-boundaries — every execution path retains the capability selected before its wait.
    fn check_capability(&self, expected: &snapback4_core::identity::Capability, current: snapback4_core::identity::Capability) -> Result<(), Refusal> {
        if current.0 != expected.0 { return Err(Refusal::new("E_AUTH", "auth", "the request's session changed; sign in again").guide("personas")); }
        if current.1 != expected.1 || current.2 != expected.2 {
            let mut why = Refusal::new("E_AUTH", "auth", "the session kind or scope changed while the request waited; retry with current authority").guide("personas");
            why.retryable = true;
            return Err(why);
        }
        self.check_scope(&current)
    }
    pub(crate) fn with_snapshot<T>(&self, shared: &Shared, engine: &Engine, receipt: Option<&(String,String)>,
        run: impl FnOnce(snapback4_core::identity::Capability, &snapback4_core::identity::RequestSnapshot<'_, '_>) -> Result<T, Refusal>,
    ) -> Result<T, Refusal> {
        let persona = if self.persona.is_some() { Some(self.resolve(shared, engine)?) } else { None };
        let digest = self.bearer.as_deref().map(snapback4_core::identity::session_digest).unwrap_or_default();
        let sample = snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(Ordering::Acquire) };
        let ordinary = self.planned_ordinary;
        snapback4_core::identity::with_request_preflight(engine.store(), &digest, sample, ordinary, receipt.map(|(p,id)|(p.as_str(),id.as_str())), |snapshot| {
            self.check_store(shared, &snapshot.store_id)?;
            let capability = persona.or_else(|| snapshot.capability.clone()).ok_or_else(|| Refusal::new("E_AUTH", "auth", "this session is not live; sign in again").guide("personas"))?;
            self.remember(shared, &capability, &snapshot.store_id, engine.generation(), sample.supervisor_revision);
            if let Some(expected)=&self.expected_query { self.check_capability(expected,capability.clone())?; }
            self.check_scope(&capability)?;
            run(capability, &snapshot)
        }).map_err(|e| e.refusal())?
    }
    pub(crate) fn resolve(&self, shared: &Shared, engine: &Engine) -> Result<snapback4_core::identity::Capability, Refusal> {
        self.resolve_at(shared, engine, None, false, self.sample(shared))
    }
    pub(crate) fn resolve_detached(&self, shared: &Shared, engine: &Engine) -> Result<snapback4_core::identity::Capability, Refusal> {
        let identity = lock(&shared.wake).store_id.clone();
        self.resolve_at(shared, engine, identity.as_deref(), true, self.sample(shared))
    }
    // @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — refresh discovery before a stale-kind refusal; every retry still resolves live authority.
    pub(crate) fn check_detached(&self, shared: &Shared, engine: &Engine, expected: &snapback4_core::identity::Capability) -> Result<(), Refusal> {
        let store = lock(&shared.wake).store_id.clone();
        let sample = self.sample(shared);
        let current=self.resolve_at(shared, engine, store.as_deref(), true, sample)?;
        if let Some(store) = store { self.remember(shared,&current,&store,engine.generation(),sample.supervisor_revision); }
        self.check_capability(expected,current)
    }
    pub(crate) fn check_expected(&self, shared: &Shared, engine: &Engine, expected: &snapback4_core::identity::Capability) -> Result<(), Refusal> {
        let sample = self.sample(shared);
        let store = lock(&shared.wake).store_id.clone();
        let current=self.resolve_at(shared, engine, None, false, sample)?;
        if let Some(store) = store { self.remember(shared,&current,&store,engine.generation(),sample.supervisor_revision); }
        self.check_capability(expected,current)
    }
    fn resolve_at(&self, shared: &Shared, engine: &Engine, identity: Option<&str>, detached: bool, sample: snapback4_core::identity::ServiceSample) -> Result<snapback4_core::identity::Capability, Refusal> {
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
        let now = sample.now;
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
                let result = if ingress { admission.resolve_ingress(shared, &reader, identity.as_deref()) } else { admission.resolve_at(shared, &reader, identity.as_deref(), true, admission.sample(shared)) };
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
