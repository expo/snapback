//! Public Convex HTTP function API; JWT verification and authorization run in Convex.
use crate::Operation;
use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};
// @ref LLP 3000.009.001.002#4-controls — native function calls preserve the harness arrival schedule
pub fn request(client: &Client, url: &str, op: &Operation, tokens: &[String]) -> RequestBuilder {
    let (kind, path, args) = match op.workload.as_str() {
        "W1" => ("query", "chat:point", json!({"message":op.message})),
        "W2" => ("query", "chat:page", json!({"room":op.room})),
        "W3" => ("query", "chat:inbox", json!({})),
        "W4" | "W5" => ("mutation", "chat:increment", json!({"counter":op.counter})),
        _ => unreachable!(),
    };
    client
        .post(format!("{url}/api/{kind}"))
        .bearer_auth(&tokens[op.principal as usize])
        .json(&json!({"path":path,"args":args,"format":"json"}))
}
// Convex's JSON format emits integral Float64 values (e.g. 1.0). The fixture
// contract validates integer fields; preserve their exact safe integer value.
fn fixture_numbers(value: Value) -> Value {
    match value {
        Value::Array(a) => Value::Array(a.into_iter().map(fixture_numbers).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| (k, fixture_numbers(v)))
                .collect(),
        ),
        Value::Number(ref n) if n.is_f64() => {
            let f = n.as_f64().unwrap();
            if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0 {
                json!(f as i64)
            } else {
                value
            }
        }
        _ => value,
    }
}
pub fn normalize(value: Value) -> Value {
    if value["status"] == "success" {
        json!({"data":fixture_numbers(value["value"].clone())})
    } else {
        json!({"error":value["errorMessage"]})
    }
}
