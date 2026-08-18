use super::*;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_BODY_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Clone)]
struct Catalog {
    digest: String,
    canonical: String,
    operations: Vec<crate::api_envelope::AppApiOperationProjection>,
    functions: Vec<crate::manifest::FunctionDefinition>,
    oauth: Option<crate::contract_types::ApiOAuthManifest>,
    ask_enabled: bool,
}

#[derive(Clone)]
struct FunctionTool {
    tool_name: String,
    function_id: String,
    function_name: String,
    route_kind: &'static str,
    kind: FunctionKind,
    auth_requirement: String,
    args_schema: Value,
    exposed: bool,
}

pub(super) async fn stateless_method(State(runtime): State<AppState>) -> Response {
    if let Err(error) = load_catalog(&runtime).await {
        return error.into_response();
    }
    let mut response = StatusCode::METHOD_NOT_ALLOWED.into_response();
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static("POST"));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-transform"),
    );
    response
}

/// Stateless Streamable HTTP v1: one JSON-RPC message per POST and one JSON
/// or single-event SSE response. No `Mcp-Session-Id` is issued, so GET cannot
/// open a server stream and DELETE has no session to terminate.
///
/// @ref LLP 0204#d3--surface-2-the-mcp-server — the remote server
/// is envelope-derived and crosses the same authority gate as external HTTP.
pub(super) async fn post(
    State(runtime): State<AppState>,
    State(state): State<SharedSnapback>,
    State(read): State<crate::local::ReadLane>,
    Extension(authority): Extension<PreparedAuthority>,
    Extension(route): Extension<RouteSpec>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let catalog = match load_catalog(&runtime).await {
        Ok(catalog) => catalog,
        Err(error) => return error.into_response(),
    };
    let bytes = match body {
        Ok(bytes) => bytes,
        Err(error) => return ApiError::request_json_invalid(error.to_string()).into_response(),
    };
    let request: Value = match serde_json::from_slice(&bytes) {
        Ok(request) => request,
        Err(error) => return ApiError::request_json_invalid(error.to_string()).into_response(),
    };
    let Some(object) = request.as_object() else {
        return json_response(rpc_error(
            Value::Null,
            -32600,
            "JSON-RPC request must be an object",
            None,
        ));
    };
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return json_response(rpc_error(
            object.get("id").cloned().unwrap_or(Value::Null),
            -32600,
            "unsupported JSON-RPC version",
            None,
        ));
    }
    let id = object.get("id").cloned();
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return StatusCode::ACCEPTED.into_response();
    };
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = dispatch(
        &runtime, &state, &read, &authority, route, &catalog, &headers, method, params,
    )
    .await;
    let Some(id) = id else {
        return StatusCode::ACCEPTED.into_response();
    };
    let payload = match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => rpc_error(id, error.code, &error.message, error.data),
    };
    transport_response(&headers, payload)
}

struct RpcFailure {
    code: i64,
    message: String,
    data: Option<Value>,
}

impl RpcFailure {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: message.into(),
            data: None,
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: -32603,
            message: message.into(),
            data: None,
        }
    }
}

#[allow(clippy::too_many_arguments)] // Established RPC dispatch boundary; regrouping is out of scope here.
async fn dispatch(
    runtime: &AppState,
    state: &SharedSnapback,
    read: &crate::local::ReadLane,
    authority: &PreparedAuthority,
    route: RouteSpec,
    catalog: &Catalog,
    headers: &HeaderMap,
    method: &str,
    params: Value,
) -> Result<Value, RpcFailure> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": { "listChanged": false },
                "resources": { "subscribe": false, "listChanged": false }
            },
            "serverInfo": { "name": "snapback-app", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Tools are generated from the current exposed Snapback API envelope. run_code is target-conditional. When enabled, ask is a synchronous MCP tool over exposed queries only and carries the same authority, provider, and budget refusals as POST /api/v1/ask."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(tool_list(catalog, authority)),
        "tools/call" => {
            call_tool(
                runtime, state, read, authority, route, catalog, headers, params,
            )
            .await
        }
        "resources/list" => Ok(resource_list(catalog)),
        "resources/read" => read_resource(catalog, params),
        _ => Err(RpcFailure {
            code: -32601,
            message: format!("method not found: {method}"),
            data: None,
        }),
    }
}

async fn load_catalog(runtime: &AppState) -> Result<Catalog, ApiError> {
    let snapshot = with_snapback(&runtime.snapback, |snapback| {
        if !snapback.external_api_enabled() {
            return Err(SnapbackError::error(
                "SNAPBACK_API_NOT_ENABLED",
                "api",
                "the application has not enabled its external API surface",
            ));
        }
        let (digest, canonical) = snapback.current_app_api_envelope()?;
        Ok((
            digest,
            canonical,
            snapback.served_function_manifest().functions.clone(),
            snapback.api_oauth_manifest(),
            snapback.api_ask_manifest().is_some(),
        ))
    })
    .await?;
    let (envelope, actual_digest) = crate::api_envelope::parse_and_validate(snapshot.1.as_bytes())
        .map_err(|refusal| {
            ApiError::from(
                SnapbackError::error(
                    "SNAPBACK_APP_API_STATE_PARSE_FAILED",
                    "app-api",
                    "the current persisted envelope no longer passes admission",
                )
                .with_details(json!({
                    "envelopeCode": refusal.code,
                    "error": refusal.message,
                })),
            )
        })?;
    if actual_digest != snapshot.0 {
        return Err(SnapbackError::error(
            "SNAPBACK_APP_API_STATE_PARSE_FAILED",
            "app-api",
            "the current envelope digest changed while building the MCP catalog",
        )
        .into());
    }
    let operations = crate::api_envelope::projection_operations(&envelope).map_err(|refusal| {
        ApiError::from(
            SnapbackError::error(
                "SNAPBACK_APP_API_STATE_PARSE_FAILED",
                "app-api",
                "the current envelope operation projection is invalid",
            )
            .with_details(json!({
                "envelopeCode": refusal.code,
                "error": refusal.message,
            })),
        )
    })?;
    Ok(Catalog {
        digest: snapshot.0,
        canonical: snapshot.1,
        operations,
        functions: snapshot.2,
        oauth: snapshot.3,
        ask_enabled: snapshot.4,
    })
}

fn function_tools(catalog: &Catalog) -> Vec<FunctionTool> {
    let operations = catalog
        .operations
        .iter()
        .map(|operation| (operation.stable_id.as_str(), operation))
        .collect::<BTreeMap<_, _>>();
    let mut definitions = catalog.functions.iter().collect::<Vec<_>>();
    definitions.sort_by(|left, right| left.id.cmp(&right.id));
    let mut taken = BTreeSet::new();
    let mut tools = Vec::with_capacity(definitions.len());
    for definition in definitions {
        let tool_name = function_tool_name(&definition.id, &mut taken);
        let operation = operations.get(definition.id.as_str()).copied();
        let exposed = definition
            .api_exposure
            .as_ref()
            .is_some_and(|exposure| exposure.expose);
        let route_kind = match definition.kind {
            FunctionKind::Query | FunctionKind::LiveQuery => "query",
            FunctionKind::Mutation => "mutation",
            FunctionKind::Action => "action",
        };
        let auth_requirement = match definition.auth_requirement {
            Some(AuthRequirement::Public) => "public",
            Some(AuthRequirement::Authenticated) => "authenticated",
            Some(AuthRequirement::OptionalUser) | None => "optional-user",
        };
        tools.push(FunctionTool {
            tool_name,
            function_id: definition.id.clone(),
            function_name: definition.name.clone(),
            route_kind,
            kind: definition.kind.clone(),
            auth_requirement: auth_requirement.to_owned(),
            args_schema: operation
                .map(|operation| operation.args_schema.clone())
                .unwrap_or_else(|| json!({ "type": "object" })),
            exposed: exposed && operation.is_some(),
        });
    }
    tools
}

pub(super) fn function_tool_name(function_id: &str, taken: &mut BTreeSet<String>) -> String {
    let sanitized = function_id
        .chars()
        .map(|character| {
            let character = character.to_ascii_lowercase();
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let base = format!("snapback_fn_{sanitized}");
    if taken.insert(base.clone()) {
        return base;
    }
    use sha2::Digest as _;
    let suffix = format!("{:x}", sha2::Sha256::digest(function_id.as_bytes()));
    let collided = format!("{base}_{}", &suffix[..8]);
    taken.insert(collided.clone());
    collided
}

fn tool_list(catalog: &Catalog, _authority: &PreparedAuthority) -> Value {
    let mut tools = vec![
        json!({
            "name": "describe_api",
            "description": "Describe the current generated Snapback external API and discovery pointers.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "run_code",
            "description": "Submit a bounded TypeScript code-mode program against an exact envelope digest. Execution is per-target conditional on the evidenced untrusted-code profile; targets without it return SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED.",
            "inputSchema": {
                "type": "object",
                "required": ["program", "envelopeDigest"],
                "properties": {
                    "program": { "type": "string" },
                    "envelopeDigest": { "type": "string" },
                    "args": { "type": "object" }
                },
                "additionalProperties": false
            }
        }),
    ];
    if catalog.ask_enabled {
        tools.push(json!({
            "name": "ask",
            "description": "Run one host-budgeted, read-only near-data AI task over the exposed query catalog. MCP v1 returns the final envelope synchronously.",
            "inputSchema": {
                "type": "object",
                "required": ["task"],
                "properties": {
                    "task": { "type": "string" },
                    "resultSchema": { "type": "object" }
                },
                "additionalProperties": false
            }
        }));
    }
    tools.extend(
        function_tools(catalog)
            .into_iter()
            // Listing is the public envelope projection. Authority gates
            // calls, not discovery; an exposed authenticated function remains
            // discoverable to an anonymous client without becoming callable.
            .filter(|tool| tool.exposed)
            .map(|tool| {
                json!({
                    "name": tool.tool_name,
                    "description": format!(
                        "Invoke {} ({}) as a Snapback {} function; auth requirement: {}.",
                        tool.function_name,
                        tool.function_id,
                        tool.route_kind,
                        tool.auth_requirement,
                    ),
                    "inputSchema": {
                        "type": "object",
                        "required": ["args"],
                        "properties": { "args": tool.args_schema },
                        "additionalProperties": false
                    },
                    "_meta": { "snapback/functionId": tool.function_id }
                })
            }),
    );
    json!({
        "tools": tools,
        "_meta": {
            "snapback/envelopeDigest": catalog.digest,
            "snapback/ask": if catalog.ask_enabled { "enabled-synchronous" } else { "disabled-by-manifest" }
        }
    })
}

#[allow(clippy::too_many_arguments)] // Established RPC dispatch boundary; regrouping is out of scope here.
async fn call_tool(
    runtime: &AppState,
    state: &SharedSnapback,
    read: &crate::local::ReadLane,
    authority: &PreparedAuthority,
    route: RouteSpec,
    catalog: &Catalog,
    headers: &HeaderMap,
    params: Value,
) -> Result<Value, RpcFailure> {
    let object = params
        .as_object()
        .ok_or_else(|| RpcFailure::invalid("tools/call params must be an object"))?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcFailure::invalid("tools/call requires a tool name"))?;
    let arguments = object
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if name == "describe_api" {
        if arguments
            .as_object()
            .is_none_or(|arguments| !arguments.is_empty())
        {
            return Err(RpcFailure::invalid("describe_api accepts no arguments"));
        }
        return Ok(successful_tool_result(describe_api(catalog)));
    }
    if name == "run_code" {
        let manifest = super::current_target_capability_manifest(runtime).await;
        let response =
            ApiError::from(super::run_code_capability_refusal(&manifest)).into_response();
        return response_to_tool_result(response).await;
    }
    if name == "ask" {
        if !catalog.ask_enabled {
            let response = ApiError::from(SnapbackError::error(
                "SNAPBACK_API_ASK_DISABLED",
                "api",
                "ask is disabled because api.ask.enabled and its complete api.budgets.ask declaration are not active",
            ))
            .into_response();
            return response_to_tool_result(response).await;
        }
        let arguments = arguments
            .as_object()
            .ok_or_else(|| RpcFailure::invalid("ask arguments must be an object"))?;
        if arguments
            .keys()
            .any(|key| !matches!(key.as_str(), "task" | "resultSchema"))
        {
            return Err(RpcFailure::invalid(
                "ask accepts only task and resultSchema",
            ));
        }
        let task = arguments
            .get("task")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcFailure::invalid("ask requires a string task"))?
            .to_owned();
        let result_schema = arguments.get("resultSchema").cloned();
        if result_schema
            .as_ref()
            .is_some_and(|schema| !schema.is_object())
        {
            return Err(RpcFailure::invalid("ask resultSchema must be an object"));
        }
        let response = super::invoke_ask_core(
            runtime,
            state,
            authority,
            headers,
            super::ExternalAskRequest {
                task,
                result_schema,
                stream: Some(false),
            },
            true,
        )
        .await;
        return response_to_tool_result(response).await;
    }
    let tools = function_tools(catalog);
    let tool = tools
        .iter()
        .find(|tool| tool.tool_name == name)
        .ok_or_else(|| RpcFailure::invalid(format!("unknown tool: {name}")))?;
    let args = arguments
        .as_object()
        .and_then(|arguments| {
            (arguments.len() == 1 && arguments.contains_key("args"))
                .then(|| arguments.get("args").cloned())
                .flatten()
        })
        .ok_or_else(|| RpcFailure::invalid("function tools require exactly one `args` member"))?;
    let input = HandlerInput {
        args,
        ..HandlerInput::default()
    };
    let response = match tool.kind {
        FunctionKind::Query | FunctionKind::LiveQuery => {
            invoke_query(
                State(runtime.clone()),
                State(state.clone()),
                State(read.clone()),
                Extension(authority.clone()),
                Extension(route),
                Path(tool.function_name.clone()),
                Result::<_, JsonRejection>::Ok(Json(FiniteQueryRequest {
                    request: FunctionCallRequest {
                        input,
                        stream_connection_id: None,
                        expected_generation: None,
                    },
                    ..FiniteQueryRequest::default()
                })),
            )
            .await
        }
        FunctionKind::Mutation => {
            invoke_mutation(
                State(runtime.clone()),
                State(state.clone()),
                Extension(authority.clone()),
                Extension(route),
                None,
                Path(tool.function_name.clone()),
                Result::<_, JsonRejection>::Ok(Json(MutationRequest {
                    input,
                    expected_generation: None,
                    ..MutationRequest::default()
                })),
            )
            .await
        }
        FunctionKind::Action => invoke_action(
            State(runtime.clone()),
            State(state.clone()),
            HeaderMap::new(),
            Extension(authority.clone()),
            Extension(route),
            None,
            Path(tool.function_name.clone()),
            Result::<_, JsonRejection>::Ok(Json(FunctionCallRequest {
                input,
                stream_connection_id: None,
                expected_generation: None,
            })),
        )
        .await
        .into_response(),
    };
    response_to_tool_result(response).await
}

async fn response_to_tool_result(response: Response) -> Result<Value, RpcFailure> {
    let successful = response.status().is_success();
    let bytes = to_bytes(response.into_body(), MCP_BODY_LIMIT)
        .await
        .map_err(|error| {
            RpcFailure::internal(format!("function response could not be read: {error}"))
        })?;
    let body = serde_json::from_slice::<Value>(&bytes).map_err(|error| {
        RpcFailure::internal(format!("function response was not JSON: {error}"))
    })?;
    if successful {
        Ok(successful_tool_result(body))
    } else {
        Ok(json!({
            "content": [{ "type": "text", "text": serde_json::to_string(&body).unwrap_or_default() }],
            "structuredContent": { "error": body, "escalation": escalation_facts() },
            "isError": true
        }))
    }
}

pub(super) async fn pre_dispatch_tool_refusal(
    request: Option<&Value>,
    response: Response,
) -> Response {
    let Some(object) = request.and_then(Value::as_object) else {
        return response;
    };
    if object.get("method").and_then(Value::as_str) != Some("tools/call") {
        return response;
    }
    let Some(id) = object.get("id").cloned() else {
        return response;
    };
    let retry_after = response.headers().get(header::RETRY_AFTER).cloned();
    let body = match to_bytes(response.into_body(), MCP_BODY_LIMIT).await {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| json!({})),
        Err(_) => json!({}),
    };
    let result = json!({
        "content": [{ "type": "text", "text": serde_json::to_string(&body).unwrap_or_default() }],
        "structuredContent": { "error": body, "escalation": escalation_facts() },
        "isError": true
    });
    let mut wrapped = json_response(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    if let Some(retry_after) = retry_after {
        wrapped
            .headers_mut()
            .insert(header::RETRY_AFTER, retry_after);
    }
    wrapped
}

fn successful_tool_result(value: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string(&value).unwrap_or_default() }],
        "structuredContent": value,
        "isError": false
    })
}

fn describe_api(catalog: &Catalog) -> Value {
    json!({
        "envelopeDigest": catalog.digest,
        "current": "/app-api/current",
        "envelope": format!("/app-api/envelope/{}", catalog.digest),
        "openapi": "/app-api/openapi.json",
        "agentSkill": "/app-api/agent-skill",
        "mcp": "/mcp",
        "authorizationServer": "/.well-known/oauth-authorization-server",
        "protectedResource": "/.well-known/oauth-protected-resource",
        "runCode": {
            "path": "/api/v1/run",
            "conditionalOn": "evidenced untrusted-code target profile",
            "unsupportedCode": "SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED"
        },
        "transport": {
            "kind": "streamable-http",
            "stateless": true,
            "serverInitiatedStreams": false,
            "sessionId": null
        },
        "ask": if catalog.ask_enabled {
            json!({ "path": "/api/v1/ask", "mcpStreaming": false, "readOnly": true })
        } else {
            json!({ "enabled": false, "requires": ["api.ask.enabled", "api.budgets.ask"] })
        }
    })
}

fn escalation_facts() -> Value {
    json!({
        "describeTool": "describe_api",
        "authorizationServer": "/.well-known/oauth-authorization-server",
        "protectedResource": "/.well-known/oauth-protected-resource"
    })
}

fn resource_list(catalog: &Catalog) -> Value {
    let resources = [
        (
            "envelope",
            "Current Snapback API envelope",
            "application/json",
        ),
        (
            "openapi",
            "Current generated OpenAPI document",
            "application/json",
        ),
        (
            "agent-skill",
            "Current generated agent skill",
            "text/markdown",
        ),
    ]
    .into_iter()
    .map(|(kind, name, mime_type)| {
        json!({
            "uri": format!("snapback-app-api://{kind}/{}", catalog.digest),
            "name": name,
            "mimeType": mime_type
        })
    })
    .collect::<Vec<_>>();
    json!({ "resources": resources })
}

fn read_resource(catalog: &Catalog, params: Value) -> Result<Value, RpcFailure> {
    let uri = params
        .as_object()
        .and_then(|params| params.get("uri"))
        .and_then(Value::as_str)
        .ok_or_else(|| RpcFailure::invalid("resources/read requires a uri"))?;
    let envelope_uri = format!("snapback-app-api://envelope/{}", catalog.digest);
    let openapi_uri = format!("snapback-app-api://openapi/{}", catalog.digest);
    let skill_uri = format!("snapback-app-api://agent-skill/{}", catalog.digest);
    let (mime_type, text) = if uri == envelope_uri {
        ("application/json", catalog.canonical.clone())
    } else if uri == openapi_uri {
        let document = crate::api_envelope::compose_openapi_document_with_oauth(
            catalog.canonical.as_bytes(),
            catalog.oauth.as_ref(),
        )
        .map_err(|error| RpcFailure::internal(error.message))?;
        (
            "application/json",
            serde_json::to_string_pretty(&document)
                .map_err(|error| RpcFailure::internal(error.to_string()))?,
        )
    } else if uri == skill_uri {
        let skill = crate::api_envelope::compose_agent_skill_with_oauth(
            catalog.canonical.as_bytes(),
            catalog.oauth.is_some(),
        )
        .map_err(|error| RpcFailure::internal(error.message))?;
        ("text/markdown", skill)
    } else {
        return Err(RpcFailure::invalid("resource URI is not current"));
    };
    Ok(json!({
        "contents": [{ "uri": uri, "mimeType": mime_type, "text": text }]
    }))
}

pub(super) async fn require_mcp_origin(
    runtime: &AppState,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(());
    };
    if loopback_origin(Some(origin)).is_some() {
        return Ok(());
    }
    let candidate = origin.to_str().ok();
    let origins = with_snapback(&runtime.snapback, |snapback| {
        Ok::<_, SnapbackError>(snapback.api_origins())
    })
    .await?;
    if candidate.is_some_and(|candidate| {
        origins
            .as_ref()
            .is_some_and(|origins| origins.iter().any(|origin| origin == candidate))
    }) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_API_EXPOSURE_DENIED",
        "api",
        "the MCP Origin header is not a declared API origin",
    )
    .with_details(json!({ "originAllowed": false }))
    .into())
}

fn rpc_error(id: Value, code: i64, message: &str, data: Option<Value>) -> Value {
    let mut error = json!({ "code": code, "message": message });
    if let Some(data) = data {
        error["data"] = data;
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error })
}

fn json_response(payload: Value) -> Response {
    transport_response(&HeaderMap::new(), payload)
}

fn transport_response(headers: &HeaderMap, payload: Value) -> Response {
    let wants_sse = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| {
            accept.contains("text/event-stream") && !accept.contains("application/json")
        });
    let body = serde_json::to_string(&payload).unwrap_or_else(|_| {
        "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,\"message\":\"response serialization failed\"}}".to_owned()
    });
    let (content_type, body) = if wants_sse {
        (
            "text/event-stream; charset=utf-8",
            format!("event: message\ndata: {body}\n\n"),
        )
    } else {
        ("application/json; charset=utf-8", body)
    };
    let mut response = Response::new(Body::from(body));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-transform"),
    );
    response.headers_mut().insert(
        HeaderName::from_static("mcp-protocol-version"),
        HeaderValue::from_static(MCP_PROTOCOL_VERSION),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_tool_names_are_sanitized_and_collisions_remain_reversible() {
        let mut taken = BTreeSet::new();
        assert_eq!(
            function_tool_name("fn:List-Items", &mut taken),
            "snapback_fn_fn_list_items"
        );
        assert!(
            function_tool_name("fn/List Items", &mut taken)
                .starts_with("snapback_fn_fn_list_items_")
        );
    }
}
