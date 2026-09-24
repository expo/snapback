//! Deterministic input corpus shared with the scratch baseline-golden writer.
use std::collections::BTreeMap;

pub type Sources = Vec<(String, String)>;
pub const PICK: &str = "fn pick(stop: bool):\n  if stop:\n    return 1\n  if true and true:\n    return 2\n  return 3\n\nmutation probe(stop: bool):\n  return pick(stop)\n";
const TABLE: &str = "effect notify\ntable notes:\n  n: int\n  unique byN: n\n  public 'notes'\n  sync public\n  insert <- allow\n  update <- allow\n  delete <- allow\n\nfn yes(value: bool): value\n";

pub fn generated() -> BTreeMap<String, Sources> {
    let mut cases = BTreeMap::from([("gpt-pick".into(), vec![("schema.q".into(), PICK.into())])]);
    for returns in 0..=3 {
        for flow in ["if", "else-if", "for"] {
            for depth in 1..=3 {
                for before in [false, true] {
                    for payload in [false, true] {
                        for (form, expr) in [
                            ("and", "true and true"), ("or", "false or true"), ("coalesce", "maybe ?? true"),
                            ("helper", "yes(true) and yes(false)"), ("read", "exists notes[n = 0] or exists notes[n = 1]"),
                            ("new", "new != new and true"),
                        ] {
                            for kind in ["mutation", "query"] {
                                if kind == "query" && (payload || form == "new") { continue; }
                                let mut early = String::new();
                                for n in 0..returns {
                                    match flow {
                                        "if" => early.push_str(&format!("  if stop = {n}:\n    return {n}\n")),
                                        "else-if" => early.push_str(&format!("  {} stop = {n}:\n    return {n}\n", if n == 0 { "if" } else { "else if" })),
                                        _ => early.push_str(&format!("  for i{n} in range(0, 2):\n    if stop = {n}:\n      return {n}\n")),
                                    }
                                }
                                let mut setup = if payload { format!("emit notify {{ value: {expr} }}\n") } else { format!("if {expr}:\n  return 7\n") };
                                for _ in 1..depth { setup = format!("if true:\n{}", indent(&setup)); }
                                setup = indent(&setup);
                                let body = if before { format!("{setup}{early}") } else { format!("{early}{setup}") };
                                let mut source = format!("{TABLE}\nfn candidate(stop: int, maybe: bool ?):\n{body}  return 9\n");
                                // Nest helper expansions independently of the source if nesting.
                                let mut target = "candidate".to_owned();
                                for n in 1..depth {
                                    source.push_str(&format!("\nfn nested{n}(stop: int, maybe: bool ?):\n  return {target}(stop, maybe)\n"));
                                    target = format!("nested{n}");
                                }
                                source.push_str(&format!("\n{kind} probe(stop: int, maybe: bool ?):\n  return {target}(stop, maybe)\n"));
                                let key = format!("generated-{returns}-{flow}-{depth}-{before}-{payload}-{form}-{kind}");
                                cases.insert(key, vec![("schema.q".into(), source)]);
                            }
                        }
                    }
                }
            }
        }
    }
    cases
}

fn indent(value: &str) -> String { value.lines().map(|line| format!("  {line}\n")).collect() }

pub fn census() -> BTreeMap<String, Sources> {
    // The exact 740 source bundles captured by R1p, including refusals. They
    // are inputs, not vendored compiler code, and retain their content keys.
    include_str!("r1p-sources.jsonl").lines().map(|line| serde_json::from_str(line).unwrap()).collect()
}
