//! Compare corresponding refusal sites without treating IR offsets or source
//! columns as stable across rewrites. Raw outcome records remain unchanged.
use crate::execute::Outcome;
use serde_json::Value;
use snapback4_core::{Engine, ir::Stmt};
use std::collections::BTreeMap;

fn sites(engine: &Engine) -> Vec<(String, String)> {
    fn explicit(value: &Value, out: &mut Vec<(String, String)>) {
        match value {
            Value::Object(fields) => {
                if let Some(r) = fields.get("Require") {
                    if let (Some(site), Some(code)) = (r["site"].as_str(), r["code"].as_str()) {
                        out.push((site.into(), format!("assert/{code}")));
                    }
                }
                for v in fields.values() {
                    explicit(v, out);
                }
            }
            Value::Array(values) => {
                for v in values {
                    explicit(v, out);
                }
            }
            _ => {}
        }
    }
    let p = engine.programs().find(|p| p.name == "run").unwrap();
    let mut out = Vec::new();
    for (i, stmt) in p.body.iter().enumerate() {
        let role = match stmt {
            Stmt::Require {
                code, site: None, ..
            } => Some(format!("require/{code}")),
            Stmt::WriteTarget { target, upsert, .. } => {
                Some(format!("write/{}/{upsert}", target.table))
            }
            Stmt::DeleteTarget { target } => Some(format!("delete/{}", target.table)),
            Stmt::Insert { table, .. } => Some(format!("insert/{table}")),
            _ => None,
        };
        if let Some(role) = role {
            out.push((format!("run:{}", i + 1), role));
        }
        explicit(&serde_json::to_value(stmt).unwrap(), &mut out);
    }
    out
}

pub fn corresponding(left: &Engine, right: &Engine, out: &Outcome) -> Outcome {
    let a = sites(left);
    let b = sites(right);
    let mut result = out.clone();
    // These rewrites preserve the order of authored assertions and writes.
    // Map only when the complete ordered role/code sequence agrees. New,
    // deleted, differently named and unrecognized sites remain exact checks.
    if a.iter().map(|x| &x.1).eq(b.iter().map(|x| &x.1)) {
        let map: BTreeMap<_, _> = b
            .iter()
            .zip(&a)
            .map(|(b, a)| (b.0.as_str(), a.0.as_str()))
            .collect();
        for key in ["refusal", "why"] {
            if let Some(site) = result.value.get_mut(key).and_then(|r| r.get_mut("site")) {
                if let Some(mapped) = site.as_str().and_then(|s| map.get(s)) {
                    *site = Value::String((*mapped).to_owned());
                }
            }
        }
    }
    result
}
