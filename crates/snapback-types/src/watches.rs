//! Closed, bounded durable-watch vocabulary and predicate evaluator.
//!
//! Watch predicates are data, never handler code. This module owns the exact
//! JSON grammar so storage, HTTP validation, and background evaluation cannot
//! drift into different interpretations.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWatch {
    #[serde(flatten)]
    pub watch: crate::storage::watches::WatchRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
}

/// Internal LLP 0070 job action. It is not an app function name and is
/// intercepted by the server-owned job executor.
pub const INTERNAL_EVALUATION_ACTION: &str = "_snapback.watch.evaluate";
pub const MIN_DEBOUNCE_MS: u64 = 5_000;
pub const MAX_DEBOUNCE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const DEFAULT_DEBOUNCE_MS: u64 = MIN_DEBOUNCE_MS;
pub const DEFAULT_DAILY_FIRING_BUDGET: u32 = 100;
pub const MAX_DAILY_FIRING_BUDGET: u32 = 1_000;
pub const OWNER_CONCURRENT_EVALUATIONS: usize = 4;
pub const MAX_PREDICATE_BYTES: usize = 16 * 1024;
pub const MAX_ARGUMENT_BYTES: usize = 64 * 1024;
pub const MAX_CLAUSES: usize = 8;
pub const MAX_GROUP_DEPTH: usize = 2;
pub const MAX_POINTER_BYTES: usize = 256;
pub const FIRING_JOURNAL_LIMIT: usize = 16;
// @ref LLP 0204#open-questions — OQ11 requires one published finite watch
// authority lifetime and renewal ceiling; v1 chooses 365 days for both.
pub const RENEWAL_CEILING_MS: u64 = 365 * 24 * 60 * 60 * 1_000;
pub const ANCHOR_LIFETIME_MS: u64 = RENEWAL_CEILING_MS;

#[derive(Clone, Debug)]
pub struct CreateWatchSpec {
    pub query_function: String,
    pub query_args: Value,
    pub predicate: Value,
    pub reaction: WatchReactionSpec,
    pub debounce_ms: u64,
    pub daily_firing_budget: u32,
}

#[derive(Clone, Debug)]
pub enum WatchReactionSpec {
    Function { function: String, args: Value },
    Webhook { url: String, secret: Option<String> },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchReactionKind {
    Function,
    Webhook,
}

impl WatchReactionKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Webhook => "webhook",
        }
    }

    pub fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "function" => Ok(Self::Function),
            "webhook" => Ok(Self::Webhook),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchOwnerKind {
    User,
    Integration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchAuthorityMode {
    CapturedGrant,
    RevalidatePrincipal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchStatus {
    Active,
    Suspended,
    Dead,
}

impl WatchStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Suspended => "suspended",
            Self::Dead => "dead",
        }
    }

    pub fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "active" => Ok(Self::Active),
            "suspended" => Ok(Self::Suspended),
            "dead" => Ok(Self::Dead),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchFunctionKind {
    Query,
    Mutation,
    Action,
}

impl WatchFunctionKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Mutation => "mutation",
            Self::Action => "action",
        }
    }

    pub fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "query" => Ok(Self::Query),
            "mutation" => Ok(Self::Mutation),
            "action" => Ok(Self::Action),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Predicate {
    Leaf(PredicateLeaf),
    And(Vec<Predicate>),
    Or(Vec<Predicate>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct PredicateLeaf {
    pub path: String,
    pub op: PredicateOp,
    pub value: Option<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PredicateOp {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Exists,
    Absent,
    Contains,
}

impl PredicateOp {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "eq" => Self::Eq,
            "ne" => Self::Ne,
            "gt" => Self::Gt,
            "gte" => Self::Gte,
            "lt" => Self::Lt,
            "lte" => Self::Lte,
            "exists" => Self::Exists,
            "absent" => Self::Absent,
            "contains" => Self::Contains,
            _ => return None,
        })
    }
}

/// Parse and canonicalize the complete v1 predicate grammar. Unknown members,
/// an invalid RFC 6901 pointer, too many clauses, or excess group nesting are
/// typed input refusals; no permissive serde catch-all exists.
///
/// @ref LLP 0204#d93--durable-watches-end-user-automations — predicates are bounded data over a
/// closed grammar, not arbitrary code.
pub fn parse_predicate(value: &Value) -> SnapbackResult<(Predicate, String)> {
    let canonical = canonical_json(value)?;
    if canonical.len() > MAX_PREDICATE_BYTES {
        return Err(input_invalid("predicate exceeds the 16 KiB v1 bound"));
    }
    let mut clauses = 0;
    let parsed = parse_node(value, 0, &mut clauses)?;
    Ok((parsed, canonical))
}

fn parse_node(value: &Value, depth: usize, clauses: &mut usize) -> SnapbackResult<Predicate> {
    let object = value
        .as_object()
        .ok_or_else(|| input_invalid("predicate nodes must be JSON objects"))?;
    if object.contains_key("and") || object.contains_key("or") {
        if object.len() != 1 {
            return Err(input_invalid(
                "predicate groups contain exactly one of and/or",
            ));
        }
        if depth >= MAX_GROUP_DEPTH {
            return Err(input_invalid("predicate group nesting exceeds depth 2"));
        }
        let (key, constructor): (&str, fn(Vec<Predicate>) -> Predicate) =
            if object.contains_key("and") {
                ("and", Predicate::And)
            } else {
                ("or", Predicate::Or)
            };
        let nodes = object[key]
            .as_array()
            .ok_or_else(|| input_invalid("predicate groups must contain an array"))?;
        if nodes.is_empty() {
            return Err(input_invalid("predicate groups cannot be empty"));
        }
        let mut parsed = Vec::with_capacity(nodes.len());
        for node in nodes {
            parsed.push(parse_node(node, depth + 1, clauses)?);
        }
        return Ok(constructor(parsed));
    }

    let allowed = ["path", "op", "value"];
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || !object.contains_key("path")
        || !object.contains_key("op")
    {
        return Err(input_invalid(
            "predicate leaves contain only path, op, and the operation's value",
        ));
    }
    *clauses += 1;
    if *clauses > MAX_CLAUSES {
        return Err(input_invalid("predicate exceeds 8 leaf clauses"));
    }
    let path = object["path"]
        .as_str()
        .ok_or_else(|| input_invalid("predicate path must be a string"))?;
    validate_pointer(path)?;
    let op = object["op"]
        .as_str()
        .and_then(PredicateOp::parse)
        .ok_or_else(|| input_invalid("predicate op is outside the closed v1 vocabulary"))?;
    let value = object.get("value").cloned();
    if matches!(op, PredicateOp::Exists | PredicateOp::Absent) && value.is_some() {
        return Err(input_invalid("exists and absent predicates omit value"));
    }
    if !matches!(op, PredicateOp::Exists | PredicateOp::Absent) && value.is_none() {
        return Err(input_invalid("this predicate operation requires value"));
    }
    Ok(Predicate::Leaf(PredicateLeaf {
        path: path.to_owned(),
        op,
        value,
    }))
}

fn validate_pointer(pointer: &str) -> SnapbackResult<()> {
    if pointer.len() > MAX_POINTER_BYTES || (!pointer.is_empty() && !pointer.starts_with('/')) {
        return Err(input_invalid(
            "predicate path must be a bounded RFC 6901 pointer",
        ));
    }
    let bytes = pointer.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'~' {
            if index + 1 == bytes.len() || !matches!(bytes[index + 1], b'0' | b'1') {
                return Err(input_invalid(
                    "predicate path contains an invalid RFC 6901 escape",
                ));
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(())
}

pub fn evaluate(predicate: &Predicate, document: &Value) -> bool {
    match predicate {
        Predicate::Leaf(leaf) => evaluate_leaf(leaf, document),
        Predicate::And(clauses) => clauses.iter().all(|clause| evaluate(clause, document)),
        Predicate::Or(clauses) => clauses.iter().any(|clause| evaluate(clause, document)),
    }
}

fn evaluate_leaf(leaf: &PredicateLeaf, document: &Value) -> bool {
    let actual = if leaf.path.is_empty() {
        Some(document)
    } else {
        document.pointer(&leaf.path)
    };
    match leaf.op {
        PredicateOp::Exists => actual.is_some(),
        PredicateOp::Absent => actual.is_none(),
        PredicateOp::Eq => actual == leaf.value.as_ref(),
        PredicateOp::Ne => actual.is_some() && actual != leaf.value.as_ref(),
        PredicateOp::Gt => compare(actual, leaf.value.as_ref()).is_some_and(|v| v.is_gt()),
        PredicateOp::Gte => compare(actual, leaf.value.as_ref()).is_some_and(|v| !v.is_lt()),
        PredicateOp::Lt => compare(actual, leaf.value.as_ref()).is_some_and(|v| v.is_lt()),
        PredicateOp::Lte => compare(actual, leaf.value.as_ref()).is_some_and(|v| !v.is_gt()),
        PredicateOp::Contains => match (actual, leaf.value.as_ref()) {
            (Some(Value::String(haystack)), Some(Value::String(needle))) => {
                haystack.contains(needle)
            }
            (Some(Value::Array(values)), Some(needle)) => values.contains(needle),
            (Some(Value::Object(object)), Some(Value::String(key))) => object.contains_key(key),
            _ => false,
        },
    }
}

fn compare(left: Option<&Value>, right: Option<&Value>) -> Option<std::cmp::Ordering> {
    match (left?, right?) {
        (Value::Number(left), Value::Number(right)) => left.as_f64()?.partial_cmp(&right.as_f64()?),
        (Value::String(left), Value::String(right)) => Some(left.cmp(right)),
        _ => None,
    }
}

pub fn canonical_json(value: &Value) -> SnapbackResult<String> {
    let canonical = canonicalize(value);
    serde_json::to_string(&canonical).map_err(|error| {
        input_invalid("watch JSON could not be canonicalized")
            .with_details(serde_json::json!({ "error": error.to_string() }))
    })
}

pub fn canonical_args(value: &Value) -> SnapbackResult<(String, String)> {
    if !value.is_object() {
        return Err(input_invalid(
            "watch query and reaction args must be JSON objects",
        ));
    }
    let canonical = canonical_json(value)?;
    if canonical.len() > MAX_ARGUMENT_BYTES {
        return Err(input_invalid("watch args exceed the 64 KiB v1 bound"));
    }
    let digest = format!("sha256:{:x}", Sha256::digest(canonical.as_bytes()));
    Ok((canonical, digest))
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonicalize(&object[key]));
            }
            Value::Object(canonical)
        }
        value => value.clone(),
    }
}

pub fn utc_day(now_ms: u64) -> u64 {
    now_ms / 86_400_000
}

pub fn input_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_WATCH_INPUT_INVALID", "watches", message.into())
}

pub fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WATCH_CATALOG_CORRUPT",
        "watches",
        "the durable watch catalog does not match the closed v1 schema",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_and_future_renewal_are_both_finite() {
        assert_eq!(ANCHOR_LIFETIME_MS, 365 * 24 * 60 * 60 * 1_000);
        assert_eq!(RENEWAL_CEILING_MS, ANCHOR_LIFETIME_MS);
    }
    use serde_json::json;

    #[test]
    fn predicate_grammar_is_closed_and_bounded() {
        let (predicate, canonical) = parse_predicate(&json!({
            "and": [
                {"path": "/rows/0/done", "op": "eq", "value": true},
                {"path": "/rows/0/title", "op": "contains", "value": "ship"}
            ]
        }))
        .unwrap();
        assert_eq!(
            canonical,
            r#"{"and":[{"op":"eq","path":"/rows/0/done","value":true},{"op":"contains","path":"/rows/0/title","value":"ship"}]}"#
        );
        assert!(evaluate(
            &predicate,
            &json!({"rows": [{"done": true, "title": "ship watches"}]})
        ));
        assert!(parse_predicate(&json!({"path": "/x", "op": "eval", "value": "code"})).is_err());
        assert!(parse_predicate(&json!({"code": "return true"})).is_err());
        assert!(parse_predicate(&json!({"path": "/bad~2", "op": "exists"})).is_err());
        assert!(
            parse_predicate(&json!({"and": [{"or": [{"and": [{"path": "", "op": "exists"}]}]}]}))
                .is_err()
        );
        assert!(
            parse_predicate(&json!({
                "or": (0..9)
                    .map(|index| json!({"path": format!("/rows/{index}"), "op": "exists"}))
                    .collect::<Vec<_>>()
            }))
            .is_err()
        );
    }

    #[test]
    fn edge_comparison_is_typed_and_contains_is_closed() {
        let (predicate, _) =
            parse_predicate(&json!({"path": "/count", "op": "gte", "value": 3})).unwrap();
        assert!(evaluate(&predicate, &json!({"count": 3})));
        assert!(!evaluate(&predicate, &json!({"count": "3"})));
        let (predicate, _) =
            parse_predicate(&json!({"path": "/tags", "op": "contains", "value": "urgent"}))
                .unwrap();
        assert!(evaluate(&predicate, &json!({"tags": ["urgent"]})));
    }
}
