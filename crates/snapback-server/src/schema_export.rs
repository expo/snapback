//! Schema registrations and route/schema projection owned by transport.

use serde_json::{Value, json};
use snapback_types::schema_export::{SchemaArtifact, finish, instance};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "inspect.admin.schema.json",
            schemars::schema_for!(crate::admin::AdminInspect),
        ),
        finish(
            "connection.grant.schema.json",
            schemars::schema_for!(crate::server::ConnectionGrant),
        ),
        finish(
            "connection.open.input.schema.json",
            schemars::schema_for!(crate::server::OpenConnectionRequest),
        ),
        finish(
            "authorized-lease.query.input.schema.json",
            schemars::schema_for!(crate::server::AuthorizedLeaseQueryRequest),
        ),
        finish(
            "authorized-lease.query.output.schema.json",
            schemars::schema_for!(crate::server::AuthorizedLeaseQueryResponse),
        ),
        finish(
            "error.response.schema.json",
            schemars::schema_for!(crate::server::ErrorResponse),
        ),
        finish(
            "mutation.output.schema.json",
            schemars::schema_for!(crate::server::MutationResponse),
        ),
        finish(
            "live.socket-client.sessions.schema.json",
            schemars::schema_for!(crate::server::SessionLiveSocketClientMessage),
        ),
    ]
}

pub fn artifact_instances() -> Vec<SchemaArtifact> {
    vec![instance("http.routes.v1.json", http_routes_artifact())]
}

/// Build the versioned route/schema join served to agents beside the Guide.
pub fn http_routes_artifact() -> Value {
    let mut routes = crate::server::route_registry();
    routes.sort_by(|left, right| {
        left.path
            .cmp(right.path)
            .then_with(|| left.method.cmp(right.method))
    });
    let routes = routes
        .into_iter()
        .map(|route| {
            let (input, output) = route_schema_refs(route.method, route.path);
            json!({
                "method": route.method,
                "path": route.path,
                "class": format!("{:?}", route.class),
                "path_policy": format!("{:?}", route.path_policy),
                "credential_resolution": format!("{:?}", route.credential_resolution),
                "inputSchema": input.map(schema_ref),
                "outputSchema": output.map(schema_ref),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "formatVersion": "snapback.http-routes.v1",
        "routes": routes,
    })
}

/// Project the exact first-party password/recovery app routes consumed by the
/// packaged Vite relay. Selection happens over `route_registry()` itself, so
/// adding or removing a server registration cannot require transcribing a
/// second method/path list in JavaScript.
///
/// @ref LLP 0031#enforcement — the installed router and every maintained
///   route projection share the same `RegisteredRoute` authority.
pub fn vite_first_party_auth_relay_routes_artifact() -> Value {
    let mut routes = crate::server::route_registry()
        .into_iter()
        .filter(|route| {
            route.class == crate::server::RouteClass::AppData
                && (route.path.starts_with("/auth/password/")
                    || route.path.starts_with("/auth/recovery/"))
        })
        .map(|route| {
            json!({
                "method": route.method,
                "path": route.path,
            })
        })
        .collect::<Vec<_>>();
    routes.sort_by(|left, right| {
        left["path"]
            .as_str()
            .cmp(&right["path"].as_str())
            .then_with(|| left["method"].as_str().cmp(&right["method"].as_str()))
    });
    json!({
        "formatVersion": "snapback.vite-first-party-auth-relay-routes.v1",
        "source": "snapback.server.route-registry.v1",
        "routes": routes,
    })
}

fn schema_ref(file: &str) -> Value {
    json!({ "$ref": file })
}

fn route_schema_refs(method: &str, path: &str) -> (Option<&'static str>, Option<&'static str>) {
    match (method, path) {
        ("GET", "/inspect") => (None, Some("inspect.public.schema.json")),
        ("GET", "/app-api/current") => (None, Some("app-api.discovery.schema.json")),
        ("GET", "/app-api/openapi.json" | "/app-api/agent-skill") => (None, None),
        ("POST" | "GET" | "DELETE", "/mcp") => (None, None),
        ("POST", "/api/v1/run" | "/api/v1/ask") => (None, None),
        (
            "POST" | "GET" | "DELETE",
            "/capability-links"
            | "/capability-links/{token}"
            | "/capability-links/{token}/invoke"
            | "/capability-links/{id}",
        ) => (None, None),
        (
            "POST" | "GET" | "DELETE",
            "/watches" | "/watches/{id}" | "/watches/{id}/suspend" | "/watches/{id}/resume",
        ) => (None, None),
        ("GET", "/auth/session") => (None, Some("auth.session.output.schema.json")),
        ("POST", "/auth/request-code") => (
            Some("auth.request-code.input.schema.json"),
            Some("auth.request-code.output.schema.json"),
        ),
        ("POST", "/auth/exchange") => (
            Some("auth.exchange.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/signup" | "/auth/password/signin") => (
            Some("auth.password-credential.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/change") => (
            Some("auth.password-change.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/reset") => (
            Some("auth.password-reset.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/recovery/consume") => (
            Some("auth.recovery-consume.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/recovery/rotate") => (
            Some("auth.empty.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/_snapback/api/auth/password/unlock") => (
            Some("auth.password-unlock.input.schema.json"),
            Some("auth.password-unlock.output.schema.json"),
        ),
        ("POST", "/_snapback/api/auth/password/attempt") => (
            Some("auth.password-attempt-admin.input.schema.json"),
            Some("auth.password-attempt-admin.output.schema.json"),
        ),
        ("POST", "/auth/integrations/retire") => (None, None),
        ("POST", "/query/{name}" | "/api/v1/query/{name}") => (
            Some("query.input.schema.json"),
            Some("query.output.schema.json"),
        ),
        ("POST", "/query/{name}/authorized-lease") => (
            Some("authorized-lease.query.input.schema.json"),
            Some("authorized-lease.query.output.schema.json"),
        ),
        ("POST", "/mutation/{name}" | "/api/v1/mutation/{name}") => (
            Some("mutation.input.schema.json"),
            Some("mutation.output.schema.json"),
        ),
        ("POST", "/action/{name}" | "/api/v1/action/{name}") => (
            Some("action.input.schema.json"),
            Some("action.output.schema.json"),
        ),
        ("POST", "/client-mutations/acknowledge") => (
            Some("client-mutation.ack.input.schema.json"),
            Some("client-mutation.ack.output.schema.json"),
        ),
        ("POST", "/client-mutations/identity-range") => (
            Some("operation.identity-range-request-v1.schema.json"),
            Some("operation.identity-range-response-v1.schema.json"),
        ),
        ("POST", "/app/bundle") => (
            Some("app.bundle.input.schema.json"),
            Some("app.bundle.output.schema.json"),
        ),
        ("POST", "/app/ensure") => (
            Some("app.ensure.input.schema.json"),
            Some("app.ensure.output.schema.json"),
        ),
        ("POST", "/connection/open") => (
            Some("connection.open.input.schema.json"),
            Some("connection.grant.schema.json"),
        ),
        ("POST", "/live/{name}/subscribe") => (
            Some("live.subscribe.input.schema.json"),
            Some("live.subscribe.output.schema.json"),
        ),
        ("POST", "/live/{name}/unsubscribe") => (
            Some("live.unsubscribe.input.schema.json"),
            Some("live.unsubscribe.output.schema.json"),
        ),
        ("POST", "/live/{name}/resume") => (
            Some("live.resume.input.schema.json"),
            Some("live.resume.output.schema.json"),
        ),
        ("GET", "/outbox/{connection_id}") => (None, Some("live.outbox-drain.output.schema.json")),
        ("POST", "/live/authorization-invalidation/acknowledge") => (
            Some("authorization-invalidation.ack.input.schema.json"),
            Some("authorization-invalidation.ack.output.schema.json"),
        ),
        ("POST", "/live/authorization-invalidation/manual-retry") => (
            Some("authorization-invalidation.manual-retry.input.schema.json"),
            Some("authorization-invalidation.manual-retry.output.schema.json"),
        ),
        ("POST", "/ephemeral/publish") => (
            Some("ephemeral.publish.input.schema.json"),
            Some("ephemeral.publish.output.schema.json"),
        ),
        ("POST", "/ephemeral/subscribe") => (
            Some("ephemeral.subscribe.input.schema.json"),
            Some("ephemeral.subscribe.output.schema.json"),
        ),
        ("POST", "/ephemeral/delete") => (
            Some("ephemeral.delete.input.schema.json"),
            Some("ephemeral.delete.output.schema.json"),
        ),
        ("GET", "/_snapback/api/inspect") => (None, Some("inspect.admin.schema.json")),
        ("GET", "/_snapback/api/control-catalog") => (None, Some("control-catalog.v1.schema.json")),
        (
            "POST",
            "/_snapback/api/auth/integrations/{id}/retire"
            | "/_snapback/api/auth/integrations/{id}/suspend"
            | "/_snapback/api/auth/integrations/{id}/resume",
        ) => (None, None),
        _ => (None, None),
    }
}
