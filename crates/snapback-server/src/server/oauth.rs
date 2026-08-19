use super::*;
#[cfg(test)]
use crate::remainder_adapter::RemainderLocalSnapbackExt as _;

#[derive(Serialize)]
struct OAuthErrorBody<'a> {
    error: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

fn oauth_error_response(
    error: &'static str,
    description: &'static str,
    status: StatusCode,
) -> Response {
    (
        status,
        Json(OAuthErrorBody {
            error,
            error_description: Some(description),
            details: None,
        }),
    )
        .into_response()
}

fn oauth_snapback_error_response(error: SnapbackError) -> Response {
    let (wire, status) = match error.diagnostic.code.as_str() {
        "SNAPBACK_AUTH_OAUTH_INVALID_CLIENT"
        | "SNAPBACK_AUTH_INTEGRATION_SUSPENDED"
        | "SNAPBACK_AUTH_INTEGRATION_REVOKED"
        | "SNAPBACK_AUTH_INTEGRATION_UNAVAILABLE" => ("invalid_client", StatusCode::UNAUTHORIZED),
        "SNAPBACK_AUTH_OAUTH_SCOPE_INVALID" => ("invalid_scope", StatusCode::BAD_REQUEST),
        "SNAPBACK_AUTH_OAUTH_ACCESS_DENIED" => ("access_denied", StatusCode::FORBIDDEN),
        "SNAPBACK_AUTH_STEP_UP_REQUIRED" => ("access_denied", StatusCode::UNAUTHORIZED),
        "SNAPBACK_AUTH_OAUTH_GRANT_INVALID" => ("invalid_grant", StatusCode::BAD_REQUEST),
        "SNAPBACK_AUTH_OAUTH_UNAVAILABLE" => {
            ("temporarily_unavailable", StatusCode::SERVICE_UNAVAILABLE)
        }
        _ => ("invalid_request", StatusCode::BAD_REQUEST),
    };
    (
        status,
        Json(OAuthErrorBody {
            error: wire,
            error_description: Some("the OAuth request was refused"),
            details: Some(json!({ "code": error.diagnostic.code })),
        }),
    )
        .into_response()
}

fn oauth_not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

fn oauth_is_local(runtime: &AppState) -> bool {
    runtime.hosted_serving.is_none()
        && runtime.server.auth_deployment == crate::auth::deployment::AuthDeploymentTarget::Local
        && runtime
            .server
            .listener_transport_loopback()
            .unwrap_or(runtime.server.loopback)
}

async fn oauth_manifest(
    runtime: &AppState,
) -> Result<crate::contract_types::ApiOAuthManifest, Response> {
    if !oauth_is_local(runtime) {
        return Err(oauth_not_found());
    }
    if runtime.auth_mode_state().active != AuthMode::Sessions {
        return Err(oauth_not_found());
    }
    with_snapback(&runtime.snapback, |snapback| {
        snapback.served_schema_manifest().oauth_manifest().cloned()
    })
    .await
    .ok_or_else(oauth_not_found)
}

/// @ref LLP 0031#oauth-facade-and-origin-root-discovery — discovery and DCR
/// advertise the listener-owned origin; an untrusted request Host cannot mint
/// attacker-controlled OAuth endpoint URLs.
fn served_origin(runtime: &AppState) -> Result<String, Response> {
    runtime.server.listener_http_origin().ok_or_else(|| {
        oauth_error_response(
            "server_error",
            "the served origin is unavailable",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })
}

fn bundle_names(oauth: &crate::contract_types::ApiOAuthManifest) -> Vec<String> {
    oauth.bundles.keys().cloned().collect()
}

/// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — standards discovery is a no-store projection of the local facade only.
pub(super) async fn oauth_authorization_server_metadata(
    State(runtime): State<AppState>,
) -> Response {
    let oauth = match oauth_manifest(&runtime).await {
        Ok(oauth) => oauth,
        Err(response) => return response,
    };
    let origin = match served_origin(&runtime) {
        Ok(origin) => origin,
        Err(response) => return response,
    };
    Json(json!({
        "issuer": origin,
        "authorization_endpoint": format!("{origin}/auth/oauth/authorize"),
        "token_endpoint": format!("{origin}/auth/oauth/token"),
        "revocation_endpoint": format!("{origin}/auth/oauth/revoke"),
        "registration_endpoint": format!("{origin}/auth/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": bundle_names(&oauth),
    }))
    .into_response()
}

pub(super) async fn oauth_protected_resource_metadata(State(runtime): State<AppState>) -> Response {
    let oauth = match oauth_manifest(&runtime).await {
        Ok(oauth) => oauth,
        Err(response) => return response,
    };
    let origin = match served_origin(&runtime) {
        Ok(origin) => origin,
        Err(response) => return response,
    };
    Json(json!({
        "resource": origin,
        "authorization_servers": [origin],
        "bearer_methods_supported": ["header"],
        "scopes_supported": bundle_names(&oauth),
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OAuthRegistrationRequest {
    redirect_uris: Vec<String>,
    client_name: Option<String>,
    client_uri: Option<String>,
    token_endpoint_auth_method: Option<String>,
    invitation: Option<SecretInput>,
}

pub(super) async fn oauth_register(
    State(runtime): State<AppState>,
    Extension(route_admission): Extension<AdmissionLease>,
    headers: HeaderMap,
    input: Result<Json<OAuthRegistrationRequest>, JsonRejection>,
) -> Response {
    if oauth_manifest(&runtime).await.is_err() {
        return oauth_not_found();
    }
    if headers.contains_key(header::AUTHORIZATION) {
        return oauth_error_response(
            "invalid_request",
            "Authorization is not accepted at dynamic registration",
            StatusCode::BAD_REQUEST,
        );
    }
    let Json(input) = match input {
        Ok(input) => input,
        Err(_) => {
            return oauth_error_response(
                "invalid_client_metadata",
                "registration metadata is invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    let unique_redirects = input.redirect_uris.iter().collect::<BTreeSet<_>>();
    if input.redirect_uris.is_empty()
        || unique_redirects.len() != input.redirect_uris.len()
        || input
            .token_endpoint_auth_method
            .as_deref()
            .is_some_and(|method| method != "none")
        || input
            .redirect_uris
            .iter()
            .any(|uri| crate::storage::auth_integrations::validate_oauth_redirect_uri(uri).is_err())
    {
        return oauth_error_response(
            "invalid_redirect_uri",
            "redirect_uris must be exact HTTPS or loopback HTTP URIs",
            StatusCode::BAD_REQUEST,
        );
    }
    let (provider, policy) = match require_agent_registration_mode(&runtime).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    let invitation = match input
        .invitation
        .as_ref()
        .map(parse_creation_invitation)
        .transpose()
    {
        Ok(value) => value,
        Err(_) => {
            return oauth_error_response(
                "invalid_client_metadata",
                "the invitation is invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    let origin = match input.client_uri.as_ref() {
        Some(uri) => match uri.parse::<axum::http::Uri>().ok().and_then(|parsed| {
            Some(format!(
                "{}://{}",
                parsed.scheme_str()?,
                parsed.authority()?
            ))
        }) {
            Some(origin) => Some(origin),
            None => {
                return oauth_error_response(
                    "invalid_client_metadata",
                    "client_uri is invalid",
                    StatusCode::BAD_REQUEST,
                );
            }
        },
        None => None,
    };
    let profile = runtime.server.profile;
    let registration_provider = provider.clone();
    let redirects = input.redirect_uris.clone();
    let client_name = input.client_name.clone();
    let issued = with_snapback(&runtime.snapback, move |snapback| {
        snapback.register_oauth_client(
            &route_admission,
            policy.mode,
            invitation.as_ref(),
            client_name,
            crate::storage::auth_integrations::IntegrationRegistrationFacts {
                origin,
                redirect_uris: redirects,
            },
            profile,
            registration_provider.now_ms(),
            registration_provider.agent_random_source(),
        )
    })
    .await;
    let issued = match issued {
        Ok(issued) => issued,
        Err(error) => return oauth_snapback_error_response(error),
    };
    let principal = issued.user_id.clone();
    let record = with_snapback(&runtime.snapback, move |snapback| {
        snapback.integration_record_if_present(&principal)
    })
    .await;
    let record = match record {
        Ok(Some(record)) => record,
        _ => {
            return oauth_error_response(
                "server_error",
                "registration state is unavailable",
                StatusCode::INTERNAL_SERVER_ERROR,
            );
        }
    };
    let served_origin = match served_origin(&runtime) {
        Ok(origin) => origin,
        Err(response) => return response,
    };
    Json(json!({
        "client_id": record.integration_id,
        "client_id_issued_at": provider.now_ms() / 1_000,
        "client_name": input.client_name,
        "redirect_uris": input.redirect_uris,
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "authorization_endpoint": format!("{served_origin}/auth/oauth/authorize"),
        "token_endpoint": format!("{served_origin}/auth/oauth/token"),
    }))
    .into_response()
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OAuthAuthorizeRequest {
    response_type: String,
    client_id: String,
    redirect_uri: String,
    scope: String,
    state: Option<String>,
    code_challenge: String,
    code_challenge_method: String,
}

fn parse_scope(raw: &str) -> Result<Vec<String>, Response> {
    let names = raw
        .split_ascii_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let unique = names.iter().collect::<BTreeSet<_>>();
    if names.is_empty() || unique.len() != names.len() {
        Err(oauth_error_response(
            "invalid_scope",
            "scope must name unique bundles",
            StatusCode::BAD_REQUEST,
        ))
    } else {
        Ok(names)
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) async fn oauth_authorize_get(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    query: Result<Query<OAuthAuthorizeRequest>, QueryRejection>,
) -> Response {
    let oauth = match oauth_manifest(&runtime).await {
        Ok(oauth) => oauth,
        Err(response) => return response,
    };
    let query = match query {
        Ok(Query(query)) => query,
        Err(_) => {
            return oauth_error_response(
                "invalid_request",
                "authorization parameters are invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    if query.response_type != "code" || query.code_challenge_method != "S256" {
        return oauth_error_response(
            "unsupported_response_type",
            "only code with PKCE S256 is supported",
            StatusCode::BAD_REQUEST,
        );
    }
    let scopes = match parse_scope(&query.scope) {
        Ok(scopes) => scopes,
        Err(response) => return response,
    };
    if scopes
        .iter()
        .any(|scope| !oauth.bundles.contains_key(scope))
    {
        return oauth_error_response(
            "invalid_scope",
            "scope names an unknown bundle",
            StatusCode::BAD_REQUEST,
        );
    }
    let (user_id, _) = match require_grant_session(&authority) {
        Ok(session) => session,
        Err(error) => return error.into_response(),
    };
    let provider = match require_agent_routes_available(&runtime) {
        Ok(provider) => provider,
        Err(error) => return error.into_response(),
    };
    let request = query.clone();
    let effect_authority = authority.clone();
    let begun = with_snapback(&runtime.snapback, move |snapback| {
        snapback.begin_oauth_authorization(
            &effect_authority,
            &user_id,
            &request.client_id,
            &request.redirect_uri,
            &scopes,
            &request.code_challenge,
            request.state.as_deref(),
            provider.now_ms(),
            provider.agent_random_source(),
        )
    })
    .await;
    let begun = match begun {
        Ok(begun) => begun,
        Err(error) => return oauth_snapback_error_response(error),
    };
    let client = begun
        .client
        .display_name
        .as_deref()
        .unwrap_or(&begun.client.client_id);
    let bundle_list = begun
        .bundle_names
        .iter()
        .map(|scope| format!("<li>{}</li>", html_escape(scope)))
        .collect::<String>();
    let function_list = begun
        .scopes
        .iter()
        .map(|scope| {
            let step_up = if scope.authority_creating {
                " — fresh authentication required"
            } else {
                ""
            };
            format!(
                "<li><code>{} {}</code>{}</li>",
                html_escape(scope.kind.as_str()),
                html_escape(&scope.function_id),
                step_up,
            )
        })
        .collect::<String>();
    let document = format!(
        "<!doctype html><html><head><meta charset=utf-8><title>Authorize integration</title></head><body><main><h1>Authorize {}</h1><p>This integration requests these function bundles:</p><ul>{}</ul><p>They resolve to these exact current function scopes:</p><ul>{}</ul><form method=post action=/auth/oauth/authorize><input type=hidden name=request_id value=\"{}\"><label>Fresh-authentication challenge <input name=challenge_id autocomplete=off></label><label>Code <input name=code autocomplete=one-time-code></label><button name=decision value=approve type=submit>Approve</button><button name=decision value=deny type=submit>Deny</button></form></main></body></html>",
        html_escape(client),
        bundle_list,
        function_list,
        html_escape(&begun.request_id),
    );
    let mut response = Response::new(Body::from(document));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OAuthAuthorizeDecision {
    request_id: String,
    decision: String,
    challenge_id: Option<String>,
    code: Option<String>,
}

fn query_escape(raw: &str) -> String {
    let mut escaped = String::new();
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            escaped.push(byte as char);
        } else {
            escaped.push_str(&format!("%{byte:02X}"));
        }
    }
    escaped
}

fn redirect_with_params(base: &str, pairs: &[(&str, &str)]) -> Result<Response, Response> {
    let separator = if base.contains('?') { '&' } else { '?' };
    let query = pairs
        .iter()
        .map(|(key, value)| format!("{}={}", query_escape(key), query_escape(value)))
        .collect::<Vec<_>>()
        .join("&");
    let location = format!("{base}{separator}{query}");
    let header = HeaderValue::from_str(&location).map_err(|_| {
        oauth_error_response(
            "server_error",
            "redirect could not be encoded",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    })?;
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert(header::LOCATION, header);
    Ok(response)
}

pub(super) async fn oauth_authorize_post(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    form: Result<Form<OAuthAuthorizeDecision>, FormRejection>,
) -> Response {
    if oauth_manifest(&runtime).await.is_err() {
        return oauth_not_found();
    }
    let Form(form) = match form {
        Ok(form) => form,
        Err(_) => {
            return oauth_error_response(
                "invalid_request",
                "consent form is invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    let (user_id, session_id) = match require_grant_session(&authority) {
        Ok(session) => session,
        Err(error) => return error.into_response(),
    };
    let provider = match require_agent_routes_available(&runtime) {
        Ok(provider) => provider,
        Err(error) => return error.into_response(),
    };
    if form.decision == "deny" {
        let now_ms = provider.now_ms();
        let result = with_snapback(&runtime.snapback, move |snapback| {
            snapback.deny_oauth_authorization(&authority, &user_id, &form.request_id, now_ms)
        })
        .await;
        return match result {
            Ok(denied) => {
                let mut pairs = vec![("error", "access_denied")];
                if let Some(state) = denied.oauth_state.as_deref() {
                    pairs.push(("state", state));
                }
                match redirect_with_params(&denied.redirect_uri, &pairs) {
                    Ok(response) | Err(response) => response,
                }
            }
            Err(error) => oauth_snapback_error_response(error),
        };
    }
    if form.decision != "approve" {
        return oauth_error_response(
            "invalid_request",
            "decision must be approve or deny",
            StatusCode::BAD_REQUEST,
        );
    }
    let challenge_id = form.challenge_id.clone().filter(|value| !value.is_empty());
    let code = form.code.clone().filter(|value| !value.is_empty());
    let proof_admission = if let (Some(challenge_id), Some(code)) = (challenge_id, code) {
        let binding = match grant_step_up_binding(&authority, form.request_id.clone()) {
            Ok(binding) => binding,
            Err(error) => return error.into_response(),
        };
        let admission = provider.admit().await;
        let (admission, coordination) = with_snapback(&runtime.snapback, move |snapback| {
            let coordination =
                snapback.execute_auth_plan(admission.step_up_coordination_plan(&challenge_id));
            (admission, coordination)
        })
        .await;
        let coordination = match coordination {
            Ok(coordination) => coordination,
            Err(error) => return map_provider_error(error).into_response(),
        };
        match admission.for_step_up(coordination, binding, &code).await {
            Ok(proof) => Some(proof),
            Err(error) => return map_provider_error(error).into_response(),
        }
    } else {
        None
    };
    let request_id = form.request_id.clone();
    let approval_user = user_id.clone();
    let approval_session = session_id.clone();
    let now_ms = provider.now_ms();
    let approval_authority = authority.clone();
    let approval = with_snapback(&runtime.snapback, move |snapback| {
        snapback.approve_oauth_grant_request(
            &approval_authority,
            &approval_user,
            &approval_session,
            &request_id,
            proof_admission.as_ref().map(|proof| proof.proof()),
            now_ms,
        )
    })
    .await;
    if let Err(error) = approval {
        return oauth_snapback_error_response(error);
    }
    let request_id = form.request_id;
    let issued = with_snapback(&runtime.snapback, move |snapback| {
        snapback.issue_oauth_authorization_code(
            &authority,
            &user_id,
            &request_id,
            provider.now_ms(),
            provider.agent_random_source(),
        )
    })
    .await;
    let issued = match issued {
        Ok(issued) => issued,
        Err(error) => return oauth_snapback_error_response(error),
    };
    let mut pairs = vec![("code", issued.code.expose_secret())];
    if let Some(state) = issued.oauth_state.as_deref() {
        pairs.push(("state", state));
    }
    match redirect_with_params(&issued.redirect_uri, &pairs) {
        Ok(response) | Err(response) => response,
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OAuthTokenRequest {
    grant_type: String,
    code: String,
    redirect_uri: String,
    client_id: String,
    code_verifier: String,
}

struct OAuthTokenResponse {
    token: ScopedToken,
    expires_in: u64,
    scope: String,
}

impl Serialize for OAuthTokenResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("OAuthTokenResponse", 4)?;
        state.serialize_field("access_token", self.token.expose_secret())?;
        state.serialize_field("token_type", "Bearer")?;
        state.serialize_field("expires_in", &self.expires_in)?;
        state.serialize_field("scope", &self.scope)?;
        state.end()
    }
}

pub(super) async fn oauth_token(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    form: Result<Form<OAuthTokenRequest>, FormRejection>,
) -> Response {
    if oauth_manifest(&runtime).await.is_err() {
        return oauth_not_found();
    }
    if headers.contains_key(header::AUTHORIZATION) {
        return oauth_error_response(
            "invalid_client",
            "public clients do not authenticate at the token endpoint",
            StatusCode::UNAUTHORIZED,
        );
    }
    let Form(form) = match form {
        Ok(form) => form,
        Err(_) => {
            return oauth_error_response(
                "invalid_request",
                "token request is invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    if form.grant_type != "authorization_code" {
        return oauth_error_response(
            "unsupported_grant_type",
            "only authorization_code is supported",
            StatusCode::BAD_REQUEST,
        );
    }
    let provider = match require_agent_routes_available(&runtime) {
        Ok(provider) => provider,
        Err(error) => return error.into_response(),
    };
    let now_ms = provider.now_ms();
    let issued = with_snapback(&runtime.snapback, move |snapback| {
        snapback.mint_scoped_token_for_oauth_code(
            &form.code,
            &form.client_id,
            &form.redirect_uri,
            &form.code_verifier,
            now_ms,
            provider.agent_random_source(),
        )
    })
    .await;
    let issued = match issued {
        Ok(issued) => issued,
        Err(error) => return oauth_snapback_error_response(error),
    };
    if !issued.evicted_token_ids.is_empty() {
        let token_ids = issued.evicted_token_ids.clone();
        let lifecycle = runtime.auth_terminal_lifecycle.clone();
        let close_by = terminal_close_by(Instant::now());
        crate::exec_guard::run_or_defer_after_local(move || {
            lifecycle.evict_service_tokens(&token_ids, close_by)
        });
    }
    let grant_id = issued.grant_id.clone();
    let scope = with_snapback(&runtime.snapback, move |snapback| {
        snapback.oauth_bundle_names_for_grant(&grant_id)
    })
    .await
    .unwrap_or_default()
    .join(" ");
    Json(OAuthTokenResponse {
        token: issued.secret,
        expires_in: issued.expires_at_ms.saturating_sub(now_ms) / 1_000,
        scope,
    })
    .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OAuthRevokeRequest {
    token: String,
    revoke_grant: Option<bool>,
    token_type_hint: Option<String>,
}

pub(super) async fn oauth_revoke(
    State(runtime): State<AppState>,
    headers: HeaderMap,
    form: Result<Form<OAuthRevokeRequest>, FormRejection>,
) -> Response {
    if oauth_manifest(&runtime).await.is_err() {
        return oauth_not_found();
    }
    if headers.contains_key(header::AUTHORIZATION) {
        return oauth_error_response(
            "invalid_request",
            "the bearer to revoke belongs in the form body",
            StatusCode::BAD_REQUEST,
        );
    }
    let Form(form) = match form {
        Ok(form) => form,
        Err(_) => {
            return oauth_error_response(
                "invalid_request",
                "revocation request is invalid",
                StatusCode::BAD_REQUEST,
            );
        }
    };
    if form
        .token_type_hint
        .as_deref()
        .is_some_and(|hint| hint != "access_token")
    {
        return oauth_error_response(
            "unsupported_token_type",
            "only access_token is supported",
            StatusCode::BAD_REQUEST,
        );
    }
    let token = match ScopedToken::parse(&form.token) {
        Ok(token) => token,
        Err(_) => return StatusCode::OK.into_response(),
    };
    let provider = match require_agent_routes_available(&runtime) {
        Ok(provider) => provider,
        Err(_) => return StatusCode::OK.into_response(),
    };
    let result = with_snapback(&runtime.snapback, move |snapback| {
        snapback.oauth_revoke_scoped_token(
            &token,
            form.revoke_grant.unwrap_or(false),
            provider.now_ms(),
        )
    })
    .await;
    if let Ok(revocation) = result
        && !revocation.token_ids.is_empty()
    {
        let lifecycle = runtime.auth_terminal_lifecycle.clone();
        let close_by = terminal_close_by(Instant::now());
        crate::exec_guard::run_or_defer_after_local(move || {
            lifecycle.terminate_service_tokens(&revocation.token_ids, close_by)
        });
    }
    StatusCode::OK.into_response()
}
