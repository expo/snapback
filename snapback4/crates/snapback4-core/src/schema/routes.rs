//! HTTP envelopes are bounded bytes, not data-program IR or SQL authority.
use super::{ActionSpec, WorkSpec};
use crate::ir::{ArgType, Expr, Program, ProgramKind, Stmt};
use crate::value::{Value, decode_bytes_hex, digest};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const BODY_BYTES: usize = 64 * 1024;
pub const HEADER_BYTES: usize = 16 * 1024;
pub const HEADER_COUNT: usize = 64;
pub const ENVELOPE_BYTES: u32 = 256 * 1024;
pub const ACTION_PREFIX: &str = "@route/";
fn default_wait() -> u64 { 5_000 }

// @ref LLP 3000.009#5.1 — declaration publishes a route; verified admission precedes its durable handler.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteSpec {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default)]
    pub work: WorkSpec,
    #[serde(default = "default_wait")]
    pub wait_ms: u64,
}

impl RouteSpec {
    pub fn validate(&self) -> Result<(), String> {
        validate_path(&self.path)?;
        if !(1..=25_000).contains(&self.wait_ms) { return Err("route wait is 1ms through 25s".into()); }
        if !self.work.policy.valid() { return Err("route work policy is outside its bounds".into()); }
        if self.service.as_ref().is_some_and(|service| !service.strip_prefix("service:").is_some_and(|name|
            !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))) {
            return Err("a provider route names an explicit service:<name> seat".into());
        }
        Ok(())
    }

    /// Private work is never a public action declaration or client operation.
    /// Even accidental insertion into the public program map cannot admit it.
    pub fn program(&self, name: &str) -> Program {
        Program { name: format!("{ACTION_PREFIX}{name}"), kind: ProgramKind::Action,
            args: BTreeMap::from([("request".into(), ArgType::Json { max_bytes: ENVELOPE_BYTES })]),
            read_time_granularity_ms: None, native: false,
            body: vec![Stmt::Require { condition: Expr::Literal(Value::Bool(false)), code: "E_ROUTE_PRIVATE".into(), site: None }] }
    }

    pub fn action_spec(&self) -> ActionSpec { ActionSpec { returns: None, work: self.work.clone() } }
    pub fn contract(&self, name: &str) -> String { digest(&("route:v1", name, self)) }
}

pub fn validate_path(path: &str) -> Result<(), String> {
    if path.len() > 256 || !path.starts_with('/') || path == "/" || path.ends_with('/')
        || path.split('/').skip(1).any(|part| part.is_empty() || matches!(part, "." | "..")
            || !part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))) {
        return Err("a route has a static absolute ASCII path without query, escapes, empty or dot segments".into());
    }
    let first = path.trim_start_matches('/').split('/').next().unwrap_or("");
    if matches!(first, "q" | "m" | "a" | "actions" | "effects" | "routes" | "assets" | "auth" | "dev" | "seed" | "sync" | "changes" | "schema" | "api.ts" | "native.wasm") {
        return Err("this route path belongs to a core HTTP endpoint".into());
    }
    Ok(())
}

/// Header spelling is the HTTP parser's normalized spelling. Only body bytes
/// are exact. Pairs retain multiplicity, including independent Set-Cookie.
pub type Headers = Vec<(String, String)>;

fn headers_valid(headers: &Headers, response: bool) -> Result<(), String> {
    if headers.len() > HEADER_COUNT || headers.iter().map(|(k, v)| k.len().saturating_add(v.len())).sum::<usize>() > HEADER_BYTES {
        return Err("route headers exceed 64 fields or 16 KiB".into());
    }
    for (name, value) in headers {
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || !value.bytes().all(|b| b == b'\t' || (b' '..=b'~').contains(&b)) {
            return Err("route headers need HTTP token names and printable ASCII values without newlines".into());
        }
        if response && matches!(name.to_ascii_lowercase().as_str(), "connection" | "content-length" | "transfer-encoding" | "keep-alive" | "upgrade" | "proxy-authenticate" | "proxy-authorization" | "te" | "trailer") {
            return Err("route responses cannot supply transport-owned headers".into());
        }
    }
    Ok(())
}

fn body_bytes(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > BODY_BYTES * 2 { return Err("a route body exceeds 64 KiB".into()); }
    decode_bytes_hex(encoded).ok_or_else(|| "route bytes use canonical lowercase base16".into())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouteRequest {
    pub method: String,
    pub path: String,
    pub headers: Headers,
    /// Same byte wire spelling as Quarry bytes; no extra codec dependency.
    pub body_hex: String,
}

impl RouteRequest {
    pub fn validate(&self, spec: &RouteSpec) -> Result<Vec<u8>, String> {
        spec.validate()?;
        if self.method != "POST" || self.path != spec.path { return Err("this request does not match its declared POST route".into()); }
        headers_valid(&self.headers, false)?;
        body_bytes(&self.body_hex)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RouteResponse {
    pub status: u16,
    pub headers: Headers,
    pub body_hex: String,
    /// Plain application GiveUp is recorded and acknowledged without exposing
    /// its text. Infrastructure refusals and parked steps never use this form.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_refusal: Option<String>,
}

impl RouteResponse {
    pub fn validate(&self) -> Result<Vec<u8>, String> {
        if !(200..=599).contains(&self.status) { return Err("a route response status is 200 through 599".into()); }
        headers_valid(&self.headers, true)?;
        let bytes = body_bytes(&self.body_hex)?;
        if matches!(self.status, 204 | 205 | 304) && !bytes.is_empty() { return Err("this response status cannot have a body".into()); }
        if let Some(message) = &self.application_refusal {
            if self.status != 204 || !self.headers.is_empty() || !bytes.is_empty() || message.len() > 2_000 {
                return Err("an acknowledged application refusal is a bare 204 and a bounded redacted reason".into());
            }
        }
        Ok(bytes)
    }
}
