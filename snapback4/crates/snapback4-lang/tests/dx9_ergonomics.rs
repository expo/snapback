use snapback4_core::{Context, Engine, Value};
use snapback4_lang::compile;
use std::collections::BTreeMap;

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}\n{source}", bound.diagnostics);
    bound
}

#[test]
fn elif_and_typed_empty_nested_accumulator_execute() {
    let b = checked("fn distinct(names: [text <=80] <=8):\n  seen = [] of text <=80\n  for name in names:\n    for old in seen:\n      require lower(old) != lower(name) else DUPLICATE\n    seen = seen + [name]\n  return count(seen)\nquery crew(names: [text <=80] <=8):\n  n = distinct(names)\n  if n = 0:\n    return 'empty'\n  elif n = 1:\n    return 'one'\n  elif n = 2:\n    return 'two'\n  else:\n    return 'many'\n");
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for (names, expected) in [(vec![], "empty"), (vec!["A"], "one"), (vec!["A", "B"], "two"), (vec!["A", "B", "C"], "many")] {
        let args = BTreeMap::from([("names".into(), Value::Array(names.into_iter().map(|s| Value::String(s.into())).collect()))]);
        assert_eq!(engine.query("crew", Context::new("dev:alice", args)).unwrap().data, Value::String(expected.into()));
    }
    let args = BTreeMap::from([("names".into(), Value::Array(vec![Value::String("Ash".into()), Value::String("ASH".into())]))]);
    assert_eq!(engine.query("crew", Context::new("dev:alice", args)).unwrap_err().code, "DUPLICATE");
    for source in [
        "query q():\n  xs = [] of int\n  xs = xs + ['bad']\n  return xs\n",
        "query q(flag: bool):\n  xs = [] of int\n  if flag:\n    xs = ['bad']\n  return xs\n",
        "query q():\n  elif true:\n    return 1\n",
    ] { assert!(!compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty(), "{source}"); }
}

const TABLE: &str = "table records:\n  owner: principal\n  at: time ?\n  status: bool\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\n";

#[test]
fn nullable_field_guards_refine_snapshots_and_identical_reads_only() {
    for body in [
        "  row = records[id] ! else NOT_FOUND\n  require row.at != null else MISSING\n  return row.at + 1d\n",
        "  return records[id].at != null and records[id].at + 1d > now\n",
        "  if records[id].at = null:\n    return false\n  return records[id].at + 1d > now\n",
    ] { checked(&format!("{TABLE}query q(id: records):\n{body}")); }
    for body in [
        "  require records[id].at != null else MISSING\n  return records[other].at + 1d\n",
        "  require records[id].at != null else MISSING\n  update records[id] {{at: null}}\n  return records[id].at + 1d\n",
        "  if records[id].at != null:\n    pass = true\n  return records[id].at + 1d\n",
    ] {
        let body = body.replace("{{", "{").replace("}}", "}");
        let source = format!("{TABLE}mutation q(id: records, other: records):\n{body}");
        assert!(!compile(&[("schema.q".into(), source)]).diagnostics.is_empty(), "{body}");
    }
}

#[test]
fn focal_and_probe_diagnostics_name_the_actual_repair() {
    let source = format!("{TABLE}query q():\n  return records first 10 by .id {{owner, late: at = null}}\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_UNKNOWN" && d.rewrite.contains(".at")), "{:?}", b.diagnostics);
    let source = format!("{TABLE}query q(id: records):\n  return exists records[id, owner = viewer and status = true]\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.message.contains("commas") && d.rewrite.contains("column = value, other = value")), "{:?}", b.diagnostics);
    checked(&format!("{TABLE}query q(id: records):\n  return exists records[id, owner = viewer, status = true]\n"));
}
