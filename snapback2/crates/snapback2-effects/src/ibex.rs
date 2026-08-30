use crate::{EffectHost, EffectJob, EffectLog, Outcome};
use ibex2::engine::hermes::{DynamicCode, Grants, Hermes};
use serde_json::json;
use snapback2_core::{EffectDecl, digest};
use std::collections::BTreeMap;
use std::time::Duration;

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
        let (outcome, logs, contaminated) = run_job(runtime, decl, job, budget);
        self.logs = logs;
        if contaminated
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

    fn take_logs(&mut self) -> Vec<EffectLog> {
        std::mem::take(&mut self.logs)
    }
}

enum BuildFailure {
    Unavailable(&'static str),
    Invalid(String),
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

    let prelude = PRELUDE.replace("__SNAPBACK_FETCH_FACTORY__", FETCH_FACTORY);
    runtime
        .eval(&prelude)
        .map_err(|error| BuildFailure::Invalid(format!("install effect prelude: {}", error.0)))?;
    runtime
        .harden()
        .map_err(|error| BuildFailure::Invalid(format!("harden effect runtime: {}", error.0)))?;
    verify_globals(&mut runtime)?;

    Ok(EffectRuntime {
        runtime,
        _grants: grants,
        declared_grants: decl.grants.clone(),
        jobs: 0,
    })
}

fn verify_globals(runtime: &mut Hermes) -> Result<(), BuildFailure> {
    let names = runtime.global_names();
    let forbidden: Vec<_> = names
        .iter()
        .filter(|name| {
            name.as_str() == "fetch"
                || (name.starts_with("__ibex2") && name.as_str() != "__ibex2_fire_timer")
                || (name.starts_with("__sb") && name.as_str() != "__snapback")
        })
        .cloned()
        .collect();
    if !names.iter().any(|name| name == "__snapback") || !forbidden.is_empty() {
        return Err(BuildFailure::Invalid(format!(
            "effect global surface leaked names: {}",
            forbidden.join(", ")
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

fn run_job(
    effect_runtime: &mut EffectRuntime,
    decl: &EffectDecl,
    job: &EffectJob,
    budget: Duration,
) -> (Outcome, Vec<EffectLog>, bool) {
    let runtime = &mut effect_runtime.runtime;
    let _ = runtime.drain_console();
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
            );
        }
    };
    let meta = json!({
        "id": job.id,
        "effect": job.effect,
        "attempt": job.attempt,
    });
    let invocation = format!(
        "__snapback.run(function (fetch, meta) {{ return ({}); }}, {}, {})",
        decl.source,
        payload,
        serde_json::to_string(&meta).expect("effect metadata is JSON")
    );

    if let Err(error) = runtime.eval(&invocation) {
        let logs = drain_logs(runtime, job);
        return (
            Outcome::Failed {
                error: error.0,
                retry: true,
            },
            logs,
            false,
        );
    }
    runtime.run_to_quiescence(budget);

    let status = runtime
        .eval("__snapback.status")
        .unwrap_or_else(|error| format!("host-error:{}", error.0));
    let contaminated = runtime
        .eval("String(__snapback.contaminated)")
        .map(|value| value == "true")
        .unwrap_or(true);
    let logs = drain_logs(runtime, job);
    let outcome = match status.as_str() {
        "sent" => match runtime.eval("__snapback.result") {
            Ok(result) => match serde_json::from_str(&result) {
                Ok(value) => Outcome::Sent(value),
                Err(error) => Outcome::Failed {
                    error: format!("E_EFFECT_RESULT_JSON: {error}"),
                    retry: false,
                },
            },
            Err(error) => Outcome::Failed {
                error: format!("E_EFFECT_RESULT_READ: {}", error.0),
                retry: false,
            },
        },
        "failed" => {
            let error = runtime
                .eval("__snapback.error")
                .unwrap_or_else(|read| format!("effect failed; error read failed: {}", read.0));
            let retry = !error.contains("denied: net.fetch");
            Outcome::Failed { error, retry }
        }
        _ => Outcome::Failed {
            error: format!("E_EFFECT_TIMEOUT: budget {} ms", budget.as_millis()),
            retry: true,
        },
    };
    (outcome, logs, contaminated)
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
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        reply.len(),
                        reply
                    );
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
            Outcome::Sent(json!({ "body": "hello from effect", "id": "fetch-1", "attempt": 1 }))
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
    fn console_is_attributed_and_jobs_share_no_global_state() {
        let source = r#"async function (payload) {
          if (payload.set) { this.jobLeak = "first"; console.log("stored", payload.value); return null; }
          return typeof this.jobLeak;
        }"#;
        let decl = declaration(source, vec!["http://127.0.0.1:1".to_owned()]);
        let mut host = Ibex2Host::new().unwrap();

        assert_eq!(
            host.run(
                &decl,
                &job("state-1", json!({ "set": true, "value": 42 })),
                Duration::from_millis(100),
            ),
            Outcome::Sent(Value::Null)
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
                &job("state-2", json!({ "set": false })),
                Duration::from_millis(100),
            ),
            Outcome::Sent(json!("undefined"))
        );
        assert_eq!(
            host.cached_runtime_count(),
            1,
            "the isolation check must reuse the runtime"
        );
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
                Outcome::Sent(json!(true))
            );
        }
        assert_eq!(host.cached_runtime_count(), 0);
        assert_eq!(
            host.run(
                &decl,
                &job("rotate-51", Value::Null),
                Duration::from_millis(100)
            ),
            Outcome::Sent(json!(true))
        );
        assert_eq!(host.cached_runtime_count(), 1);
        host.generation_changed();
        assert_eq!(host.cached_runtime_count(), 0);
    }
}
