//! The bound-only transport of a `test` owner (LLP 1021 §3): grants are
//! admitted on the logical origin, the loopback is substituted after, an
//! unbound origin is terminal, and no socket leaves the loopback — asserted
//! with a reachable listener at the logical origin that must receive nothing.
use super::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct Listener {
    port: u16,
    hits: Arc<Mutex<Vec<String>>>,
}

impl Listener {
    /// Answers `reply` on every path; `/start` answers a 302 to `redirect`
    /// when one is given. Every request head is recorded.
    fn start(reply: &'static str, redirect: Option<String>) -> Self {
        Self::start_with(reply, redirect, None)
    }

    /// As `start`, but the first request is answered with `first_status` and
    /// a short body instead of `reply`.
    fn start_with(
        reply: &'static str,
        redirect: Option<String>,
        first_status: Option<u16>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let hits = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&hits);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut raw = Vec::new();
                let mut buffer = [0_u8; 4096];
                loop {
                    match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            raw.extend_from_slice(&buffer[..read]);
                            if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                                let head = String::from_utf8_lossy(&raw[..end]).into_owned();
                                let length = head
                                    .lines()
                                    .find_map(|line| {
                                        let (key, value) = line.split_once(':')?;
                                        key.eq_ignore_ascii_case("content-length")
                                            .then(|| value.trim().parse::<usize>().ok())
                                            .flatten()
                                    })
                                    .unwrap_or(0);
                                if raw.len() >= end + 4 + length {
                                    break;
                                }
                            }
                        }
                    }
                }
                let request = String::from_utf8_lossy(&raw).into_owned();
                let start = request.lines().next().unwrap_or("").contains(" /start");
                let hits = {
                    let mut recorded = recorded.lock().unwrap();
                    recorded.push(request);
                    recorded.len()
                };
                let response = match &redirect {
                    _ if hits == 1 && first_status.is_some() => format!(
                        "HTTP/1.1 {} Busy\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbusy",
                        first_status.unwrap()
                    ),
                    Some(location) if start => format!(
                        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    ),
                    _ => format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                        reply.len()
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

    fn hits(&self) -> Vec<String> {
        self.hits.lock().unwrap().clone()
    }
}

fn declaration(source: &str, grants: Vec<String>) -> EffectDecl {
    EffectDecl {
        name: "delivery.notify".to_owned(),
        grants,
        source: source.to_owned(),
        then: None,
    }
}

fn bound_job(id: &str, payload: Value, bindings: &[(String, String)]) -> EffectJob {
    EffectJob {
        id: id.to_owned(),
        effect: "delivery.notify".to_owned(),
        payload,
        attempt: 1,
        generation: Some("generation-1".to_owned()),
        bindings: Some(bindings.iter().cloned().collect::<BTreeMap<_, _>>()),
    }
}

const FETCH_TEXT: &str = "async (payload, { fetch, meta }) => (await fetch(payload.url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': meta.id }, body: JSON.stringify(payload) })).text()";
const FETCH_CATCH: &str = "async (payload, { fetch }) => { try { const r = await fetch(payload.url); return { status: r.status, redirected: r.redirected, text: await r.text() }; } catch (error) { return { code: error.code || 'missing', origin: error.origin || 'missing', message: error.message || String(error) }; } }";

#[test]
fn bound_refusals_leave_header_handles_at_baseline_and_the_runtime_idle() {
    const ROUNDS: usize = 128;
    let logical = "http://granted.example";
    let decl = declaration(
        r#"async (payload, { fetch }) => {
          if (!payload.exercise) return { baseline: true };
          const counts = { denied: 0, unbound: 0, invalid: 0 };
          for (let i = 0; i < payload.rounds; i++) {
            try { await fetch('http://denied.example/path'); }
            catch (error) { if (error.code === 'E_EFFECT_GRANT') counts.denied++; }
            try { await fetch('http://granted.example/path'); }
            catch (error) { if (error.code === 'E_EFFECT_UNBOUND') counts.unbound++; }
            try { await fetch('http://['); }
            catch (error) { if (error instanceof TypeError) counts.invalid++; }
          }
          return counts;
        }"#,
        vec![logical.to_owned()],
    );
    let mut host = Ibex2Host::new().unwrap();
    let baseline = host.run(
        &decl,
        &bound_job("refusal-baseline", json!({ "exercise": false }), &[]),
        Duration::from_secs(5),
    );
    assert_eq!(
        baseline,
        Outcome::Sent {
            result: json!({ "baseline": true }),
            leftover: false,
        }
    );
    let header_baseline = host
        .runtimes
        .values()
        .next()
        .unwrap()
        .runtime
        .live_header_handles_for_test();

    let outcome = host.run(
        &decl,
        &bound_job(
            "refusal-loop",
            json!({ "exercise": true, "rounds": ROUNDS }),
            &[],
        ),
        Duration::from_secs(10),
    );
    assert_eq!(
        outcome,
        Outcome::Sent {
            result: json!({ "denied": ROUNDS, "unbound": ROUNDS, "invalid": ROUNDS }),
            leftover: false,
        }
    );
    let runtime = host.runtimes.values().next().unwrap();
    assert_eq!(
        runtime.runtime.live_header_handles_for_test(),
        header_baseline,
        "bound refusals must not allocate an unadoptable Headers snapshot"
    );
}

#[test]
fn bound_transport_substitutes_the_loopback_after_admitting_the_logical_origin() {
    let logical = Listener::start("the logical origin must never be reached", None);
    let provider = Listener::start("provider answered", None);
    let decl = declaration(FETCH_TEXT, vec![logical.origin()]);
    let mut host = Ibex2Host::new().unwrap();
    let outcome = host.run(
        &decl,
        &bound_job(
            "bound-1",
            json!({ "url": format!("{}/send?x=1", logical.origin()), "to": "bob" }),
            &[(logical.origin(), provider.origin())],
        ),
        Duration::from_secs(5),
    );
    assert_eq!(
        outcome,
        Outcome::Sent {
            result: json!("provider answered"),
            leftover: false
        }
    );
    let hits = provider.hits();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert!(
        hits[0].starts_with("POST /send?x=1 HTTP/1.1\r\n"),
        "{}",
        hits[0]
    );
    assert!(
        hits[0]
            .to_ascii_lowercase()
            .contains("idempotency-key: bound-1"),
        "{}",
        hits[0]
    );
    assert!(hits[0].ends_with(r#"{"url":"http://127.0.0.1:"#) || hits[0].contains(r#""to":"bob""#));
    assert!(
        logical.hits().is_empty(),
        "a socket left the loopback binding: {:?}",
        logical.hits()
    );
}

#[test]
fn unbound_granted_origin_is_terminal_and_reaches_no_transport() {
    let logical = Listener::start("must not arrive", None);
    let decl = declaration(FETCH_TEXT, vec![logical.origin()]);
    let mut host = Ibex2Host::new().unwrap();
    let outcome = host.run(
        &decl,
        &bound_job(
            "unbound-1",
            json!({ "url": format!("{}/send", logical.origin()) }),
            &[],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Failed { error, retry } = outcome else {
        panic!("expected E_EFFECT_UNBOUND, got {outcome:?}")
    };
    assert!(!retry, "an unbound origin is terminal: {error}");
    assert!(error.contains("E_EFFECT_UNBOUND"), "{error}");
    assert!(error.contains(&logical.origin()), "{error}");
    assert!(
        error.contains(&format!(
            "declare effects.provider('{}', handler) in the journey that emits delivery.notify",
            logical.origin()
        )),
        "{error}"
    );
    assert!(logical.hits().is_empty(), "{:?}", logical.hits());

    // The refusal is a tagged error the effect can observe, like a grant denial.
    let caught = declaration(FETCH_CATCH, vec![logical.origin()]);
    let outcome = host.run(
        &caught,
        &bound_job(
            "unbound-2",
            json!({ "url": format!("{}/send", logical.origin()) }),
            &[],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Sent { result, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(result["code"], "E_EFFECT_UNBOUND", "{result}");
    assert_eq!(result["origin"], logical.origin(), "{result}");
    assert!(logical.hits().is_empty());
}

#[test]
fn the_grant_is_checked_on_the_logical_origin_before_any_binding() {
    let granted = Listener::start("granted", None);
    let ungranted = Listener::start("ungranted but bound", None);
    let provider = Listener::start("provider", None);
    let decl = declaration(FETCH_CATCH, vec![granted.origin()]);
    let mut host = Ibex2Host::new().unwrap();
    let outcome = host.run(
        &decl,
        &bound_job(
            "grant-first",
            json!({ "url": format!("{}/secret", ungranted.origin()) }),
            &[
                (granted.origin(), provider.origin()),
                (ungranted.origin(), provider.origin()),
            ],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Sent { result, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(
        result,
        json!({
            "code": "E_EFFECT_GRANT",
            "origin": ungranted.origin(),
            "message": format!("denied: net.fetch {}; declare {}", ungranted.origin(), ungranted.origin()),
        })
    );
    assert!(provider.hits().is_empty());
    assert!(ungranted.hits().is_empty());
    assert!(granted.hits().is_empty());
}

#[test]
fn redirect_hops_are_admitted_on_the_logical_origin_and_rerouted() {
    let logical = Listener::start("must not arrive", None);
    let other = Listener::start("must not arrive either", None);
    // The provider redirects /start to the LOGICAL origin's /next: the hop is
    // admitted on that origin and rerouted to the same provider.
    let provider = Listener::start("second hop", Some(format!("{}/next", logical.origin())));
    let decl = declaration(FETCH_CATCH, vec![logical.origin()]);
    let mut host = Ibex2Host::new().unwrap();
    let outcome = host.run(
        &decl,
        &bound_job(
            "redirect-bound",
            json!({ "url": format!("{}/start", logical.origin()) }),
            &[(logical.origin(), provider.origin())],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Sent { result, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(
        result,
        json!({ "status": 200, "redirected": true, "text": "second hop" }),
    );
    let hits = provider.hits();
    assert_eq!(hits.len(), 2, "{hits:?}");
    assert!(hits[0].starts_with("GET /start HTTP/1.1"), "{}", hits[0]);
    assert!(hits[1].starts_with("GET /next HTTP/1.1"), "{}", hits[1]);
    assert!(logical.hits().is_empty());

    // A redirect to an ungranted origin is refused as the grant, before any
    // binding lookup and before any transport, exactly as in production.
    let leaking = Listener::start("", Some(format!("{}/secret", other.origin())));
    let outcome = host.run(
        &decl,
        &bound_job(
            "redirect-ungranted",
            json!({ "url": format!("{}/start", logical.origin()) }),
            &[
                (logical.origin(), leaking.origin()),
                (other.origin(), provider.origin()),
            ],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Sent { result, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(result["code"], "E_EFFECT_GRANT", "{result}");
    assert_eq!(result["origin"], other.origin(), "{result}");
    assert_eq!(leaking.hits().len(), 1);
    assert!(other.hits().is_empty());
    assert_eq!(
        provider.hits().len(),
        2,
        "the bound provider saw no third hop"
    );
}

#[test]
fn a_job_with_other_bindings_gets_its_own_runtime_and_equal_bindings_reuse_it() {
    let logical = Listener::start("must not arrive", None);
    let first = Listener::start("first provider", None);
    let second = Listener::start("second provider", None);
    let decl = declaration(FETCH_TEXT, vec![logical.origin()]);
    let url = json!({ "url": format!("{}/send", logical.origin()) });
    let mut host = Ibex2Host::new().unwrap();
    let to_first = [(logical.origin(), first.origin())];
    let to_second = [(logical.origin(), second.origin())];
    let run = |host: &mut Ibex2Host, id: &str, bindings: &[(String, String)]| {
        host.run(
            &decl,
            &bound_job(id, url.clone(), bindings),
            Duration::from_secs(5),
        )
    };
    assert_eq!(
        run(&mut host, "epoch-1", &to_first),
        Outcome::Sent {
            result: json!("first provider"),
            leftover: false
        }
    );
    assert_eq!(host.cached_runtime_count(), 1);
    assert_eq!(
        run(&mut host, "epoch-2", &to_second),
        Outcome::Sent {
            result: json!("second provider"),
            leftover: false
        }
    );
    assert_eq!(
        host.cached_runtime_count(),
        1,
        "the earlier epoch's runtime is gone"
    );
    assert_eq!(
        run(&mut host, "epoch-2-again", &to_second),
        Outcome::Sent {
            result: json!("second provider"),
            leftover: false
        }
    );
    assert_eq!(host.cached_runtime_count(), 1);
    assert_eq!(first.hits().len(), 1);
    assert_eq!(second.hits().len(), 2);
    assert!(logical.hits().is_empty());
    // Production transport for the same declaration: the logical origin is
    // reached directly, and its runtime is its own.
    let production = host.run(
        &decl,
        &EffectJob {
            bindings: None,
            ..bound_job("production", url.clone(), &to_second)
        },
        Duration::from_secs(5),
    );
    assert_eq!(
        production,
        Outcome::Sent {
            result: json!("must not arrive"),
            leftover: false
        }
    );
    assert_eq!(logical.hits().len(), 1);
    assert_eq!(second.hits().len(), 2);
    assert!(
        host.take_provider().is_none(),
        "production jobs record no provider evidence"
    );
}

/// A provider error on one attempt leaves the runtime usable for the next:
/// the row is retried under `meta.id` on the same compartment.
#[test]
fn a_retry_after_a_provider_error_completes_on_the_reused_runtime() {
    let logical = Listener::start("must not arrive", None);
    let provider = Listener::start_with("provider answered", None, Some(503));
    let decl = declaration(
        "async (payload, { fetch, meta }) => { const response = await fetch(payload.url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': meta.id }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(`provider ${response.status}`); return { providerId: await response.text() }; }",
        vec![logical.origin()],
    );
    let url = json!({ "url": format!("{}/send", logical.origin()) });
    let bindings = [(logical.origin(), provider.origin())];
    let mut host = Ibex2Host::new().unwrap();
    let first = host.run(
        &decl,
        &bound_job("retry-1", url.clone(), &bindings),
        Duration::from_secs(5),
    );
    let Outcome::Failed { error, retry } = first else {
        panic!("{first:?}")
    };
    assert!(retry && error.contains("provider 503"), "{error}");
    assert_eq!(host.take_provider().unwrap()["requests"], 1);
    assert_eq!(
        host.cached_runtime_count(),
        1,
        "a provider error keeps the runtime"
    );
    let started = std::time::Instant::now();
    let second = host.run(
        &decl,
        &EffectJob {
            attempt: 2,
            ..bound_job("retry-1", url, &bindings)
        },
        Duration::from_secs(5),
    );
    assert_eq!(
        second,
        Outcome::Sent {
            result: json!({ "providerId": "provider answered" }),
            leftover: false
        },
        "after {:?}",
        started.elapsed()
    );
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(
        host.take_provider().unwrap()["requests"],
        1,
        "attempt two has its own count"
    );
    assert_eq!(provider.hits().len(), 2);
    assert!(logical.hits().is_empty());
}

#[test]
fn response_url_stays_logical_after_redirect_and_relative_followup() {
    let logical = Listener::start("must not arrive", None);
    let provider = Listener::start("ok", Some("/next".into()));
    let decl = declaration(
        r#"async (payload, { fetch }) => {
        const response = await fetch(payload.url);
        await response.text();
        const next = await fetch(new URL("/last", response.url));
        await next.text();
        const input = new URL(payload.url);
        const pending = fetch(input, { redirect: "manual" });
        input.pathname = "/changed-after-request";
        const manual = await pending;
        await manual.text();
        return { url: response.url, next: next.url, redirected: response.redirected, manual: manual.url };
    }"#,
        vec![logical.origin()],
    );
    let mut host = Ibex2Host::new().unwrap();
    let result = host.run(
        &decl,
        &bound_job(
            "logical-response",
            json!({"url":format!("{}/start",logical.origin())}),
            &[(logical.origin(), provider.origin())],
        ),
        Duration::from_secs(5),
    );
    let Outcome::Sent { result, .. } = result else {
        panic!("{result:?}")
    };
    assert_eq!(
        result,
        json!({"url":format!("{}/next",logical.origin()), "next":format!("{}/last",logical.origin()), "redirected":true, "manual":format!("{}/start",logical.origin())})
    );
    assert_eq!(host.take_provider().unwrap()["requests"], 4);
    assert_eq!(provider.hits().len(), 4);
    assert!(logical.hits().is_empty());
}

#[test]
fn production_response_url_is_the_engine_url_without_rewriting() {
    let server = Listener::start("ok", Some("/next?engine=1".into()));
    let decl = declaration(
        "async (payload, { fetch }) => ({ url: (await fetch(payload.url)).url })",
        vec![server.origin()],
    );
    let mut host = Ibex2Host::new().unwrap();
    for (path, final_path) in [
        ("/send?engine=1", "/send?engine=1"),
        ("/start", "/next?engine=1"),
    ] {
        let outcome = host.run(
            &decl,
            &EffectJob {
                bindings: None,
                ..bound_job(
                    "production-url",
                    json!({"url":format!("{}{path}", server.origin())}),
                    &[],
                )
            },
            Duration::from_secs(5),
        );
        let Outcome::Sent { result, .. } = outcome else {
            panic!("{outcome:?}")
        };
        assert_eq!(
            result,
            json!({"url":format!("{}{final_path}", server.origin())})
        );
        assert!(
            host.take_provider().is_none(),
            "production records no substituted transport"
        );
    }
    let hits = server.hits();
    assert_eq!(hits.len(), 3, "{hits:?}");
    assert!(
        hits[0].starts_with("GET /send?engine=1 HTTP/1.1"),
        "{hits:?}"
    );
    assert!(hits[1].starts_with("GET /start HTTP/1.1"), "{hits:?}");
    assert!(
        hits[2].starts_with("GET /next?engine=1 HTTP/1.1"),
        "{hits:?}"
    );
}
