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
        Self::start_with("", Some((302, location)))
    }

    // Redirect only /start; every other path serves reply, including the next hop.
    fn start_with(reply: &'static str, redirect_to: Option<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
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
                        Ok(0) => break,
                        Ok(read) => {
                            raw.extend_from_slice(&buffer[..read]);
                            if let Some(end) =
                                raw.windows(4).position(|window| window == b"\r\n\r\n")
                            {
                                let headers = String::from_utf8_lossy(&raw[..end]);
                                let length = request_header(&headers, "content-length")
                                    .map(|value| value.parse::<usize>().unwrap())
                                    .unwrap_or(0);
                                if raw.len() >= end + 4 + length {
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                let request = String::from_utf8_lossy(&raw).into_owned();
                let start = request.lines().next().unwrap_or("").contains(" /start ");
                recorded.lock().unwrap().push(request);
                let response = match &redirect_to {
                    Some((status, location)) if start => format!(
                        "HTTP/1.1 {status} Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    ),
                    _ => format!(
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

fn request_header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    request
        .split("\r\n\r\n")
        .next()
        .unwrap()
        .lines()
        .skip(1)
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case(name).then(|| value.trim())
        })
}

fn assert_bodyless_wire_content_length(request: &str) {
    // ureq emits Content-Length: 0 for an empty request on Linux and omits it
    // on Darwin. Either proves the authored body length was removed.
    assert!(
        matches!(request_header(request, "content-length"), None | Some("0")),
        "{request}"
    );
}

fn assert_content_type(request: &str, expected: Option<&str>) {
    let block = request.split_once("\r\n\r\n").unwrap().0;
    assert!(
        !block
            .to_ascii_lowercase()
            .contains("application/x-www-form-urlencoded"),
        "unexpected transport default: {request}"
    );
    let values: Vec<_> = block
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim())
        })
        .collect();
    assert_eq!(
        values,
        expected.into_iter().collect::<Vec<_>>(),
        "{request}"
    );
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
        bindings: None,
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
fn unread_fetch_response_rows_are_cancelled_at_job_settlement() {
    const FETCHES: usize = 16;
    let server = TestServer::start("body stays unread");
    let decl = declaration(
        r#"async (payload, { fetch }) => {
          for (let i = 0; i < payload.fetches; i++) await fetch(payload.url);
          if (payload.fail) throw new Error('failed after unread responses');
          return null;
        }"#,
        vec![server.origin()],
    );
    let mut host = Ibex2Host::new().unwrap();
    let work = job(
        "unread-responses",
        json!({ "url": server.origin() + "/unread", "fetches": FETCHES, "fail": false }),
    );
    assert_eq!(
        host.run(&decl, &work, Duration::from_secs(10)),
        sent(Value::Null)
    );
    let snapshot = read_job_snapshot(host.runtimes.values_mut().next().unwrap(), &work.id).unwrap();
    assert_eq!(
        snapshot.live_responses, 0,
        "resolved jobs must cancel every unread primitive response row"
    );

    let failed = job(
        "unread-responses-failed",
        json!({ "url": server.origin() + "/unread", "fetches": FETCHES, "fail": true }),
    );
    let outcome = host.run(&decl, &failed, Duration::from_secs(10));
    let Outcome::Failed { error, retry } = outcome else {
        panic!("expected authored failure, got {outcome:?}")
    };
    assert!(
        retry && error.contains("failed after unread responses"),
        "{error}"
    );
    let snapshot =
        read_job_snapshot(host.runtimes.values_mut().next().unwrap(), &failed.id).unwrap();
    assert_eq!(
        snapshot.live_responses, 0,
        "rejected jobs must cancel every unread primitive response row"
    );
    assert_eq!(server.hits.lock().unwrap().len(), FETCHES * 2);
}

#[test]
fn fetch_delivers_authored_headers_in_every_headers_init_form() {
    let server = TestServer::start("ok");
    for form in ["record", "pairs", "headers", "iterable"] {
        let decl = declaration(
            r#"async (payload, { fetch, meta }) => {
              const pairs = [['Content-Type', 'application/json'], ['Idempotency-Key', meta.id],
                ['Authorization', 'Bearer token'], ['X-Joined', ' one '], ['x-joined', 'two']];
              let headers;
              if (payload.form === 'record') headers = Object.fromEntries(pairs);
              else if (payload.form === 'headers') headers = new Headers(pairs);
              else if (payload.form === 'iterable') headers = { *[Symbol.iterator]() { yield* pairs; } };
              else headers = pairs;
              const pending = fetch(payload.url, { method: 'POST', headers, body: '{"hello":"world"}' });
              if (payload.form === 'record') headers['Authorization'] = 'changed';
              else if (payload.form === 'headers') headers.set('authorization', 'changed');
              else pairs[2][1] = 'changed';
              const body = await (await pending).text();
              return { body, caller: payload.form === 'headers' ? headers.get('authorization') : 'changed' };
            }"#,
            vec![server.origin()],
        );
        assert_eq!(
            Ibex2Host::new().unwrap().run(
                &decl,
                &job(
                    "headers-1",
                    json!({ "url": server.origin() + "/push", "form": form })
                ),
                Duration::from_secs(3),
            ),
            sent(json!({ "body": "ok", "caller": "changed" })),
        );
        let request = server.hits.lock().unwrap().last().unwrap().clone();
        println!("{form} request:\n{request}");
        assert!(request.starts_with("POST /push HTTP/1.1\r\n"));
        assert_content_type(&request, Some("application/json"));
        for (name, value) in [
            ("idempotency-key", "headers-1"),
            ("authorization", "Bearer token"),
            ("x-joined", "one, two"),
        ] {
            assert_eq!(
                request_header(&request, name),
                Some(value),
                "{form}: {request}"
            );
        }
        assert_eq!(
            request.split_once("\r\n\r\n").unwrap().1,
            r#"{"hello":"world"}"#
        );
    }
    assert_eq!(server.hits.lock().unwrap().len(), 4);
}

#[test]
fn fetch_string_body_defaults_to_text_plain_without_overriding_authored_type() {
    let server = TestServer::start("ok");
    for redirect in ["follow", "manual", "error"] {
        for authored in [false, true] {
            let decl = declaration(
                "async (p, { fetch }) => (await fetch(p.url, { method: 'POST', body: p.authored ? '{\"body\":true}' : 'hello', headers: p.authored ? { 'Content-Type': 'application/json' } : undefined, redirect: p.redirect })).text()",
                vec![server.origin()],
            );
            let payload = json!({ "url": server.origin() + "/body", "redirect": redirect, "authored": authored });
            assert_eq!(
                Ibex2Host::new().unwrap().run(
                    &decl,
                    &job("plain", payload),
                    Duration::from_secs(3)
                ),
                sent(json!("ok"))
            );
            let request = server.hits.lock().unwrap().last().unwrap().clone();
            println!("{redirect} authored={authored} request:\n{request}");
            assert_content_type(
                &request,
                Some(if authored {
                    "application/json"
                } else {
                    "text/plain;charset=UTF-8"
                }),
            );
            assert_eq!(
                request.split_once("\r\n\r\n").unwrap().1,
                if authored {
                    r#"{"body":true}"#
                } else {
                    "hello"
                }
            );
        }
    }
    assert_eq!(server.hits.lock().unwrap().len(), 6);
}

#[test]
fn fetch_redirect_preserves_or_drops_the_default_string_content_type() {
    for status in [307, 303] {
        let server = TestServer::start_with("ok", Some((status, "/end".to_owned())));
        let decl = declaration(
            "async (p, { fetch }) => (await fetch(p.url, { method: 'POST', body: 'hello' })).text()",
            vec![server.origin()],
        );
        assert_eq!(
            Ibex2Host::new().unwrap().run(
                &decl,
                &job(
                    "plain-redirect",
                    json!({ "url": server.origin() + "/start" })
                ),
                Duration::from_secs(3)
            ),
            sent(json!("ok"))
        );
        let hits = server.hits.lock().unwrap();
        assert_eq!(hits.len(), 2);
        for (hop, request) in hits.iter().enumerate() {
            println!("{status} default hop {hop}:\n{request}");
            let dropped = status == 303 && hop == 1;
            let method = if dropped { "GET" } else { "POST" };
            let path = if hop == 0 { "/start" } else { "/end" };
            assert!(
                request.starts_with(&format!("{method} {path} HTTP/1.1\r\n")),
                "{request}"
            );
            assert_content_type(
                request,
                if dropped {
                    None
                } else {
                    Some("text/plain;charset=UTF-8")
                },
            );
            if dropped {
                assert_bodyless_wire_content_length(request);
            } else {
                assert_eq!(request_header(request, "content-length"), Some("5"));
            }
            assert_eq!(
                request.split_once("\r\n\r\n").unwrap().1,
                if dropped { "" } else { "hello" }
            );
        }
    }
}

#[test]
fn fetch_redirect_matrix_preserves_or_drops_method_body_and_headers() {
    for status in [301, 302, 303, 307, 308] {
        for method in ["POST", "PUT", "GET", "HEAD"] {
            let server = TestServer::start_with("", Some((status, "/end".to_owned())));
            let decl = declaration(
                r#"async (p, { fetch }) => {
                  const headers = { 'Content-Type': 'application/json', 'Content-Length': '999',
                    'Content-Encoding': 'identity', 'Content-Language': 'en', 'Content-Location': '/body',
                    'Authorization': 'Bearer token', 'Proxy-Authorization': 'Basic proxy', 'Cookie': 'session=secret',
                    'Idempotency-Key': 'redirect-key' };
                  const response = await fetch(p.url, { method: p.method, headers,
                    body: p.method === 'GET' || p.method === 'HEAD' ? undefined : '{"body":true}' });
                  await response.text();
                  return { status: response.status, redirected: response.redirected };
                }"#,
                vec![server.origin()],
            );
            assert_eq!(
                Ibex2Host::new().unwrap().run(
                    &decl,
                    &job(
                        "redirect",
                        json!({ "url": server.origin() + "/start", "method": method })
                    ),
                    Duration::from_secs(3)
                ),
                sent(json!({ "status": 200, "redirected": true }))
            );
            let hits = server.hits.lock().unwrap();
            assert_eq!(hits.len(), 2);
            let request = &hits[1];
            println!("{status} {method} redirected request:\n{request}");
            let drop_body = (status == 303 && method != "GET" && method != "HEAD")
                || ((status == 301 || status == 302) && method == "POST");
            let expected_method = if drop_body { "GET" } else { method };
            assert!(
                request.starts_with(&format!("{expected_method} /end HTTP/1.1\r\n")),
                "{request}"
            );
            assert_content_type(
                request,
                if drop_body {
                    None
                } else {
                    Some("application/json")
                },
            );
            for (name, value) in [
                ("content-encoding", "identity"),
                ("content-language", "en"),
                ("content-location", "/body"),
            ] {
                assert_eq!(
                    request_header(request, name),
                    if drop_body { None } else { Some(value) },
                    "{request}"
                );
            }
            let authored_body = method != "GET" && method != "HEAD";
            if authored_body {
                assert_eq!(
                    request_header(&hits[0], "content-length"),
                    Some("13"),
                    "{}",
                    hits[0]
                );
            } else {
                assert_bodyless_wire_content_length(&hits[0]);
            }
            if authored_body && !drop_body {
                assert_eq!(request_header(request, "content-length"), Some("13"));
            } else {
                assert_bodyless_wire_content_length(request);
            }
            for (name, value) in [
                ("authorization", "Bearer token"),
                ("proxy-authorization", "Basic proxy"),
                ("cookie", "session=secret"),
                ("idempotency-key", "redirect-key"),
            ] {
                assert_eq!(request_header(request, name), Some(value), "{request}");
            }
            let expected_body = if drop_body || method == "GET" || method == "HEAD" {
                ""
            } else {
                r#"{"body":true}"#
            };
            assert_eq!(request.split_once("\r\n\r\n").unwrap().1, expected_body);
        }
    }
}

#[test]
fn fetch_cross_origin_redirect_strips_credentials_and_checks_each_grant() {
    for status in [301, 302, 303, 307, 308] {
        for granted in [false, true] {
            let destination = TestServer::start("ok");
            let redirector =
                TestServer::start_with("", Some((status, destination.origin() + "/end")));
            let mut grants = vec![redirector.origin()];
            if granted {
                grants.push(destination.origin());
            }
            let decl = declaration(
                r#"async (p, { fetch }) => {
              const headers = new Headers({ Authorization: 'Bearer token', 'Proxy-Authorization': 'Basic proxy',
                Cookie: 'session=secret', 'Content-Type': 'application/json', 'Idempotency-Key': 'cross-key',
                'Content-Length': '999', 'Content-Encoding': 'identity', 'Content-Language': 'en', 'Content-Location': '/body' });
              const pending = fetch(p.url, { method: 'POST', headers, body: '{"cross":true}' });
              headers.set('authorization', 'changed');
              try { return { body: await (await pending).text(), caller: headers.get('authorization') }; }
              catch (error) { return { code: error.code, origin: error.origin, caller: headers.get('authorization') }; }
            }"#,
                grants,
            );
            let expected = if granted {
                json!({ "body": "ok", "caller": "changed" })
            } else {
                json!({ "code": "E_EFFECT_GRANT", "origin": destination.origin(), "caller": "changed" })
            };
            assert_eq!(
                Ibex2Host::new().unwrap().run(
                    &decl,
                    &job("cross", json!({ "url": redirector.origin() + "/start" })),
                    Duration::from_secs(3)
                ),
                sent(expected)
            );
            let initial_hits = redirector.hits.lock().unwrap();
            assert_eq!(initial_hits.len(), 1);
            let initial = &initial_hits[0];
            assert!(initial.starts_with("POST /start HTTP/1.1\r\n"), "{initial}");
            assert_content_type(initial, Some("application/json"));
            assert_eq!(
                initial.split_once("\r\n\r\n").unwrap().1,
                r#"{"cross":true}"#
            );
            assert_content_type(initial, Some("application/json"));
            for (name, value) in [
                ("authorization", "Bearer token"),
                ("proxy-authorization", "Basic proxy"),
                ("cookie", "session=secret"),
                ("content-length", "14"),
                ("content-encoding", "identity"),
                ("content-language", "en"),
                ("content-location", "/body"),
                ("idempotency-key", "cross-key"),
            ] {
                assert_eq!(request_header(initial, name), Some(value), "{initial}");
            }
            let hits = destination.hits.lock().unwrap();
            assert_eq!(hits.len(), usize::from(granted));
            if granted {
                let request = &hits[0];
                println!(
                    "{status} cross-origin first request:\n{initial}\ncross-origin redirected request:\n{request}"
                );
                let dropped = status != 307 && status != 308;
                let method = if dropped { "GET" } else { "POST" };
                assert!(
                    request.starts_with(&format!("{method} /end HTTP/1.1\r\n")),
                    "{request}"
                );
                for name in ["authorization", "proxy-authorization", "cookie"] {
                    assert_eq!(request_header(request, name), None, "{request}");
                }
                assert_content_type(
                    request,
                    if dropped {
                        None
                    } else {
                        Some("application/json")
                    },
                );
                for (name, value) in [
                    ("content-encoding", "identity"),
                    ("content-language", "en"),
                    ("content-location", "/body"),
                ] {
                    assert_eq!(
                        request_header(request, name),
                        if dropped { None } else { Some(value) },
                        "{request}"
                    );
                }
                if dropped {
                    assert_bodyless_wire_content_length(request);
                } else {
                    assert_eq!(request_header(request, "content-length"), Some("14"));
                }
                assert_eq!(
                    request_header(request, "idempotency-key"),
                    Some("cross-key")
                );
                assert_eq!(
                    request.split_once("\r\n\r\n").unwrap().1,
                    if dropped { "" } else { r#"{"cross":true}"# }
                );
            }
        }
    }
}

#[test]
fn fetch_keeps_headers_constructible_after_many_host_requests() {
    let server = TestServer::start("ok");
    let decl = declaration(
        r#"async (p, { fetch }) => {
          const first = new Headers({ 'X-Caller': 'before' });
          for (let i = 0; i < 64; i++) {
            const response = await fetch(p.url, { headers: first });
            if (await response.text() !== 'ok') throw new Error('wrong response');
          }
          const second = new Headers({ 'X-Caller': 'after' });
          first.set('X-Caller', 'still alive');
          return { first: first.get('x-caller'), second: second.get('x-caller') };
        }"#,
        vec![server.origin()],
    );
    assert_eq!(
        Ibex2Host::new().unwrap().run(
            &decl,
            &job("many-fetches", json!({ "url": server.origin() + "/body" })),
            Duration::from_secs(5)
        ),
        sent(json!({ "first": "still alive", "second": "after" }))
    );
    let hits = server.hits.lock().unwrap();
    assert_eq!(hits.len(), 64);
    for request in hits.iter() {
        assert_eq!(
            request_header(request, "x-caller"),
            Some("before"),
            "{request}"
        );
    }
}

#[test]
fn fetch_invalid_headers_refuse_before_a_request() {
    let server = TestServer::start("must not arrive");
    let mut host = Ibex2Host::new().unwrap();
    for (name, value) in [
        ("x-test", "bad\r\ninjection"),
        ("x-test", "bad\0value"),
        ("x-test", "\u{100}"),
        ("bad name", "value"),
    ] {
        let decl = declaration(
            "async (p, { fetch }) => { try { await fetch(p.url, { headers: [[p.name, p.value]] }); return 'sent'; } catch (e) { return { message: e.message, typeError: e instanceof TypeError }; } }",
            vec![server.origin()],
        );
        let outcome = host.run(
            &decl,
            &job(
                "invalid",
                json!({ "url": server.origin(), "name": name, "value": value }),
            ),
            Duration::from_secs(3),
        );
        assert!(
            matches!(outcome, Outcome::Sent { ref result, .. } if result["typeError"] == true && result["message"].as_str().unwrap().contains("Invalid header")),
            "{outcome:?}"
        );
    }
    assert!(server.hits.lock().unwrap().is_empty());
}

#[test]
fn fetch_invalid_redirect_mode_cannot_enter_the_raw_follower() {
    let server = TestServer::start("must not arrive");
    let decl = declaration(
        "async (p, { fetch }) => { try { await fetch(p.url, { redirect: 'invalid' }); return 'sent'; } catch (e) { return { typeError: e instanceof TypeError, message: e.message }; } }",
        vec![server.origin()],
    );
    let outcome = Ibex2Host::new().unwrap().run(
        &decl,
        &job("invalid-redirect", json!({ "url": server.origin() })),
        Duration::from_secs(3),
    );
    assert_eq!(
        outcome,
        sent(json!({ "typeError": true, "message": "Invalid redirect mode" }))
    );
    assert!(server.hits.lock().unwrap().is_empty());
}

#[test]
fn fetch_releases_only_its_own_header_snapshots_on_every_exit() {
    let context = Context::new(GrantSet::none());
    let mut runtime = Hermes::new(DynamicCode::Closed).unwrap();
    runtime
        .install_with(Groups::PURE, &context, InstallOptions::default())
        .unwrap();
    // Observe header ownership at the same primitive-object seam used by the
    // host. The raw stub isolates settlement from the transport itself.
    runtime
        .eval(
            r#"
      globalThis.released = [];
      let tokens = 0;
      globalThis.__ibex2_fetch_control = function (action) { return action === 0 ? ++tokens : undefined; };
      globalThis.__ibex2_response_read = function () { return Promise.resolve(null); };
      globalThis.__ibex2_response_field = function (handle, field) {
        if (field === 0) return handle === 307 ? 307 : 200;
        if (field === 1) return handle !== 307;
        if (field === 2) return 'http://127.0.0.1/start';
        if (field === 7) return handle === 307 ? '[["location","/end"]]' : '[]';
        return false;
      };
      globalThis.__snapback_ibex2_fetch_primitives = Object.freeze({
        fetch: function () { throw new Error('raw fetch is supplied by the test'); },
        responseField: globalThis.__ibex2_response_field,
        responseRead: globalThis.__ibex2_response_read,
        fetchControl: globalThis.__ibex2_fetch_control,
        textEncode: function (text) { return new TextEncoder().encode(text).buffer; },
        textDecode: function (bytes) { return new TextDecoder().decode(bytes); },
        textEncodeInto: function () { throw new Error('unused'); },
        headersFree: function (handle) { released.push(handle); },
      });
    "#,
        )
        .unwrap();
    runtime
        .eval(&format!("globalThis.factory = {FETCH_FACTORY};"))
        .unwrap();
    runtime.eval(r#"
      globalThis.result = 'pending';
      (async function () {
        const caller = new Headers({ authorization: 'Bearer caller' });
        let calls = 0;
        for (const mode of ['success', 'rejection', 'throw', 'redirect']) {
          let hop = 0;
          const fetch = factory(function (url, method, body, redirect, handle) {
            calls++;
            hop++;
            if (handle === caller._handle) throw new Error('borrowed the caller handle');
            if (mode === 'throw') throw new Error('synchronous');
            if (mode === 'rejection') return Promise.reject(new Error('asynchronous'));
            return Promise.resolve(mode === 'redirect' && hop === 1 ? 307 : 200);
          }, function (error) { return error; });
          let error;
          try { await fetch('http://127.0.0.1/start', { headers: caller }); }
          catch (e) { error = e.message; }
          const expected = mode === 'throw' ? 'synchronous' : mode === 'rejection' ? 'asynchronous' : undefined;
          if (error !== expected) throw new Error('wrong settlement: ' + error);
          if (released.length !== calls || new Set(released).size !== calls) throw new Error('leaked or double-freed snapshot');
          if (released.includes(caller._handle) || caller.get('authorization') !== 'Bearer caller') throw new Error('freed caller');
          caller.set('authorization', 'Bearer caller');
        }
        return { calls, releases: released.length, caller: caller.get('authorization') };
      })().then(function (value) { result = JSON.stringify(value); }, function (error) { result = String(error); });
    "#).unwrap();
    runtime.pump().unwrap();
    let result = runtime.eval("result").unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&result).unwrap(),
        json!({ "calls": 5, "releases": 5, "caller": "Bearer caller" })
    );
}

#[test]
fn empty_grants_allow_an_effect_without_network() {
    let decl = declaration(
        "async (payload, { meta }) => ({ body: payload.body, id: meta.id })",
        vec![],
    );
    let mut host = Ibex2Host::new().unwrap();
    for id in ["no-network-1", "no-network-2"] {
        assert_eq!(
            host.run(
                &decl,
                &job(id, json!({ "body": id })),
                Duration::from_secs(2),
            ),
            sent(json!({ "body": id, "id": id }))
        );
    }
}

// @ref LLP 1018.008.003#4-empty-grants-mean-no-network-authority — aliases and helpers cannot bypass host admission, before any socket.
#[test]
fn empty_grants_refuse_global_aliased_and_helper_fetch_before_transport() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let mut host = Ibex2Host::new().unwrap();
    for source in [
        "async (payload) => (await fetch(payload.url)).text()",
        "async (payload, { fetch }) => (await fetch(payload.url)).text()",
        "async (payload, tools) => { const request = tools.fetch; return (await request(payload.url)).text(); }",
        "async (payload, tools) => { async function request(url) { return (await tools.fetch(url)).text(); } return request(payload.url); }",
    ] {
        let outcome = host.run(
            &declaration(source, vec![]),
            &job(
                "empty-grant-denial",
                json!({ "url": format!("{origin}/secret") }),
            ),
            Duration::from_secs(2),
        );
        assert!(
            matches!(&outcome, Outcome::Failed { error, retry: false }
                if error.contains(&format!("denied: net.fetch {origin}"))),
            "{source}: {outcome:?}"
        );
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
            "an empty-grant fetch reached transport: {source}"
        );
    }
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
        Duration::from_secs(1),
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
            Duration::from_secs(1),
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

    for field in ["redirect", "method", "body", "headers"] {
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
        "fetchPrimitives",
        "boundTransport",
        "rawFetch",
        "headersClaimed",
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
            Duration::from_millis(100),
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
    assert_eq!(error, HostFailure::Message("E_EFFECT_RESULT".to_owned()));
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
fn effect_global_surface_is_exact_pinned_engine_profile() {
    let decl = declaration("async () => true", vec!["http://127.0.0.1:1".to_owned()]);
    let mut runtime = build_runtime(&decl, None, Instant::now() + Duration::from_secs(10))
        .expect("build effect runtime");
    let names = runtime.runtime.global_names();
    let debugger_profile = EFFECT_GLOBALS
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let release_profile = debugger_profile
        .iter()
        .filter(|name| name.as_str() != DEBUGGER_INTERNAL)
        .cloned()
        .collect::<Vec<_>>();
    assert!(
        names == release_profile || names == debugger_profile,
        "unexpected hardened engine profile: {names:?}"
    );
}

#[test]
fn global_surface_allows_only_the_pinned_debugger_profile_difference() {
    let debugger_profile = EFFECT_GLOBALS
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let release_profile = debugger_profile
        .iter()
        .filter(|name| name.as_str() != DEBUGGER_INTERNAL)
        .cloned()
        .collect::<Vec<_>>();
    assert!(verify_global_names(&debugger_profile).is_ok());
    assert!(verify_global_names(&release_profile).is_ok());

    let mut unknown = release_profile.clone();
    unknown.push("UnexpectedEngineGlobal".to_owned());
    unknown.sort();
    let BuildFailure::Invalid(unknown_error) = verify_global_names(&unknown).unwrap_err() else {
        panic!("an unknown global must be an invalid engine surface");
    };
    assert!(unknown_error.contains("unexpected: UnexpectedEngineGlobal"));

    for required in ["Intl", "fetch", "__ibex2_fire_timer"] {
        let missing = release_profile
            .iter()
            .filter(|name| name.as_str() != required)
            .cloned()
            .collect::<Vec<_>>();
        let BuildFailure::Invalid(missing_error) = verify_global_names(&missing).unwrap_err()
        else {
            panic!("a missing mandatory global must be an invalid engine surface");
        };
        assert!(missing_error.contains(&format!("missing: {required}")));
    }
}
