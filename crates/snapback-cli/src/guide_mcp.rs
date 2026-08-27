//! Read-only MCP projection of the build-bound Snapback Guide.
//!
//! The projection derives its resource list from the same embedded manifest
//! the HTTP served-guide and admin console consume. It never reads the checkout,
//! so every returned page shares the manifest's content hash and build commit.
//!
//! @ref LLP 0061#4-distribution-and-discovery — Phase 2b re-serves the §4a
//! embedded corpus as versioned MCP resources with the same identity handshake.

use crate::guide;
use anyhow::Context as _;
use serde_json::{Value, json};
use std::io::{BufRead as _, Write as _};

const PROTOCOL_VERSION: &str = "2025-06-18";
const MANIFEST_URI: &str = "snapback-guide://manifest";
const FLAT_URI: &str = "snapback-guide://flat";
const PAGE_URI_PREFIX: &str = "snapback-guide://page/";
const SYMBOL_URI_PREFIX: &str = "snapback-guide://symbol/";
const SYMBOL_URI_TEMPLATE: &str = "snapback-guide://symbol/{name}{?slice}";

#[derive(Clone, Debug, Eq, PartialEq)]
struct GuideIdentity {
    content_hash: String,
    build_commit: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct GuideResource {
    uri: String,
    name: String,
    title: String,
    description: String,
    embedded_path: String,
    mime_type: String,
}

fn page_description(page: &Value) -> anyhow::Result<String> {
    let status = page
        .get("status")
        .and_then(Value::as_str)
        .context("guide manifest page has no status")?;
    let maturity = page
        .get("maturity")
        .and_then(Value::as_str)
        .context("guide manifest page has no maturity")?;
    let capabilities = page
        .get("capabilities")
        .and_then(Value::as_array)
        .context("guide manifest page capabilities is not an array")?
        .iter()
        .map(|capability| {
            capability
                .as_str()
                .context("guide manifest page capability is not a string")
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(format!(
        "Status: {status}; maturity: {maturity}; capabilities: {}.",
        if capabilities.is_empty() {
            "none".to_owned()
        } else {
            capabilities.join(", ")
        }
    ))
}

fn embedded_manifest() -> anyhow::Result<Value> {
    Ok(guide::manifest().clone())
}

fn guide_identity(manifest: &Value) -> anyhow::Result<GuideIdentity> {
    let content_hash = manifest
        .get("contentHash")
        .and_then(Value::as_str)
        .context("embedded guide manifest has no contentHash")?;
    let build_commit = manifest
        .pointer("/buildIdentity/commit")
        .and_then(Value::as_str)
        .context("embedded guide manifest has no buildIdentity.commit")?;
    anyhow::ensure!(
        content_hash.len() == 64 && content_hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "embedded guide contentHash is invalid"
    );
    anyhow::ensure!(
        !build_commit.is_empty(),
        "embedded guide build commit is empty"
    );
    Ok(GuideIdentity {
        content_hash: content_hash.to_owned(),
        build_commit: build_commit.to_owned(),
    })
}

fn resource_catalog(manifest: &Value) -> anyhow::Result<Vec<GuideResource>> {
    let pages = manifest
        .get("pages")
        .and_then(Value::as_object)
        .context("embedded guide manifest pages is not an object")?;
    let mut resources = vec![GuideResource {
        uri: MANIFEST_URI.to_owned(),
        name: "manifest".to_owned(),
        title: "Snapback Guide manifest".to_owned(),
        description: "Navigation, capability, verification, and build identity registry."
            .to_owned(),
        embedded_path: "guide-manifest.generated.json".to_owned(),
        mime_type: "application/json".to_owned(),
    }];
    let flat_projections = manifest
        .get("flatProjections")
        .and_then(Value::as_object)
        .context("embedded guide manifest flatProjections is not an object")?;
    let section_projections = flat_projections
        .get("sections")
        .and_then(Value::as_object)
        .context("embedded guide manifest flatProjections.sections is not an object")?;
    let mut section_entries = section_projections.iter().collect::<Vec<_>>();
    section_entries.sort_by_key(|(name, _)| *name);
    for (section, projection) in section_entries {
        let path = projection
            .get("path")
            .and_then(Value::as_str)
            .context("guide section flat projection has no path")?;
        let embedded_path = path
            .strip_prefix("guide/")
            .context("guide section flat projection path is outside guide/")?;
        anyhow::ensure!(
            guide::file(embedded_path).is_some(),
            "embedded guide section flat {path} is missing"
        );
        let uri = projection
            .get("uri")
            .and_then(Value::as_str)
            .context("guide section flat projection has no URI")?;
        anyhow::ensure!(
            uri == format!("{FLAT_URI}/{section}"),
            "guide section flat projection {section} has an invalid URI"
        );
        let bytes = projection
            .get("bytes")
            .and_then(Value::as_u64)
            .context("guide section flat projection has no byte count")?;
        resources.push(GuideResource {
            uri: uri.to_owned(),
            name: format!("flat.{section}"),
            title: format!("Snapback Guide — {section} section"),
            description: format!(
                "Context-bounded {section} section projection ({}).",
                approximate_size(bytes)
            ),
            embedded_path: embedded_path.to_owned(),
            mime_type: "text/markdown; charset=utf-8".to_owned(),
        });
    }
    let whole_flat = flat_projections
        .get("whole")
        .and_then(Value::as_object)
        .context("embedded guide manifest flatProjections.whole is not an object")?;
    let whole_path = whole_flat
        .get("path")
        .and_then(Value::as_str)
        .context("guide whole flat projection has no path")?;
    anyhow::ensure!(whole_path == "guide/guide-flat.generated.md");
    let whole_uri = whole_flat
        .get("uri")
        .and_then(Value::as_str)
        .context("guide whole flat projection has no URI")?;
    anyhow::ensure!(whole_uri == FLAT_URI);
    let whole_bytes = whole_flat
        .get("bytes")
        .and_then(Value::as_u64)
        .context("guide whole flat projection has no byte count")?;
    resources.push(GuideResource {
        uri: FLAT_URI.to_owned(),
        name: "flat".to_owned(),
        title: "Snapback Guide — whole-corpus flat projection".to_owned(),
        description: format!(
            "Bulk export ({}); a last resort. Start with the start.mental-model / start.<template> packets or a section projection; capabilities is a lookup registry.",
            approximate_size(whole_bytes)
        ),
        embedded_path: guide::FLAT_PATH.to_owned(),
        mime_type: "text/markdown; charset=utf-8".to_owned(),
    });
    let mut page_entries = pages.iter().collect::<Vec<_>>();
    page_entries.sort_by(|(left_id, left), (right_id, right)| {
        let left_order = left
            .get("order")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        let right_order = right
            .get("order")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MAX);
        left_order
            .cmp(&right_order)
            .then_with(|| left_id.cmp(right_id))
    });
    for (id, page) in page_entries {
        let path = page
            .get("path")
            .and_then(Value::as_str)
            .context("guide manifest page has no path")?;
        let embedded_path = path
            .strip_prefix("guide/")
            .context("guide manifest page path is outside guide/")?;
        anyhow::ensure!(
            guide::file(embedded_path).is_some(),
            "embedded guide page {path} is missing"
        );
        let title = page
            .get("title")
            .and_then(Value::as_str)
            .context("guide manifest page has no title")?;
        resources.push(GuideResource {
            uri: format!("{PAGE_URI_PREFIX}{id}"),
            name: id.clone(),
            title: title.to_owned(),
            description: page_description(page)?,
            embedded_path: embedded_path.to_owned(),
            mime_type: "text/markdown; charset=utf-8".to_owned(),
        });
    }
    let manifest_resources = manifest
        .get("resources")
        .and_then(Value::as_object)
        .context("embedded guide manifest resources is not an object")?;
    let mut resource_entries = manifest_resources.iter().collect::<Vec<_>>();
    resource_entries.sort_by_key(|(name, _)| *name);
    for (id, resource) in resource_entries {
        if resource
            .pointer("/projections/mcp")
            .and_then(Value::as_bool)
            != Some(true)
        {
            continue;
        }
        let path = resource
            .get("path")
            .and_then(Value::as_str)
            .context("guide manifest resource has no path")?;
        let embedded_path = path
            .strip_prefix("guide/")
            .context("guide manifest resource path is outside guide/")?;
        anyhow::ensure!(
            guide::file(embedded_path).is_some(),
            "embedded guide resource {path} is missing"
        );
        let uri = resource
            .get("uri")
            .and_then(Value::as_str)
            .context("guide manifest MCP resource has no URI")?;
        anyhow::ensure!(
            !resources.iter().any(|candidate| candidate.uri == uri),
            "guide manifest repeats MCP resource URI {uri}"
        );
        resources.push(GuideResource {
            uri: uri.to_owned(),
            name: id.clone(),
            title: resource
                .get("title")
                .and_then(Value::as_str)
                .context("guide manifest resource has no title")?
                .to_owned(),
            description: format!("Snapback Guide resource {path}"),
            embedded_path: embedded_path.to_owned(),
            mime_type: resource
                .get("mediaType")
                .and_then(Value::as_str)
                .context("guide manifest resource has no mediaType")?
                .to_owned(),
        });
    }
    Ok(resources)
}

fn approximate_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("about {:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("about {} KiB", (bytes + 512) / 1024)
    }
}

// @ref LLP 0194#design — the registry flag enables both its static MCP
// resource and the bounded exact-symbol template backed by the same bytes.
fn symbol_template_enabled(manifest: &Value) -> bool {
    manifest
        .pointer("/resources/reference.symbol-registry/projections/mcp")
        .and_then(Value::as_bool)
        == Some(true)
}

fn resource_templates(manifest: &Value, identity: &GuideIdentity) -> Vec<Value> {
    if !symbol_template_enabled(manifest) {
        return Vec::new();
    }
    vec![json!({
        "uriTemplate": SYMBOL_URI_TEMPLATE,
        "name": "reference.symbol",
        "title": "Snapback API symbol or module slice",
        "description": "One exact build-bound symbol/member or bounded module slice. Use slice=2,3,... when the result names a next slice.",
        "mimeType": "application/json",
        "_meta": identity_meta(identity),
    })]
}

fn percent_decode(value: &str) -> Result<String, &'static str> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err("symbol resource URI has invalid percent encoding");
        }
        let hex = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        };
        let high =
            hex(bytes[index + 1]).ok_or("symbol resource URI has invalid percent encoding")?;
        let low =
            hex(bytes[index + 2]).ok_or("symbol resource URI has invalid percent encoding")?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map_err(|_| "symbol resource URI is not UTF-8")
}

fn parse_symbol_resource_uri(uri: &str) -> Result<Option<(String, usize)>, &'static str> {
    let Some(rest) = uri.strip_prefix(SYMBOL_URI_PREFIX) else {
        return Ok(None);
    };
    let (encoded_name, query) = rest.split_once('?').unwrap_or((rest, ""));
    let name = percent_decode(encoded_name)?;
    if name.is_empty() {
        return Err("symbol resource name is empty");
    }
    let mut slice = 1;
    if !query.is_empty() {
        let mut saw_slice = false;
        for field in query.split('&') {
            let (key, value) = field
                .split_once('=')
                .ok_or("symbol resource query parameter has no value")?;
            if percent_decode(key)? != "slice" || saw_slice {
                return Err("symbol resource accepts only one slice parameter");
            }
            slice = percent_decode(value)?
                .parse::<usize>()
                .ok()
                .filter(|slice| *slice > 0)
                .ok_or("symbol resource slice must be a positive integer")?;
            saw_slice = true;
        }
    }
    Ok(Some((name, slice)))
}

fn identity_meta(identity: &GuideIdentity) -> Value {
    json!({
        "snapback/guideContentHash": identity.content_hash,
        "snapback/buildCommit": identity.build_commit,
    })
}

fn resource_descriptor(resource: &GuideResource, identity: &GuideIdentity) -> Value {
    json!({
        "uri": resource.uri,
        "name": resource.name,
        "title": resource.title,
        "description": resource.description,
        "mimeType": resource.mime_type,
        "_meta": identity_meta(identity),
    })
}

fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn failure(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    })
}

fn handle_request(request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(Value::as_str);
    if request.get("jsonrpc") != Some(&Value::String("2.0".to_owned())) || method.is_none() {
        return id.map(|id| failure(id, -32600, "Invalid Request"));
    }
    let method = method.unwrap_or_default();
    let id = id?;
    let manifest = match embedded_manifest() {
        Ok(manifest) => manifest,
        Err(_) => return Some(failure(id, -32603, "Embedded guide unavailable")),
    };
    let identity = match guide_identity(&manifest) {
        Ok(identity) => identity,
        Err(_) => return Some(failure(id, -32603, "Embedded guide identity invalid")),
    };
    match method {
        "initialize" => Some(success(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "resources": { "subscribe": false, "listChanged": false }
                },
                "serverInfo": { "name": "snapback-guide", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Start with snapback-guide://page/start.mental-model, or the snapback-guide://page/start.<template> packet for a scaffolded template. Use snapback-guide://page/meta.capabilities as a lookup registry, not a linear read. Then read snapback-guide://manifest and compare its guide hash/build commit with every cached resource before combining content.",
            }),
        )),
        "ping" => Some(success(id, json!({}))),
        "resources/templates/list" => Some(success(
            id,
            json!({
                "resourceTemplates": resource_templates(&manifest, &identity),
                "_meta": identity_meta(&identity),
            }),
        )),
        "resources/list" => match resource_catalog(&manifest) {
            Ok(resources) => Some(success(
                id,
                json!({
                    "resources": resources.iter().map(|resource| resource_descriptor(resource, &identity)).collect::<Vec<_>>(),
                    "_meta": identity_meta(&identity),
                }),
            )),
            Err(_) => Some(failure(id, -32603, "Embedded guide catalog invalid")),
        },
        "resources/read" => {
            let uri = request
                .pointer("/params/uri")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if symbol_template_enabled(&manifest) {
                match parse_symbol_resource_uri(uri) {
                    Ok(Some((query, slice))) => {
                        let lookup = match crate::guide_reference::lookup(&query, slice) {
                            Ok(Some(lookup)) => lookup,
                            Ok(None) => return Some(failure(id, -32002, "Resource not found")),
                            Err(_) => {
                                return Some(failure(
                                    id,
                                    -32603,
                                    "Embedded symbol registry invalid",
                                ));
                            }
                        };
                        let text = match serde_json::to_string(&lookup) {
                            Ok(text) => text,
                            Err(_) => {
                                return Some(failure(id, -32603, "Symbol lookup encoding failed"));
                            }
                        };
                        return Some(success(
                            id,
                            json!({
                                "contents": [{
                                    "uri": uri,
                                    "mimeType": "application/json",
                                    "text": text,
                                    "_meta": identity_meta(&identity),
                                }],
                                "_meta": identity_meta(&identity),
                            }),
                        ));
                    }
                    Ok(None) => {}
                    Err(message) => return Some(failure(id, -32602, message)),
                }
            }
            let resources = match resource_catalog(&manifest) {
                Ok(resources) => resources,
                Err(_) => return Some(failure(id, -32603, "Embedded guide catalog invalid")),
            };
            let Some(resource) = resources.iter().find(|resource| resource.uri == uri) else {
                return Some(failure(id, -32002, "Resource not found"));
            };
            let Some(file) = guide::served_file(&resource.embedded_path) else {
                return Some(failure(id, -32603, "Embedded guide resource missing"));
            };
            let Ok(text) = std::str::from_utf8(file.bytes) else {
                return Some(failure(id, -32603, "Embedded guide resource is not UTF-8"));
            };
            Some(success(
                id,
                json!({
                    "contents": [{
                        "uri": resource.uri,
                        "mimeType": resource.mime_type,
                        "text": text,
                        "_meta": identity_meta(&identity),
                    }],
                    "_meta": identity_meta(&identity),
                }),
            ))
        }
        _ => Some(failure(id, -32601, "Method not found")),
    }
}

pub fn run_stdio() -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::BufWriter::new(std::io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.context("failed to read MCP request")?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle_request(request),
            Err(_) => Some(failure(Value::Null, -32700, "Parse error")),
        };
        if let Some(response) = response {
            serde_json::to_writer(&mut stdout, &response)
                .context("failed to encode MCP response")?;
            stdout
                .write_all(b"\n")
                .context("failed to write MCP response")?;
            stdout.flush().context("failed to flush MCP response")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: u64, method: &str, params: Value) -> Value {
        handle_request(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .expect("request response")
    }

    #[test]
    fn catalog_is_manifest_derived_and_identity_bound() {
        let manifest = embedded_manifest().unwrap();
        let listed = request(1, "resources/list", json!({}));
        let resources = listed["result"]["resources"].as_array().unwrap();
        let mut expected = vec![MANIFEST_URI.to_owned(), FLAT_URI.to_owned()];
        expected.extend(
            manifest["flatProjections"]["sections"]
                .as_object()
                .unwrap()
                .values()
                .filter_map(|projection| projection.get("uri").and_then(Value::as_str))
                .map(str::to_owned),
        );
        expected.extend(
            manifest["pages"]
                .as_object()
                .unwrap()
                .keys()
                .map(|id| format!("{PAGE_URI_PREFIX}{id}")),
        );
        expected.extend(
            manifest["resources"]
                .as_object()
                .unwrap()
                .values()
                .filter(|resource| {
                    resource
                        .pointer("/projections/mcp")
                        .and_then(Value::as_bool)
                        == Some(true)
                })
                .filter_map(|resource| resource.get("uri").and_then(Value::as_str))
                .map(str::to_owned),
        );
        expected.sort();
        let mut actual = resources
            .iter()
            .filter_map(|resource| resource.get("uri").and_then(Value::as_str))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        actual.sort();
        assert_eq!(actual, expected);
        assert!(actual.contains(&"snapback-guide://reference/registry".to_owned()));
        assert!(actual.contains(&"snapback-guide://reference/diagnostics".to_owned()));
        let capabilities = resources
            .iter()
            .find(|resource| resource["uri"] == "snapback-guide://page/meta.capabilities")
            .expect("capability-index resource");
        assert_eq!(
            capabilities["description"],
            "Status: current; maturity: shipped; capabilities: none."
        );
        let agent_principals = resources
            .iter()
            .find(|resource| resource["uri"] == "snapback-guide://page/auth.agent-principals")
            .expect("capability-bearing resource");
        assert_eq!(
            agent_principals["description"],
            "Status: current; maturity: shipped; capabilities: auth.agent-principals, auth.agent-registration."
        );
        let identity = guide_identity(&manifest).unwrap();
        assert!(resources.iter().all(|resource| {
            resource["_meta"]["snapback/guideContentHash"] == identity.content_hash
                && resource["_meta"]["snapback/buildCommit"] == identity.build_commit
        }));
    }

    #[test]
    fn manifest_pages_and_manifest_resources_return_exact_embedded_bytes() {
        for uri in [
            MANIFEST_URI,
            "snapback-guide://flat/backend",
            "snapback-guide://page/auth.protecting-data",
            "snapback-guide://reference/registry",
        ] {
            let response = request(1, "resources/read", json!({ "uri": uri }));
            let content = &response["result"]["contents"][0];
            assert_eq!(content["uri"], uri);
            let text = content["text"].as_str().unwrap();
            assert!(!text.is_empty());
        }
        let manifest = request(2, "resources/read", json!({ "uri": MANIFEST_URI }));
        assert_eq!(
            manifest["result"]["contents"][0]["text"],
            std::str::from_utf8(
                guide::served_file("guide-manifest.generated.json")
                    .unwrap()
                    .bytes
            )
            .unwrap()
        );
        let registry = request(
            3,
            "resources/read",
            json!({ "uri": "snapback-guide://reference/registry" }),
        );
        assert_eq!(
            registry["result"]["contents"][0]["text"],
            std::str::from_utf8(
                guide::file(crate::guide_reference::REGISTRY_PATH)
                    .unwrap()
                    .bytes
            )
            .unwrap()
        );
    }

    #[test]
    fn symbol_template_returns_the_shared_bounded_lookup_schema() {
        let templates = request(1, "resources/templates/list", json!({}));
        assert_eq!(
            templates["result"]["resourceTemplates"][0]["uriTemplate"],
            SYMBOL_URI_TEMPLATE
        );
        let response = request(
            2,
            "resources/read",
            json!({ "uri": "snapback-guide://symbol/SnapbackClient?slice=2" }),
        );
        let text = response["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(text.len() <= crate::guide_reference::MAX_LOOKUP_BYTES);
        let lookup: Value = serde_json::from_str(text).unwrap();
        assert_eq!(
            lookup["schemaVersion"],
            crate::guide_reference::LOOKUP_SCHEMA_VERSION
        );
        assert_eq!(lookup["match"], "symbol-slice");
        assert_eq!(lookup["truncation"]["slice"], 2);
        assert_eq!(
            lookup["truncation"]["nextCommand"],
            "snapback guide SnapbackClient --slice 3"
        );
    }

    #[test]
    fn protocol_surface_is_read_only_and_closed() {
        let initialize = request(1, "initialize", json!({}));
        assert_eq!(initialize["result"]["protocolVersion"], PROTOCOL_VERSION);
        let instructions = initialize["result"]["instructions"].as_str().unwrap();
        // @ref LLP 0259#1-first-read-contract — start packets lead; the
        // capability index is named as a lookup registry, before the manifest.
        assert!(
            instructions
                .find("snapback-guide://page/start.mental-model")
                .unwrap()
                < instructions
                    .find("snapback-guide://page/meta.capabilities")
                    .unwrap()
        );
        assert!(instructions.contains("lookup registry, not a linear read"));
        assert!(
            instructions
                .find("snapback-guide://page/meta.capabilities")
                .unwrap()
                < instructions.find("snapback-guide://manifest").unwrap()
        );
        assert!(initialize["result"]["capabilities"].get("tools").is_none());
        assert_eq!(
            request(
                2,
                "resources/read",
                json!({ "uri": "snapback-guide://missing" })
            )["error"]["code"],
            -32002
        );
        assert_eq!(request(3, "tools/list", json!({}))["error"]["code"], -32601);
        assert_eq!(
            request(
                4,
                "resources/read",
                json!({ "uri": "snapback-guide://symbol/SnapbackClient?slice=0" })
            )["error"]["code"],
            -32602
        );
        assert!(
            handle_request(json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .is_none()
        );
    }
}
