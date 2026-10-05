use crate::{EffectHost, EffectJob, EffectLog, Outcome};
use ibex2_runtime::engine::hermes::{DynamicCode, Hermes, InstallOptions, JsError};
use ibex2_runtime::{
    bindings::{Context, Groups},
    grant::GrantSet,
};
use serde_json::json;
use snapback2_core::{EffectDecl, digest};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const MAX_JOBS_PER_RUNTIME: u32 = 50;
const FETCH_PRIMITIVES_GLOBAL: &str = "__snapback_ibex2_fetch_primitives";
const EFFECT_GROUPS: Groups = Groups::PURE
    .union(Groups::CONSOLE)
    .union(Groups::TIMERS)
    .union(Groups::ABORT)
    .union(Groups::FETCH);
const PRELUDE: &str = include_str!("prelude.js");
const FETCH_FACTORY: &str = include_str!("prelude/fetch.js");
const BOUND_TRANSPORT: &str = include_str!("prelude/bound.js");
// Public names match the compiler effect allowlist. Function, engine internals,
// and globalThis remain unnameable in authored source; the host needs them to
// harden and pump, with DynamicCode::Closed refusing dynamic compilation.
const DEBUGGER_INTERNAL: &str = "DebuggerInternal";
const EFFECT_GLOBALS: &[&str] = &[
    "$SHBuiltin",
    "Array",
    "ArrayBuffer",
    "BigInt",
    "BigInt64Array",
    "BigUint64Array",
    "Boolean",
    "DataView",
    "Date",
    DEBUGGER_INTERNAL,
    "Error",
    "EvalError",
    "Float32Array",
    "Float64Array",
    "Function",
    "Headers",
    "HermesInternal",
    "Infinity",
    "Int16Array",
    "Int32Array",
    "Int8Array",
    "Intl",
    "JSON",
    "Map",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Proxy",
    "RangeError",
    "ReferenceError",
    "Reflect",
    "RegExp",
    "Set",
    "String",
    "Symbol",
    "SyntaxError",
    "TextDecoder",
    "TextEncoder",
    "TypeError",
    "URIError",
    "URL",
    "URLSearchParams",
    "Uint16Array",
    "Uint32Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "WeakMap",
    "WeakSet",
    "__ibex2_fire_timer",
    "atob",
    "btoa",
    "console",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "fetch",
    "globalThis",
    "isFinite",
    "isNaN",
    "meta",
    "parseFloat",
    "parseInt",
    "setTimeout",
    "undefined",
    "unescape",
];

/// Doctor's real engine probe. Besides proving construction, this reference
/// keeps the static Hermes implementation in a not-yet-owner-integrated binary.
pub(crate) fn engine_available() -> bool {
    Hermes::new(DynamicCode::Closed).is_some()
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct RuntimeKey {
    effect: String,
    source_digest: String,
}

struct EffectRuntime {
    // The runtime borrows the install endowment. Field order is intentional:
    // Rust drops it before the context declared immediately after it.
    runtime: Hermes,
    _context: Context,
    declared_grants: Vec<String>,
    // A `test` owner's job carries its epoch's bindings; a runtime built for
    // one binding table never serves a job with another.
    bindings: Option<BTreeMap<String, String>>,
    jobs: u32,
    provider: Option<serde_json::Value>,
    host_token: String,
}

/// Ibex 2 over vanilla Hermes, with one hardened runtime per effect source.
// @ref LLP 1003#3-the-runtime-snapback2-effects — per-source runtimes carry grants, harden before jobs, and rotate after fifty.
pub struct Ibex2Host {
    runtimes: BTreeMap<RuntimeKey, EffectRuntime>,
    logs: Vec<EffectLog>,
    provider: Option<serde_json::Value>,
    available: bool,
}

impl Ibex2Host {
    pub fn new() -> Result<Self, &'static str> {
        Ok(Self {
            runtimes: BTreeMap::new(),
            logs: Vec::new(),
            provider: None,
            available: engine_available(),
        })
    }

    /// Drop every compartment when the owner installs a new generation.
    /// Source/grant changes are also detected defensively on each `run`.
    pub fn generation_changed(&mut self) {
        self.runtimes.clear();
    }

    fn run_inner(&mut self, decl: &EffectDecl, job: &EffectJob, budget: Duration) -> Outcome {
        let key = RuntimeKey {
            effect: decl.name.clone(),
            source_digest: digest(&decl.source),
        };
        self.runtimes.retain(|existing, runtime| {
            existing.effect != decl.name
                || (existing == &key
                    && runtime.declared_grants == decl.grants
                    && runtime.bindings == job.bindings
                    && runtime.jobs < MAX_JOBS_PER_RUNTIME)
        });

        // One deadline per job, from here: the runtime it may have to build,
        // the authored module's top level, and every entrance after are held
        // to the same instant.
        let deadline = Instant::now() + budget;
        if !self.runtimes.contains_key(&key) {
            match build_runtime(decl, job.bindings.as_ref(), deadline) {
                Ok(runtime) => {
                    self.runtimes.insert(key.clone(), runtime);
                }
                Err(BuildFailure::Unavailable(message)) => return Outcome::Unavailable(message),
                Err(BuildFailure::Deadline) => return timeout_outcome(budget),
                Err(BuildFailure::Invalid(message)) => {
                    return Outcome::Failed {
                        error: format!("E_EFFECT_ENGINE: {message}"),
                        retry: false,
                    };
                }
            }
        }

        let runtime = self.runtimes.get_mut(&key).expect("runtime was inserted");
        runtime.jobs += 1;
        let (outcome, logs, contaminated, quiescent) = run_job(runtime, job, budget, deadline);
        self.logs = logs;
        self.provider = runtime.provider.take();
        if contaminated
            || !quiescent
            || runtime.jobs >= MAX_JOBS_PER_RUNTIME
            || matches!(outcome, Outcome::Failed { ref error, .. } if error.starts_with("E_EFFECT_TIMEOUT"))
        {
            self.runtimes.remove(&key);
        }
        outcome
    }

    #[cfg(test)]
    fn cached_runtime_count(&self) -> usize {
        self.runtimes.len()
    }
}

impl EffectHost for Ibex2Host {
    fn run(&mut self, decl: &EffectDecl, job: &EffectJob, budget: Duration) -> Outcome {
        self.logs.clear();
        self.provider = None;
        self.run_inner(decl, job, budget)
    }

    fn describe(&self) -> &'static str {
        if self.available {
            "ibex2 + vanilla hermes"
        } else {
            "none"
        }
    }

    fn generation_changed(&mut self) {
        Ibex2Host::generation_changed(self);
    }

    fn take_provider(&mut self) -> Option<serde_json::Value> {
        self.provider.take()
    }

    fn take_logs(&mut self) -> Vec<EffectLog> {
        std::mem::take(&mut self.logs)
    }
}

#[derive(Debug)]
enum BuildFailure {
    Unavailable(&'static str),
    Invalid(String),
    /// The job's deadline ended the authored module's top-level evaluation.
    Deadline,
}

fn host_channel_token() -> Result<String, BuildFailure> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| BuildFailure::Unavailable("OS randomness unavailable"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Freeze the JSON data captured by the compiler's effect-source IIFE without
/// placing a helper in the effect's lexical or global authority surface. Each
/// generated constant is initialized through its own self-contained freezer;
/// arbitrary hand-authored function expressions are left byte-for-byte alone.
fn freeze_compiler_embedded_constants(source: &str) -> String {
    const PREFIX: &str = "(() => {";
    const FREEZER: &str = "(function freeze(value) { if (value === null || typeof value !== 'object') return value; const names = Object.getOwnPropertyNames(value); for (let i = 0; i < names.length; i++) freeze(value[names[i]]); return Object.freeze(value); })";

    if !source.starts_with(PREFIX) {
        return source.to_owned();
    }
    let mut cursor = PREFIX.len();
    let mut output = PREFIX.to_owned();
    let mut transformed = false;

    loop {
        let whitespace_start = cursor;
        while source
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        output.push_str(&source[whitespace_start..cursor]);
        let Some(after_const) = source[cursor..].strip_prefix("const ") else {
            break;
        };
        let Some(equals) = after_const.find(" = ") else {
            return source.to_owned();
        };
        let name = &after_const[..equals];
        if name.is_empty() {
            return source.to_owned();
        }
        let declaration_prefix_end = cursor + "const ".len() + equals + " = ".len();
        let mut values = serde_json::Deserializer::from_str(&source[declaration_prefix_end..])
            .into_iter::<serde_json::Value>();
        let Some(Ok(_)) = values.next() else {
            return source.to_owned();
        };
        let value_end = declaration_prefix_end + values.byte_offset();
        if source.as_bytes().get(value_end) != Some(&b';') {
            return source.to_owned();
        }
        output.push_str("const ");
        output.push_str(name);
        output.push_str(" = ");
        output.push_str(FREEZER);
        output.push('(');
        output.push_str(&source[declaration_prefix_end..value_end]);
        output.push_str(");");
        cursor = value_end + 1;
        transformed = true;
    }

    if !transformed {
        return source.to_owned();
    }
    output.push_str(&source[cursor..]);
    output
}

fn build_runtime(
    decl: &EffectDecl,
    bindings: Option<&BTreeMap<String, String>>,
    deadline: Instant,
) -> Result<EffectRuntime, BuildFailure> {
    build_runtime_until(decl, bindings, deadline).map_err(|error| {
        if Instant::now() >= deadline {
            BuildFailure::Deadline
        } else {
            error
        }
    })
}

fn build_runtime_until(
    decl: &EffectDecl,
    bindings: Option<&BTreeMap<String, String>>,
    deadline: Instant,
) -> Result<EffectRuntime, BuildFailure> {
    let mut runtime = Hermes::new(DynamicCode::Closed)
        .ok_or(BuildFailure::Unavailable("Hermes::new returned None"))?;
    // One budget covers trusted setup as well as authored execution.
    runtime.set_deadline(deadline);
    let grant_spec = transport_origins(decl, bindings)
        .map(|origin| format!("net.fetch {origin}"))
        .collect::<Vec<_>>()
        .join("\n");
    let grants = GrantSet::parse(&grant_spec).map_err(|error| {
        BuildFailure::Invalid(format!("declared fetch grants did not parse: {error}"))
    })?;
    let context = Context::new(grants);
    runtime
        .install_with(
            EFFECT_GROUPS,
            &context,
            InstallOptions {
                fetch_primitives: Some(FETCH_PRIMITIVES_GLOBAL),
            },
        )
        .map_err(|error| BuildFailure::Invalid(format!("install effect bindings: {error}")))?;
    if let Some(bindings) = bindings {
        runtime
            .eval(&format!(
                "globalThis.__snapback_bound_transport = {}",
                bound_transport(decl, bindings)
            ))
            .map_err(|error| {
                BuildFailure::Invalid(format!("install bound transport: {error:?}"))
            })?;
    }

    let host_token = host_channel_token()?;
    let prelude = PRELUDE
        .replace("__SNAPBACK_FETCH_FACTORY__", FETCH_FACTORY)
        .replace(
            "__SNAPBACK_EFFECT_NAME__",
            &serde_json::to_string(&decl.name).expect("effect name is JSON"),
        )
        .replace(
            "__SNAPBACK_ALLOWED_GLOBALS__",
            &serde_json::to_string(EFFECT_GLOBALS).expect("effect globals are JSON"),
        )
        .replace(
            "__SNAPBACK_HOST_TOKEN__",
            &serde_json::to_string(&host_token).expect("host token is JSON"),
        );
    runtime
        .eval(&format!("globalThis.__snapback_install = {prelude}"))
        .map_err(|error| BuildFailure::Invalid(format!("install effect prelude: {error}")))?;
    // Hand the prelude entry to the token-gated host channel exactly once,
    // then remove the public install slot before source is evaluated.
    let token = serde_json::to_string(&host_token).expect("host token is JSON");
    runtime
        .eval(&format!(
            "__ibex2_fire_timer({token}, 'install', globalThis.__snapback_install); \
             delete globalThis.__snapback_install; \
             Object.preventExtensions(globalThis)",
        ))
        .map_err(|error| BuildFailure::Invalid(format!("capture effect host entry: {error}")))?;
    runtime
        .harden()
        .map_err(|error| BuildFailure::Invalid(format!("harden effect runtime: {error}")))?;
    verify_globals(&mut runtime)?;
    // Isolation boundary: source gets its own top-level script over the already
    // hardened global. Argument evaluation obtains the function value there;
    // the token-gated call then transfers only that value into the prelude.
    let isolated_source = freeze_compiler_embedded_constants(&decl.source);
    // The module's top level is the first authored code the runtime runs,
    // and it is held to the job's deadline like every entrance after it: a
    // spin here is stopped by the same budget, and construction is charged
    // to the attempt that needed it.
    runtime.set_deadline(deadline);
    runtime
        .eval(&format!(
            "__ibex2_fire_timer({token}, 'installEffect', ({isolated_source}))"
        ))
        .map_err(|error| match error {
            JsError::Deadline => BuildFailure::Deadline,
            error => BuildFailure::Invalid(format!("install isolated effect: {error}")),
        })?;

    Ok(EffectRuntime {
        runtime,
        _context: context,
        declared_grants: decl.grants.clone(),
        bindings: bindings.cloned(),
        jobs: 0,
        provider: None,
        host_token,
    })
}

/// What Ibex's raw binding may reach. Production: the declared grants. A
/// `test` owner: only the loopback origins the journey bound — the logical
/// origins are admitted by the bound transport in front of it, so no socket
/// can leave the loopback whatever the effect asks for.
// @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — the bound-only transport of the test owner.
fn transport_origins<'a>(
    decl: &'a EffectDecl,
    bindings: Option<&'a BTreeMap<String, String>>,
) -> Box<dyn Iterator<Item = &'a str> + 'a> {
    match bindings {
        Some(bindings) => Box::new(bindings.values().map(String::as_str)),
        None => Box::new(decl.grants.iter().map(String::as_str)),
    }
}

fn bound_transport(decl: &EffectDecl, bindings: &BTreeMap<String, String>) -> String {
    BOUND_TRANSPORT
        .replace(
            "__SNAPBACK_GRANTS__",
            &serde_json::to_string(&decl.grants).expect("grants are JSON"),
        )
        .replace(
            "__SNAPBACK_BINDINGS__",
            &serde_json::to_string(bindings).expect("bindings are JSON"),
        )
        .replace(
            "__SNAPBACK_EFFECT_NAME__",
            &serde_json::to_string(&decl.name).expect("effect name is JSON"),
        )
}

fn verify_globals(runtime: &mut Hermes) -> Result<(), BuildFailure> {
    let names = runtime.global_names();
    verify_global_names(&names)?;
    let frozen = runtime
        .eval("String(Object.isFrozen(globalThis))")
        .map_err(|error| BuildFailure::Invalid(format!("inspect hardened global: {error}")))?;
    if frozen != "true" {
        return Err(BuildFailure::Invalid(
            "effect global object was not frozen".to_owned(),
        ));
    }
    Ok(())
}

fn verify_global_names(names: &[String]) -> Result<(), BuildFailure> {
    // @ref LLP 1003#1-authoring — debugger and release engines retain only one non-authorable, pinned profile difference
    // Pinned debugger-enabled Hermes installs DebuggerInternal as a
    // non-configurable global, while its release profile omits it. It is not
    // in the compiler's authored allowlist and the host never calls it; this
    // is the sole admitted engine-profile difference. Function is fixed in
    // both profiles because the Ibex hardener needs Function.prototype.call.
    let has_debugger_internal = names.iter().any(|name| name == DEBUGGER_INTERNAL);
    let expected = EFFECT_GLOBALS
        .iter()
        .filter(|name| **name != DEBUGGER_INTERNAL || has_debugger_internal)
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    if names != expected {
        let unexpected = names
            .iter()
            .filter(|name| !EFFECT_GLOBALS.contains(&name.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let missing = EFFECT_GLOBALS
            .iter()
            .filter(|name| {
                **name != DEBUGGER_INTERNAL && !names.iter().any(|actual| actual == **name)
            })
            .copied()
            .collect::<Vec<_>>();
        return Err(BuildFailure::Invalid(format!(
            "effect global surface mismatch; unexpected: {}; missing: {}",
            unexpected.join(", "),
            missing.join(", ")
        )));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FailureKind {
    Grant,
    Result,
    Retryable,
}

/// Where the job stands, as the prelude reports it. A failure carries its
/// classification: the prelude makes it once, at settlement, from
/// closure-held error identity — application-owned error fields are
/// diagnostic data only — and the snapshot that reports the failure carries
/// it, so learning it needs no entrance of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JobStatus {
    Running,
    Sent,
    Failed(FailureKind),
}

#[derive(Debug)]
struct JobSnapshot {
    status: JobStatus,
    result: Option<String>,
    error: Option<String>,
    contaminated: bool,
    source_evaluations: u64,
    effect_frozen: bool,
    pending_fetches: u64,
    pending_timers: u64,
    next_timer_delay: Option<f64>,
}

fn host_call_expression(effect_runtime: &EffectRuntime, method: &str, args: &[String]) -> String {
    let token = serde_json::to_string(&effect_runtime.host_token).expect("host token is JSON");
    let method = serde_json::to_string(method).expect("host method is JSON");
    let arguments = std::iter::once(token)
        .chain(std::iter::once(method))
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(", ");
    format!("__ibex2_fire_timer({arguments})")
}

/// Why a host-channel call produced nothing.
#[derive(Debug, PartialEq, Eq)]
enum HostFailure {
    /// The job's deadline passed: at the door, so nothing ran, or while
    /// JavaScript ran, so the engine stopped it.
    Deadline,
    /// JavaScript threw, or the channel's reply was not what the host expects.
    Message(String),
}

impl From<JsError> for HostFailure {
    fn from(error: JsError) -> Self {
        match error {
            JsError::Deadline => HostFailure::Deadline,
            JsError::Thrown(text) => HostFailure::Message(text),
        }
    }
}

impl From<String> for HostFailure {
    fn from(message: String) -> Self {
        HostFailure::Message(message)
    }
}

fn call_host(
    effect_runtime: &mut EffectRuntime,
    method: &str,
    args: &[String],
) -> Result<String, HostFailure> {
    let expression = host_call_expression(effect_runtime, method, args);
    Ok(effect_runtime.runtime.eval(&expression)?)
}

fn read_job_snapshot(
    effect_runtime: &mut EffectRuntime,
    job_token: &str,
) -> Result<JobSnapshot, HostFailure> {
    let token_json = serde_json::to_string(job_token).expect("job token is JSON");
    let read = host_call_expression(effect_runtime, "read", &[token_json]);
    let encoded = effect_runtime
        .runtime
        .eval(&format!("JSON.stringify({read})"))?;
    let value: serde_json::Value = serde_json::from_str(&encoded)
        .map_err(|error| format!("host snapshot is not JSON: {error}"))?;
    let field = |name: &str| {
        value
            .get(name)
            .ok_or_else(|| format!("host snapshot is missing {name}"))
    };
    let token = value
        .get("token")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "E_EFFECT_RESULT".to_owned())?
        .to_owned();
    if token != job_token {
        return Err("E_EFFECT_RESULT".to_owned().into());
    }
    let status = match field("status")?
        .as_str()
        .ok_or_else(|| "host snapshot status is not a string".to_owned())?
    {
        "sent" => JobStatus::Sent,
        "failed" => JobStatus::Failed(match field("failureKind")?.as_str() {
            Some("grant") => FailureKind::Grant,
            Some("result") => FailureKind::Result,
            Some("retryable") => FailureKind::Retryable,
            other => {
                return Err(format!(
                    "host snapshot failureKind is not a classification: {other:?}"
                )
                .into());
            }
        }),
        _ => JobStatus::Running,
    };
    effect_runtime.provider = value.get("provider").filter(|v| !v.is_null()).cloned();
    Ok(JobSnapshot {
        status,
        result: field("result")?.as_str().map(str::to_owned),
        error: field("error")?.as_str().map(str::to_owned),
        contaminated: field("contaminated")?
            .as_bool()
            .ok_or_else(|| "host snapshot contaminated is not a boolean".to_owned())?,
        source_evaluations: field("sourceEvaluations")?
            .as_u64()
            .ok_or_else(|| "host snapshot sourceEvaluations is not an integer".to_owned())?,
        effect_frozen: field("effectFrozen")?
            .as_bool()
            .ok_or_else(|| "host snapshot effectFrozen is not a boolean".to_owned())?,
        pending_fetches: field("pendingFetches")?
            .as_u64()
            .ok_or_else(|| "host snapshot pendingFetches is not an integer".to_owned())?,
        pending_timers: field("pendingTimers")?
            .as_u64()
            .ok_or_else(|| "host snapshot pendingTimers is not an integer".to_owned())?,
        next_timer_delay: field("nextTimerDelay")?.as_f64(),
    })
}

type JobResult = (Outcome, Vec<EffectLog>, bool, bool);

/// The budget's failure is retryable: a timeout can be transient, and an
/// effect that reached its provider before it is retried under `meta.id`
/// idempotency. The attempts and the backoff schedule are the runner's.
// @ref LLP 1003#3-the-runtime-snapback2-effects — `E_EFFECT_TIMEOUT` → `Failed { retry: true }`.
fn timeout_outcome(budget: Duration) -> Outcome {
    Outcome::Failed {
        error: format!("E_EFFECT_TIMEOUT: budget {} ms", budget.as_millis()),
        retry: true,
    }
}

fn timed_out(effect_runtime: &EffectRuntime, job: &EffectJob, budget: Duration) -> JobResult {
    let logs = drain_logs(&effect_runtime.runtime, job);
    (timeout_outcome(budget), logs, false, false)
}

/// Why the drive between entrances ended before quiescence.
enum Exit {
    /// The deadline ended an entrance. Whether that is the job's timeout
    /// depends on what the host had observed by then.
    Deadline,
    /// Anything else, already reported.
    Result(JobResult),
}

/// An entrance the engine refused or stopped. Anything but the deadline
/// thrown out of a drain or a pump is engine-raised — Promise reactions and
/// `queueMicrotask` catch their own — and leaves the runtime's state unknown.
fn entrance_failed(
    effect_runtime: &EffectRuntime,
    job: &EffectJob,
    entrance: &str,
    error: JsError,
) -> Exit {
    match error {
        JsError::Deadline => Exit::Deadline,
        JsError::Thrown(text) => Exit::Result((
            Outcome::Failed {
                error: format!("E_EFFECT_ENGINE: {entrance} threw: {text}"),
                retry: false,
            },
            drain_logs(&effect_runtime.runtime, job),
            true,
            false,
        )),
    }
}

fn host_channel_failed(
    effect_runtime: &EffectRuntime,
    job: &EffectJob,
    what: &str,
    failure: HostFailure,
) -> Exit {
    match failure {
        HostFailure::Deadline => Exit::Deadline,
        HostFailure::Message(error) => Exit::Result((
            Outcome::Failed {
                error: format!("E_EFFECT_HOST_CHANNEL: {what}: {error}"),
                retry: false,
            },
            drain_logs(&effect_runtime.runtime, job),
            true,
            false,
        )),
    }
}

fn snapshot_failed(effect_runtime: &EffectRuntime, job: &EffectJob, failure: HostFailure) -> Exit {
    match failure {
        HostFailure::Deadline => Exit::Deadline,
        HostFailure::Message(error) => Exit::Result((
            Outcome::Failed {
                error: if error.contains("E_EFFECT_RESULT") {
                    "E_EFFECT_RESULT".to_owned()
                } else {
                    format!("E_EFFECT_RESULT_READ: {error}")
                },
                retry: false,
            },
            drain_logs(&effect_runtime.runtime, job),
            true,
            false,
        )),
    }
}

/// One job, one deadline.
///
/// The deadline is the declared budget measured from before the runtime was
/// built, and every entrance into authored code — the module's top-level
/// evaluation, the synchronous `run`, each microtask drain, each timer pump,
/// and the host reads between them — is held to that same instant; nothing
/// renews it per entrance or per iteration. The engine stops JavaScript at
/// it and reports the stop by kind; the host maps that to the timeout, and
/// the runtime is discarded.
// @ref LLP 1021#5-a-running-effect-can-be-stopped — armed before the module's top-level evaluation and the first `call_host`; the stop is the engine's, not a check between entrances.
fn run_job(
    effect_runtime: &mut EffectRuntime,
    job: &EffectJob,
    budget: Duration,
    deadline: Instant,
) -> JobResult {
    effect_runtime.provider = job
        .bindings
        .as_ref()
        .map(|_| json!({"origins":[],"requests":0,"refused":{}}));
    let _ = effect_runtime.runtime.drain_console();
    let payload = match serde_json::to_string(&job.payload) {
        Ok(payload) => payload,
        Err(error) => {
            return (
                Outcome::Failed {
                    error: format!("E_EFFECT_PAYLOAD_JSON: {error}"),
                    retry: false,
                },
                Vec::new(),
                false,
                true,
            );
        }
    };
    let meta = json!({
        "id": job.id,
        "effect": job.effect,
        "attempt": job.attempt,
    });
    let payload_json = serde_json::to_string(&payload).expect("encoded payload is JSON");
    let meta_json =
        serde_json::to_string(&serde_json::to_string(&meta).expect("effect metadata is JSON"))
            .expect("encoded effect metadata is JSON");
    let job_token_json = serde_json::to_string(&job.id).expect("job token is JSON");

    // A fresh runtime was armed with this same instant for its top-level
    // evaluation; a retained one is armed here, before its first entrance.
    effect_runtime.runtime.set_deadline(deadline);
    let result = run_job_until(
        effect_runtime,
        job,
        budget,
        deadline,
        &[job_token_json, payload_json, meta_json],
    );
    // The deadline was this job's. A retained runtime is armed again, with the
    // next job's, before that job's first entrance.
    effect_runtime.runtime.clear_deadline();
    result
}

fn run_job_until(
    effect_runtime: &mut EffectRuntime,
    job: &EffectJob,
    budget: Duration,
    deadline: Instant,
    run_args: &[String],
) -> JobResult {
    match call_host(effect_runtime, "run", run_args) {
        Ok(_) => {}
        Err(HostFailure::Deadline) => return timed_out(effect_runtime, job, budget),
        Err(HostFailure::Message(error)) => {
            let logs = drain_logs(&effect_runtime.runtime, job);
            return (Outcome::Failed { error, retry: true }, logs, true, false);
        }
    }
    let mut settled = None;
    let (snapshot, quiescent) = match drive(effect_runtime, job, deadline, &mut settled) {
        Ok(end) => end,
        // The deadline reached after the job was observed settled ends the
        // drive with that settlement — a result stands, a failure keeps the
        // classification made when it settled — and the leftover work goes
        // with the runtime. The timeout is for a job still running.
        Err(Exit::Deadline) => match settled {
            Some(snapshot) => (snapshot, false),
            None => return timed_out(effect_runtime, job, budget),
        },
        Err(Exit::Result(result)) => return result,
    };
    let logs = drain_logs(&effect_runtime.runtime, job);
    if snapshot.source_evaluations != 1 || !snapshot.effect_frozen {
        return (
            Outcome::Failed {
                error: "E_EFFECT_ENGINE: installed effect lost its frozen one-evaluation invariant"
                    .to_owned(),
                retry: false,
            },
            logs,
            true,
            quiescent,
        );
    }
    let contaminated = snapshot.contaminated;
    let outcome = match snapshot.status {
        JobStatus::Sent => match snapshot.result {
            Some(result) => match serde_json::from_str(&result) {
                Ok(value) => Outcome::Sent {
                    result: value,
                    leftover: !quiescent,
                },
                Err(_) => Outcome::Failed {
                    error: "E_EFFECT_RESULT".to_owned(),
                    retry: false,
                },
            },
            None => Outcome::Failed {
                error: "E_EFFECT_RESULT".to_owned(),
                retry: false,
            },
        },
        JobStatus::Failed(kind) => Outcome::Failed {
            error: snapshot.error.unwrap_or_else(|| {
                if kind == FailureKind::Result {
                    "E_EFFECT_RESULT".to_owned()
                } else {
                    "effect failed without an error".to_owned()
                }
            }),
            retry: kind == FailureKind::Retryable,
        },
        JobStatus::Running => timeout_outcome(budget),
    };
    (outcome, logs, contaminated, quiescent)
}

#[cfg(test)]
thread_local! {
    static DRIVE_TURNS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static MEASURE_LEGACY_POLL: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Drain, read, wait, pump — until the job is quiescent, or settled with
/// only timers left, or the deadline is reached. Isolation boundary:
/// application microtasks drain while no timer permit exists; then exactly
/// one permit is armed immediately before one Ibex pump, and a real timer
/// consumes it before its callback microtasks. The last snapshot that
/// reported the job settled is left in `settled`: it is what stands when
/// the deadline ends an entrance after it.
fn drive(
    effect_runtime: &mut EffectRuntime,
    job: &EffectJob,
    deadline: Instant,
    settled: &mut Option<JobSnapshot>,
) -> Result<(JobSnapshot, bool), Exit> {
    let mut idle_wait = Duration::from_millis(1);
    loop {
        #[cfg(test)]
        DRIVE_TURNS.with(|turns| turns.set(turns.get() + 1));
        effect_runtime
            .runtime
            .drain_microtasks()
            .map_err(|error| entrance_failed(effect_runtime, job, "microtask drain", error))?;
        let snapshot = read_job_snapshot(effect_runtime, &job.id)
            .map_err(|failure| snapshot_failed(effect_runtime, job, failure))?;
        let is_settled = snapshot.status != JobStatus::Running;
        if is_settled && snapshot.pending_fetches == 0 {
            if snapshot.pending_timers == 0 {
                return Ok((snapshot, true));
            }
            if snapshot.next_timer_delay.is_none_or(|millis| millis > 0.0) {
                return Ok((snapshot, false));
            }
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok((snapshot, false));
        }

        let remaining = deadline.saturating_duration_since(now);
        // Ibex has no public wait-for-completion primitive. Poll blocked
        // network work with bounded backoff, never through an authored timer.
        let timer_wait = snapshot
            .next_timer_delay
            .map(|millis| Duration::from_secs_f64(millis.max(0.0) / 1000.0));
        let wait = if snapshot.pending_fetches == 0 {
            timer_wait.unwrap_or(idle_wait)
        } else {
            timer_wait.unwrap_or(idle_wait).min(idle_wait)
        }
        .min(remaining);
        #[cfg(test)]
        let wait = if MEASURE_LEGACY_POLL.with(|legacy| legacy.get()) {
            Duration::from_millis(1).min(remaining)
        } else {
            wait
        };
        if is_settled {
            *settled = Some(snapshot);
        }
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }

        call_host(effect_runtime, "armTimers", &[])
            .map_err(|failure| host_channel_failed(effect_runtime, job, "arm timers", failure))?;
        let ran = effect_runtime
            .runtime
            .pump()
            .map_err(|error| entrance_failed(effect_runtime, job, "timer pump", error))?;
        call_host(effect_runtime, "disarmTimers", &[]).map_err(|failure| {
            host_channel_failed(effect_runtime, job, "disarm timers", failure)
        })?;
        idle_wait = if ran > 0 {
            Duration::from_millis(1)
        } else {
            (idle_wait * 2).min(Duration::from_millis(40))
        };
    }
}

fn drain_logs(runtime: &Hermes, job: &EffectJob) -> Vec<EffectLog> {
    runtime
        .drain_console()
        .into_iter()
        .map(|record| EffectLog {
            outbox_id: job.id.clone(),
            level: record.level.as_str().to_owned(),
            message: record.message,
        })
        .collect()
}

#[cfg(test)]
#[path = "ibex_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "ibex_bound_tests.rs"]
mod bound_tests;

#[cfg(test)]
#[path = "ibex_deadline_tests.rs"]
mod deadline_tests;

#[cfg(test)]
#[path = "ibex_fetch_tests.rs"]
mod fetch_tests;
