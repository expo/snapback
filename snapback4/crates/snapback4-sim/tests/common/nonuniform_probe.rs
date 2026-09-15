//! N1: a read-rule probe cut on a non-uniform scan keeps hidden and absent
//! worlds wire-identical. Operator meter fields intentionally are not wire.
#![allow(dead_code)]
use snapback4_core::{Ceilings, Context, QueryOutcome, Value};
use snapback4_core::error::Refusal;
use snapback4_core::value::object;

// Fixed to the refilled Following page's uncut cost, for the same sweep before and after.
pub const EXAMINED_SWEEP: u64 = 82;

pub const SOURCE: &str = "table permits:\n  owner: principal\n  unique byOwner: owner\n  public 'permits'\n  online only\ntable records:\n  owner: principal\n  body: text <=100\n  read <- exists permits[owner = .owner]\n  online only\nquery page(c: cursor ?):\n  return records[] after c first 1 by byId\nquery filtered(c: cursor ?):\n  return records[] after c first 1 by byId where true\nquery refuses(c: cursor ?):\n  page = records[] after c first 1 by byId\n  require false else STOP\n  return page\n";

pub fn context() -> Context { Context::new("dev:reader", Default::default()).at(300) }
pub fn rows(hidden: bool) -> Vec<(String, Value)> {
    let mut rows = vec![("permits".into(), object([("id", Value::Id("grant".into())), ("owner", Value::Id("dev:allowed".into()))]))];
    if hidden {
        for n in 0..20 { rows.push(("records".into(), object([("id", Value::Id(format!("secret-{n:02}"))), ("owner", Value::Id("dev:hidden".into())), ("body", Value::String("SECRET".into()))]))); }
    }
    rows
}
pub fn visible() -> (String, Value) {
    ("records".into(), object([("id", Value::Id("visible".into())), ("owner", Value::Id("dev:allowed".into())), ("body", Value::String("VISIBLE".into()))]))
}

pub fn sweep(cost: u64, mut query: impl FnMut(&str, Ceilings) -> Result<QueryOutcome, Refusal>) -> Vec<serde_json::Value> {
    let mut observed = Vec::new();
    for examined in 1..=cost {
        for rule_probes in [0, Ceilings::default().rule_probes] {
            for name in ["page", "filtered", "refuses"] {
                let result = query(name, Ceilings { examined, rule_probes, ..Default::default() });
                let body = match result {
                    Ok(page) => {
                        assert_eq!(page.data, Value::Array(vec![]));
                        assert!(!page.complete);
                        assert!(page.next.is_none());
                        serde_json::json!({"data":snapback4_core::wire::to_json(&page.data), "complete":page.complete, "next":page.next, "seq":page.seq, "tables":page.tables, "nextExpiry":page.next_expiry})
                    }
                    Err(why) => { assert_eq!(name, "refuses"); assert_eq!(why.code, "STOP"); serde_json::json!({"denied":why}) }
                };
                observed.push(body);
            }
        }
    }
    observed
}

pub fn positive(page: QueryOutcome) {
    assert_eq!(page.data.as_array().unwrap().len(), 1);
    assert_eq!(page.data.as_array().unwrap()[0].field("body").unwrap(), &Value::String("VISIBLE".into()));
    assert!(!page.complete, "the non-uniform class stays incomplete even with a visible match");
}
