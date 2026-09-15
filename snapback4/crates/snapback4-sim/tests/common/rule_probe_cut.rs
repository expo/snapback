//! Authorization probes at a point-read boundary, shared by all three hosts.
use snapback4_core::{Ceilings, Context, QueryOutcome, Value};
use snapback4_core::error::{MeterKind, Refusal};
use snapback4_core::value::object;
use std::collections::BTreeMap;

pub fn source(negated: bool, twice: bool) -> String {
    let probe = if negated { "not exists permits[owner = viewer]" } else { "exists permits[owner = viewer]" };
    let rule = if twice { format!("{probe} and {probe}") } else { probe.into() };
    format!(r#"
table permits:
  owner: principal
  unique byOwner: owner
  read <- deny
table records:
  body: text <=20
  read <- {rule}
table items:
  recordId: records
  read <- public
  sync public
query point(recordId: records):
  return records[recordId]
query missing(recordId: records):
  return not exists records[recordId]
query shaped(c: cursor ?):
  return items[] after c first 1 by byId {{ record: records[.recordId] }}
query guarded(c: cursor ?):
  return items[] after c first 1 by byId {{ allowed: exists records[.recordId] }}
query filtered(c: cursor ?):
  return items[] after c first 1 by byId where not exists records[.recordId]
query required(recordId: records):
  return records[recordId] ! else RECORD_MISSING
"#)
}

pub fn seed(world: &str, negated: bool) -> Vec<(String, Value)> {
    let mut rows: Vec<_> = (0..2).map(|n| ("items".into(), object([
        ("id", Value::Id(format!("item{n}"))), ("recordId", Value::Id("record".into())),
    ]))).collect();
    if world != "absent" {
        rows.push(("records".into(), object([("id", Value::Id("record".into())), ("body", Value::String("protected".into()))])));
    }
    if (world == "visible") != negated {
        rows.push(("permits".into(), object([("id", Value::Id("permit".into())), ("owner", Value::Id("dev:alice".into()))])));
    }
    rows
}

pub fn context(name: &str) -> Context {
    let args = if matches!(name, "point" | "missing" | "required") { BTreeMap::from([("recordId".into(), Value::Id("record".into()))]) } else { BTreeMap::new() };
    Context::new("dev:alice", args).at(100)
}

pub fn check(host: &str, world: &str, twice: bool, mut query: impl FnMut(&str, Ceilings) -> Result<QueryOutcome, Refusal>) -> Vec<Result<QueryOutcome, Refusal>> {
    let mut observations = Vec::new();
    for name in ["point", "missing", "shaped", "guarded", "filtered", "required"] {
        let control = query(name, Ceilings::default());
        if name == "required" && world != "visible" {
            assert_eq!(control.as_ref().unwrap_err().code, "RECORD_MISSING");
        } else {
            let result = control.as_ref().unwrap();
            assert!(result.capped_at.is_none(), "{host} {world} {name}: {result:?}");
            assert_eq!(result.complete, host == "server", "online-only device coverage remains incomplete");
            if name == "point" || name == "required" { assert_eq!(result.data == Value::Null, world != "visible"); }
            if name == "missing" { assert_eq!(result.data, Value::Bool(world != "visible")); }
            if name == "shaped" || name == "guarded" { assert!(result.next.is_some(), "completed source page keeps its cursor"); }
        }
        observations.push(control);
        // A predicate first pays its own lookup charge; leave the rule with
        // zero probes, or one probe for a rule whose worst case needs two.
        let rule_probes = u64::from(name == "filtered") + u64::from(twice);
        let cut = query(name, Ceilings { rule_probes, ..Ceilings::default() });
        println!("RULE_PROBE_CUT host={host} world={world} name={name} probes={rule_probes} result={cut:?}");
        let result = cut.as_ref().unwrap();
        assert!(!result.complete, "{host} {world} {name}: a cut authorization is unknown");
        assert_eq!(result.data, Value::Null, "{host} {world} {name}: unknown authorization withholds the result");
        assert!(result.next.is_none(), "no continuation past an unknown authorization");
        assert_eq!(result.capped_at.as_ref().map(|cut| cut.0), Some(MeterKind::RuleProbes));
        observations.push(cut);
    }
    observations
}
