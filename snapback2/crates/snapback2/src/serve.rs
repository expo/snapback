//! Small synchronous HTTP/1.1 + chunked SSE server.
// @ref LLP 1002#4-the-wire — JSON states and SSE deliveries are the public protocol.

use crate::asset_http::{MediaJobs, handle_asset_delivery, handle_upload};
use crate::blob_store::{BlobStore, LocalStaging};
use crate::control;
use crate::project::SharedCompiler;
use crate::protocol::{Refusal, refusal_json};
use crate::writer::{
    Action, Identity, OfflineOptions, OwnerHandle, SseEvent, SseReceiver, sse_queue,
};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

#[path = "serve_live.rs"]
mod live;
#[path = "serve_security.rs"]
mod security;
pub(crate) use security::cors_origin;

const DEV_CORS_ALLOWED_HEADERS: &str = "Authorization, Content-Type, Cache-Control";
const MAX_HTTP_WORKERS: usize = 64;
const RESERVED_CONTROL_WORKERS: usize = 4;
const RESERVED_JSON_WORKERS: usize = 8;
const MAX_UPLOAD_WORKERS: usize = 4;
const MAX_NON_CONTROL_WORKERS: usize = MAX_HTTP_WORKERS - RESERVED_CONTROL_WORKERS;
const MAX_SSE_WORKERS: usize = MAX_NON_CONTROL_WORKERS - RESERVED_JSON_WORKERS - MAX_UPLOAD_WORKERS;

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
    pub blobs: Arc<dyn BlobStore>,
    pub staging: Arc<LocalStaging>,
    pub media_jobs: MediaJobs,
    pub compiler: SharedCompiler,
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

    pub fn run(self, context: Context) -> Result<(), Refusal> {
        let workers = WorkerPools::default();
        let streams = live::Streams::default();
        let auth_limits = Arc::new(security::AuthLimiter::default());
        while !context.stop.load(Ordering::SeqCst) {
            match self.server.recv_timeout(Duration::from_millis(100)) {
                Ok(Some(request)) => {
                    let class = WorkerClass::for_url(request.url());
                    let Some(worker) = workers.acquire(class) else {
                        respond_refusal(
                            request,
                            503,
                            Refusal::owner(
                                "E_OWNER_BUSY",
                                format!(
                                    "the owner has reached its bounded {} worker limit",
                                    class.label()
                                ),
                                "close slow clients and retry",
                            ),
                            &context.mode,
                        );
                        continue;
                    };
                    let connection_context = context.clone();
                    let connection_streams = streams.clone();
                    let connection_auth_limits = auth_limits.clone();
                    spawn_connection(
                        &context.root,
                        move || {
                            let mut worker = worker;
                            handle(
                                request,
                                connection_context,
                                connection_streams,
                                &mut worker,
                                &connection_auth_limits,
                            );
                        },
                        |task| {
                            thread::Builder::new()
                                .name("snapback2-http".to_owned())
                                .spawn(task)
                        },
                    );
                }
                Ok(None) => {}
                Err(error) => {
                    let refusal = fatal_server("accept loop", error);
                    crate::watch::log(
                        &context.root,
                        json!({ "exited": "fatal server failure", "refusal": refusal }),
                    );
                    context.stop.store(true, Ordering::SeqCst);
                    return Err(refusal);
                }
            }
        }
        // @ref LLP 1002#5-the-owner — stop wakes idle physical streams so their
        // heartbeat wait cannot outlive the owner's bounded exit contract.
        streams.wake_all();
        Ok(())
    }
}

fn spawn_connection<F, S>(root: &std::path::Path, task: F, spawn: S)
where
    F: FnOnce() + Send + 'static,
    S: FnOnce(F) -> std::io::Result<thread::JoinHandle<()>>,
{
    if let Err(error) = spawn(task) {
        crate::watch::log(
            root,
            json!({"connection": "shed", "refusal": fatal_server("connection thread", error)}),
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkerClass {
    Json,
    Sse,
    Upload,
    Control,
}

impl WorkerClass {
    fn for_url(url: &str) -> Self {
        let raw_path = url.split_once('?').map_or(url, |(path, _)| path);
        let path = percent_decode_path(raw_path);
        if path.starts_with("/control/") {
            Self::Control
        } else if path == "/api/upload" || path.starts_with("/api/asset/") {
            Self::Upload
        } else if path == "/api/live"
            || path == "/api/subscribe"
            || (path.starts_with("/api/channel/") && path.ends_with("/subscribe"))
        {
            Self::Sse
        } else {
            Self::Json
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Json => "JSON HTTP",
            Self::Sse => "SSE",
            Self::Upload => "asset upload",
            Self::Control => "control HTTP",
        }
    }
}

#[derive(Default)]
struct WorkerCounts {
    total: usize,
    json: usize,
    sse: usize,
    control: usize,
    upload: usize,
}

#[derive(Clone, Default)]
struct WorkerPools(Arc<Mutex<WorkerCounts>>);

impl WorkerPools {
    fn acquire(&self, class: WorkerClass) -> Option<HttpWorker> {
        let mut counts = self.0.lock().ok()?;
        let non_control = counts.json + counts.sse + counts.upload;
        if counts.total >= MAX_HTTP_WORKERS
            || (class != WorkerClass::Control && non_control >= MAX_NON_CONTROL_WORKERS)
            || (class == WorkerClass::Sse && counts.sse >= MAX_SSE_WORKERS)
            || (class == WorkerClass::Upload && counts.upload >= MAX_UPLOAD_WORKERS)
        {
            return None;
        }
        counts.total += 1;
        match class {
            WorkerClass::Json => counts.json += 1,
            WorkerClass::Sse => counts.sse += 1,
            WorkerClass::Upload => counts.upload += 1,
            WorkerClass::Control => counts.control += 1,
        }
        drop(counts);
        Some(HttpWorker {
            pools: self.clone(),
            class,
            release_reply: None,
        })
    }
}

struct HttpWorker {
    pools: WorkerPools,
    class: WorkerClass,
    release_reply: Option<(
        std::sync::mpsc::SyncSender<Result<Json, Refusal>>,
        Result<Json, Refusal>,
    )>,
}

impl HttpWorker {
    fn reply_after_release(
        &mut self,
        sender: std::sync::mpsc::SyncSender<Result<Json, Refusal>>,
        result: Result<Json, Refusal>,
    ) {
        self.release_reply = Some((sender, result));
    }
}

impl Drop for HttpWorker {
    fn drop(&mut self) {
        let mut counts = self
            .pools
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        counts.total -= 1;
        match self.class {
            WorkerClass::Json => counts.json -= 1,
            WorkerClass::Sse => counts.sse -= 1,
            WorkerClass::Upload => counts.upload -= 1,
            WorkerClass::Control => counts.control -= 1,
        }
        drop(counts);
        if let Some((sender, result)) = self.release_reply.take() {
            let _ = sender.send(result);
        }
    }
}

// Admission precedes persona checks and body reads: remote callers learn only the loopback refusal.
fn control_admission(request: &Request, secret: &str) -> Result<(), Refusal> {
    if !is_loopback(request.remote_addr().map(SocketAddr::ip)) {
        return Err(Refusal::owner(
            "E_OWNER_CONTROL_REMOTE",
            "control routes are loopback only",
            "call the owner from the local machine",
        ));
    }
    if !security::secret_matches(header(request, "X-Snapback-Control").as_deref(), secret) {
        return Err(Refusal::owner(
            "E_OWNER_CONTROL_SECRET",
            "invalid owner control secret",
            "read X-Snapback-Control from .snapback/owner.json",
        ));
    }
    Ok(())
}

fn handle(
    mut request: Request,
    context: Context,
    streams: live::Streams,
    worker: &mut HttpWorker,
    auth_limits: &security::AuthLimiter,
) {
    if request.url().len() > 16 * 1024 {
        respond_refusal(
            request,
            414,
            Refusal::input(
                "request URL exceeds 16 KiB",
                "use a shorter URL or a POST request",
            ),
            &context.mode,
        );
        return;
    }
    if let Err(refusal) = security::browser_admission(&request, &context.mode) {
        respond_refusal(request, 403, refusal, &context.mode);
        return;
    }
    let method = method_name(request.method());
    let request_url = request.url().to_owned();
    let (path, query) = split_url(&request_url);
    // @ref LLP 1016#d6--the-operator-seat-ad-hoc-programs-and-rehearsal — the ad hoc, job, and execute routes (each carries the seat or a rehearsal) have no remote seat until H0 supplies token admission; refuse before secrets or parsing source.
    if matches!(
        path.as_str(),
        "/control/run" | "/control/job" | "/control/execute"
    ) && let Err(refusal) = control::operator_transport(
        is_loopback(request.remote_addr().map(SocketAddr::ip)),
        &context.mode,
    ) {
        respond_refusal(request, 403, refusal, &context.mode);
        return;
    }
    // OPTIONS /control/* needs the secret too: control is not a CORS surface.
    if path.starts_with("/control/")
        && let Err(refusal) = control_admission(&request, &context.secret)
    {
        respond_refusal(request, 403, refusal, &context.mode);
        return;
    }
    // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — persona and bearer are mutually exclusive authority sources at the raw wire too.
    if header(&request, "X-Snapback-As").is_some() && bearer(&request).is_some() {
        respond_refusal(
            request,
            400,
            Refusal::new(
                "E_AUTH_AMBIGUOUS",
                "auth",
                "a request cannot carry both persona and bearer authority",
                "send exactly one of X-Snapback-As or Authorization: Bearer <token>",
                "auth/session",
            ),
            &context.mode,
        );
        return;
    }
    // The header always selects a viewer; control-route operator authority travels in the body.
    if header(&request, "X-Snapback-As").as_deref() == Some("system") {
        respond_refusal(request, 403, Refusal::operator_required(), &context.mode);
        return;
    }
    if context.mode == "serve" && header(&request, "X-Snapback-As").is_some() {
        respond_refusal(
            request,
            403,
            Refusal::new(
                "E_AUTH_PERSONA_NOT_DEV",
                "auth",
                "personas are refused by a serve owner",
                "remove X-Snapback-As and use Authorization: Bearer <token>",
                "auth/personas",
            ),
            &context.mode,
        );
        return;
    }
    if method == "OPTIONS" {
        respond_json(request, 204, json!({}), &context.mode);
        return;
    }
    if path.starts_with("/control/") {
        let body = match read_body(&mut request) {
            Ok(body) => body,
            Err(error) => {
                respond_refusal(request, 400, error, &context.mode);
                return;
            }
        };
        if body.get("as").and_then(Json::as_str) == Some("system")
            && let Err(refusal) = control::operator_transport(
                is_loopback(request.remote_addr().map(SocketAddr::ip)),
                &context.mode,
            )
        {
            respond_refusal(request, 403, refusal, &context.mode);
            return;
        }

        let control_context = control::Context {
            handle: context.handle.clone(),
            root: context.root.clone(),
            compiler: context.compiler.clone(),
        };
        match control::route(method, &path, &query, body, &control_context) {
            Some(Ok(value)) => respond_json(request, 200, value, &context.mode),
            Some(Err((status, error))) => respond_refusal(request, status, error, &context.mode),
            None => respond_refusal(request, 404, route_unknown(&path), &context.mode),
        }
        return;
    }

    // @ref LLP 1006#5-upload-one-post — upload branches before the 1 MiB UTF-8
    // JSON reader and runs in its own bounded worker class.
    if method == "POST" && path == "/api/upload" {
        let identity = request_identity(&request);
        handle_upload(request, &context, identity);
        return;
    }
    if matches!(method, "GET" | "HEAD") && path.starts_with("/api/asset/") {
        handle_asset_delivery(request, &context, &path, &query);
        return;
    }

    let body = match read_body(&mut request) {
        Ok(body) => body,
        Err(error) => {
            respond_refusal(request, 400, error, &context.mode);
            return;
        }
    };

    let identity = request_identity(&request);
    let bearer_token = bearer(&request).unwrap_or_default();
    if method == "POST" && (path == "/api/live" || path == "/api/live/control") {
        live::handle(
            request,
            &context,
            streams,
            identity,
            body,
            path.ends_with("/control"),
            worker,
        );
        return;
    }
    let _auth_permit =
        if method == "POST" && matches!(path.as_str(), "/api/auth/signup" | "/api/auth/login") {
            match auth_limits.admit(
                request.remote_addr().map(SocketAddr::ip),
                body.get("email").and_then(Json::as_str).unwrap_or_default(),
                std::time::Instant::now(),
            ) {
                Some(permit) => Some(permit),
                None => {
                    respond_refusal(
                        request,
                        429,
                        Refusal::new(
                            "E_AUTH_RATE_LIMIT",
                            "auth",
                            "too many password authentication attempts",
                            "wait 60 seconds before trying again",
                            "auth/session",
                        ),
                        &context.mode,
                    );
                    return;
                }
            }
        } else {
            None
        };
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
        ("GET", "/api/manifest") => {
            let operator = header(&request, "X-Snapback-Control").is_some();
            if operator && let Err(refusal) = control_admission(&request, &context.secret) {
                respond_refusal(request, 403, refusal, &context.mode);
            } else {
                call_json(request, &context, Action::Manifest { operator }, 200);
            }
        }
        ("GET", "/api/program") => call_json(
            request,
            &context,
            Action::Program {
                generation: query.get("generation").unwrap_or_default().to_owned(),
                identity,
            },
            200,
        ),
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
                remaining: body.get("remaining").cloned(),
            },
            200,
        ),
        ("POST", "/api/auth/guest") => call_json(
            request,
            &context,
            Action::Guest {
                remaining: body.get("remaining").cloned(),
            },
            200,
        ),
        ("POST", "/api/auth/refresh") => call_json(
            request,
            &context,
            Action::Refresh { token: bearer_token },
            200,
        ),
        ("POST", "/api/auth/logout") => call_json(
            request,
            &context,
            Action::Logout {
                token: bearer_token,
            },
            200,
        ),
        ("GET", "/api/uploads") => call_json(
            request,
            &context,
            Action::ListUploads {
                identity,
                after: query.get("after").unwrap_or_default().to_owned(),
            },
            200,
        ),
        ("POST", "/api/uploads/discard") => call_json(
            request,
            &context,
            Action::DiscardUpload {
                identity,
                id: string_field(&body, "id"),
            },
            200,
        ),
        ("GET", "/api/auth/me") => call_json(request, &context, Action::Me { identity }, 200),
        ("POST", "/api/auth/asset-session") => {
            call_json(request, &context, Action::AssetSession { identity }, 200)
        }
        ("POST", "/api/acquire") => match context.handle.acquire(body, identity) {
            Ok(encoded) => respond_encoded_json(request, 200, encoded, &context.mode),
            Err(error) => respond_refusal(request, refusal_status(&error), error, &context.mode),
        },
        ("POST", "/api/query") if body.get("batch").is_some() => call_json(
            request,
            &context,
            Action::QueryBatch { body, identity },
            200,
        ),
        ("POST", "/api/mutation") if body.get("batch").is_some() => call_json(
            request,
            &context,
            Action::ReplayBatch { body, identity },
            200,
        ),
        ("POST", "/api/query") => call_json(
            request,
            &context,
            Action::Execute {
                op: string_field(&body, "op"),
                args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                identity,
                expected: Some(snapback2_core::ProgramKind::Query),
                expected_generation: None,
                offline: offline_options(&body, &query),
                replay: None,
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
                expected_generation: body.get("expectedGeneration").cloned(),
                offline: OfflineOptions::default(),
                // A client that sends `replay: null` is a client without a store.
                replay: body.get("replay").filter(|value| !value.is_null()).cloned(),
            },
            200,
        ),
        ("POST", "/api/resume") => {
            call_json(request, &context, Action::Resume { body, identity }, 200)
        }
        ("GET", "/api/subscribe") => {
            let op = query.get("op").unwrap_or_default().to_owned();
            let args = match parse_query_json(query.get("args").unwrap_or("{}")) {
                Ok(args) => args,
                Err(error) => {
                    respond_refusal(request, 400, error, &context.mode);
                    return;
                }
            };
            let (tx, rx) = sse_queue();
            let _connected =
                match live::ConnectedStream::open(&context.handle, &identity, tx.clone()) {
                    Ok(connected) => connected,
                    Err(error) => {
                        respond_refusal(request, refusal_status(&error), error, &context.mode);
                        return;
                    }
                };
            match context
                .handle
                .subscribe(op, args, identity, offline_options(&body, &query), tx)
            {
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
        ("POST", path)
            if channel_name(path, "/set").is_some() || channel_name(path, "/clear").is_some() =>
        {
            let setting = channel_name(path, "/set");
            let name = setting
                .clone()
                .or_else(|| channel_name(path, "/clear"))
                .unwrap_or_default();
            call_json(
                request,
                &context,
                Action::ChannelWrite {
                    name,
                    args: body.get("args").cloned().unwrap_or_else(|| json!({})),
                    lease: body
                        .get("lease")
                        .and_then(Json::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    version: body.get("version").cloned().unwrap_or(Json::Null),
                    value: setting.map(|_| body.get("value").cloned().unwrap_or(Json::Null)),
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
            let (tx, rx) = sse_queue();
            let _connected =
                match live::ConnectedStream::open(&context.handle, &identity, tx.clone()) {
                    Ok(connected) => connected,
                    Err(error) => {
                        respond_refusal(request, refusal_status(&error), error, &context.mode);
                        return;
                    }
                };
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

pub(crate) fn respond_json(request: Request, status: u16, value: Json, mode: &str) {
    respond_encoded_json(request, status, serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec()), mode);
}

// @ref LLP 1001#native-owner-image-pipeline — encoded native frames cross the
// owner/HTTP boundary without another JSON body tree or serialization pass.
fn respond_encoded_json(request: Request, status: u16, encoded: Vec<u8>, mode: &str) {
    let mut headers = vec![content_type("application/json")];
    decorate_asset_response_headers(request.url(), &mut headers);
    if status == 200 && request.url().split('?').next() == Some("/api/program") {
        headers.push(header_value("Cache-Control", "private, immutable"));
    }
    let mut response =
        Response::from_data(encoded)
            .with_status_code(StatusCode(status));
    for header in headers {
        response.add_header(header);
    }
    if let Some(origin) = cors_origin(&request, mode) {
        response.add_header(header_value("Access-Control-Allow-Origin", &origin));
        response.add_header(header_value("Vary", "Origin"));
        response.add_header(header_value(
            "Access-Control-Allow-Headers",
            DEV_CORS_ALLOWED_HEADERS,
        ));
        response.add_header(header_value(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS",
        ));
    }
    let _ = request.respond(response);
}

pub(crate) fn respond_refusal(request: Request, status: u16, mut refusal: Refusal, mode: &str) {
    if mode == "serve" && refusal.code == "E_AUTH_REQUIRED" {
        refusal.rewrite = Some("send Authorization: Bearer <token>".to_owned());
    }
    respond_json(request, status, refusal_json(&refusal), mode);
}

fn respond_sse(
    request: Request,
    receiver: SseReceiver,
    handle: OwnerHandle,
    drop_action: DropAction,
    mode: &str,
) {
    // tiny_http's ordinary chunk encoder buffers 8 KiB, which is wrong for
    // realtime SSE. Its raw response writer lets this route frame and flush
    // one HTTP chunk per event while the rest of the server stays tiny_http.
    let cors = security::cors_lines(&request, mode);
    let mut writer = request.into_writer();
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

pub(crate) fn request_identity(request: &Request) -> Identity {
    if let Some(persona) = header(request, "X-Snapback-As") {
        Identity::Persona(persona)
    } else if let Some(token) = bearer(request) {
        Identity::Bearer(token)
    } else {
        Identity::Anonymous
    }
}

pub(crate) fn bearer(request: &Request) -> Option<String> {
    let value = header(request, "Authorization")?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("Bearer") && !token.is_empty()).then(|| token.to_owned())
}

pub(crate) fn header(request: &Request, name: &str) -> Option<String> {
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
    (percent_decode_path(path), Query(values))
}

fn percent_decode(value: &str) -> String {
    decode_component(value, true)
}

fn percent_decode_path(value: &str) -> String {
    decode_component(value, false)
}

fn decode_component(value: &str, query: bool) -> String {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let digit = |byte: u8| (byte as char).to_digit(16);
                if let (Some(high), Some(low)) = (digit(bytes[index + 1]), digit(bytes[index + 2]))
                {
                    let byte = ((high << 4) | low) as u8;
                    output.push(byte);
                    index += 3;
                    continue;
                }
                output.push(bytes[index]);
            }
            b'+' if query => output.push(b' '),
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

fn offline_options(body: &Json, query: &Query) -> OfflineOptions {
    OfflineOptions {
        drain: query.get("drain") == Some("1"),
        receipt: body.get("receipt").and_then(Json::as_bool) == Some(true)
            || query.get("receipt") == Some("1"),
        validator: body
            .get("validator")
            .and_then(Json::as_str)
            .or_else(|| query.get("validator"))
            .map(ToOwned::to_owned),
    }
}

pub(crate) fn refusal_status(refusal: &Refusal) -> u16 {
    if refusal.code == "E_OFFLINE_RESET" {
        409
    } else if refusal.code == "E_OFFLINE_RESUME" {
        413
    } else if refusal.code == "E_AUTH_REQUIRED" || refusal.code == "E_AUTH_SESSION" {
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
        Method::Head => "HEAD",
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

pub(crate) fn checked_header_value(name: &str, value: &str) -> Result<Header, Refusal> {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).map_err(|_| {
        Refusal::owner(
            "E_OWNER_HTTP_HEADER",
            "invalid HTTP response header",
            "use ASCII header values without control characters",
        )
    })
}

// Callers with data-derived values use checked_header_value and return a refusal.
pub(crate) fn header_value(name: &str, value: &str) -> Header {
    checked_header_value(name, value).expect("static or typed HTTP header")
}

/// Apply the asset-route privacy envelope from the untouched request target,
/// including refusals produced before route dispatch.
// @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — carrier
// presence, not dispatch progress, makes every asset response no-store/no-referrer.
pub(crate) fn decorate_asset_response_headers(raw_url: &str, headers: &mut Vec<Header>) {
    let raw_path = raw_url.split_once('?').map_or(raw_url, |(path, _)| path);
    if !percent_decode_path(raw_path).starts_with("/api/asset/") {
        return;
    }
    set_header(headers, "Referrer-Policy", "no-referrer");
    if query_has_name(raw_url, "s") {
        set_header(headers, "Cache-Control", "no-store");
    }
}

fn query_has_name(raw_url: &str, expected: &str) -> bool {
    raw_url.split_once('?').is_some_and(|(_, query)| {
        query.split('&').any(|pair| {
            let name = pair.split_once('=').map_or(pair, |(name, _)| name);
            percent_decode(name) == expected
        })
    })
}

fn set_header(headers: &mut Vec<Header>, name: &str, value: &str) {
    headers.retain(|header| !header.field.to_string().eq_ignore_ascii_case(name));
    headers.push(header_value(name, value));
}

fn fatal_server(stage: &str, error: impl std::fmt::Display) -> Refusal {
    Refusal::owner(
        "E_OWNER_FATAL",
        format!("{stage} failed: {error}"),
        "inspect .snapback/log.jsonl and restart the owner",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_control_refuses_before_secret_operator_or_body_validation() {
        for secret in [None, Some("wrong"), Some("correct")] {
            for body in ["{invalid json", r#"{"as":"system"}"#] {
                let mut request = tiny_http::TestRequest::new()
                    .with_remote_addr("192.0.2.1:1234".parse().unwrap())
                    .with_method(Method::Post)
                    .with_path("/control/execute")
                    .with_body(body);
                if let Some(secret) = secret {
                    request = request.with_header(header_value("X-Snapback-Control", secret));
                }
                let mut request: Request = request.into();
                let refusal = control_admission(&request, "correct").unwrap_err();
                let envelope = refusal_json(&refusal);
                assert_eq!(envelope["code"], "E_OWNER_CONTROL_REMOTE");
                assert_eq!(envelope["family"], "owner");
                assert!(envelope["rewrite"].as_str().is_some_and(|s| !s.is_empty()));
                assert!(envelope["guide"].as_str().is_some_and(|s| !s.is_empty()));
                let mut unread = String::new();
                request.as_reader().read_to_string(&mut unread).unwrap();
                assert_eq!(unread, body, "admission consumed the body");
            }
        }
    }

    #[test]
    fn idle_socket_flood_is_shed_and_first_socket_times_out() {
        use std::io::BufRead;
        let server = BoundServer::bind(0).unwrap();
        let mut sockets = (0..300)
            .map(|_| std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap())
            .collect::<Vec<_>>();
        let mut shed = 0;
        for socket in sockets.iter_mut().skip(1) {
            socket
                .set_read_timeout(Some(Duration::from_millis(2)))
                .unwrap();
            let mut byte = [0];
            match socket.read(&mut byte) {
                Ok(0) => shed += 1,
                Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => shed += 1,
                _ => {}
            }
        }
        assert!(
            shed > 0,
            "raw socket admission must shed beyond its fixed reader/queue bounds"
        );
        sockets[0]
            .set_read_timeout(Some(Duration::from_secs(7)))
            .unwrap();
        let mut response = String::new();
        std::io::BufReader::new(&sockets[0])
            .read_line(&mut response)
            .unwrap();
        assert!(
            response.is_empty() || response.contains(" 408 "),
            "{response}"
        );
    }

    #[test]
    fn pipelined_requests_wait_for_response_without_blocking_other_connections() {
        use std::io::Write;
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let mut pipeline = std::net::TcpStream::connect(address).unwrap();
        pipeline.write_all(b"GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let first = server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        assert_eq!(first.url(), "/first");
        // An open raw/SSE response holds only its own connection's admission.
        let response = first.into_writer();
        assert!(server.recv_timeout(Duration::from_millis(100)).unwrap().is_none());
        let mut other = std::net::TcpStream::connect(address).unwrap();
        other.write_all(b"GET /other HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let unrelated = server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        assert_eq!(unrelated.url(), "/other");
        unrelated.respond(tiny_http::Response::empty(200)).unwrap();
        drop(response);
        let second = server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        assert_eq!(second.url(), "/second");
        second.respond(tiny_http::Response::empty(200)).unwrap();
    }

    #[test]
    fn shed_connection_does_not_allocate_or_drain_declared_body() {
        use std::io::BufRead;
        let server = BoundServer::bind(0).unwrap();
        let mut socket = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        write!(
            socket,
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n",
            usize::MAX
        )
        .unwrap();
        let request = server
            .server
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        let started = std::time::Instant::now();
        let root = std::env::temp_dir().join(format!("snapback-body-shed-{}", std::process::id()));
        spawn_connection(
            &root,
            move || drop(request),
            |_task| Err(std::io::Error::other("injected spawn exhaustion")),
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        let mut response = String::new();
        std::io::BufReader::new(socket)
            .read_line(&mut response)
            .unwrap();
        assert!(response.contains(" 500 "), "{response}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ordinary_refusal_responds_before_a_withheld_request_body() {
        use std::io::BufRead;
        let server = BoundServer::bind(0).unwrap();
        let mut socket = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        socket.write_all(b"POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048576\r\n\r\n").unwrap();
        let request = server.server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
        let responder = thread::spawn(move || request.respond(Response::from_string("denied").with_status_code(403)));
        let mut reader = std::io::BufReader::new(socket);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains(" 403 "), "{line}");
        loop {
            line.clear(); assert!(reader.read_line(&mut line).unwrap() > 0, "EOF before response headers ended");
            if line == "\r\n" { break; }
        }
        let mut body = [0; 6];
        reader.read_exact(&mut body).unwrap();
        assert_eq!(&body, b"denied");
        responder.join().unwrap().unwrap();
    }

    #[test]
    fn ordinary_responses_preserve_http_version_head_and_pipeline_framing() {
        use std::io::BufRead;
        for version in ["1.0", "1.1"] {
            let server = BoundServer::bind(0).unwrap();
            let mut socket = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let methods = if version == "1.1" { vec!["POST", "HEAD", "GET"] } else { vec!["HEAD"] };
            for method in &methods {
                let body = if *method == "POST" { "{}" } else { "" };
                write!(socket, "{method} / HTTP/{version}\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            }
            let count = methods.len();
            let responder = thread::spawn(move || {
                for _ in 0..count {
                    let mut request = server.server.recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
                    let mut body = String::new(); request.as_reader().read_to_string(&mut body).unwrap();
                    request.respond(Response::from_string("x".repeat(4096))
                        .with_header(header_value("Content-Type", "application/json"))).unwrap();
                }
            });
            let mut reader = std::io::BufReader::new(socket);
            for method in methods {
                let mut line = String::new(); reader.read_line(&mut line).unwrap();
                assert!(line.starts_with(&format!("HTTP/{version} 200 ")), "{line}");
                let mut headers = String::new();
                loop {
                    line.clear(); assert!(reader.read_line(&mut line).unwrap() > 0, "EOF before response headers ended");
                    if line == "\r\n" { break; }
                    headers.push_str(&line);
                }
                assert!(headers.contains("Content-Length: 4096\r\n"), "{headers}");
                assert!(headers.contains("Content-Type: application/json\r\n"), "{headers}");
                if method != "HEAD" {
                    let mut body = vec![0; 4096]; reader.read_exact(&mut body).unwrap();
                    assert_eq!(body, vec![b'x'; 4096]);
                }
            }
            responder.join().unwrap();
        }
    }

    #[test]
    fn spawn_failure_releases_one_connection_and_next_spawn_runs() {
        let pools = WorkerPools::default();
        let worker = pools.acquire(WorkerClass::Json).unwrap();
        let root =
            std::env::temp_dir().join(format!("snapback-spawn-failure-{}", std::process::id()));
        spawn_connection(
            &root,
            move || drop(worker),
            |_task| Err(std::io::Error::other("injected thread exhaustion")),
        );
        assert_eq!(pools.0.lock().unwrap().total, 0);
        let (done, answer) = std::sync::mpsc::channel();
        let worker = pools.acquire(WorkerClass::Json).unwrap();
        spawn_connection(
            &root,
            move || {
                drop(worker);
                done.send(()).unwrap();
            },
            |task| thread::Builder::new().spawn(task),
        );
        answer.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(pools.0.lock().unwrap().total, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn percent_decoding_is_byte_safe_and_paths_preserve_plus() {
        for value in [
            "/%aé",
            "%é",
            "%😀",
            "%a😀",
            "%",
            "%a",
            "%FF",
            "%E2%82%AC",
            "中文%中",
        ] {
            let _ = split_url(value);
            let _ = WorkerClass::for_url(value);
        }
        for ch in (128..=0x10ffff).filter_map(char::from_u32) {
            let value = format!("/%a{ch}");
            assert_eq!(percent_decode_path(&value), value);
        }
        assert_eq!(split_url("/a+b?q=a+b").0, "/a+b");
        assert_eq!(split_url("/a+b?q=a+b").1.get("q"), Some("a b"));
        assert_eq!(percent_decode_path("/%2B%E2%82%AC"), "/+€");
    }

    #[test]
    fn response_headers_reject_control_characters_and_non_ascii() {
        for value in ["ok\r\nSet-Cookie: a=1", "bad\0value", "é", "\u{7f}"] {
            assert!(checked_header_value("Location", value).is_err());
        }
        assert!(checked_header_value("Bad\r\nName", "value").is_err());
        assert!(checked_header_value("Location", "/api/asset/s2id-example?w=256").is_ok());
    }

    #[test]
    fn bearer_scheme_is_case_insensitive() {
        for scheme in ["Bearer", "bearer", "BEARER", "bEaReR"] {
            let request: Request = tiny_http::TestRequest::new()
                .with_header(header_value("Authorization", &format!("{scheme} opaque")))
                .into();
            assert_eq!(bearer(&request).as_deref(), Some("opaque"));
        }
    }

    #[test]
    fn poisoned_worker_pool_refuses_and_drop_releases_without_panicking() {
        let pools = WorkerPools::default();
        let worker = pools.acquire(WorkerClass::Json).unwrap();
        let poison = pools.clone();
        let _ = thread::spawn(move || {
            let _guard = poison.0.lock().unwrap();
            panic!("inject poison");
        })
        .join();
        assert!(pools.acquire(WorkerClass::Json).is_none());
        drop(worker);
        assert_eq!(pools.0.lock().err().unwrap().into_inner().total, 0);
    }

    #[test]
    fn fatal_server_failures_have_the_owner_fatal_type_and_cause() {
        let refusal = fatal_server("accept loop", "simulated accept failure");
        assert_eq!(refusal.code, "E_OWNER_FATAL");
        assert_eq!(refusal.family, "owner");
        assert!(refusal.message.contains("accept loop"));
        assert!(refusal.message.contains("simulated accept failure"));
    }

    #[test]
    fn browser_cors_never_admits_the_owner_control_capability() {
        assert!(!DEV_CORS_ALLOWED_HEADERS.contains("X-Snapback-Control"));
    }

    #[test]
    fn worker_budget_reserves_json_and_control_capacity_from_sse() {
        assert_eq!(WorkerClass::for_url("/api/live"), WorkerClass::Sse);
        assert_eq!(WorkerClass::for_url("/api/live/control"), WorkerClass::Json);
        let pools = WorkerPools::default();
        let sse = (0..MAX_SSE_WORKERS)
            .map(|_| pools.acquire(WorkerClass::Sse).unwrap())
            .collect::<Vec<_>>();
        assert!(pools.acquire(WorkerClass::Sse).is_none());
        let uploads = (0..MAX_UPLOAD_WORKERS)
            .map(|_| pools.acquire(WorkerClass::Upload).unwrap())
            .collect::<Vec<_>>();
        assert!(pools.acquire(WorkerClass::Upload).is_none());
        let json = (0..RESERVED_JSON_WORKERS)
            .map(|_| pools.acquire(WorkerClass::Json).unwrap())
            .collect::<Vec<_>>();
        assert!(pools.acquire(WorkerClass::Json).is_none());
        let control = (0..RESERVED_CONTROL_WORKERS)
            .map(|_| pools.acquire(WorkerClass::Control).unwrap())
            .collect::<Vec<_>>();
        assert!(pools.acquire(WorkerClass::Control).is_none());
        drop((sse, uploads, json, control));
        let counts = pools.0.lock().unwrap();
        assert_eq!(counts.total, 0);
        assert_eq!(counts.json, 0);
        assert_eq!(counts.sse, 0);
        assert_eq!(counts.upload, 0);
        assert_eq!(counts.control, 0);
        drop(counts);
        assert_eq!(
            WorkerClass::for_url("/control/status"),
            WorkerClass::Control
        );
        assert_eq!(
            WorkerClass::for_url("/api/subscribe?op=todos.list"),
            WorkerClass::Sse
        );
        assert_eq!(
            WorkerClass::for_url("/api/channel/typing/subscribe?args=%7B%7D"),
            WorkerClass::Sse
        );
        assert_eq!(
            WorkerClass::for_url("%2Fapi%2Fsubscribe?op=todos.list"),
            WorkerClass::Sse
        );
        assert_eq!(
            WorkerClass::for_url("%2Fcontrol%2Fstatus"),
            WorkerClass::Control
        );
        assert_eq!(WorkerClass::for_url("/api/query"), WorkerClass::Json);
        assert_eq!(WorkerClass::for_url("/api/upload"), WorkerClass::Upload);
        assert_eq!(
            WorkerClass::for_url("/api/asset/id?w=256"),
            WorkerClass::Upload
        );
    }

    #[test]
    fn release_reply_is_sent_only_after_the_worker_returns_to_the_pool() {
        let pools = WorkerPools::default();
        let mut worker = pools.acquire(WorkerClass::Sse).unwrap();
        let (reply, answer) = std::sync::mpsc::sync_channel(1);
        worker.reply_after_release(reply, Ok(json!({ "ok": true })));
        assert!(matches!(
            answer.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Empty)
        ));

        drop(worker);

        assert_eq!(answer.recv().unwrap().unwrap(), json!({ "ok": true }));
        let counts = pools.0.lock().unwrap();
        assert_eq!(counts.total, 0);
        assert_eq!(counts.sse, 0);
    }

    #[test]
    fn asset_response_privacy_is_derived_from_the_original_request_target() {
        let mut headers = vec![header_value("Cache-Control", "public, immutable")];
        decorate_asset_response_headers("/api/asset/bad/path?s=secret", &mut headers);
        let values = headers
            .iter()
            .map(|header| {
                (
                    header.field.to_string().to_ascii_lowercase(),
                    header.value.as_str().to_owned(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            values.get("cache-control").map(String::as_str),
            Some("no-store")
        );
        assert_eq!(
            values.get("referrer-policy").map(String::as_str),
            Some("no-referrer")
        );
    }
}
