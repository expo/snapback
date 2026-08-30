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
const EFFECT_GLOBALS: &[&str] = &[
    // Non-configurable Hermes intrinsics. Project source cannot name these
    // under the compiler's closed effect environment, but the engine always
    // reports them in global_names().
    "$SHBuiltin",
    "Array",
    "Date",
    "DebuggerInternal",
    "Error",
    "HermesInternal",
    "Infinity",
    "JSON",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "Set",
    "String",
    "Symbol",
    "TextDecoder",
    "TextEncoder",
    "TypeError",
    "URL",
    "Uint8Array",
    "WeakMap",
    "WeakSet",
    // Ibex 2's C++ pump resolves this name directly. The prelude replaces the
    // binding with a wrapper guarded by a closure-held, host-armed permit.
    "__ibex2_fire_timer",
    "atob",
    "btoa",
    "console",
    "fetch",
    "globalThis",
    "isFinite",
    "meta",
    "setTimeout",
    "undefined",
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
}

impl Ibex2Host {
    pub fn new() -> Result<Self, &'static str> {
        Ok(Self {
            runtimes: BTreeMap::new(),
            logs: Vec::new(),
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
        "ibex2 + vanilla hermes"
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
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    struct TestServer {
        port: u16,
        hits: Arc<Mutex<Vec<String>>>,
    }

    impl TestServer {
        fn start(reply: &'static str) -> Self {
            Self::start_with(reply, None)
        }

        fn start_redirecting_to(location: String) -> Self {
            Self::start_with("", Some(location))
        }

        fn start_with(reply: &'static str, redirect_to: Option<String>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
            let port = listener.local_addr().unwrap().port();
            let hits = Arc::new(Mutex::new(Vec::new()));
            let recorded = Arc::clone(&hits);
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { break };
                    let mut raw = Vec::new();
                    let mut buffer = [0_u8; 4096];
                    loop {
                        match stream.read(&mut buffer) {
                            Ok(0) => break,
                            Ok(read) => {
                                raw.extend_from_slice(&buffer[..read]);
                                if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    recorded.lock().unwrap().push(
                        String::from_utf8_lossy(&raw)
                            .lines()
                            .next()
                            .unwrap_or("")
                            .to_owned(),
                    );
                    let response = match &redirect_to {
                        Some(location) => format!(
                            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        ),
                        None => format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            reply.len(),
                            reply
                        ),
                    };
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
            });
            Self { port, hits }
        }

        fn origin(&self) -> String {
            format!("http://127.0.0.1:{}", self.port)
        }
    }

    fn declaration(source: &str, grants: Vec<String>) -> EffectDecl {
        EffectDecl {
            name: "notifications.notify".to_owned(),
            grants,
            source: source.to_owned(),
            then: None,
        }
    }

    fn job(id: &str, payload: Value) -> EffectJob {
        EffectJob {
            id: id.to_owned(),
            effect: "notifications.notify".to_owned(),
            payload,
            attempt: 1,
            generation: Some("generation-1".to_owned()),
        }
    }

    fn sent(result: Value) -> Outcome {
        Outcome::Sent {
            result,
            leftover: false,
        }
    }

    #[test]
    fn loopback_fetch_returns_the_response_body() {
        let server = TestServer::start("hello from effect");
        let decl = declaration(
            "async (payload) => ({ body: await (await fetch(payload.url)).text(), id: meta.id, attempt: meta.attempt })",
            vec![server.origin()],
        );
        let mut host = Ibex2Host::new().unwrap();
        let outcome = host.run(
            &decl,
            &job(
                "fetch-1",
                json!({ "url": format!("{}/body", server.origin()) }),
            ),
            Duration::from_secs(2),
        );

        assert_eq!(
            outcome,
            sent(json!({ "body": "hello from effect", "id": "fetch-1", "attempt": 1 }))
        );
        assert_eq!(server.hits.lock().unwrap().len(), 1);
    }

    #[test]
    fn undeclared_origin_is_non_retryable_and_names_the_origin() {
        let server = TestServer::start("must not arrive");
        let decl = declaration(
            "async (payload, { fetch }) => (await fetch(payload.url)).text()",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();
        let outcome = host.run(
            &decl,
            &job(
                "denied-1",
                json!({ "url": format!("{}/secret", server.origin()) }),
            ),
            Duration::from_secs(2),
        );

        match outcome {
            Outcome::Failed { error, retry } => {
                assert!(!retry);
                assert!(
                    error.contains(&server.origin()),
                    "unexpected error: {error}"
                );
            }
            other => panic!("expected grant denial, got {other:?}"),
        }
        assert!(server.hits.lock().unwrap().is_empty());

        let tagged = declaration(
            "async (payload, { fetch }) => { try { await fetch(payload.url); } catch (error) { return { code: error.code, origin: error.origin }; } }",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        assert_eq!(
            host.run(
                &tagged,
                &job(
                    "denied-tag",
                    json!({ "url": format!("{}/secret", server.origin()) }),
                ),
                Duration::from_secs(2),
            ),
            sent(json!({ "code": "E_EFFECT_GRANT", "origin": server.origin() }))
        );
    }

    #[test]
    fn redirect_denial_names_the_denied_hop_origin() {
        let denied = TestServer::start("must not arrive");
        let redirector = TestServer::start_redirecting_to(format!("{}/secret", denied.origin()));
        let decl = declaration(
            "async (payload, { fetch }) => { try { await fetch(payload.url); } catch (error) { return { code: error.code || 'missing', origin: error.origin || 'missing', message: error.message || String(error) }; } }",
            vec![redirector.origin()],
        );
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job(
                    "redirect-denied",
                    json!({ "url": format!("{}/start", redirector.origin()) }),
                ),
                Duration::from_secs(2),
            ),
            sent(json!({
                "code": "E_EFFECT_GRANT",
                "origin": denied.origin(),
                "message": format!(
                    "denied: net.fetch {}; declare {}",
                    denied.origin(),
                    denied.origin()
                ),
            }))
        );
        assert_eq!(redirector.hits.lock().unwrap().len(), 1);
        assert!(denied.hits.lock().unwrap().is_empty());
    }

    #[test]
    fn throw_retries_and_never_resolving_promise_times_out() {
        let mut host = Ibex2Host::new().unwrap();
        let throws = declaration(
            "async () => { throw new Error('provider broke'); }",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let outcome = host.run(
            &throws,
            &job("throw-1", Value::Null),
            Duration::from_millis(50),
        );
        assert!(
            matches!(outcome, Outcome::Failed { retry: true, ref error } if error.contains("provider broke"))
        );

        let mimics_denial = declaration(
            "async () => { throw new Error('denied: net.fetch provider overloaded'); }",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        assert!(matches!(
            host.run(
                &mimics_denial,
                &job("throw-denial-text", Value::Null),
                Duration::from_millis(50),
            ),
            Outcome::Failed { retry: true, ref error }
                if error.contains("denied: net.fetch provider overloaded")
        ));

        let never = declaration(
            "async () => new Promise(() => {})",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let outcome = host.run(
            &never,
            &job("timeout-1", Value::Null),
            Duration::from_millis(10),
        );
        assert!(
            matches!(outcome, Outcome::Failed { retry: true, ref error } if error.starts_with("E_EFFECT_TIMEOUT"))
        );
    }

    #[test]
    fn effect_code_cannot_forge_a_grant_denial_marker() {
        let mut host = Ibex2Host::new().unwrap();

        for code in ["E_EFFECT_GRANT", "E_EFFECT_RESULT"] {
            let decl = declaration(
                &format!(
                    "async () => {{ const forged = new Error('provider failed'); forged.code = '{code}'; throw forged; }}"
                ),
                vec!["http://127.0.0.1:1".to_owned()],
            );
            assert!(
                matches!(
                    host.run(
                        &decl,
                        &job(&format!("forged-{code}"), Value::Null),
                        Duration::from_millis(100),
                    ),
                    Outcome::Failed { retry: true, ref error }
                        if error.contains("provider failed")
                ),
                "application-owned error code {code} must remain diagnostic data"
            );
        }
    }

    #[test]
    fn effect_source_cannot_resolve_host_closure_bindings() {
        let mut host = Ibex2Host::new().unwrap();

        for binding in [
            "state",
            "hostToken",
            "installedEntry",
            "fireTimer",
            "grantedFetch",
        ] {
            let decl = declaration(
                &format!("async () => ({{ leaked: {binding} }})"),
                vec!["http://127.0.0.1:1".to_owned()],
            );
            assert!(
                matches!(
                    host.run(
                        &decl,
                        &job(&format!("closure-{binding}"), Value::Null),
                        Duration::from_millis(100),
                    ),
                    Outcome::Failed { retry: false, ref error }
                        if error.starts_with("E_EFFECT_RESULT")
                            && error.contains("ReferenceError")
                ),
                "effect code must neither forge nor leak the closure-held {binding} binding"
            );
        }
    }

    #[test]
    fn undefined_is_non_retryable_null_is_valid_and_non_json_results_are_refused() {
        let grants = vec!["http://127.0.0.1:1".to_owned()];
        let mut host = Ibex2Host::new().unwrap();

        for (id, source) in [
            ("undefined", "async () => undefined"),
            ("bare-return", "async () => { return; }"),
        ] {
            assert!(
                matches!(
                    host.run(
                        &declaration(source, grants.clone()),
                        &job(id, Value::Null),
                        Duration::from_millis(100),
                    ),
                    Outcome::Failed { retry: false, ref error }
                        if error == "E_EFFECT_RESULT: effect returned undefined; return null explicitly"
                ),
                "{id}"
            );
        }

        assert_eq!(
            host.run(
                &declaration("async () => null", grants.clone()),
                &job("explicit-null", Value::Null),
                Duration::from_millis(100),
            ),
            sent(Value::Null)
        );

        for (id, source) in [
            ("nan", "async () => NaN"),
            ("infinity", "async () => Infinity"),
            ("negative-infinity", "async () => -Infinity"),
            ("undefined-field", "async () => ({ missing: undefined })"),
            ("undefined-element", "async () => [undefined]"),
            ("function", "async () => function nope() {}"),
            ("symbol", "async () => Symbol('nope')"),
            ("bigint", "async () => 1n"),
            (
                "cyclic",
                "async () => { const value = {}; value.self = value; return value; }",
            ),
        ] {
            assert!(
                matches!(
                    host.run(
                        &declaration(source, grants.clone()),
                        &job(id, Value::Null),
                        Duration::from_millis(100),
                    ),
                    Outcome::Failed { retry: false, ref error }
                        if error.starts_with("E_EFFECT_RESULT")
                ),
                "{id}"
            );
        }
    }

    #[test]
    fn compiler_embedded_json_constants_are_isolated_between_jobs() {
        let decl = declaration(
            r#"(() => { const box = {"value":"clean","nested":{"value":"clean"}}; return (async (payload) => {
              if (payload.poison) {
                try { box.value = "secret"; } catch (_) {}
                try { box.nested.value = "secret"; } catch (_) {}
              }
              return { value: box.value, nested: box.nested.value };
            }); })()"#,
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();

        let _ = host.run(
            &decl,
            &job("constants-poison", json!({ "poison": true })),
            Duration::from_millis(100),
        );
        assert_eq!(
            host.run(
                &decl,
                &job("constants-read", json!({ "poison": false })),
                Duration::from_millis(100),
            ),
            sent(json!({ "value": "clean", "nested": "clean" }))
        );
        assert_eq!(host.cached_runtime_count(), 1);
    }

    #[test]
    fn job_code_cannot_fire_ibex_timers_through_a_lexical_hook() {
        let decl = declaration(
            r#"async () => {
              let handle;
              let fired = false;
              const fireTimer = globalThis.__ibex2_fire_timer;
              const realTimer = new Promise(function (resolve) {
                handle = setTimeout(function () { fired = true; resolve(); }, 20);
              });
              await Promise.resolve();
              let denied = false;
              try { fireTimer(handle); } catch (_) { denied = true; }
              const firedBeforeDue = fired;
              await realTimer;
              return { denied, firedBeforeDue, fired };
            }"#,
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job("timer-guard", Value::Null),
                Duration::from_millis(500),
            ),
            sent(json!({ "denied": true, "firedBeforeDue": false, "fired": true }))
        );
    }

    #[test]
    fn guarded_ibex_timer_still_drives_an_awaited_timeout() {
        let decl = declaration(
            r#"async () => {
              await new Promise(function (resolve) { setTimeout(resolve, 0); });
              return { timer: "delivered" };
            }"#,
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job("timer-await", Value::Null),
                Duration::from_millis(100),
            ),
            sent(json!({ "timer": "delivered" }))
        );
    }

    #[test]
    fn console_is_attributed_and_job_tools_share_no_state() {
        let source = r#"(() => { const globalAlias = globalThis; return async function (payload, tools) {
          const fetch = tools.fetch;
          const meta = tools.meta;
          if (payload.set) {
            payload.jobLeak = "payload";
            payload.nested.jobLeak = "nested";
            try { fetch.jobLeak = "fetch"; } catch (_) {}
            try { meta.jobLeak = "meta"; } catch (_) {}
            try { tools.jobLeak = "tools"; } catch (_) {}
            try { globalAlias.jobLeak = "global"; } catch (_) {}
            console.log("stored", payload.value);
            return {
              payloadMutated: payload.jobLeak === "payload" && payload.nested.jobLeak === "nested",
              toolsStayedIsolated: fetch.jobLeak === undefined && meta.jobLeak === undefined && tools.jobLeak === undefined,
              globalStayedIsolated: globalAlias.jobLeak === undefined
            };
          }
          return {
            payloadClean: payload.jobLeak === undefined && payload.nested.jobLeak === undefined,
            fetchClean: fetch.jobLeak === undefined,
            metaClean: meta.jobLeak === undefined,
            toolsClean: tools.jobLeak === undefined,
            globalClean: globalAlias.jobLeak === undefined,
            fetchFrozen: Object.isFrozen(fetch),
            metaFrozen: Object.isFrozen(meta),
            toolsFrozen: Object.isFrozen(tools)
          };
        }; })()"#;
        let decl = declaration(source, vec!["http://127.0.0.1:1".to_owned()]);
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job("state-1", json!({ "set": true, "value": 42, "nested": {} }),),
                Duration::from_millis(100),
            ),
            sent(json!({
                "globalStayedIsolated": true,
                "payloadMutated": true,
                "toolsStayedIsolated": true
            }))
        );
        assert_eq!(
            host.take_logs(),
            vec![EffectLog {
                outbox_id: "state-1".to_owned(),
                level: "log".to_owned(),
                message: "stored 42".to_owned(),
            }]
        );
        assert_eq!(
            host.run(
                &decl,
                &job("state-2", json!({ "set": false, "nested": {} })),
                Duration::from_millis(100),
            ),
            sent(json!({
                "fetchClean": true,
                "fetchFrozen": true,
                "globalClean": true,
                "metaClean": true,
                "metaFrozen": true,
                "payloadClean": true,
                "toolsClean": true,
                "toolsFrozen": true
            }))
        );
        assert_eq!(
            host.cached_runtime_count(),
            1,
            "the isolation check must reuse the runtime"
        );
    }

    #[test]
    fn synchronous_setup_failure_does_not_poison_the_next_job() {
        let decl = declaration(
            "async (payload) => payload",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut wrong_effect = job("wrong-effect", Value::Null);
        wrong_effect.effect = "notifications.other".to_owned();
        let mut host = Ibex2Host::new().unwrap();

        assert!(matches!(
            host.run(&decl, &wrong_effect, Duration::from_millis(100)),
            Outcome::Failed { retry: true, ref error }
                if error.contains("effect source is not installed")
        ));
        assert_eq!(
            host.run(
                &decl,
                &job("after-sync-failure", json!({ "clean": true })),
                Duration::from_millis(100),
            ),
            sent(json!({ "clean": true }))
        );
        assert_eq!(host.cached_runtime_count(), 1);
    }

    #[test]
    fn runtime_rotates_after_fifty_jobs() {
        let decl = declaration("async () => true", vec!["http://127.0.0.1:1".to_owned()]);
        let mut host = Ibex2Host::new().unwrap();
        for attempt in 1..=50 {
            let mut next = job(&format!("rotate-{attempt}"), Value::Null);
            next.attempt = attempt;
            assert_eq!(
                host.run(&decl, &next, Duration::from_millis(100)),
                sent(json!(true))
            );
        }
        assert_eq!(host.cached_runtime_count(), 0);
        assert_eq!(
            host.run(
                &decl,
                &job("rotate-51", Value::Null),
                Duration::from_millis(100)
            ),
            sent(json!(true))
        );
        assert_eq!(host.cached_runtime_count(), 1);
        host.generation_changed();
        assert_eq!(host.cached_runtime_count(), 0);
    }

    #[test]
    fn resolved_job_with_leftover_timer_discards_runtime() {
        let decl = declaration(
            r#"async (payload) => {
              if (payload.schedule) {
                setTimeout(function () { console.log("late timer"); }, 30);
              }
              return payload.value;
            }"#,
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job("timer-1", json!({ "schedule": true, "value": "first" })),
                Duration::from_millis(5),
            ),
            Outcome::Sent {
                result: json!("first"),
                leftover: true,
            }
        );
        assert_eq!(host.cached_runtime_count(), 0);

        assert_eq!(
            host.run(
                &decl,
                &job("timer-2", json!({ "schedule": false, "value": "second" })),
                Duration::from_millis(100),
            ),
            sent(json!("second"))
        );
        assert!(
            host.take_logs().is_empty(),
            "the first job's timer must be gone"
        );
        assert_eq!(host.cached_runtime_count(), 1);
    }

    #[test]
    fn effect_source_is_evaluated_once_per_runtime() {
        let decl = declaration(
            "async (payload) => payload",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();

        for number in 1..=3 {
            assert_eq!(
                host.run(
                    &decl,
                    &job(&format!("compile-{number}"), json!(number)),
                    Duration::from_millis(100),
                ),
                sent(json!(number))
            );
        }

        let cached = host
            .runtimes
            .values_mut()
            .next()
            .expect("one cached runtime");
        let snapshot = read_job_snapshot(cached, "compile-3").unwrap();
        assert_eq!(snapshot.source_evaluations, 1);
        assert!(snapshot.effect_frozen);
    }

    #[test]
    fn host_refuses_a_result_for_another_job_token() {
        let decl = declaration(
            "async () => ({ real: true })",
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let mut host = Ibex2Host::new().unwrap();
        assert_eq!(
            host.run(
                &decl,
                &job("right-job", Value::Null),
                Duration::from_millis(100),
            ),
            sent(json!({ "real": true }))
        );

        let cached = host
            .runtimes
            .values_mut()
            .next()
            .expect("one cached runtime");
        let error = read_job_snapshot(cached, "wrong-job").unwrap_err();
        assert_eq!(error, "E_EFFECT_RESULT");
    }

    #[test]
    fn payload_json_parse_preserves_an_own_proto_key() {
        let decl = declaration(
            r#"async (payload) => ({
              inheritedAdminAbsent: payload.admin === undefined,
              ownProto: Object.prototype.hasOwnProperty.call(payload, "__proto__")
            })"#,
            vec!["http://127.0.0.1:1".to_owned()],
        );
        let payload: Value = serde_json::from_str(r#"{"__proto__":{"admin":true}}"#).unwrap();
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(&decl, &job("proto-1", payload), Duration::from_millis(100),),
            sent(json!({ "inheritedAdminAbsent": true, "ownProto": true }))
        );
    }

    #[test]
    fn effect_global_surface_is_exact_allowlist() {
        let decl = declaration("async () => true", vec!["http://127.0.0.1:1".to_owned()]);
        let mut runtime = build_runtime(&decl).expect("build effect runtime");
        assert_eq!(
            runtime.runtime.global_names(),
            EFFECT_GLOBALS
                .iter()
                .map(|name| (*name).to_owned())
                .collect::<Vec<_>>()
        );
    }
}
