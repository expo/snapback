//! Read-only near-data AI provider protocol and provenance receipts.
//!
//! The module deliberately owns no caller authority and no database access.
//! The server loop invokes catalog queries through the ordinary invocation
//! gate, then gives this module only bounded tool/result JSON.

use crate::config::SecretRedactor;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use hmac::{Hmac, Mac as _};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::Sha256;
use std::net::IpAddr;
use std::time::Duration;
use zeroize::{Zeroize, Zeroizing};

pub const PROVIDER_KEY_HEADER: &str = "x-snapback-ask-provider-key";
pub const FINAL_TOOL_NAME: &str = "snapback_final_answer";
pub const RESULT_SCHEMA_RETRY_CAP: u64 = 2;
const PROVIDER_RESPONSE_MAX_BYTES: usize = 4 * 1024 * 1024;
const PROVIDER_ENDPOINT_MAX_BYTES: usize = 4_096;

#[derive(Clone, Debug)]
pub struct QueryTool {
    pub tool_name: String,
    pub function_name: String,
    pub args_schema: Value,
}

#[derive(Clone, Debug)]
pub struct ProviderConfig {
    pub identity: String,
    pub base_url: String,
    pub model: String,
    target_policy: crate::outbound_policy::HttpTargetPolicy,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenAccounting {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub estimated: bool,
}

#[derive(Clone, Debug)]
pub struct ProviderTurn {
    pub message: Value,
    pub tool_calls: Vec<ProviderToolCall>,
    pub content: Option<String>,
    pub tokens: TokenAccounting,
}

#[derive(Clone, Debug)]
pub struct ProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallReceipt {
    pub function: String,
    pub args_digest: String,
    pub result_digest: String,
}

pub struct ReceiptKey([u8; 32]);

impl Drop for ReceiptKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl ReceiptKey {
    pub fn generate() -> SnapbackResult<Self> {
        let mut key = [0_u8; 32];
        getrandom::fill(&mut key).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_API_ASK_RECEIPT_KEY_UNAVAILABLE",
                "api",
                "the ask provenance key could not be generated",
            )
        })?;
        Ok(Self(key))
    }

    /// Domain-separated keyed commitment. It is provenance, not proof: the
    /// receipt attests which host calls were observed, not derivation of the
    /// model's final answer.
    ///
    /// @ref LLP 0062#3-code-mode — per-run HMAC value minimization.
    /// @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — retained call
    /// values are commitments, never raw authorized data.
    pub fn digest(&self, domain: &[u8], value: &Value) -> SnapbackResult<String> {
        let canonical = crate::rqs_contract::jcs(value).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_API_ASK_RECEIPT_INVALID",
                "api",
                "an ask call value could not be canonically committed",
            )
        })?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.0).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_API_ASK_RECEIPT_INVALID",
                "api",
                "the ask provenance commitment could not be initialized",
            )
        })?;
        mac.update(b"snapback.ask.provenance.v1\0");
        mac.update(domain);
        mac.update(&(canonical.len() as u64).to_be_bytes());
        mac.update(canonical.as_bytes());
        Ok(format!("hmac-sha256:{:x}", mac.finalize().into_bytes()))
    }
}

pub fn parse_provider(provider: &str, model: &str) -> SnapbackResult<ProviderConfig> {
    let base_url = if provider == "openai-compatible" {
        "https://api.openai.com/v1".to_owned()
    } else if let Some(value) = provider.strip_prefix("openai-compatible:") {
        value.trim_end_matches('/').to_owned()
    } else {
        return Err(SnapbackError::error(
            "SNAPBACK_API_ASK_PROVIDER_UNSUPPORTED",
            "api",
            "v1 supports only the openai-compatible provider class",
        )
        .with_details(json!({ "provider": provider, "supported": ["openai-compatible"] })));
    };
    let parsed = ureq::get(&base_url)
        .request_url()
        .map_err(|_| provider_invalid())?;
    let url = parsed.as_url();
    let host = parsed.host().trim_start_matches('[').trim_end_matches(']');
    let literal = host.parse::<IpAddr>().ok();
    // @ref LLP 0251#consumerprofile-contract — only this crate's unit-test
    // build can mint Ask's loopback HTTP capability; manifests and runtime
    // configuration have no switch that enables it in a served binary.
    let test_loopback_http = cfg!(test)
        && parsed.scheme() == "http"
        && literal.is_some_and(|address| address.is_loopback());
    if (parsed.scheme() != "https" && !test_loopback_http)
        || host.is_empty()
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || literal.is_some_and(|address| {
            !crate::outbound_policy::is_public_ip(address) && !test_loopback_http
        })
        || model.is_empty()
    {
        return Err(provider_invalid());
    }
    Ok(ProviderConfig {
        // The configured base is part of provider identity. The bare class
        // remains the stable identity for the default OpenAI endpoint.
        identity: provider.to_owned(),
        base_url,
        model: model.to_owned(),
        target_policy: if test_loopback_http {
            crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp
        } else {
            crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly
        },
    })
}

fn provider_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_ASK_PROVIDER_INVALID",
        "api",
        "the declared openai-compatible provider must carry an HTTPS base URL (HTTP is allowed only for loopback tests) and a model",
    )
}

pub fn provider_tools(queries: &[QueryTool], result_schema: Option<&Value>) -> Vec<Value> {
    let mut tools = queries
        .iter()
        .map(|query| {
            json!({
                "type": "function",
                "function": {
                    "name": query.tool_name,
                    "description": format!("Read application data through the exposed query {}. Mutations and actions are unavailable in ask v1.", query.function_name),
                    "parameters": query.args_schema,
                }
            })
        })
        .collect::<Vec<_>>();
    let parameters = result_schema.cloned().unwrap_or_else(|| {
        json!({
            "type": "object",
            "required": ["answer"],
            "properties": { "answer": { "type": "string" } },
            "additionalProperties": false
        })
    });
    tools.push(json!({
        "type": "function",
        "function": {
            "name": FINAL_TOOL_NAME,
            "description": "Return the final answer. Calling this tool terminates the read-only ask loop.",
            "parameters": parameters
        }
    }));
    tools
}

/// @ref LLP 0009#capability-model — provider HTTP remains behind the explicit outbound
///   action switch and a manifest-selected destination.
/// @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — v1 admits one
///   OpenAI-compatible provider class and never echoes provider response bytes.
pub async fn chat_completion(
    config: ProviderConfig,
    key: Zeroizing<String>,
    redactor: SecretRedactor,
    messages: Vec<Value>,
    tools: Vec<Value>,
    remaining_tokens: u64,
    timeout: Duration,
) -> SnapbackResult<ProviderTurn> {
    tokio::task::spawn_blocking(move || {
        if !crate::runtime::outbound_actions_enabled() {
            return Err(SnapbackError::error(
                "SNAPBACK_API_ASK_EGRESS_DISABLED",
                "api",
                "ask provider egress is disabled; set SNAPBACK_OUTBOUND_ACTIONS=1 for this target",
            ));
        }
        let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
        let target_policy = config.target_policy;
        let body = json!({
            "model": config.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "max_tokens": remaining_tokens,
        });
        let request_bytes = serde_json::to_vec(&body)
            .map_err(|_| upstream_invalid())?
            .len();
        // @ref LLP 0251#canonical-admission-algorithm — resolve/classify and
        // pin the exact manifest-selected authority before the caller bearer
        // materializes; the shared agent also refuses redirects and env proxies.
        let prepared_target = crate::outbound_policy::prepare_http_target(
            &endpoint,
            target_policy,
            PROVIDER_ENDPOINT_MAX_BYTES,
        )
        .map_err(|_| upstream_failed("provider destination refused".to_owned()))?;
        let agent = crate::outbound_policy::pinned_http_agent(&prepared_target, timeout)
            .map_err(|_| upstream_failed("provider destination refused".to_owned()))?;
        let response = agent
            .post(prepared_target.authored_url())
            .timeout(timeout)
            .set("authorization", &format!("Bearer {}", key.as_str()))
            .set("content-type", "application/json")
            .send_json(body);
        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(status, _)) => {
                return Err(upstream_failed(format!("provider returned HTTP {status}")));
            }
            Err(ureq::Error::Transport(error)) => {
                let reason = bounded_reason(&redactor.redact_text(&error.to_string()));
                return Err(upstream_failed(reason));
            }
        };
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take((PROVIDER_RESPONSE_MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                upstream_failed(bounded_reason(&redactor.redact_text(&error.to_string())))
            })?;
        if bytes.len() > PROVIDER_RESPONSE_MAX_BYTES {
            return Err(upstream_failed(
                "provider response exceeded 4 MiB".to_owned(),
            ));
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| upstream_invalid())?;
        parse_provider_turn(value, request_bytes, bytes.len())
    })
    .await
    .map_err(|_| upstream_failed("provider worker failed".to_owned()))?
}

fn parse_provider_turn(
    value: Value,
    request_bytes: usize,
    response_bytes: usize,
) -> SnapbackResult<ProviderTurn> {
    let message = value
        .pointer("/choices/0/message")
        .cloned()
        .ok_or_else(upstream_invalid)?;
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .map(|call| {
                    Ok(ProviderToolCall {
                        id: call
                            .get("id")
                            .and_then(Value::as_str)
                            .ok_or_else(upstream_invalid)?
                            .to_owned(),
                        name: call
                            .pointer("/function/name")
                            .and_then(Value::as_str)
                            .ok_or_else(upstream_invalid)?
                            .to_owned(),
                        arguments: call
                            .pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .ok_or_else(upstream_invalid)?
                            .to_owned(),
                    })
                })
                .collect::<SnapbackResult<Vec<_>>>()
        })
        .transpose()?
        .unwrap_or_default();
    let usage = value.get("usage").and_then(Value::as_object);
    let prompt = usage
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(Value::as_u64);
    let completion = usage
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(Value::as_u64);
    let total = usage
        .and_then(|usage| usage.get("total_tokens"))
        .and_then(Value::as_u64);
    let estimated = prompt.is_none() || completion.is_none() || total.is_none();
    let estimate = ((request_bytes + response_bytes) as u64).div_ceil(4);
    let prompt_tokens = prompt.unwrap_or_else(|| (request_bytes as u64).div_ceil(4));
    let completion_tokens = completion.unwrap_or_else(|| (response_bytes as u64).div_ceil(4));
    let total_tokens = total
        .unwrap_or(estimate)
        .max(prompt_tokens.saturating_add(completion_tokens));
    Ok(ProviderTurn {
        message,
        tool_calls,
        content,
        tokens: TokenAccounting {
            prompt_tokens,
            completion_tokens,
            total_tokens,
            estimated,
        },
    })
}

pub fn validate_result(schema: &Value, result: &Value) -> SnapbackResult<()> {
    let schema = schema.as_object().ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID",
            "api",
            "resultSchema must be a JSON Schema object",
        )
    })?;
    let schema_value = Value::Object(schema.clone());
    if has_external_schema_reference(&schema_value) {
        return Err(SnapbackError::error(
            "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID",
            "api",
            "resultSchema references must remain within the caller-supplied schema",
        ));
    }
    let validator = jsonschema::validator_for(&schema_value).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID",
            "api",
            "resultSchema is not a valid supported JSON Schema",
        )
    })?;
    validator.validate(result).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH",
            "api",
            "the provider final answer did not satisfy resultSchema",
        )
    })
}

fn has_external_schema_reference(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(has_external_schema_reference),
        Value::Object(fields) => fields.iter().any(|(name, value)| {
            (matches!(name.as_str(), "$ref" | "$dynamicRef")
                && value
                    .as_str()
                    .is_some_and(|reference| !reference.starts_with('#')))
                || has_external_schema_reference(value)
        }),
        _ => false,
    }
}

fn bounded_reason(reason: &str) -> String {
    reason.chars().take(256).collect()
}

fn upstream_failed(reason: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_ASK_UPSTREAM_FAILED",
        "api",
        "the configured ask provider failed",
    )
    .with_details(json!({ "reason": bounded_reason(&reason) }))
}

fn upstream_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_ASK_UPSTREAM_INVALID",
        "api",
        "the configured ask provider returned an invalid chat-completions response",
    )
}

use std::io::Read as _;

#[cfg(test)]
mod tests {
    use super::*;

    fn serve_one_json(
        listener: std::net::TcpListener,
        body: Value,
    ) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            use std::io::{Read as _, Write as _};

            let (mut socket, _) = listener.accept().expect("accept credentialed request");
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("bound credentialed request read");
            let mut bytes = Vec::new();
            let mut chunk = [0_u8; 4_096];
            let (header_end, content_length) = loop {
                let read = socket.read(&mut chunk).expect("read credentialed request");
                assert!(read > 0, "credentialed request closed before headers");
                bytes.extend_from_slice(&chunk[..read]);
                if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                    let header_end = index + 4;
                    let headers = std::str::from_utf8(&bytes[..header_end])
                        .expect("credentialed request headers UTF-8");
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.split_once(':').and_then(|(name, value)| {
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                        })
                        .unwrap_or(0);
                    break (header_end, content_length);
                }
            };
            while bytes.len() < header_end + content_length {
                let read = socket.read(&mut chunk).expect("read credentialed body");
                assert!(read > 0, "credentialed request closed before body");
                bytes.extend_from_slice(&chunk[..read]);
            }
            let response = serde_json::to_vec(&body).expect("fixture response JSON");
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response.len()
            )
            .expect("write fixture response head");
            socket
                .write_all(&response)
                .expect("write fixture response body");
            String::from_utf8(bytes).expect("credentialed request UTF-8")
        })
    }

    #[test]
    fn provider_literals_refuse_non_public_addresses_during_parse() {
        for address in [
            "169.254.169.254",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "[::ffff:169.254.169.254]",
        ] {
            let error = parse_provider(
                &format!("openai-compatible:https://{address}/v1"),
                "fixture-model",
            )
            .expect_err("non-public provider literal must fail at parse time");
            assert_eq!(error.diagnostic.code, "SNAPBACK_API_ASK_PROVIDER_INVALID");
        }

        parse_provider(
            "openai-compatible:https://93.184.216.34/v1",
            "fixture-model",
        )
        .expect("public HTTPS literal remains admissible");
        parse_provider(
            "openai-compatible:http://127.0.0.1:43123/v1",
            "fixture-model",
        )
        .expect("unit-test fixture receives the internal loopback capability");
    }

    #[test]
    fn ask_and_push_bearers_bypass_environment_proxies() {
        const CHILD_MARKER: &str = "ASK_PUSH_PROXY_CHILD";
        const ASK_BEARER: &str = "ask-direct-bearer-sentinel";
        const PUSH_BEARER: &str = "push-direct-bearer-sentinel";

        if std::env::var_os(CHILD_MARKER).is_some() {
            let ask_listener =
                std::net::TcpListener::bind("127.0.0.1:0").expect("bind direct Ask destination");
            let ask_address = ask_listener.local_addr().expect("Ask destination address");
            let ask_request = serve_one_json(
                ask_listener,
                json!({
                    "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
                }),
            );
            let config = parse_provider(
                &format!("openai-compatible:http://{ask_address}/v1"),
                "fixture-model",
            )
            .expect("parse direct Ask fixture");
            tokio::runtime::Runtime::new()
                .expect("Ask proxy-test runtime")
                .block_on(chat_completion(
                    config,
                    Zeroizing::new(ASK_BEARER.to_owned()),
                    SecretRedactor::default(),
                    Vec::new(),
                    Vec::new(),
                    32,
                    Duration::from_secs(2),
                ))
                .expect("Ask reaches its pinned direct destination");
            assert!(
                ask_request
                    .join()
                    .expect("Ask direct fixture joins")
                    .to_ascii_lowercase()
                    .contains(&format!("authorization: bearer {ASK_BEARER}\r\n"))
            );

            let push_listener =
                std::net::TcpListener::bind("127.0.0.1:0").expect("bind direct Expo destination");
            let push_address = push_listener
                .local_addr()
                .expect("Expo destination address");
            let push_request = serve_one_json(push_listener, json!({"data": []}));
            crate::push::post_expo_json(
                &format!("http://{push_address}/--/api/v2/push/send"),
                Some(PUSH_BEARER),
                json!([]),
                Duration::from_secs(2),
            )
            .expect("Expo reaches its pinned direct destination");
            assert!(
                push_request
                    .join()
                    .expect("Expo direct fixture joins")
                    .to_ascii_lowercase()
                    .contains(&format!("authorization: bearer {PUSH_BEARER}\r\n"))
            );
            return;
        }

        let proxy = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("bind credential-observation proxy witness");
        let proxy_address = proxy.local_addr().expect("proxy witness address");
        let proxy_url = format!("http://{proxy_address}");
        let output = std::process::Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "ask::tests::ask_and_push_bearers_bypass_environment_proxies",
                "--nocapture",
            ])
            .env(CHILD_MARKER, "1")
            .env("SNAPBACK_OUTBOUND_ACTIONS", "1")
            .env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("ALL_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("all_proxy", &proxy_url)
            .env("NO_PROXY", "")
            .env("no_proxy", "")
            .output()
            .expect("run isolated Ask/Expo proxy witness");
        assert!(
            output.status.success(),
            "Ask/Expo proxy child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        proxy
            .set_nonblocking(true)
            .expect("make proxy witness nonblocking");
        assert!(
            matches!(proxy.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
            "an inherited environment proxy observed a credentialed outbound connection"
        );
    }

    #[test]
    fn result_schema_references_are_request_local() {
        validate_result(
            &json!({
                "$defs": { "answer": { "type": "string" } },
                "$ref": "#/$defs/answer"
            }),
            &json!("ok"),
        )
        .expect("local references remain supported");

        let error = validate_result(&json!({ "$ref": "file:///etc/passwd" }), &Value::Null)
            .expect_err("provider result schemas cannot read host files");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_API_ASK_RESULT_SCHEMA_INVALID"
        );
    }
}
