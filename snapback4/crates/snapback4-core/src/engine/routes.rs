//! Authentication belongs to ingress; only verified, declared requests enter
//! durable work. Private route handlers then use exactly the action machinery.
use super::{Context, Engine, actions::{self, ActionRequest}};
use crate::{RuntimeError, identity, schema::{RouteSpec, routes::{ACTION_PREFIX, RouteRequest}}, wire};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const ID_PREFIX: &str = "route:v1:";
/// An ephemeral ingress id/fence uses the same OS randomness as action claims.
pub fn verification_token() -> Result<String, RuntimeError> { identity::claim_token() }
fn refused(code: &'static str, message: impl Into<String>) -> RuntimeError { RuntimeError::Structural { code, message: message.into() } }
fn unknown() -> RuntimeError { refused("E_ROUTE_UNKNOWN", "no declared route work is available under this authority") }
fn generation() -> RuntimeError { refused("E_ROUTE_GENERATION", "this route declaration changed; inspect admitted work instead of issuing replacement intent") }

fn declaration<'a>(engine: &'a Engine, name: &str, contract: &str) -> Result<&'a RouteSpec, RuntimeError> {
    let route = engine.schema.routes.get(name).ok_or_else(unknown)?;
    route.validate().map_err(|message| refused("E_ROUTE_INPUT", message))?;
    if route.contract(name) != contract { return Err(generation()); }
    Ok(route)
}

impl Engine {
    /// Capture before invoking the provider verifier, then require the same
    /// principal generation when that verifier returns. Verification is not
    /// authority to restore a revoked service seat.
    pub fn route_service_generation(&self, name: &str, contract: &str) -> Result<(String, i64), RuntimeError> {
        let principal = declaration(self, name, contract)?.service.clone().ok_or_else(unknown)?;
        let tx = self.store.authority_transaction()?;
        let generation = identity::principal_generation(&tx, &principal)?;
        tx.rollback()?;
        Ok((principal, generation))
    }

    pub fn request_session_route(&mut self, name: &str, contract: &str, envelope: &RouteRequest, context: Context) -> Result<(ActionRequest, bool), RuntimeError> {
        if declaration(self, name, contract)?.service.is_some() { return Err(unknown()); }
        if context.session_digest.is_none() && !context.viewer.starts_with("dev:") { return Err(RuntimeError::Auth("a session route requires a live session".into())); }
        self.admit_route(name, contract, envelope, context, None)
    }

    /// The trusted ingress host calls this only after its fenced verifier
    /// answered allow. No public action endpoint calls this method.
    // @ref LLP 3000.009#5.1 — route/body deduplication starts after provider authentication, before handler execution.
    pub fn request_verified_route(&mut self, name: &str, contract: &str, envelope: &RouteRequest, service_generation: i64, now: i64) -> Result<(ActionRequest, bool), RuntimeError> {
        let principal = declaration(self, name, contract)?.service.clone().ok_or_else(unknown)?;
        self.admit_route(name, contract, envelope, Context::new(principal, BTreeMap::new()).at(now), Some(service_generation))
    }

    fn admit_route(&mut self, name: &str, contract: &str, envelope: &RouteRequest, mut context: Context, service_generation: Option<i64>) -> Result<(ActionRequest, bool), RuntimeError> {
        let route = declaration(self, name, contract)?.clone();
        let body = envelope.validate(&route).map_err(|message| refused("E_ROUTE_INPUT", message))?;
        if context.viewer == crate::SYSTEM_PRINCIPAL || !crate::value::identity_fits(&context.viewer) { return Err(RuntimeError::Auth("a route needs a signed-in principal or its declared service seat".into())); }
        let now = context.now.unwrap_or_else(crate::now_ms);
        let tx = self.store.transaction()?;
        let scope = if let Some(expected) = service_generation {
            if route.service.as_deref() != Some(context.viewer.as_str()) || identity::principal_generation(&tx, &context.viewer)? != expected {
                return Err(RuntimeError::Auth("the service authority changed during route verification".into()));
            }
            // Do not re-key service work after a declaration/seat change.
            // Existing same-body work must refuse, not execute a second time.
            json!(["service"])
        } else if let Some(token) = &context.session_digest {
            let authority = identity::authority(&tx, token, &context.viewer, now)?;
            json!(["session", context.viewer, authority.family, authority.generation])
        } else { json!(["dev", context.viewer]) };
        let body_digest = format!("{:x}", Sha256::digest(&body));
        let id = format!("{ID_PREFIX}{}", crate::value::digest(&(name, scope, body_digest)));
        let program = route.program(name);
        if let Some(run) = actions::request(tx.conn(), &id)? {
            if run.action != program.name || run.contract.as_deref() != Some(contract) { return Err(generation()); }
            if run.principal != context.viewer || actions::authority_expiry(&tx, &run, now)?.is_none() { return Err(unknown()); }
            // Headers (e.g. fresh signatures/timestamps) are authentication
            // metadata, not a second intent. Retain the first admitted envelope.
            let previous = run.args.get("request").map(wire::to_json).ok_or_else(unknown)?;
            if previous.get("bodyHex").and_then(serde_json::Value::as_str) != Some(envelope.body_hex.as_str()) { return Err(crate::store::id_reused()); }
            tx.rollback()?;
            return Ok((run, true));
        }
        // Verification sees incoming credentials, but durable handlers receive
        // bound authority, not a reusable bearer/cookie copied into work storage.
        let mut retained = envelope.clone();
        retained.headers.retain(|(name, _)| !matches!(name.to_ascii_lowercase().as_str(), "authorization" | "proxy-authorization" | "cookie" | "x-snapback-persona"));
        let request = serde_json::to_value(retained).map_err(|_| refused("E_ROUTE_INPUT", "cannot encode route envelope"))?;
        context.args = BTreeMap::from([("request".into(), wire::untyped(&request).map_err(|message| refused("E_ROUTE_INPUT", message))?)]);
        let raw = json!({"request": request});
        if serde_json::to_vec(&context.args).map_err(|error| RuntimeError::Input(error.to_string()))?.len() as u64 > self.ceilings.heap_bytes {
            return Err(refused("E_ROUTE_INPUT", "the route envelope exceeds the engine heap bound"));
        }
        actions::insert_spec(&tx, &program, &id, &context, &raw, service_generation.is_some(), &route.action_spec(), contract, now)?;
        let run = actions::request(tx.conn(), &id)?.ok_or_else(unknown)?;
        tx.commit()?;
        Ok((run, false))
    }

    /// Collection checks both the currently declared route and the original
    /// authority. The HTTP host also checks its current caller/verified ticket.
    pub fn route_request_at(&self, name: &str, contract: &str, id: &str, principal: &str, now: i64) -> Result<ActionRequest, RuntimeError> {
        declaration(self, name, contract)?;
        let run = self.action_request_at(id, principal, now)?;
        if run.action != format!("{ACTION_PREFIX}{name}") || !id.starts_with(ID_PREFIX) { return Err(unknown()); }
        if run.contract.as_deref() != Some(contract) { return Err(generation()); }
        Ok(run)
    }
}
