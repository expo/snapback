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

fn embedded_manifest() -> anyhow::Result<Value> {
    let file = guide::file("guide-manifest.generated.json")
        .context("embedded Snapback Guide manifest is missing")?;
    serde_json::from_slice(file.bytes).context("embedded Snapback Guide manifest is invalid")
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
    let mut resources = vec![
        GuideResource {
            uri: MANIFEST_URI.to_owned(),
            name: "manifest".to_owned(),
            title: "Snapback Guide manifest".to_owned(),
            description: "Navigation, capability, verification, and build identity registry."
                .to_owned(),
            embedded_path: "guide-manifest.generated.json".to_owned(),
            mime_type: "application/json".to_owned(),
        },
        GuideResource {
            uri: FLAT_URI.to_owned(),
            name: "flat".to_owned(),
            title: "Snapback Guide — flat projection".to_owned(),
            description: "Capability index and every guide page in one agent-oriented document."
                .to_owned(),
            embedded_path: guide::FLAT_PATH.to_owned(),
            mime_type: "text/markdown; charset=utf-8".to_owned(),
        },
    ];
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
            description: format!("Snapback Guide page {path}"),
            embedded_path: embedded_path.to_owned(),
            mime_type: "text/markdown; charset=utf-8".to_owned(),
        });
    }
    Ok(resources)
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
                "instructions": "Read the manifest first and compare its guide hash/build commit with every cached resource before combining content.",
            }),
        )),
        "ping" => Some(success(id, json!({}))),
        "resources/templates/list" => Some(success(id, json!({ "resourceTemplates": [] }))),
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
            let resources = match resource_catalog(&manifest) {
                Ok(resources) => resources,
                Err(_) => return Some(failure(id, -32603, "Embedded guide catalog invalid")),
            };
            let Some(resource) = resources.iter().find(|resource| resource.uri == uri) else {
                return Some(failure(id, -32002, "Resource not found"));
            };
            let Some(file) = guide::file(&resource.embedded_path) else {
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
        let page_count = manifest["pages"].as_object().unwrap().len();
        let listed = request(1, "resources/list", json!({}));
        let resources = listed["result"]["resources"].as_array().unwrap();
        assert_eq!(resources.len(), page_count + 2);
        assert_eq!(resources[0]["uri"], MANIFEST_URI);
        assert_eq!(resources[1]["uri"], FLAT_URI);
        let identity = guide_identity(&manifest).unwrap();
        assert!(resources.iter().all(|resource| {
            resource["_meta"]["snapback/guideContentHash"] == identity.content_hash
                && resource["_meta"]["snapback/buildCommit"] == identity.build_commit
        }));
    }

    #[test]
    fn manifest_and_pages_return_exact_embedded_bytes() {
        for uri in [MANIFEST_URI, "snapback-guide://page/auth.protecting-data"] {
            let response = request(1, "resources/read", json!({ "uri": uri }));
            let content = &response["result"]["contents"][0];
            assert_eq!(content["uri"], uri);
            let text = content["text"].as_str().unwrap();
            assert!(!text.is_empty());
        }
        let manifest = request(2, "resources/read", json!({ "uri": MANIFEST_URI }));
        assert_eq!(
            manifest["result"]["contents"][0]["text"],
            std::str::from_utf8(guide::file("guide-manifest.generated.json").unwrap().bytes)
                .unwrap()
        );
    }

    #[test]
    fn protocol_surface_is_read_only_and_closed() {
        let initialize = request(1, "initialize", json!({}));
        assert_eq!(initialize["result"]["protocolVersion"], PROTOCOL_VERSION);
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
        assert!(
            handle_request(json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .is_none()
        );
    }
}
