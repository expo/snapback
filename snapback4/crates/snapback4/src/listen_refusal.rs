//! A taken port is a failed start that names its holder. Scripts that spawn
//! `dev` and then poll the port must not go on to talk to an older instance
//! (an orphan, or a sibling run) as if it were the server they just started.
use serde_json::Value as Json;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

/// The refusal for `bind:port` already in use, after asking the holder who it is.
pub(crate) fn in_use(bind: &str, port: u16, verb: &str) -> String {
    let holder = bind.parse::<IpAddr>().ok().map(|ip| match ip {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        ip => ip,
    }).filter(IpAddr::is_loopback).map(|ip| describe(SocketAddr::new(ip, port)));
    let (holder, pid) = holder.unwrap_or_else(|| ("another process".into(), None));
    let again = match verb { "serve" => format!("snapback4 serve <dir> --port {}", port.wrapping_add(1).max(1)), _ => format!("snapback4 {verb} --port {}", port.wrapping_add(1).max(1)) };
    format!("E_ADDRINUSE at {bind}:{port}: port {port} is already taken by {holder}; this {verb} did not start and served nothing.\n  rewrite: stop that process{} and rerun, or choose another port: {again} (--port 0 picks a free one; the URL is always stdout's first line)\n  find the holder: lsof -nP -iTCP:{port} -sTCP:LISTEN",
        pid.map(|pid| format!(" (kill {pid})")).unwrap_or_default())
}

/// Who answers on the port: a dev names its PID and project in `/dev/status`.
fn describe(address: SocketAddr) -> (String, Option<u64>) {
    match crate::verbs::run_forward::exchange(address, "GET", "/dev/status", None, "", Duration::from_secs(2)) {
        Ok((200, status)) => {
            let pid = status.get("pid").and_then(Json::as_u64);
            let project = status.get("project").and_then(Json::as_str).unwrap_or("an unnamed project");
            let store = if status.get("temporary") == Some(&Json::Bool(true)) { "a temporary store" } else { "its project store" };
            (format!("a running snapback4 dev{} serving {project} on {store}", pid.map(|p| format!(" (pid {p})")).unwrap_or_default()), pid)
        }
        Ok((status, _)) => (format!("a server that is not a snapback4 dev (GET /dev/status answered {status}; a snapback4 serve refuses that door)"), None),
        Err(_) => ("a process that does not answer GET /dev/status (not a snapback4 dev)".into(), None),
    }
}
