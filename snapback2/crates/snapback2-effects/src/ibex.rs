use crate::{EffectHost, EffectJob, EffectLog, Outcome};
use ibex2::engine::hermes::{DynamicCode, Grants, Hermes};
use serde_json::json;
use snapback2_core::{EffectDecl, digest};
use std::collections::{BTreeMap, hash_map::RandomState};
use std::hash::{BuildHasher, Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const MAX_JOBS_PER_RUNTIME: u32 = 50;
const SAVE_FETCH_ACCESSORS: &str = r#"
globalThis.__sb_saved = {
  field: globalThis.__ibex2_response_field,
  decode: globalThis.__ibex2_text_decode,
  encode: globalThis.__ibex2_text_encode,
  encodeInto: globalThis.__ibex2_text_encode_into
};
"#;
const PRELUDE: &str = include_str!("prelude.js");
const FETCH_FACTORY: &str = include_str!("prelude/fetch.js");
// Public names match the compiler effect allowlist. Engine internals and globalThis
// remain unnameable in authored source; the host needs them to harden and pump.
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
    "DebuggerInternal",
    "Error",
    "EvalError",
    "Float32Array",
    "Float64Array",
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
    // Drop the runtime before its raw fetch binding's borrowed grants.
    runtime: Hermes,
    _grants: Grants,
    declared_grants: Vec<String>,
    jobs: u32,
    host_token: String,
}

/// Ibex 2 over vanilla Hermes, with one hardened runtime per effect source.
// @ref LLP 1003#3-the-runtime-snapback2-effects — per-source runtimes carry grants, harden before jobs, and rotate after fifty.
pub struct Ibex2Host {
    runtimes: BTreeMap<RuntimeKey, EffectRuntime>,
    logs: Vec<EffectLog>,
    available: bool,
}

impl Ibex2Host {
    pub fn new() -> Result<Self, &'static str> {
        Ok(Self {
            runtimes: BTreeMap::new(),
            logs: Vec::new(),
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
                    && runtime.jobs < MAX_JOBS_PER_RUNTIME)
        });

        if !self.runtimes.contains_key(&key) {
            match build_runtime(decl) {
                Ok(runtime) => {
                    self.runtimes.insert(key.clone(), runtime);
                }
                Err(BuildFailure::Unavailable(message)) => return Outcome::Unavailable(message),
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
        let (outcome, logs, contaminated, quiescent) = run_job(runtime, job, budget);
        self.logs = logs;
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

    fn take_logs(&mut self) -> Vec<EffectLog> {
        std::mem::take(&mut self.logs)
    }
}

#[derive(Debug)]
enum BuildFailure {
    Unavailable(&'static str),
    Invalid(String),
}

static HOST_CHANNEL_NONCE: AtomicU64 = AtomicU64::new(0);

fn host_channel_token() -> String {
    let nonce = HOST_CHANNEL_NONCE.fetch_add(1, Ordering::Relaxed);
    let random_part = |domain: u64| {
        let mut hasher = RandomState::new().build_hasher();
        nonce.hash(&mut hasher);
        domain.hash(&mut hasher);
        hasher.finish()
    };
    let first = random_part(0);
    let second = random_part(1);
    format!("{second:016x}{first:016x}")
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

fn build_runtime(decl: &EffectDecl) -> Result<EffectRuntime, BuildFailure> {
    let mut runtime = Hermes::new(DynamicCode::Closed)
        .ok_or(BuildFailure::Unavailable("Hermes::new returned None"))?;
    if !runtime.install_stdlib() {
        return Err(BuildFailure::Unavailable(
            "Ibex 2 standard library install failed",
        ));
    }
    runtime
        .eval(SAVE_FETCH_ACCESSORS)
        .map_err(|error| BuildFailure::Invalid(format!("save fetch accessors: {}", error.0)))?;
    runtime
        .install_bindings()
        .map_err(|error| BuildFailure::Invalid(format!("install bindings: {}", error.0)))?;

    let grant_spec = decl
        .grants
        .iter()
        .map(|origin| format!("net.fetch {origin}"))
        .collect::<Vec<_>>()
        .join("\n");
    let grants = Grants::parse(&grant_spec)
        .ok_or_else(|| BuildFailure::Invalid("declared fetch grants did not parse".to_owned()))?;
    if !runtime.install_fetch(&grants) {
        return Err(BuildFailure::Invalid(
            "install grant-bound raw fetch failed".to_owned(),
        ));
    }

    let host_token = host_channel_token();
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
        .map_err(|error| BuildFailure::Invalid(format!("install effect prelude: {}", error.0)))?;
    // Hand the prelude entry to the token-gated host channel exactly once,
    // then remove the public install slot before source is evaluated.
    let token = serde_json::to_string(&host_token).expect("host token is JSON");
    runtime
        .eval(&format!(
            "__ibex2_fire_timer({token}, 'install', globalThis.__snapback_install); \
             delete globalThis.__snapback_install; \
             Object.preventExtensions(globalThis)",
        ))
        .map_err(|error| {
            BuildFailure::Invalid(format!("capture effect host entry: {}", error.0))
        })?;
    runtime
        .harden()
        .map_err(|error| BuildFailure::Invalid(format!("harden effect runtime: {}", error.0)))?;
    verify_globals(&mut runtime)?;
    // Isolation boundary: source gets its own top-level script over the already
    // hardened global. Argument evaluation obtains the function value there;
    // the token-gated call then transfers only that value into the prelude.
    let isolated_source = freeze_compiler_embedded_constants(&decl.source);
    runtime
        .eval(&format!(
            "__ibex2_fire_timer({token}, 'installEffect', ({isolated_source}))"
        ))
        .map_err(|error| BuildFailure::Invalid(format!("install isolated effect: {}", error.0)))?;

    Ok(EffectRuntime {
        runtime,
        _grants: grants,
        declared_grants: decl.grants.clone(),
        jobs: 0,
        host_token,
    })
}

fn verify_globals(runtime: &mut Hermes) -> Result<(), BuildFailure> {
    let names = runtime.global_names();
    let expected = EFFECT_GLOBALS
        .iter()
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
            .filter(|name| !names.iter().any(|actual| actual == **name))
            .copied()
            .collect::<Vec<_>>();
        return Err(BuildFailure::Invalid(format!(
            "effect global surface mismatch; unexpected: {}; missing: {}",
            unexpected.join(", "),
            missing.join(", ")
        )));
    }
    let frozen = runtime
        .eval("String(Object.isFrozen(globalThis))")
        .map_err(|error| BuildFailure::Invalid(format!("inspect hardened global: {}", error.0)))?;
    if frozen != "true" {
        return Err(BuildFailure::Invalid(
            "effect global object was not frozen".to_owned(),
        ));
    }
    Ok(())
}

#[derive(Debug)]
struct JobSnapshot {
    status: String,
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

fn call_host(
    effect_runtime: &mut EffectRuntime,
    method: &str,
    args: &[String],
) -> Result<String, String> {
    let expression = host_call_expression(effect_runtime, method, args);
    effect_runtime
        .runtime
        .eval(&expression)
        .map_err(|error| error.0)
}

fn read_job_snapshot(
    effect_runtime: &mut EffectRuntime,
    job_token: &str,
) -> Result<JobSnapshot, String> {
    let token_json = serde_json::to_string(job_token).expect("job token is JSON");
    let read = host_call_expression(effect_runtime, "read", &[token_json]);
    let encoded = effect_runtime
        .runtime
        .eval(&format!("JSON.stringify({read})"))
        .map_err(|error| error.0)?;
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
        .ok_or("E_EFFECT_RESULT")?
        .to_owned();
    if token != job_token {
        return Err("E_EFFECT_RESULT".to_owned());
    }
    Ok(JobSnapshot {
        status: field("status")?
            .as_str()
            .ok_or_else(|| "host snapshot status is not a string".to_owned())?
            .to_owned(),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FailureKind {
    Grant,
    Result,
    Retryable,
}

fn classify_job_failure(
    effect_runtime: &mut EffectRuntime,
    job_token: &str,
) -> Result<FailureKind, String> {
    let token_json = serde_json::to_string(job_token).expect("job token is JSON");
    match call_host(effect_runtime, "classifyFailure", &[token_json])?.as_str() {
        "grant" => Ok(FailureKind::Grant),
        "result" => Ok(FailureKind::Result),
        "retryable" => Ok(FailureKind::Retryable),
        other => Err(format!("unknown effect failure classification: {other}")),
    }
}

fn run_job(
    effect_runtime: &mut EffectRuntime,
    job: &EffectJob,
    budget: Duration,
) -> (Outcome, Vec<EffectLog>, bool, bool) {
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

    if let Err(error) = call_host(
        effect_runtime,
        "run",
        &[job_token_json, payload_json, meta_json],
    ) {
        let logs = drain_logs(&effect_runtime.runtime, job);
        return (Outcome::Failed { error, retry: true }, logs, false, true);
    }
    let started = Instant::now();
    let (snapshot, quiescent) = loop {
        // Isolation boundary: drain application microtasks while no timer
        // permit exists. Then arm exactly one permit immediately before one
        // Ibex pump; a real timer consumes it before its callback microtasks.
        effect_runtime.runtime.drain_microtasks();
        let snapshot = match read_job_snapshot(effect_runtime, &job.id) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let logs = drain_logs(&effect_runtime.runtime, job);
                return (
                    Outcome::Failed {
                        error: if error.contains("E_EFFECT_RESULT") {
                            "E_EFFECT_RESULT".to_owned()
                        } else {
                            format!("E_EFFECT_RESULT_READ: {error}")
                        },
                        retry: false,
                    },
                    logs,
                    true,
                    false,
                );
            }
        };
        let settled = matches!(snapshot.status.as_str(), "sent" | "failed");
        if settled && snapshot.pending_fetches == 0 {
            if snapshot.pending_timers == 0 {
                break (snapshot, true);
            }
            if snapshot.next_timer_delay.is_none_or(|millis| millis > 0.0) {
                break (snapshot, false);
            }
        }
        if started.elapsed() >= budget {
            break (snapshot, false);
        }

        let remaining = budget.saturating_sub(started.elapsed());
        let wait = if snapshot.pending_fetches == 0 {
            snapshot
                .next_timer_delay
                .map(|millis| Duration::from_secs_f64((millis.max(0.0)) / 1000.0))
                .unwrap_or(Duration::from_millis(1))
        } else {
            Duration::from_millis(1)
        }
        .min(remaining);
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }

        if let Err(error) = call_host(effect_runtime, "armTimers", &[]) {
            let logs = drain_logs(&effect_runtime.runtime, job);
            return (
                Outcome::Failed {
                    error: format!("E_EFFECT_HOST_CHANNEL: arm timers: {error}"),
                    retry: false,
                },
                logs,
                true,
                false,
            );
        }
        effect_runtime.runtime.pump();
        if let Err(error) = call_host(effect_runtime, "disarmTimers", &[]) {
            let logs = drain_logs(&effect_runtime.runtime, job);
            return (
                Outcome::Failed {
                    error: format!("E_EFFECT_HOST_CHANNEL: disarm timers: {error}"),
                    retry: false,
                },
                logs,
                true,
                false,
            );
        }
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
    let outcome = match snapshot.status.as_str() {
        "sent" => match snapshot.result {
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
        "failed" => {
            // Isolation boundary: application-owned error fields are diagnostic
            // data only. Retry policy comes from closure-held error identity.
            let failure_kind = match classify_job_failure(effect_runtime, &job.id) {
                Ok(failure_kind) => failure_kind,
                Err(error) => {
                    return (
                        Outcome::Failed {
                            error: format!("E_EFFECT_RESULT_READ: {error}"),
                            retry: false,
                        },
                        logs,
                        true,
                        quiescent,
                    );
                }
            };
            let error = if failure_kind == FailureKind::Result {
                snapshot
                    .error
                    .unwrap_or_else(|| "E_EFFECT_RESULT".to_owned())
            } else {
                snapshot
                    .error
                    .unwrap_or_else(|| "effect failed without an error".to_owned())
            };
            Outcome::Failed {
                error,
                retry: failure_kind == FailureKind::Retryable,
            }
        }
        _ => Outcome::Failed {
            error: format!("E_EFFECT_TIMEOUT: budget {} ms", budget.as_millis()),
            retry: true,
        },
    };
    (outcome, logs, contaminated, quiescent)
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
