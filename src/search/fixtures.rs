//! The shared accepted/rejected search-AST fixture corpus (LLP 0131 §The
//! search fixture, item 4; LLP 0115 CV-5).
//!
//! One committed corpus runs against every carrier of the search request
//! grammar: Rust deserialization (asserted **during generation**, so a
//! committed file implies the claim), the exported `search.request.schema.json`
//! (ajv, `packages/snapback-codegen/search-ast-fixtures.test.mjs`), and the
//! codegen-emitted plus hand-published TypeScript types (tsc, same test). A
//! fixture disagreeing anywhere fails CI.
//!
//! `typeLevel: false` marks rejections that TypeScript's type system cannot
//! express (numeric range/integrality bounds); those fixtures are still
//! agreement-gated against Rust and the exported schema.

use crate::search::types::SearchRequestV1;
use serde_json::{Value, json};

pub const SEARCH_AST_FIXTURES_FILE: &str = "search.request.fixtures-v1.json";

struct Fixture {
    name: &'static str,
    accept: bool,
    /// Whether the rejection is expressible at the TypeScript type level.
    /// Always true for accepted fixtures.
    type_level: bool,
    request: Value,
}

fn corpus() -> Vec<Fixture> {
    let accept = |name, request| Fixture {
        name,
        accept: true,
        type_level: true,
        request,
    };
    let reject = |name, request| Fixture {
        name,
        accept: false,
        type_level: true,
        request,
    };
    let reject_bounds = |name, request| Fixture {
        name,
        accept: false,
        type_level: false,
        request,
    };
    vec![
        accept(
            "minimal-term",
            json!({ "query": { "all": [ { "Term": { "value": "hello" } } ] } }),
        ),
        accept(
            "every-clause-kind",
            json!({
                "query": { "all": [
                    { "Term": { "value": "hello", "field": "title" } },
                    { "Phrase": { "values": ["warm", "milk"], "field": "body" } },
                    { "Prefix": { "value": "he" } },
                    { "Any": [
                        { "Term": { "value": "left" } },
                        { "Prefix": { "value": "ri" } },
                    ] },
                    { "Not": { "Term": { "value": "cold" } } },
                    { "Filter": { "field": "status", "op": "eq", "value": "open" } },
                ] },
                "limit": 10,
                "after": "cursor-bytes",
            }),
        ),
        accept(
            "filter-number-and-boolean-values",
            json!({
                "query": { "all": [
                    { "Filter": { "field": "count", "op": "eq", "value": 3 } },
                    { "Filter": { "field": "done", "op": "eq", "value": true } },
                ] },
            }),
        ),
        accept(
            "empty-all-is-grammar-valid",
            json!({ "query": { "all": [] } }),
        ),
        reject("missing-query", json!({})),
        reject("query-wrong-kind", json!({ "query": 42 })),
        reject(
            "unknown-clause-variant",
            json!({ "query": { "all": [ { "Regex": { "value": "h.*" } } ] } }),
        ),
        reject(
            "unknown-atom-member",
            json!({ "query": { "all": [ { "Term": { "value": "x", "nope": 1 } } ] } }),
        ),
        reject(
            "term-missing-value",
            json!({ "query": { "all": [ { "Term": { "field": "title" } } ] } }),
        ),
        reject(
            "filter-op-outside-profile",
            json!({ "query": { "all": [
                { "Filter": { "field": "status", "op": "neq", "value": "open" } },
            ] } }),
        ),
        reject(
            "filter-null-value",
            json!({ "query": { "all": [
                { "Filter": { "field": "status", "op": "eq", "value": null } },
            ] } }),
        ),
        reject(
            "filter-structured-value",
            json!({ "query": { "all": [
                { "Filter": { "field": "status", "op": "eq", "value": { "open": true } } },
            ] } }),
        ),
        reject(
            "undeclared-request-member",
            json!({ "query": { "all": [] }, "extra": true }),
        ),
        reject(
            "after-wrong-kind",
            json!({ "query": { "all": [] }, "after": 7 }),
        ),
        reject(
            "limit-wrong-kind",
            json!({ "query": { "all": [] }, "limit": "ten" }),
        ),
        reject(
            "not-wraps-non-atom",
            json!({ "query": { "all": [
                { "Not": { "Filter": { "field": "s", "op": "eq", "value": "x" } } },
            ] } }),
        ),
        reject(
            "phrase-values-wrong-kind",
            json!({ "query": { "all": [ { "Phrase": { "values": "hi" } } ] } }),
        ),
        reject_bounds(
            "limit-negative",
            json!({ "query": { "all": [] }, "limit": -1 }),
        ),
        reject_bounds(
            "limit-fractional",
            json!({ "query": { "all": [] }, "limit": 1.5 }),
        ),
    ]
}

/// Generate the committed corpus artifact, asserting the Rust-deserialization
/// claim for every fixture while doing so.
pub fn search_ast_fixture_corpus() -> Value {
    let fixtures = corpus()
        .into_iter()
        .map(|fixture| {
            let parsed = crate::args_contract::parse_search_request(&fixture.request);
            match (&parsed, fixture.accept) {
                (Ok(_), true) | (Err(_), false) => {}
                (Ok(_), false) => panic!(
                    "search AST fixture {} must refuse Rust deserialization",
                    fixture.name
                ),
                (Err(error), true) => panic!(
                    "search AST fixture {} must deserialize: {error}",
                    fixture.name
                ),
            }
            if let Ok(request) = &parsed {
                // Round-trip identity keeps the committed bytes honest as the
                // exact accepted value (optional members stay absent).
                let reserialized =
                    serde_json::to_value::<&SearchRequestV1>(request).expect("reserialize");
                assert_eq!(
                    reserialized, fixture.request,
                    "search AST fixture {} must round-trip byte-identically",
                    fixture.name
                );
            }
            json!({
                "name": fixture.name,
                "expect": if fixture.accept { "accept" } else { "reject" },
                "typeLevel": fixture.type_level,
                "request": fixture.request,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "artifactKind": "searchRequestFixturesV1",
        "formatVersion": 1,
        "schema": "search.request.schema.json",
        "fixtures": fixtures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpus_generates_and_asserts_rust_agreement() {
        let artifact = search_ast_fixture_corpus();
        let fixtures = artifact["fixtures"].as_array().expect("fixtures");
        assert!(fixtures.len() >= 15, "corpus covers the grammar surface");
    }
}
