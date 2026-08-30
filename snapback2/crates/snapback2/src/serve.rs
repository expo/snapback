//! Small synchronous HTTP/1.1 + chunked SSE server.
// @ref LLP 1002#4-the-wire — JSON states and SSE deliveries are the public protocol.

use crate::control;
use crate::protocol::{Refusal, refusal_json};
use crate::writer::{Action, Identity, OwnerHandle, SseEvent};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub struct BoundServer {
    server: Arc<Server>,
    pub port: u16,
}

#[derive(Clone)]
pub struct Context {
    pub handle: OwnerHandle,
    pub root: std::path::PathBuf,
    pub secret: String,
    pub mode: String,
    pub url: String,
    pub stop: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct Query(BTreeMap<String, String>);

impl Query {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }

    pub fn u64(&self, name: &str) -> Option<u64> {
        self.get(name)?.parse().ok()
    }

    pub fn usize(&self, name: &str) -> Option<usize> {
        self.get(name)?.parse().ok()
    }
}

impl BoundServer {
    pub fn bind(port: u16) -> Result<Self, Refusal> {
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let server = Server::http(address).map_err(|error| {
            Refusal::owner(
                "E_OWNER_PORT_TAKEN",
                format!("cannot bind 127.0.0.1:{port}: {error}"),
                "omit --port for a free port or choose another port",
            )
        })?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|address| address.port())
            .ok_or_else(|| {
                Refusal::owner(
                    "E_OWNER_BIND",
                    "server did not bind an IP socket",
                    "use a supported loopback host",
                )
            })?;
        Ok(Self {
            server: Arc::new(server),
            port,
        })
    }

    pub fn run(self, context: Context) {
        while !context.stop.load(Ordering::SeqCst) {
            match self.server.recv_timeout(Duration::from_millis(100)) {
                Ok(Some(request)) => {
                    let connection_context = context.clone();
                    if let Err(error) = thread::Builder::new()
                        .name("snapback2-http".to_owned())
                        .spawn(move || handle(request, connection_context))
                    {
                        crate::watch::log(
                            &context.root,
                            json!({ "exited": "connection thread failed", "error": error.to_string() }),
                        );
                        context.stop.store(true, Ordering::SeqCst);
                        break;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    eprintln!("{}", json!({ "serverError": error.to_string() }));
                    crate::watch::log(
                        &context.root,
                        json!({ "exited": "server error", "error": error.to_string() }),
                    );
                    context.stop.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    }
}

fn handle(mut request: Request, context: Context) {
    let method = method_name(request.method());
    let raw_url = request.url().to_owned();
    let (path, query) = split_url(&raw_url);
    if method == "OPTIONS" {
        respond_json(request, 204, json!({}), &context.mode);
        return;
    }
    let body = match read_body(&mut request) {
        Ok(body) => body,
        Err(error) => {
            respond_refusal(request, 400, error, &context.mode);
            return;
        }
    };

    if path.starts_with("/control/") {
        if !is_loopback(request.remote_addr().map(SocketAddr::ip)) {
            respond_refusal(
                request,
                403,
                Refusal::owner(
                    "E_OWNER_CONTROL_REMOTE",
                    "control routes are loopback only",
                    "call the owner from the local machine",
                ),
                &context.mode,
            );
            return;
        }
        if header(&request, "X-Snapback-Control").as_deref() != Some(&context.secret) {
            respond_refusal(
                request,
                403,
                Refusal::owner(
                    "E_OWNER_CONTROL_SECRET",
                    "invalid owner control secret",
                    "read X-Snapback-Control from .snapback/owner.json",
                ),
                &context.mode,
            );
            return;
        }
        let control_context = control::Context {
            handle: context.handle.clone(),
            root: context.root.clone(),
        };
        match control::route(method, &path, &query, body, &control_context) {
            Some(Ok(value)) => respond_json(request, 200, value, &context.mode),
            Some(Err((status, error))) => respond_refusal(request, status, error, &context.mode),
            None => respond_refusal(request, 404, route_unknown(&path), &context.mode),
        }
        return;
    }

    let identity = request_identity(&request);
    let bearer_token = bearer(&request).unwrap_or_default();
    match (method, path.as_str()) {
        ("GET", "/") => match context.handle.call(Action::Status) {
            Ok(status) => respond_json(
                request,
                200,
                json!({
                    "ok": true,
                    "version": crate::VERSION,
                    "generation": status.get("generation"),
                    "mode": context.mode,
                    "url": context.url,
                }),
                &context.mode,
            ),
            Err(error) => respond_refusal(request, 500, error, &context.mode),
        },
        ("GET", "/api/manifest") => call_json(request, &context, Action::Manifest, 200),
        ("POST", "/api/auth/signup") => call_json(
            request,
            &context,
            Action::Signup {
                email: string_field(&body, "email"),
                password: string_field(&body, "password"),
            },
            200,
        ),
        ("POST", "/api/auth/login") => call_json(
            request,
            &context,
            Action::Login {
                email: string_field(&body, "email"),
                password: string_field(&body, "password"),
            },
            200,
        ),
        ("POST", "/api/auth/guest") => call_json(request, &context, Action::Guest, 200),
        ("POST", "/api/auth/logout") => call_json(
            request,
            &context,
            Action::Logout {
                token: bearer_token,
            },
            200,
        ),
        ("GET", "/api/auth/me") => call_json(request, &context, Action::Me { identity }, 200),
        ("POST", "/api/query") => call_json(
            request,
            &context,
            Action::Execute {
                op: string_field(&body, "op"),
                args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                identity,
                expected: Some(snapback2_core::ProgramKind::Query),
            },
            200,
        ),
        ("POST", "/api/mutation") => call_json(
            request,
            &context,
            Action::Execute {
                op: string_field(&body, "op"),
                args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                identity,
                expected: Some(snapback2_core::ProgramKind::Mutation),
            },
            200,
        ),
        ("GET", "/api/subscribe") => {
            let op = query.get("op").unwrap_or_default().to_owned();
            let args = match parse_query_json(query.get("args").unwrap_or("{}")) {
                Ok(args) => args,
                Err(error) => {
                    respond_refusal(request, 400, error, &context.mode);
                    return;
                }
            };
            let (tx, rx) = mpsc::channel();
            match context.handle.subscribe(op, args, identity, tx) {
                Ok(meta) => {
                    let id = meta.get("id").and_then(Json::as_u64).unwrap_or(0);
                    respond_sse(
                        request,
                        rx,
                        context.handle.clone(),
                        DropAction::Live(id),
                        &context.mode,
                    );
                }
                Err(error) => {
                    respond_refusal(request, refusal_status(&error), error, &context.mode)
                }
            }
        }
        ("POST", path) if channel_name(path, "/publish").is_some() => {
            let name = channel_name(path, "/publish").unwrap_or_default();
            call_json(
                request,
                &context,
                Action::ChannelPublish {
                    name,
                    args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                    payload: body.get("payload").cloned().unwrap_or(Json::Null),
                    identity,
                },
                200,
            );
        }
        ("GET", path) if channel_name(path, "/subscribe").is_some() => {
            let name = channel_name(path, "/subscribe").unwrap_or_default();
            let args = match parse_query_json(query.get("args").unwrap_or("{}")) {
                Ok(args) => args,
                Err(error) => {
                    respond_refusal(request, 400, error, &context.mode);
                    return;
                }
            };
            let (tx, rx) = mpsc::channel();
            match context.handle.call(Action::ChannelSubscribe {
                name,
                args,
                identity,
                events: tx,
            }) {
                Ok(meta) => {
                    let id = meta.get("id").and_then(Json::as_u64).unwrap_or(0);
                    respond_sse(
                        request,
                        rx,
                        context.handle.clone(),
                        DropAction::Channel(id),
                        &context.mode,
                    );
                }
                Err(error) => {
                    respond_refusal(request, refusal_status(&error), error, &context.mode)
                }
            }
        }
        _ => respond_refusal(request, 404, route_unknown(&path), &context.mode),
    }
}

fn call_json(request: Request, context: &Context, action: Action, ok_status: u16) {
    match context.handle.call(action) {
        Ok(value) => respond_json(request, ok_status, value, &context.mode),
        Err(error) => respond_refusal(request, refusal_status(&error), error, &context.mode),
    }
}

fn respond_json(request: Request, status: u16, value: Json, mode: &str) {
    let mut response =
        Response::from_string(serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_owned()))
            .with_status_code(StatusCode(status))
            .with_header(content_type("application/json"));
    if mode == "dev" {
        response.add_header(header_value("Access-Control-Allow-Origin", "*"));
        response.add_header(header_value(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-Snapback-As, X-Snapback-Control",
        ));
    }
    let _ = request.respond(response);
}

fn respond_refusal(request: Request, status: u16, refusal: Refusal, mode: &str) {
    respond_json(request, status, refusal_json(&refusal), mode);
}

fn respond_sse(
    request: Request,
    receiver: Receiver<SseEvent>,
    handle: OwnerHandle,
    drop_action: DropAction,
    mode: &str,
) {
    // tiny_http's ordinary chunk encoder buffers 8 KiB, which is wrong for
    // realtime SSE. Its raw response writer lets this route frame and flush
    // one HTTP chunk per event while the rest of the server stays tiny_http.
    let mut writer = request.into_writer();
    let cors = if mode == "dev" {
        "Access-Control-Allow-Origin: *\r\n"
    } else {
        ""
    };
    if write!(
        writer,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\n{cors}\r\n"
    )
    .and_then(|_| writer.flush())
    .is_ok()
    {
        loop {
            let event = match receiver.recv_timeout(Duration::from_secs(15)) {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => SseEvent {
                    seq: None,
                    data: Json::Null,
                    terminal: false,
                },
                Err(RecvTimeoutError::Disconnected) => break,
            };
            let payload = if event.data.is_null() {
                ": heartbeat\n\n".to_owned()
            } else {
                let id = event.seq.map(|seq| format!("id: {seq}\n")).unwrap_or_default();
                format!(
                    "{id}data: {}\n\n",
                    serde_json::to_string(&event.data).unwrap_or_else(|_| "null".to_owned())
                )
            };
            if write!(writer, "{:x}\r\n{}\r\n", payload.len(), payload)
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
            if event.terminal {
                break;
            }
        }
    }
    let _ = writer.write_all(b"0\r\n\r\n");
    let _ = writer.flush();
    match drop_action {
        DropAction::Live(id) => handle.unsubscribe(id),
        DropAction::Channel(id) => {
            let _ = handle.call(Action::ChannelUnsubscribe { id });
        }
    }
}

enum DropAction {
    Live(u64),
    Channel(u64),
}

fn request_identity(request: &Request) -> Identity {
    if let Some(persona) = header(request, "X-Snapback-As") {
        Identity::Persona(persona)
    } else if let Some(token) = bearer(request) {
        Identity::Bearer(token)
    } else {
        Identity::Anonymous
    }
}

fn bearer(request: &Request) -> Option<String> {
    header(request, "Authorization")?
        .strip_prefix("Bearer ")
        .map(ToOwned::to_owned)
}

fn header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.to_string().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str().to_owned())
}

fn read_body(request: &mut Request) -> Result<Json, Refusal> {
    let mut text = String::new();
    request
        .as_reader()
        .take(1_048_577)
        .read_to_string(&mut text)
        .map_err(|error| {
            Refusal::input(
                format!("cannot read request body: {error}"),
                "send a JSON body smaller than 1 MiB",
            )
        })?;
    if text.len() > 1_048_576 {
        return Err(Refusal::input(
            "request body exceeds 1 MiB",
            "send a smaller request",
        ));
    }
    if text.trim().is_empty() {
        Ok(json!({}))
    } else {
        serde_json::from_str(&text).map_err(|error| {
            Refusal::input(
                format!("request body is not valid JSON: {error}"),
                "send Content-Type: application/json with valid JSON",
            )
        })
    }
}

fn split_url(raw: &str) -> (String, Query) {
    let (path, query) = raw.split_once('?').unwrap_or((raw, ""));
    let values = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(name), percent_decode(value))
        })
        .collect();
    (percent_decode(path), Query(values))
}

fn percent_decode(value: &str) -> String {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    output.push(byte);
                    index += 3;
                    continue;
                }
                output.push(bytes[index]);
            }
            b'+' => output.push(b' '),
            byte => output.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn parse_query_json(value: &str) -> Result<Json, Refusal> {
    serde_json::from_str(value).map_err(|error| {
        Refusal::input(
            format!("query parameter args is not valid JSON: {error}"),
            "URL-encode a JSON object in the args query parameter",
        )
    })
}

fn channel_name(path: &str, suffix: &str) -> Option<String> {
    path.strip_prefix("/api/channel/")?
        .strip_suffix(suffix)
        .filter(|name| !name.is_empty() && !name.contains('/'))
        .map(ToOwned::to_owned)
}

fn string_field(value: &Json, name: &str) -> String {
    value
        .get(name)
        .and_then(Json::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn refusal_status(refusal: &Refusal) -> u16 {
    if refusal.code == "E_AUTH_REQUIRED" || refusal.code == "E_AUTH_SESSION" {
        401
    } else if refusal.family == "auth" || refusal.family == "rule" {
        403
    } else if refusal.code == "E_OP_UNKNOWN" || refusal.code == "E_OP_CHANNEL_UNKNOWN" {
        404
    } else {
        400
    }
}

fn route_unknown(path: &str) -> Refusal {
    Refusal::new(
        "E_OP_ROUTE_UNKNOWN",
        "op",
        format!("unknown route {path}"),
        "use /api/manifest and the documented wire routes",
        "op/routes",
    )
}

fn method_name(method: &Method) -> &'static str {
    match method {
        Method::Get => "GET",
        Method::Post => "POST",
        Method::Options => "OPTIONS",
        _ => "OTHER",
    }
}

fn is_loopback(address: Option<IpAddr>) -> bool {
    address.is_some_and(|address| address.is_loopback())
}

fn content_type(value: &str) -> Header {
    header_value("Content-Type", value)
}

fn header_value(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static HTTP header")
}
