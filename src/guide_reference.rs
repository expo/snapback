//! Budgeted exact-symbol lookup over the build-bound Guide registry.
//!
//! @ref LLP 0194#design — CLI and MCP share one registry parser, identity
//! binding, lookup schema, and 16 KiB slicing implementation.

use anyhow::Context as _;
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

pub const REGISTRY_PATH: &str = "reference/registry.json";
pub const DIAGNOSTICS_REGISTRY_PATH: &str = "reference/diagnostics-registry.json";
pub const LOOKUP_SCHEMA_VERSION: &str = "snapback.guide-symbol-lookup.v1";
pub const MAX_LOOKUP_BYTES: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const SYMBOL_PAGE_SIZE: usize = 8;
const MODULE_PAGE_SIZE: usize = 12;
const DIAGNOSTIC_PAGE_SIZE: usize = 24;

#[derive(Debug)]
struct ReferenceArtifacts {
    registry: Value,
    diagnostics: Value,
    identity: Value,
    budget: usize,
}

static REFERENCE_ARTIFACTS: OnceLock<Result<ReferenceArtifacts, String>> = OnceLock::new();

fn load_reference_artifacts() -> anyhow::Result<ReferenceArtifacts> {
    let manifest_file = crate::guide::file("guide-manifest.generated.json")
        .context("embedded Snapback Guide manifest is missing")?;
    let manifest: Value = serde_json::from_slice(manifest_file.bytes)
        .context("embedded Snapback Guide manifest is invalid")?;
    let registry_file = crate::guide::file(REGISTRY_PATH)
        .context("embedded Snapback Guide symbol registry is missing")?;
    let diagnostics_file = crate::guide::file(DIAGNOSTICS_REGISTRY_PATH)
        .context("embedded Snapback Guide diagnostics registry is missing")?;
    let resource = manifest
        .pointer("/resources/reference.symbol-registry")
        .context("embedded Guide manifest does not declare the symbol registry")?;
    let actual_sha256 = format!("{:x}", Sha256::digest(registry_file.bytes));
    anyhow::ensure!(
        resource.get("sha256").and_then(Value::as_str) == Some(actual_sha256.as_str()),
        "SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide manifest does not bind the embedded registry bytes"
    );
    let diagnostics_resource = manifest
        .pointer("/resources/reference.diagnostics-registry")
        .context("embedded Guide manifest does not declare the diagnostics registry")?;
    let diagnostics_sha256 = format!("{:x}", Sha256::digest(diagnostics_file.bytes));
    anyhow::ensure!(
        diagnostics_resource.get("sha256").and_then(Value::as_str)
            == Some(diagnostics_sha256.as_str()),
        "SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide manifest does not bind the embedded diagnostics registry bytes"
    );

    let registry: Value = serde_json::from_slice(registry_file.bytes)
        .context("embedded Snapback Guide symbol registry is invalid")?;
    anyhow::ensure!(
        registry.get("schemaVersion").and_then(Value::as_str)
            == Some("snapback-symbol-registry.v1"),
        "embedded Snapback Guide symbol registry schema is unsupported"
    );
    anyhow::ensure!(
        resource.get("sourceDigest") == registry.pointer("/buildIdentity/sourceDigest"),
        "SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide and registry source identities differ"
    );
    let diagnostics: Value = serde_json::from_slice(diagnostics_file.bytes)
        .context("embedded Snapback Guide diagnostics registry is invalid")?;
    anyhow::ensure!(
        diagnostics.get("schemaVersion").and_then(Value::as_str)
            == Some("snapback-diagnostics-registry.v1"),
        "embedded Snapback Guide diagnostics registry schema is unsupported"
    );
    anyhow::ensure!(
        diagnostics_resource.get("sourceDigest")
            == diagnostics.pointer("/buildIdentity/sourceDigest"),
        "SNAPBACK_GUIDE_REGISTRY_IDENTITY_MISMATCH: Guide and diagnostics source identities differ"
    );

    let guide_content_hash = manifest
        .get("contentHash")
        .and_then(Value::as_str)
        .context("embedded Guide manifest has no contentHash")?;
    let guide_build_commit = manifest
        .pointer("/buildIdentity/commit")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let registry_source_digest = registry
        .pointer("/buildIdentity/sourceDigest")
        .and_then(Value::as_str)
        .context("embedded symbol registry has no sourceDigest")?
        .to_owned();
    let declared_budget = registry
        .pointer("/limits/lookupBytes")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(MAX_LOOKUP_BYTES);

    Ok(ReferenceArtifacts {
        registry,
        identity: json!({
            "guideContentHash": guide_content_hash,
            "guideBuildCommit": guide_build_commit,
            "registrySourceDigest": registry_source_digest,
            "diagnosticsSourceDigest": diagnostics.pointer("/buildIdentity/sourceDigest"),
        }),
        diagnostics,
        budget: declared_budget.min(MAX_LOOKUP_BYTES),
    })
}

fn budgeted_diagnostic(
    query: &str,
    diagnostic: &Value,
    identity: &Value,
    slice: usize,
    budget: usize,
) -> anyhow::Result<Value> {
    let complete = json!({
        "schemaVersion": LOOKUP_SCHEMA_VERSION,
        "ok": true,
        "query": query,
        "match": "diagnostic",
        "identity": identity,
        "diagnostic": diagnostic,
        "truncation": Value::Null,
    });
    if encoded_len(&complete)? <= budget {
        return Ok(complete);
    }
    let sites = diagnostic
        .get("sites")
        .and_then(Value::as_array)
        .context("diagnostic registry sites is not an array")?;
    let start = (slice - 1)
        .checked_mul(DIAGNOSTIC_PAGE_SIZE)
        .context("SNAPBACK_CLI_ARGUMENT_INVALID: --slice is too large")?;
    let visible = sites
        .iter()
        .skip(start)
        .take(DIAGNOSTIC_PAGE_SIZE)
        .cloned()
        .collect::<Vec<_>>();
    let has_more = start.saturating_add(DIAGNOSTIC_PAGE_SIZE) < sites.len();
    let next_slice = has_more.then_some(slice + 1);
    let mut summary = diagnostic.as_object().cloned().unwrap_or_default();
    summary.insert("sites".to_owned(), Value::Array(visible));
    let result = json!({
        "schemaVersion": LOOKUP_SCHEMA_VERSION,
        "ok": true,
        "query": query,
        "match": "diagnostic-slice",
        "identity": identity,
        "diagnostic": summary,
        "truncation": {
            "truncated": true,
            "slice": slice,
            "elided": [format!("emitting sites outside {}-{} of {}", start + 1, (start + DIAGNOSTIC_PAGE_SIZE).min(sites.len()), sites.len())],
            "nextSlice": next_slice,
            "nextCommand": next_slice.map(|next| format!("snapback guide {query} --slice {next}")),
        },
    });
    anyhow::ensure!(
        encoded_len(&result)? <= budget,
        "SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: diagnostic slice {query} exceeds {budget} bytes"
    );
    Ok(result)
}

fn diagnostic_for_distribution(diagnostic: &Value, distribution: &str) -> Value {
    let mut projected = diagnostic.clone();
    if distribution == crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE
        && let Some(object) = projected.as_object_mut()
    {
        object.remove("sites");
    }
    projected
}

fn reference_artifacts() -> anyhow::Result<&'static ReferenceArtifacts> {
    match REFERENCE_ARTIFACTS
        .get_or_init(|| load_reference_artifacts().map_err(|error| format!("{error:#}")))
    {
        Ok(artifacts) => Ok(artifacts),
        Err(message) => anyhow::bail!(message.clone()),
    }
}

fn symbol_summary(symbol: &Value) -> Value {
    json!({
        "identity": symbol.get("identity").cloned().unwrap_or(Value::Null),
        "originIdentity": symbol.get("originIdentity").cloned().unwrap_or(Value::Null),
        "name": symbol.get("name").cloned().unwrap_or(Value::Null),
        "package": symbol.get("package").cloned().unwrap_or(Value::Null),
        "module": symbol.get("module").cloned().unwrap_or(Value::Null),
        "kind": symbol.get("kind").cloned().unwrap_or(Value::Null),
        "runtime": symbol.get("runtime").cloned().unwrap_or(Value::Null),
        "anchor": symbol.get("anchor").cloned().unwrap_or(Value::Null),
        "documentation": symbol.get("documentation").cloned().unwrap_or(Value::Null),
        "source": symbol.get("source").cloned().unwrap_or(Value::Null),
    })
}

fn member_match<'a>(symbol: &'a Value, query: &str) -> Option<&'a Value> {
    let name = symbol.get("name")?.as_str()?;
    let member_name = query.strip_prefix(&format!("{name}."))?;
    symbol
        .get("members")?
        .as_array()?
        .iter()
        .find(|member| member.get("name").and_then(Value::as_str) == Some(member_name))
}

fn encoded_len(value: &Value) -> anyhow::Result<usize> {
    Ok(serde_json::to_vec(value)?.len())
}

fn names(values: &[Value]) -> String {
    values
        .iter()
        .filter_map(|value| value.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ")
}

fn summary_with(symbol: &Value, fields: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    let mut summary = symbol_summary(symbol)
        .as_object()
        .cloned()
        .unwrap_or_else(Map::new);
    for (name, value) in fields {
        summary.insert(name.to_owned(), value);
    }
    Value::Object(summary)
}

fn budgeted_symbol(
    query: &str,
    symbol: &Value,
    member: Option<&Value>,
    identity: &Value,
    slice: usize,
    budget: usize,
) -> anyhow::Result<Value> {
    if let Some(member) = member {
        let result = json!({
            "schemaVersion": LOOKUP_SCHEMA_VERSION,
            "ok": true,
            "query": query,
            "match": "member",
            "identity": identity,
            "symbol": symbol_summary(symbol),
            "member": member,
            "truncation": Value::Null,
        });
        anyhow::ensure!(
            encoded_len(&result)? <= budget,
            "SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: exact member {query} exceeds {budget} bytes"
        );
        return Ok(result);
    }

    let complete = json!({
        "schemaVersion": LOOKUP_SCHEMA_VERSION,
        "ok": true,
        "query": query,
        "match": "symbol",
        "identity": identity,
        "symbol": summary_with(symbol, [
            ("signature", symbol.get("signature").cloned().unwrap_or(Value::Null)),
            ("overloads", symbol.get("overloads").cloned().unwrap_or_else(|| json!([]))),
            ("members", symbol.get("members").cloned().unwrap_or_else(|| json!([]))),
        ]),
        "truncation": Value::Null,
    });
    if encoded_len(&complete)? <= budget {
        return Ok(complete);
    }

    let members = symbol
        .get("members")
        .and_then(Value::as_array)
        .context("registry symbol members is not an array")?;
    let start = (slice - 1)
        .checked_mul(SYMBOL_PAGE_SIZE)
        .context("SNAPBACK_CLI_ARGUMENT_INVALID: --slice is too large")?;
    let visible = members
        .iter()
        .skip(start)
        .take(SYMBOL_PAGE_SIZE)
        .cloned()
        .collect::<Vec<_>>();
    let remaining = members
        .iter()
        .skip(start.saturating_add(SYMBOL_PAGE_SIZE))
        .cloned()
        .collect::<Vec<_>>();
    let mut elided = Vec::new();
    if let Some(signature) = symbol.get("signature").and_then(Value::as_str)
        && !signature.is_empty()
    {
        elided.push(format!("complete signature ({} bytes)", signature.len()));
    }
    if start > 0 {
        elided.push(format!(
            "members 1-{start}: {}",
            names(&members.iter().take(start).cloned().collect::<Vec<_>>())
        ));
    }
    if !remaining.is_empty() {
        elided.push(format!(
            "members {}-{}: {}",
            start + SYMBOL_PAGE_SIZE + 1,
            members.len(),
            names(&remaining)
        ));
    }
    let next_slice = (!remaining.is_empty()).then_some(slice + 1);
    let next_command = next_slice.map(|next| format!("snapback guide {query} --slice {next}"));
    let mut result = json!({
        "schemaVersion": LOOKUP_SCHEMA_VERSION,
        "ok": true,
        "query": query,
        "match": "symbol-slice",
        "identity": identity,
        "symbol": summary_with(symbol, [
            ("signature", Value::Null),
            ("members", Value::Array(visible.clone())),
        ]),
        "truncation": {
            "truncated": true,
            "slice": slice,
            "elided": elided,
            "nextSlice": next_slice,
            "nextCommand": next_command,
            "exactMemberCommand": format!("snapback guide {query}.<member>"),
        },
    });
    if encoded_len(&result)? > budget {
        let compact_members = visible
            .iter()
            .map(|member| {
                json!({
                    "identity": member.get("identity").cloned().unwrap_or(Value::Null),
                    "name": member.get("name").cloned().unwrap_or(Value::Null),
                    "kind": member.get("kind").cloned().unwrap_or(Value::Null),
                    "sources": member.get("sources").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        result["symbol"]["members"] = Value::Array(compact_members);
    }
    anyhow::ensure!(
        encoded_len(&result)? <= budget,
        "SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: symbol slice {query} exceeds {budget} bytes"
    );
    Ok(result)
}

fn budgeted_module(
    query: &str,
    symbols: &[&Value],
    identity: &Value,
    slice: usize,
    budget: usize,
) -> anyhow::Result<Value> {
    let start = (slice - 1)
        .checked_mul(MODULE_PAGE_SIZE)
        .context("SNAPBACK_CLI_ARGUMENT_INVALID: --slice is too large")?;
    let visible = symbols
        .iter()
        .skip(start)
        .take(MODULE_PAGE_SIZE)
        .map(|symbol| symbol_summary(symbol))
        .collect::<Vec<_>>();
    let remaining = symbols
        .iter()
        .skip(start.saturating_add(MODULE_PAGE_SIZE))
        .copied()
        .collect::<Vec<_>>();
    let truncation = if remaining.is_empty() && start == 0 {
        Value::Null
    } else {
        let mut elided = Vec::new();
        if start > 0 {
            elided.push(format!(
                "symbols 1-{start}: {}",
                symbols
                    .iter()
                    .take(start)
                    .filter_map(|symbol| symbol.get("name").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !remaining.is_empty() {
            elided.push(format!(
                "symbols {}-{}: {}",
                start + MODULE_PAGE_SIZE + 1,
                symbols.len(),
                remaining
                    .iter()
                    .filter_map(|symbol| symbol.get("name").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        let next_slice = (!remaining.is_empty()).then_some(slice + 1);
        json!({
            "truncated": true,
            "slice": slice,
            "elided": elided,
            "nextSlice": next_slice,
            "nextCommand": next_slice.map(|next| format!("snapback guide {query} --slice {next}")),
            "exactSymbolCommand": "snapback guide <ExactSymbolName>",
        })
    };
    let result = json!({
        "schemaVersion": LOOKUP_SCHEMA_VERSION,
        "ok": true,
        "query": query,
        "match": "module-slice",
        "identity": identity,
        "module": query,
        "symbols": visible,
        "truncation": truncation,
    });
    anyhow::ensure!(
        encoded_len(&result)? <= budget,
        "SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: module slice {query} exceeds {budget} bytes"
    );
    Ok(result)
}

/// Return `None` for a non-exact query so callers can preserve Markdown
/// section search as the fuzzy fallback.
pub fn lookup(query: &str, slice: usize) -> anyhow::Result<Option<Value>> {
    anyhow::ensure!(
        slice > 0 && u64::try_from(slice).is_ok_and(|slice| slice <= MAX_SAFE_INTEGER),
        "SNAPBACK_CLI_ARGUMENT_INVALID: --slice must be a positive integer"
    );
    let artifacts = reference_artifacts()?;
    // @ref LLP 0193#program — a stable diagnostic code is an exact navigation
    // key and therefore wins before API-symbol lookup or Markdown search.
    if let Some(diagnostic) = artifacts
        .diagnostics
        .get("diagnostics")
        .and_then(Value::as_object)
        .and_then(|diagnostics| diagnostics.get(query))
    {
        let diagnostic =
            diagnostic_for_distribution(diagnostic, crate::identity::build_distribution());
        return budgeted_diagnostic(
            query,
            &diagnostic,
            &artifacts.identity,
            slice,
            artifacts.budget,
        )
        .map(Some);
    }
    let symbols = artifacts
        .registry
        .get("symbols")
        .and_then(Value::as_array)
        .context("embedded symbol registry symbols is not an array")?;
    let by_identity = symbols
        .iter()
        .filter_map(|symbol| {
            symbol
                .get("identity")
                .and_then(Value::as_str)
                .map(|identity| (identity, symbol))
        })
        .collect::<HashMap<_, _>>();
    let matched = artifacts
        .registry
        .pointer("/lookup/exact")
        .and_then(Value::as_object)
        .and_then(|exact| exact.get(query))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|identity| by_identity.get(identity).copied())
        .collect::<Vec<_>>();
    let mut seen_origins = HashSet::new();
    let unique = matched
        .into_iter()
        .filter(|symbol| {
            symbol
                .get("originIdentity")
                .and_then(Value::as_str)
                .is_some_and(|origin| seen_origins.insert(origin))
        })
        .collect::<Vec<_>>();
    if unique.len() == 1 {
        return budgeted_symbol(
            query,
            unique[0],
            member_match(unique[0], query),
            &artifacts.identity,
            slice,
            artifacts.budget,
        )
        .map(Some);
    }
    if unique.len() > 1 {
        return budgeted_module(query, &unique, &artifacts.identity, slice, artifacts.budget)
            .map(Some);
    }
    let module_symbols = symbols
        .iter()
        .filter(|symbol| symbol.get("module").and_then(Value::as_str) == Some(query))
        .collect::<Vec<_>>();
    if !module_symbols.is_empty() {
        return budgeted_module(
            query,
            &module_symbols,
            &artifacts.identity,
            slice,
            artifacts.budget,
        )
        .map(Some);
    }
    Ok(None)
}

pub fn format_lookup(result: &Value) -> anyhow::Result<String> {
    let query = result
        .get("query")
        .and_then(Value::as_str)
        .context("lookup result has no query")?;
    let match_kind = result
        .get("match")
        .and_then(Value::as_str)
        .context("lookup result has no match kind")?;
    let mut lines = vec![
        format!("{query} — {match_kind}"),
        format!(
            "guide {} · registry {}",
            result
                .pointer("/identity/guideContentHash")
                .and_then(Value::as_str)
                .context("lookup result has no Guide identity")?,
            result
                .pointer("/identity/registrySourceDigest")
                .and_then(Value::as_str)
                .context("lookup result has no registry identity")?,
        ),
    ];
    if let Some(diagnostic) = result.get("diagnostic") {
        lines.push(format!(
            "{}{}",
            diagnostic
                .get("subsystem")
                .and_then(Value::as_str)
                .unwrap_or("unknown subsystem"),
            diagnostic
                .get("httpStatus")
                .and_then(Value::as_u64)
                .map(|status| format!(" · HTTP {status}"))
                .unwrap_or_default(),
        ));
        if let Some(anchor) = diagnostic.get("guideAnchor").and_then(Value::as_str) {
            lines.push(format!("Guide: {anchor}"));
        }
        if let Some(sites) = diagnostic.get("sites").and_then(Value::as_array) {
            lines.push(String::new());
            lines.push("Emitting sites:".to_owned());
            lines.extend(sites.iter().filter_map(|site| {
                Some(format!(
                    "- {}:{}:{}",
                    site.get("file")?.as_str()?,
                    site.get("line")?.as_u64()?,
                    site.get("column")?.as_u64()?,
                ))
            }));
        }
    } else if let Some(member) = result.get("member") {
        lines.push(format!(
            "{} · {}",
            result
                .pointer("/symbol/module")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            result
                .pointer("/symbol/kind")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ));
        lines.push(String::new());
        lines.push(
            member
                .get("signature")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        );
    } else if let Some(symbol) = result.get("symbol") {
        lines.push(format!(
            "{} · {}",
            symbol
                .get("module")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            symbol
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ));
        if let Some(signature) = symbol.get("signature").and_then(Value::as_str) {
            lines.push(String::new());
            lines.push(signature.to_owned());
        }
        if let Some(members) = symbol.get("members").and_then(Value::as_array)
            && !members.is_empty()
        {
            lines.push(String::new());
            lines.extend(members.iter().map(|member| {
                format!(
                    "{}: {}",
                    member
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    member
                        .get("signature")
                        .and_then(Value::as_str)
                        .or_else(|| member.get("kind").and_then(Value::as_str))
                        .unwrap_or_default(),
                )
            }));
        }
    } else if let Some(symbols) = result.get("symbols").and_then(Value::as_array) {
        lines.push(String::new());
        lines.extend(symbols.iter().map(|symbol| {
            format!(
                "{} — {} — {}",
                symbol
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                symbol
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                symbol
                    .get("identity")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
        }));
    }
    if let Some(truncation) = result.get("truncation").filter(|value| !value.is_null()) {
        lines.push(String::new());
        lines.push("TRUNCATED:".to_owned());
        if let Some(elided) = truncation.get("elided").and_then(Value::as_array) {
            lines.extend(
                elided
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|entry| format!("- {entry}")),
            );
        }
        if let Some(next) = truncation.get("nextCommand").and_then(Value::as_str) {
            lines.push(format!("Next: {next}"));
        }
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_lookup_cases_match_the_package_contract_and_budget() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/guide-symbol-lookup-v1.json"
        ))
        .unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let query = case["query"].as_str().unwrap();
            let slice = case["slice"].as_u64().unwrap() as usize;
            let result = lookup(query, slice).unwrap();
            if case["match"].is_null() {
                assert!(result.is_none(), "{query} must remain a fuzzy fallback");
                continue;
            }
            let result = result.unwrap();
            assert_eq!(result["schemaVersion"], LOOKUP_SCHEMA_VERSION);
            assert_eq!(result["match"], case["match"]);
            assert_eq!(
                result
                    .pointer("/truncation/truncated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                case.get("truncated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                "{query} slice {slice}"
            );
            if let Some(next) = case.get("nextCommand") {
                assert_eq!(&result["truncation"]["nextCommand"], next);
            }
            if let Some(needle) = case.get("signatureContains").and_then(Value::as_str) {
                assert!(
                    result
                        .pointer("/member/signature")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .contains(needle)
                );
            }
            assert!(serde_json::to_vec(&result).unwrap().len() <= MAX_LOOKUP_BYTES);
        }
    }

    #[test]
    fn exact_diagnostic_lookup_is_identity_bound_and_http_classified() {
        let result = lookup("SNAPBACK_AUTH_SESSION_EXPIRED", 1)
            .unwrap()
            .expect("registered diagnostic");
        assert_eq!(result["match"], "diagnostic");
        assert_eq!(result["diagnostic"]["subsystem"], "auth");
        assert_eq!(result["diagnostic"]["httpStatus"], 401);
        assert!(
            result
                .pointer("/identity/diagnosticsSourceDigest")
                .and_then(Value::as_str)
                .is_some_and(|digest| digest.starts_with("sha256:"))
        );
        assert!(serde_json::to_vec(&result).unwrap().len() <= MAX_LOOKUP_BYTES);
    }

    #[test]
    fn public_package_diagnostic_projection_omits_repository_sites() {
        let diagnostic = json!({
            "code": "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "sites": [{"file": "src/manifest.rs", "line": 1, "column": 1}],
        });
        let public = diagnostic_for_distribution(
            &diagnostic,
            crate::identity::BUILD_DISTRIBUTION_PUBLIC_PACKAGE,
        );
        assert!(public.get("sites").is_none(), "{public}");
        let contributor = diagnostic_for_distribution(
            &diagnostic,
            crate::identity::BUILD_DISTRIBUTION_CONTRIBUTOR_SOURCE,
        );
        assert_eq!(contributor["sites"], diagnostic["sites"]);
    }
}
