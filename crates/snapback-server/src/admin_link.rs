//! Managed reachability fronts for `snapback admin link`.
//!
//! The server remains bound to loopback. This module owns only the two
//! invocation-scoped ingress mechanisms and terminal QR presentation.

use anyhow::Context as _;
use axum::Router;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{ConnectInfo, State};
use axum::http::{
    HeaderMap, HeaderName, HeaderValue, Method, Request, Response, StatusCode, header,
};
use axum::response::IntoResponse as _;
use axum::routing::any;
use qrcode::QrCode;
use qrcode::render::unicode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeSet;
use std::ffi::CStr;
use std::fs::{File, OpenOptions};
use std::io::{self, Read as _};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

const RELAY_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const RELAY_MASTER_EXCHANGE_PATH: &str = "/_snapback/api/console/credential";
const RELAY_CLAIM_EXCHANGE_PATH: &str = "/_snapback/api/console/claim/exchange";
const TAILSCALE_MOUNT_PATH: &str = "/_snapback";
const TAILSCALE_HTTPS_PORT: u16 = 443;
const TAILSCALE_RECEIPT_VERSION: u32 = 1;
const TAILSCALE_RECEIPT_MAX_BYTES: usize = 64 * 1024;
const TAILSCALE_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct LanCandidate {
    pub interface: String,
    pub address: IpAddr,
}

/// Enumerate addresses whose interface flags and names match the LLP 0017 LAN
/// posture. Point-to-point and known virtual/tunnel devices are excluded even
/// when they are administratively up.
#[cfg(unix)]
pub fn lan_candidates() -> anyhow::Result<Vec<LanCandidate>> {
    let mut head = std::ptr::null_mut();
    // SAFETY: getifaddrs initializes `head` on success; freeifaddrs owns the
    // returned linked list and is called exactly once below.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Err(anyhow::anyhow!(
            "SNAPBACK_ADMIN_LAN_INTERFACE_ENUMERATION_FAILED: {}",
            io::Error::last_os_error()
        ));
    }
    let mut candidates = BTreeSet::new();
    let mut cursor = head;
    while !cursor.is_null() {
        // SAFETY: cursor walks the linked list returned by getifaddrs until a
        // null next pointer.
        let interface = unsafe { &*cursor };
        let flags = interface.ifa_flags as libc::c_int;
        let address = interface.ifa_addr;
        if flags & libc::IFF_UP != 0
            && flags & libc::IFF_LOOPBACK == 0
            && flags & libc::IFF_POINTOPOINT == 0
            && !address.is_null()
        {
            // SAFETY: ifa_name is a NUL-terminated name owned by the list.
            let name = unsafe { CStr::from_ptr(interface.ifa_name) }
                .to_string_lossy()
                .into_owned();
            if !virtual_interface_name(&name) {
                // SAFETY: the address family selects the matching sockaddr
                // layout; both structures are copied before the list is freed.
                let ip = unsafe {
                    match (*address).sa_family as libc::c_int {
                        libc::AF_INET => {
                            let address = &*(address.cast::<libc::sockaddr_in>());
                            Some(IpAddr::V4(std::net::Ipv4Addr::from(u32::from_be(
                                address.sin_addr.s_addr,
                            ))))
                        }
                        libc::AF_INET6 => {
                            let address = &*(address.cast::<libc::sockaddr_in6>());
                            Some(IpAddr::V6(std::net::Ipv6Addr::from(
                                address.sin6_addr.s6_addr,
                            )))
                        }
                        _ => None,
                    }
                };
                if let Some(address) = ip
                    && usable_lan_address(address)
                {
                    candidates.insert(LanCandidate {
                        interface: name,
                        address,
                    });
                }
            }
        }
        cursor = interface.ifa_next;
    }
    // SAFETY: head is the exact pointer returned by getifaddrs above.
    unsafe { libc::freeifaddrs(head) };
    Ok(candidates.into_iter().collect())
}

#[cfg(not(unix))]
pub fn lan_candidates() -> anyhow::Result<Vec<LanCandidate>> {
    anyhow::bail!(
        "SNAPBACK_ADMIN_LAN_HOST_UNSUPPORTED: LAN interface ownership is not implemented on this host"
    )
}

fn usable_lan_address(address: IpAddr) -> bool {
    !address.is_loopback() && !address.is_unspecified() && !address.is_multicast()
}

fn virtual_interface_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "lo",
        "awdl",
        "llw",
        "utun",
        "tun",
        "tap",
        "veth",
        "docker",
        "br-",
        "bridge",
        "virbr",
        "vmnet",
        "vboxnet",
        "podman",
        "tailscale",
        "zt",
        "wg",
    ]
    .iter()
    .any(|prefix| name == *prefix || name.starts_with(prefix))
}

pub fn select_lan_address(
    selector: Option<&str>,
    candidates: &[LanCandidate],
) -> anyhow::Result<LanCandidate> {
    let formatted = format_lan_candidates(candidates);
    let explicit_address = selector
        .filter(|selector| !selector.is_empty())
        .and_then(|selector| selector.parse::<IpAddr>().ok());
    if let Some(address) = explicit_address {
        anyhow::ensure!(
            usable_lan_address(address),
            "SNAPBACK_ADMIN_LAN_WILDCARD_REFUSED: --lan may not bind a wildcard, loopback, or multicast address"
        );
    }
    let matches = match selector.filter(|selector| !selector.is_empty()) {
        None => {
            let interfaces = candidates
                .iter()
                .map(|candidate| candidate.interface.as_str())
                .collect::<BTreeSet<_>>();
            if interfaces.len() != 1 {
                return Err(anyhow::anyhow!(
                    "SNAPBACK_ADMIN_LAN_INTERFACE_AMBIGUOUS: choose --lan=<address|interface>; candidates: {formatted}"
                ));
            }
            candidates.to_vec()
        }
        Some(selector) => {
            if let Some(address) = explicit_address {
                candidates
                    .iter()
                    .filter(|candidate| candidate.address == address)
                    .cloned()
                    .collect()
            } else {
                candidates
                    .iter()
                    .filter(|candidate| candidate.interface == selector)
                    .cloned()
                    .collect()
            }
        }
    };
    match matches.as_slice() {
        [candidate] => Ok(candidate.clone()),
        [] => anyhow::bail!(
            "SNAPBACK_ADMIN_LAN_INTERFACE_NOT_FOUND: no eligible up non-loopback non-virtual interface matched; candidates: {formatted}"
        ),
        _ => preferred_interface_address(&matches).ok_or_else(|| anyhow::anyhow!(
            "SNAPBACK_ADMIN_LAN_INTERFACE_AMBIGUOUS: choose --lan=<address|interface>; candidates: {}",
            format_lan_candidates(&matches)
        )),
    }
}

fn preferred_interface_address(candidates: &[LanCandidate]) -> Option<LanCandidate> {
    let interfaces = candidates
        .iter()
        .map(|candidate| candidate.interface.as_str())
        .collect::<BTreeSet<_>>();
    if interfaces.len() != 1 {
        return None;
    }
    candidates
        .iter()
        .find(|candidate| matches!(candidate.address, IpAddr::V4(_)))
        .or_else(|| candidates.first())
        .cloned()
}

fn format_lan_candidates(candidates: &[LanCandidate]) -> String {
    if candidates.is_empty() {
        return "none".to_owned();
    }
    candidates
        .iter()
        .map(|candidate| format!("{}={}", candidate.interface, candidate.address))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Clone, Debug)]
pub struct RelayObservation {
    pub peer: SocketAddr,
}

#[derive(Clone)]
struct RelayState {
    upstream_origin: Arc<str>,
    published_origin: Arc<str>,
    expected_host: Arc<str>,
    observations: mpsc::UnboundedSender<RelayObservation>,
}

pub struct LanRelay {
    pub origin: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<io::Result<()>>>,
}

impl LanRelay {
    pub async fn close(mut self) -> anyhow::Result<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(mut task) = self.task.take() {
            match tokio::time::timeout(crate::admin::CONSOLE_RELAY_LEASE_INTERVAL / 3, &mut task)
                .await
            {
                Ok(result) => result.map_err(|error| {
                    anyhow::anyhow!("SNAPBACK_ADMIN_LAN_RELAY_FAILED: {error}")
                })??,
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                }
            }
        }
        Ok(())
    }
}

impl Drop for LanRelay {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

pub async fn start_lan_relay(
    bind_address: IpAddr,
    upstream_origin: &str,
) -> anyhow::Result<(LanRelay, mpsc::UnboundedReceiver<RelayObservation>)> {
    anyhow::ensure!(
        usable_lan_address(bind_address),
        "SNAPBACK_ADMIN_LAN_WILDCARD_REFUSED: --lan may not bind a wildcard, loopback, or multicast address"
    );
    let upstream = validated_loopback_upstream(upstream_origin)?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(bind_address, 0))
        .await
        .map_err(|error| {
            anyhow::anyhow!(
                "SNAPBACK_ADMIN_LAN_BIND_FAILED: could not bind {bind_address}:0: {error}"
            )
        })?;
    let local_addr = listener.local_addr()?;
    let origin = socket_http_origin(local_addr);
    let expected_host = socket_authority(local_addr);
    let (observations, receiver) = mpsc::unbounded_channel();
    let state = RelayState {
        upstream_origin: Arc::from(upstream.into_boxed_str()),
        published_origin: Arc::from(origin.clone().into_boxed_str()),
        expected_host: Arc::from(expected_host.into_boxed_str()),
        observations,
    };
    let router = Router::new().fallback(any(relay_request)).with_state(state);
    let (shutdown, wait_for_shutdown) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = wait_for_shutdown.await;
        })
        .await
    });
    Ok((
        LanRelay {
            origin,
            shutdown: Some(shutdown),
            task: Some(task),
        },
        receiver,
    ))
}

async fn relay_request(
    State(state): State<RelayState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request<Body>,
) -> Response<Body> {
    match relay_request_inner(state, peer, request).await {
        Ok(response) => response,
        Err(refusal) => relay_refusal(refusal.status, refusal.code, refusal.message),
    }
}

#[derive(Debug)]
struct RelayRefusal {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl RelayRefusal {
    fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message,
        }
    }

    fn forbidden(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message,
        }
    }

    fn bad_gateway(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            code,
            message,
        }
    }
}

async fn relay_request_inner(
    state: RelayState,
    peer: SocketAddr,
    request: Request<Body>,
) -> Result<Response<Body>, RelayRefusal> {
    let (parts, body) = request.into_parts();
    if parts.method == Method::CONNECT {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_CONNECT_REFUSED",
            "CONNECT is not accepted by the admin relay",
        ));
    }
    if parts.uri.scheme().is_some() || parts.uri.authority().is_some() {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_TARGET_FORM_REFUSED",
            "the admin relay accepts origin-form request targets only",
        ));
    }
    if parts.headers.contains_key(header::TRANSFER_ENCODING)
        || parts.headers.get_all(header::CONTENT_LENGTH).iter().count() > 1
    {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_FRAMING_REFUSED",
            "ambiguous or transfer-coded request framing is not accepted",
        ));
    }
    reject_forwarding_headers(&parts.headers)?;
    if parts.headers.contains_key("x-snapback-admin-token")
        || parts.headers.contains_key(header::AUTHORIZATION)
    {
        // @ref LLP 0017#security-defaults — neither the master exchange route
        // nor either spelling of its durable bearer may transit the LAN relay.
        return Err(RelayRefusal::forbidden(
            "SNAPBACK_ADMIN_RELAY_MASTER_CREDENTIAL_REFUSED",
            "the master administrator credential may not transit the LAN relay",
        ));
    }
    let host = parts
        .headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !host.eq_ignore_ascii_case(&state.expected_host) {
        return Err(RelayRefusal {
            status: StatusCode::MISDIRECTED_REQUEST,
            code: "SNAPBACK_ADMIN_RELAY_HOST_REFUSED",
            message: "the request Host does not match this relay",
        });
    }
    let canonical_path = canonical_relay_path(&parts.uri)?;
    let websocket = websocket_upgrade(&parts.headers);
    if (state_changing(&parts.method) || websocket)
        && let Some(origin) = parts.headers.get(header::ORIGIN)
        && origin.to_str().ok() != Some(state.published_origin.as_ref())
    {
        return Err(RelayRefusal::forbidden(
            "SNAPBACK_ADMIN_RELAY_ORIGIN_REFUSED",
            "the request Origin does not match this relay",
        ));
    }
    let policy = relay_path_policy(&parts.method, &canonical_path, &parts.headers)?;
    if websocket {
        return Err(RelayRefusal {
            status: StatusCode::NOT_IMPLEMENTED,
            code: "SNAPBACK_ADMIN_RELAY_WEBSOCKET_UNAVAILABLE",
            message: "no admin WebSocket operation is registered on this path",
        });
    }
    let body = to_bytes(body, RELAY_MAX_BODY_BYTES).await.map_err(|_| {
        RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_BODY_REFUSED",
            "the relay request body was invalid or exceeded its bound",
        )
    })?;
    let response =
        forward_http_request(&state, &parts.method, &parts.uri, &parts.headers, body).await?;
    if policy == RelayPathPolicy::ClaimExchange && response.status().is_success() {
        let _ = state.observations.send(RelayObservation { peer });
    }
    Ok(response)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RelayPathPolicy {
    ConsoleStatic,
    ClaimExchange,
    CredentialApi,
    Preflight,
}

fn relay_path_policy(
    method: &Method,
    path: &str,
    headers: &HeaderMap,
) -> Result<RelayPathPolicy, RelayRefusal> {
    if path == RELAY_MASTER_EXCHANGE_PATH {
        return Err(RelayRefusal::forbidden(
            "SNAPBACK_ADMIN_RELAY_MASTER_ROUTE_REFUSED",
            "the master console-credential exchange is not published by the LAN relay",
        ));
    }
    if method == Method::OPTIONS
        && (path == RELAY_CLAIM_EXCHANGE_PATH || path.starts_with("/_snapback/api/"))
    {
        return Ok(RelayPathPolicy::Preflight);
    }
    if (path == "/_snapback/admin" || path.starts_with("/_snapback/admin/"))
        && matches!(*method, Method::GET | Method::HEAD)
    {
        return Ok(RelayPathPolicy::ConsoleStatic);
    }
    if path == RELAY_CLAIM_EXCHANGE_PATH && method == Method::POST {
        return Ok(RelayPathPolicy::ClaimExchange);
    }
    if path.starts_with("/_snapback/api/")
        && headers
            .get("x-snapback-console-credential")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("sbcc_") && value.len() > 5)
    {
        return Ok(RelayPathPolicy::CredentialApi);
    }
    Err(RelayRefusal::forbidden(
        "SNAPBACK_ADMIN_RELAY_ROUTE_REFUSED",
        "the request is outside the claim-console relay slice",
    ))
}

fn canonical_relay_path(uri: &axum::http::Uri) -> Result<String, RelayRefusal> {
    let path = uri.path();
    if !path.starts_with('/') || path.contains('\\') || path.contains("//") {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
            "the request path is not canonical",
        ));
    }
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(RelayRefusal::bad_request(
                    "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
                    "the request path contains invalid percent encoding",
                ));
            }
            let decoded = decode_hex(bytes[index + 1], bytes[index + 2]).ok_or_else(|| {
                RelayRefusal::bad_request(
                    "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
                    "the request path contains invalid percent encoding",
                )
            })?;
            if matches!(decoded, b'/' | b'\\' | b'.' | 0..=31 | 127) {
                return Err(RelayRefusal::bad_request(
                    "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
                    "encoded separators, dot segments, and controls are not accepted",
                ));
            }
            index += 3;
            continue;
        }
        index += 1;
    }
    if path.split('/').any(|segment| matches!(segment, "." | "..")) {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
            "dot segments are not accepted",
        ));
    }
    Ok(path.to_owned())
}

fn decode_hex(high: u8, low: u8) -> Option<u8> {
    fn nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }
    Some((nibble(high)? << 4) | nibble(low)?)
}

fn reject_forwarding_headers(headers: &HeaderMap) -> Result<(), RelayRefusal> {
    if headers.keys().any(|name| {
        let name = name.as_str();
        name == "forwarded"
            || name.starts_with("x-forwarded-")
            || matches!(
                name,
                "x-real-ip"
                    | "client-ip"
                    | "true-client-ip"
                    | "cf-connecting-ip"
                    | "x-envoy-external-address"
            )
    }) {
        return Err(RelayRefusal::bad_request(
            "SNAPBACK_ADMIN_RELAY_FORWARDING_HEADER_REFUSED",
            "client-supplied forwarding headers are not accepted",
        ));
    }
    Ok(())
}

fn websocket_upgrade(headers: &HeaderMap) -> bool {
    headers
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
}

fn state_changing(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

async fn forward_http_request(
    state: &RelayState,
    method: &Method,
    uri: &axum::http::Uri,
    headers: &HeaderMap,
    body: Bytes,
) -> Result<Response<Body>, RelayRefusal> {
    let target = format!(
        "{}{}",
        state.upstream_origin,
        uri.path_and_query()
            .map(|value| value.as_str())
            .unwrap_or("/")
    );
    let method = method.as_str().to_owned();
    let connection_tokens = connection_header_tokens(headers);
    let forwarded_headers = headers
        .iter()
        .filter_map(|(name, value)| {
            (!hop_by_hop_header(name, &connection_tokens) && name != header::ACCEPT_ENCODING)
                .then(|| Some((name.as_str().to_owned(), value.to_str().ok()?.to_owned())))?
        })
        .collect::<Vec<_>>();
    let body = body.to_vec();
    let upstream = tokio::task::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().redirects(0).build();
        let mut request = agent.request(&method, &target);
        for (name, value) in forwarded_headers {
            request = request.set(&name, &value);
        }
        let result = if body.is_empty() {
            request.call()
        } else {
            request.send_bytes(&body)
        };
        match result {
            Ok(response) => Ok(response),
            Err(ureq::Error::Status(_, response)) => Ok(response),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|_| {
        RelayRefusal::bad_gateway(
            "SNAPBACK_ADMIN_RELAY_UPSTREAM_FAILED",
            "the loopback admin upstream task failed",
        )
    })?
    .map_err(|_| {
        RelayRefusal::bad_gateway(
            "SNAPBACK_ADMIN_RELAY_UPSTREAM_FAILED",
            "the loopback admin upstream was unavailable",
        )
    })?;
    let status = StatusCode::from_u16(upstream.status()).map_err(|_| {
        RelayRefusal::bad_gateway(
            "SNAPBACK_ADMIN_RELAY_UPSTREAM_INVALID",
            "the loopback admin upstream returned an invalid status",
        )
    })?;
    let response_connection_tokens = upstream
        .headers_names()
        .into_iter()
        .filter(|name| name.eq_ignore_ascii_case("connection"))
        .filter_map(|name| upstream.header(&name))
        .flat_map(|value| value.split(','))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();
    let response_headers = upstream
        .headers_names()
        .into_iter()
        .filter_map(|name| {
            let parsed = HeaderName::from_bytes(name.as_bytes()).ok()?;
            if hop_by_hop_header(&parsed, &response_connection_tokens)
                || parsed == header::CONTENT_LENGTH
            {
                return None;
            }
            let value = HeaderValue::from_str(upstream.header(&name)?).ok()?;
            Some((parsed, value))
        })
        .collect::<Vec<_>>();
    let mut bytes = Vec::new();
    upstream
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|_| {
            RelayRefusal::bad_gateway(
                "SNAPBACK_ADMIN_RELAY_UPSTREAM_INVALID",
                "the loopback admin upstream response could not be read",
            )
        })?;
    let mut response = Response::builder()
        .status(status)
        .header(header::CONNECTION, "close")
        .body(Body::from(bytes))
        .expect("validated relay response parts");
    for (name, value) in response_headers {
        response.headers_mut().append(name, value);
    }
    Ok(response)
}

fn connection_header_tokens(headers: &HeaderMap) -> BTreeSet<String> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn hop_by_hop_header(name: &HeaderName, connection_tokens: &BTreeSet<String>) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-connection"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    ) || connection_tokens.contains(name.as_str())
}

fn relay_refusal(status: StatusCode, code: &'static str, message: &'static str) -> Response<Body> {
    let mut response = (
        status,
        axum::Json(serde_json::json!({
            "diagnostic": {
                "severity": "error",
                "code": code,
                "subsystem": "admin-relay",
                "message": message,
            }
        })),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

fn validated_loopback_upstream(origin: &str) -> anyhow::Result<String> {
    let uri = origin.parse::<axum::http::Uri>().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_LAN_TARGET_INVALID: the admin target is not an HTTP loopback origin"
        )
    })?;
    let host = uri
        .authority()
        .map(|authority| authority.host())
        .unwrap_or_default();
    let ip_host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || ip_host
            .parse::<IpAddr>()
            .ok()
            .is_some_and(|address| address.is_loopback());
    anyhow::ensure!(
        uri.scheme_str() == Some("http")
            && loopback
            && matches!(uri.path(), "" | "/")
            && uri.query().is_none(),
        "SNAPBACK_ADMIN_LAN_TARGET_INVALID: the admin target must be an HTTP loopback origin"
    );
    Ok(format!(
        "http://{}",
        uri.authority().expect("validated authority")
    ))
}

fn socket_authority(address: SocketAddr) -> String {
    match address.ip() {
        IpAddr::V4(ip) => format!("{ip}:{}", address.port()),
        IpAddr::V6(ip) => format!("[{ip}]:{}", address.port()),
    }
}

fn socket_http_origin(address: SocketAddr) -> String {
    format!("http://{}", socket_authority(address))
}

pub fn render_terminal_qr(value: &str) -> anyhow::Result<String> {
    // The QR input is the selected URL's exact UTF-8 bytes. No URL parsing,
    // normalization, or display escaping occurs between print and encoding.
    let code = QrCode::new(value.as_bytes()).map_err(|error| {
        anyhow::anyhow!("SNAPBACK_ADMIN_QR_ENCODING_FAILED: could not encode claim URL: {error}")
    })?;
    Ok(code.render::<unicode::Dense1x2>().quiet_zone(true).build())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TailscaleReceipt {
    version: u32,
    origin: String,
    host_port: String,
    path: String,
    proxy: String,
    owners: Vec<String>,
}

pub struct TailscaleGuard {
    receipt_path: PathBuf,
    lock_path: PathBuf,
    owner_path: PathBuf,
    owner_id: String,
    owner_file: Option<File>,
    receipt: TailscaleReceipt,
    closed: bool,
}

impl TailscaleGuard {
    pub fn origin(&self) -> &str {
        &self.receipt.origin
    }

    pub fn close(mut self) -> anyhow::Result<()> {
        self.cleanup()?;
        self.closed = true;
        Ok(())
    }

    fn cleanup(&mut self) -> anyhow::Result<()> {
        if self.closed {
            return Ok(());
        }
        let lock = open_locked_file(&self.lock_path)?;
        let Some(mut receipt) = read_tailscale_receipt(&self.receipt_path)? else {
            self.owner_file.take();
            let _ = std::fs::remove_file(&self.owner_path);
            drop(lock);
            self.closed = true;
            return Ok(());
        };
        anyhow::ensure!(
            receipt.version == self.receipt.version
                && receipt.origin == self.receipt.origin
                && receipt.host_port == self.receipt.host_port
                && receipt.path == self.receipt.path
                && receipt.proxy == self.receipt.proxy
                && receipt.owners.contains(&self.owner_id),
            "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID: invocation ownership is no longer recorded"
        );
        receipt.owners.retain(|owner| owner != &self.owner_id);
        self.owner_file.take();
        let _ = std::fs::remove_file(&self.owner_path);
        if receipt.owners.is_empty() {
            let status = tailscale_serve_status()?;
            if exact_tailscale_mapping(&status, &receipt) {
                let result = tailscale_command(&[
                    "serve",
                    &format!("--https={TAILSCALE_HTTPS_PORT}"),
                    &format!("--set-path={TAILSCALE_MOUNT_PATH}"),
                    "off",
                ]);
                if let Err(error) = result {
                    write_tailscale_receipt(&self.receipt_path, &receipt)?;
                    drop(lock);
                    return Err(error);
                }
            }
            let _ = std::fs::remove_file(&self.receipt_path);
        } else {
            write_tailscale_receipt(&self.receipt_path, &receipt)?;
        }
        drop(lock);
        self.closed = true;
        Ok(())
    }
}

impl Drop for TailscaleGuard {
    fn drop(&mut self) {
        if !self.closed
            && let Err(error) = self.cleanup()
        {
            eprintln!("SNAPBACK_ADMIN_TAILSCALE_CLEANUP_FAILED: {error}");
        }
    }
}

pub fn acquire_tailscale(
    upstream_origin: &str,
    receipt_dir_override: Option<&Path>,
) -> anyhow::Result<TailscaleGuard> {
    let proxy = validated_tailscale_upstream(upstream_origin)?;
    let (dns_name, _) = tailscale_identity_and_status()?;
    let origin = format!("https://{dns_name}");
    let host_port = format!("{dns_name}:{TAILSCALE_HTTPS_PORT}");
    let receipt_dir = receipt_dir_override
        .map(Path::to_path_buf)
        .or_else(|| std::env::var_os("SNAPBACK_ADMIN_TAILSCALE_RECEIPT_DIR").map(PathBuf::from))
        .unwrap_or_else(default_tailscale_receipt_dir);
    prepare_receipt_directory(&receipt_dir)?;
    let identity = tailscale_receipt_identity(&host_port);
    let receipt_path = receipt_dir.join(format!("{identity}.json"));
    let lock_path = receipt_dir.join(format!("{identity}.lock"));
    let lock = open_locked_file(&lock_path)?;
    let initial_serve_status = tailscale_serve_status()?;
    let mut receipt = read_tailscale_receipt(&receipt_path)?;
    if let Some(existing) = receipt.as_mut() {
        sweep_stale_tailscale_owners(&receipt_dir, existing)?;
        if existing.owners.is_empty() {
            if exact_tailscale_mapping(&initial_serve_status, existing) {
                tailscale_command(&[
                    "serve",
                    &format!("--https={TAILSCALE_HTTPS_PORT}"),
                    &format!("--set-path={TAILSCALE_MOUNT_PATH}"),
                    "off",
                ])?;
            }
            let _ = std::fs::remove_file(&receipt_path);
            receipt = None;
        }
    }
    let live_status = tailscale_serve_status()?;
    let mut receipt = if let Some(existing) = receipt {
        anyhow::ensure!(
            existing.version == TAILSCALE_RECEIPT_VERSION
                && existing.origin == origin
                && existing.host_port == host_port
                && existing.path == TAILSCALE_MOUNT_PATH
                && existing.proxy == proxy,
            "SNAPBACK_ADMIN_TAILSCALE_MAPPING_CONFLICT: a live Snapback receipt owns a different mapping"
        );
        anyhow::ensure!(
            exact_tailscale_mapping(&live_status, &existing),
            "SNAPBACK_ADMIN_TAILSCALE_MAPPING_MUTATED: the receipt-owned mapping changed outside Snapback"
        );
        existing
    } else {
        anyhow::ensure!(
            !tailscale_path_is_mapped(&live_status, &host_port, TAILSCALE_MOUNT_PATH),
            "SNAPBACK_ADMIN_TAILSCALE_MAPPING_CONFLICT: an operator-made mapping already owns https://{host_port}{TAILSCALE_MOUNT_PATH}"
        );
        let created = TailscaleReceipt {
            version: TAILSCALE_RECEIPT_VERSION,
            origin,
            host_port,
            path: TAILSCALE_MOUNT_PATH.to_owned(),
            proxy,
            owners: Vec::new(),
        };
        // The receipt is the Snapback ownership tag. Commit it before daemon
        // state so SIGKILL at any later point leaves a stale mapping the next
        // invocation can identify, compare, and sweep.
        write_tailscale_receipt(&receipt_path, &created)?;
        if let Err(error) = tailscale_command(&[
            "serve",
            "--bg",
            "--yes",
            &format!("--https={TAILSCALE_HTTPS_PORT}"),
            &format!("--set-path={TAILSCALE_MOUNT_PATH}"),
            &created.proxy,
        ]) {
            // The CLI can report failure after tailscaled committed the
            // mutation. Keep the ownership tag unless a fresh status read
            // proves the exact mapping was not installed, so the next
            // invocation can safely compare and sweep a crash remnant.
            if tailscale_serve_status()
                .is_ok_and(|status| !exact_tailscale_mapping(&status, &created))
            {
                let _ = std::fs::remove_file(&receipt_path);
            }
            return Err(error);
        }
        let after = tailscale_serve_status()?;
        anyhow::ensure!(
            exact_tailscale_mapping(&after, &created),
            "SNAPBACK_ADMIN_TAILSCALE_MAPPING_INVALID: tailscaled did not publish the exact tailnet-only /_snapback mapping"
        );
        created
    };
    let owner_id = uuid::Uuid::new_v4().simple().to_string();
    let owner_path = receipt_dir.join(format!("{identity}.owner-{owner_id}"));
    let owner_file = create_locked_owner_file(&owner_path)?;
    receipt.owners.push(owner_id.clone());
    receipt.owners.sort();
    receipt.owners.dedup();
    write_tailscale_receipt(&receipt_path, &receipt)?;
    drop(lock);
    Ok(TailscaleGuard {
        receipt_path,
        lock_path,
        owner_path,
        owner_id,
        owner_file: Some(owner_file),
        receipt,
        closed: false,
    })
}

fn validated_tailscale_upstream(origin: &str) -> anyhow::Result<String> {
    let uri = origin.parse::<axum::http::Uri>().map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_TAILSCALE_TARGET_UNSUPPORTED: target must be http://127.0.0.1:<port>"
        )
    })?;
    anyhow::ensure!(
        uri.scheme_str() == Some("http")
            && uri.authority().is_some_and(|authority| {
                authority.host() == "127.0.0.1" && authority.port_u16().is_some()
            })
            && matches!(uri.path(), "" | "/")
            && uri.query().is_none(),
        "SNAPBACK_ADMIN_TAILSCALE_TARGET_UNSUPPORTED: target must be http://127.0.0.1:<port>"
    );
    Ok(format!(
        "http://{}",
        uri.authority().expect("validated tailscale target")
    ))
}

fn tailscale_identity_and_status() -> anyhow::Result<(String, Value)> {
    let output = tailscale_command(&["status", "--json"])?;
    let status: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_TAILSCALE_STATUS_INVALID: tailscale status returned invalid JSON"
        )
    })?;
    anyhow::ensure!(
        status.get("BackendState").and_then(Value::as_str) == Some("Running"),
        "SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: tailscaled is not running"
    );
    let dns_name = status
        .pointer("/Self/DNSName")
        .and_then(Value::as_str)
        .map(|value| value.trim_end_matches('.'))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "SNAPBACK_ADMIN_TAILSCALE_STATUS_INVALID: tailscale status omitted Self.DNSName"
            )
        })?
        .to_ascii_lowercase();
    anyhow::ensure!(
        valid_dns_name(&dns_name),
        "SNAPBACK_ADMIN_TAILSCALE_STATUS_INVALID: tailscale status carried an invalid Self.DNSName"
    );
    Ok((dns_name, status))
}

fn valid_dns_name(value: &str) -> bool {
    value.len() <= 253
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && label.as_bytes().first() != Some(&b'-')
                && label.as_bytes().last() != Some(&b'-')
        })
}

fn tailscale_serve_status() -> anyhow::Result<Value> {
    let output = tailscale_command(&["serve", "status", "--json"])?;
    if output.stdout.is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_TAILSCALE_STATUS_INVALID: tailscale serve status returned invalid JSON"
        )
    })
}

fn tailscale_command(arguments: &[&str]) -> anyhow::Result<Output> {
    let mut child = Command::new("tailscale")
        .args(arguments)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                anyhow::anyhow!(
                    "SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: tailscale CLI/tailscaled is unavailable"
                )
            } else {
                anyhow::anyhow!("SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: {error}")
            }
        })?;
    let deadline = std::time::Instant::now() + TAILSCALE_COMMAND_TIMEOUT;
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!(
                "SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: tailscale {} timed out",
                arguments.join(" ")
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr)
            .split_whitespace()
            .take(24)
            .collect::<Vec<_>>()
            .join(" ");
        anyhow::bail!(
            "SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE: tailscale {} failed{}{}",
            arguments.join(" "),
            if detail.is_empty() { "" } else { ": " },
            detail
        );
    }
    Ok(output)
}

fn exact_tailscale_mapping(status: &Value, receipt: &TailscaleReceipt) -> bool {
    status
        .pointer(&format!(
            "/Web/{}/Handlers/{}/Proxy",
            json_pointer_escape(&receipt.host_port),
            json_pointer_escape(&receipt.path)
        ))
        .and_then(Value::as_str)
        == Some(receipt.proxy.as_str())
        && status
            .pointer(&format!("/TCP/{TAILSCALE_HTTPS_PORT}/HTTPS"))
            .and_then(Value::as_bool)
            == Some(true)
        && status
            .pointer(&format!(
                "/AllowFunnel/{}",
                json_pointer_escape(&receipt.host_port)
            ))
            .and_then(Value::as_bool)
            != Some(true)
}

fn tailscale_path_is_mapped(status: &Value, host_port: &str, path: &str) -> bool {
    if status
        .pointer(&format!(
            "/Web/{}/Handlers/{}",
            json_pointer_escape(host_port),
            json_pointer_escape(path)
        ))
        .is_some()
    {
        return true;
    }
    status
        .get("Foreground")
        .and_then(Value::as_object)
        .is_some_and(|foreground| {
            foreground
                .values()
                .any(|config| tailscale_path_is_mapped(config, host_port, path))
        })
}

fn json_pointer_escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn tailscale_receipt_identity(host_port: &str) -> String {
    let digest = Sha256::digest(format!("{host_port}\0{TAILSCALE_MOUNT_PATH}").as_bytes());
    digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn default_tailscale_receipt_dir() -> PathBuf {
    #[cfg(unix)]
    let suffix = unsafe { libc::geteuid() }.to_string();
    #[cfg(not(unix))]
    let suffix = std::process::id().to_string();
    std::env::temp_dir().join(format!("snapback-admin-tailscale-{suffix}"))
}

#[cfg(unix)]
fn prepare_receipt_directory(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
    if !path.exists() {
        std::fs::create_dir_all(path).with_context(|| {
            format!(
                "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_UNAVAILABLE: could not create {}",
                path.display()
            )
        })?;
    }
    let metadata = std::fs::symlink_metadata(path)?;
    let effective_uid = unsafe { libc::geteuid() };
    anyhow::ensure!(
        metadata.is_dir() && !metadata.file_type().is_symlink() && metadata.uid() == effective_uid,
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_UNAVAILABLE: receipt directory is not an owner-controlled directory"
    );
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn prepare_receipt_directory(_path: &Path) -> anyhow::Result<()> {
    anyhow::bail!(
        "SNAPBACK_ADMIN_TAILSCALE_HOST_UNSUPPORTED: owner-only receipt custody is unavailable on this host"
    )
}

#[cfg(unix)]
fn open_locked_file(path: &Path) -> anyhow::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| {
            anyhow::anyhow!(
                "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_UNAVAILABLE: could not open {}: {error}",
                path.display()
            )
        })?;
    crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
    fs2::FileExt::lock_exclusive(&file)?;
    Ok(file)
}

#[cfg(not(unix))]
fn open_locked_file(_path: &Path) -> anyhow::Result<File> {
    anyhow::bail!(
        "SNAPBACK_ADMIN_TAILSCALE_HOST_UNSUPPORTED: receipt locking is unavailable on this host"
    )
}

#[cfg(unix)]
fn create_locked_owner_file(path: &Path) -> anyhow::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
    fs2::FileExt::lock_exclusive(&file)?;
    Ok(file)
}

#[cfg(not(unix))]
fn create_locked_owner_file(_path: &Path) -> anyhow::Result<File> {
    anyhow::bail!(
        "SNAPBACK_ADMIN_TAILSCALE_HOST_UNSUPPORTED: receipt locking is unavailable on this host"
    )
}

fn read_tailscale_receipt(path: &Path) -> anyhow::Result<Option<TailscaleReceipt>> {
    let bytes = match crate::secure_file::read_strict_owner_only(path, TAILSCALE_RECEIPT_MAX_BYTES)
    {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(anyhow::anyhow!(
                "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID: {}: {error}",
                path.display()
            ));
        }
    };
    let receipt: TailscaleReceipt = serde_json::from_slice(&bytes).map_err(|_| {
        anyhow::anyhow!(
            "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID: {} is not valid receipt JSON",
            path.display()
        )
    })?;
    anyhow::ensure!(
        receipt.version == TAILSCALE_RECEIPT_VERSION,
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID: unsupported receipt version"
    );
    Ok(Some(receipt))
}

fn write_tailscale_receipt(path: &Path, receipt: &TailscaleReceipt) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(receipt)?;
    anyhow::ensure!(
        bytes.len() <= TAILSCALE_RECEIPT_MAX_BYTES,
        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_INVALID: receipt exceeds its byte bound"
    );
    let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    crate::secure_file::write_new_owner_only(&temporary, &bytes)?;
    let publication =
        std::fs::rename(&temporary, path).and_then(|()| crate::secure_file::sync_parent(path));
    if publication.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    publication?;
    Ok(())
}

fn sweep_stale_tailscale_owners(
    receipt_dir: &Path,
    receipt: &mut TailscaleReceipt,
) -> anyhow::Result<()> {
    let mut live = Vec::new();
    for owner in &receipt.owners {
        let path = receipt_dir.join(format!(
            "{}.owner-{owner}",
            tailscale_receipt_identity(&receipt.host_port)
        ));
        if let Some(file) = open_owner_for_sweep(&path)? {
            match fs2::FileExt::try_lock_exclusive(&file) {
                Ok(()) => {
                    let _ = fs2::FileExt::unlock(&file);
                    drop(file);
                    let _ = std::fs::remove_file(path);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => live.push(owner.clone()),
                Err(error) => {
                    return Err(anyhow::anyhow!(
                        "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_UNAVAILABLE: could not inspect owner lock: {error}"
                    ));
                }
            }
        }
    }
    receipt.owners = live;
    Ok(())
}

#[cfg(unix)]
fn open_owner_for_sweep(path: &Path) -> anyhow::Result<Option<File>> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let file = match OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    crate::secure_file::validate_strict_owner_only_descriptor(&file)?;
    Ok(Some(file))
}

#[cfg(not(unix))]
fn open_owner_for_sweep(_path: &Path) -> anyhow::Result<Option<File>> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_selection_refuses_wildcards_and_ambiguity() {
        let candidates = vec![
            LanCandidate {
                interface: "en0".to_owned(),
                address: "192.168.1.4".parse().unwrap(),
            },
            LanCandidate {
                interface: "en1".to_owned(),
                address: "10.0.0.4".parse().unwrap(),
            },
        ];
        assert!(
            select_lan_address(None, &candidates)
                .unwrap_err()
                .to_string()
                .contains("SNAPBACK_ADMIN_LAN_INTERFACE_AMBIGUOUS")
        );
        assert!(
            select_lan_address(Some("0.0.0.0"), &candidates)
                .unwrap_err()
                .to_string()
                .contains("SNAPBACK_ADMIN_LAN_WILDCARD_REFUSED")
        );
        assert_eq!(
            select_lan_address(Some("en0"), &candidates)
                .unwrap()
                .address,
            "192.168.1.4".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn relay_path_canonicalization_rejects_parser_disagreement_shapes() {
        for target in [
            "/_snapback%2fapi/inspect",
            "/_snapback/%2e%2e/app",
            "/_snapback/../app",
            "/_snapback//api/inspect",
            "/_snapback\\api\\inspect",
        ] {
            let uri = target.parse().unwrap();
            assert!(canonical_relay_path(&uri).is_err(), "accepted {target}");
        }
        assert_eq!(
            canonical_relay_path(&"/_snapback/api/data/a%20b?limit=1".parse().unwrap()).unwrap(),
            "/_snapback/api/data/a%20b"
        );
    }

    #[test]
    fn tailscale_mapping_parser_requires_exact_private_https_path() {
        let receipt = TailscaleReceipt {
            version: 1,
            origin: "https://node.example.ts.net".to_owned(),
            host_port: "node.example.ts.net:443".to_owned(),
            path: "/_snapback".to_owned(),
            proxy: "http://127.0.0.1:4287".to_owned(),
            owners: vec![],
        };
        let exact = serde_json::json!({
            "TCP": {"443": {"HTTPS": true}},
            "Web": {"node.example.ts.net:443": {"Handlers": {
                "/_snapback": {"Proxy": "http://127.0.0.1:4287"}
            }}}
        });
        assert!(exact_tailscale_mapping(&exact, &receipt));
        let mut funnel = exact.clone();
        funnel["AllowFunnel"] = serde_json::json!({"node.example.ts.net:443": true});
        assert!(!exact_tailscale_mapping(&funnel, &receipt));
    }

    #[test]
    fn qr_uses_the_selected_url_bytes_without_normalization() {
        let url = "http://192.168.1.4:49152/_snapback/admin/#claim=sbcl_Aa00";
        let rendered = render_terminal_qr(url).unwrap();
        assert!(rendered.contains(['▀', '▄', '█', ' ']));
        assert!(QrCode::new(url.as_bytes()).unwrap().width() > 0);
    }
}
