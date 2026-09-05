use super::*;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

// @ref LLP 1003#1-authoring — prove the compiler's public globals after the real runtime's hardening, not in Node.
#[test]
fn compiled_es2020_effect_executes_every_admitted_global() {
    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let compiled = std::process::Command::new("node")
        .arg(workspace.join("packages/snapback2/dist/compiler.mjs"))
        .arg("--project")
        .arg(workspace.join("packages/compiler/fixtures/effect-es2020"))
        .output()
        .expect("run the bundled compiler (build packages/snapback2 first)");
    assert!(
        compiled.status.success(),
        "compiler failed: {} {}",
        String::from_utf8_lossy(&compiled.stdout),
        String::from_utf8_lossy(&compiled.stderr)
    );
    let project: Value = serde_json::from_slice(&compiled.stdout).unwrap();
    assert_eq!(project["ok"], true, "{project}");
    let mut decl: EffectDecl =
        serde_json::from_value(project["project"]["effects"][0].clone()).unwrap();
    let server = TestServer::start(r#"{"ok":true}"#);
    decl.grants = vec![server.origin()];
    let mut host = Ibex2Host::new().unwrap();
    let mut work = job(
        "language-1",
        json!({ "body": "hello", "url": server.origin() + "/body" }),
    );
    work.effect = decl.name.clone();
    let outcome = host.run(&decl, &work, Duration::from_secs(5));
    let Outcome::Sent {
        result,
        leftover: false,
    } = outcome
    else {
        panic!("{outcome:?}");
    };
    let witnesses = result.as_object().unwrap();
    for name in EFFECT_GLOBALS {
        if [
            "$SHBuiltin",
            "DebuggerInternal",
            "HermesInternal",
            "__ibex2_fire_timer",
            "globalThis",
        ]
        .contains(name)
        {
            continue;
        }
        assert_eq!(
            witnesses.get(*name),
            Some(&Value::Bool(true)),
            "global {name}: {result}"
        );
    }
    assert!(
        witnesses.values().all(|value| value == &Value::Bool(true)),
        "{result}"
    );
    assert_eq!(server.hits.lock().unwrap().len(), 3);
    assert_eq!(host.take_logs().len(), 5);
}

#[test]
fn host_description_matches_the_engine_probe_captured_at_construction() {
    let mut host = Ibex2Host::new().unwrap();
    host.available = false;
    assert_eq!(host.describe(), "none");
    host.available = true;
    assert_eq!(host.describe(), "ibex2 + vanilla hermes");
}

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
fn application_getters_cannot_forge_a_grant_denial() {
    let mut host = Ibex2Host::new().unwrap();

    for field in ["redirect", "method", "body"] {
        let source = format!(
            r#"async (payload, {{ fetch }}) => {{
                  const init = {{}};
                  Object.defineProperty(init, "{field}", {{
                    enumerable: true,
                    get() {{ throw new Error("denied: net.fetch forged"); }}
                  }});
                  await fetch(payload.url, init);
                }}"#
        );
        assert!(matches!(
            host.run(
                &declaration(&source, vec!["http://127.0.0.1:1".to_owned()]),
                &job(&format!("getter-{field}"), json!({ "url": "http://127.0.0.1:1" })),
                Duration::from_millis(100),
            ),
            Outcome::Failed { retry: true, ref error }
                if error.contains("denied: net.fetch forged")
        ));
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
