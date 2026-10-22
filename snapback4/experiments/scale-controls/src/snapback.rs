//! Native serve HTTP only: deliberately independent of the server's store.
use crate::Operation;
use reqwest::{Client, RequestBuilder};
use serde_json::{Value, json};

// @ref LLP 3000.009.001.002#4-controls — no intermediate /op server or trusted-principal shortcut.
pub fn request(client: &Client, url: &str, op: &Operation, tokens: &[String]) -> RequestBuilder {
    let (path, args) = match op.workload.as_str() {
        "W1" => ("q/W1", json!({"message":format!("m{:010}",op.message)})),
        "W2" => ("q/W2", json!({"room":format!("r{:04}",op.room)})),
        "W3" => ("q/W3", json!({})),
        _ => (
            "m/increment",
            json!({"counter":format!("c{:04}",op.counter)}),
        ),
    };
    client
        .post(format!("{url}/{path}"))
        .bearer_auth(&tokens[op.principal as usize])
        .json(&json!({"args":args}))
}

pub fn normalize(op: &Operation, mut value: Value) -> Value {
    if op.workload == "W4" || op.workload == "W5" {
        if value["state"] != "sent" {
            return Value::Null;
        }
        value = json!({"data":value["result"].take()});
    } else if value["complete"] != true || value.get("denied").is_some() {
        return Value::Null;
    }
    // Quarry ids are nominal strings; controls use integer fixture keys.
    fn ids(v: &mut Value) {
        match v {
            Value::Array(a) => a.iter_mut().for_each(ids),
            Value::Object(o) => {
                for (key, v) in o {
                    if ["id", "room", "sender"].contains(&key.as_str()) {
                        if let Some(s) = v.as_str() {
                            if let Some(n) = s.get(1..).and_then(|s| s.parse::<i64>().ok()) {
                                *v = json!(n);
                            }
                        }
                    } else {
                        ids(v);
                    }
                }
            }
            _ => {}
        }
    }
    ids(&mut value["data"]);
    value
}
