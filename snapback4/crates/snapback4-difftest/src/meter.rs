//! Public-outcome boundary probes. Read counters can resume after progress;
//! heap/steps/output and opening cuts have separate, documented checks.
use crate::{
    ast::{Body, Read},
    execute::{self, Outcome},
    generate::Case,
    oracle::{self, Oracle, Verdict},
};
use serde_json::{Value as Json, json};
use snapback4_core::Ceilings;
use std::collections::BTreeSet;

pub fn array(out: &Outcome) -> Option<Vec<Json>> {
    out.data()?.get("Array")?.as_array().cloned()
}

pub fn drain(
    engine: &mut impl execute::Executor,
    case: &Case,
    first: &Outcome,
) -> Result<(Vec<Json>, Vec<Outcome>), String> {
    let mut data = array(first).ok_or("non-array-result")?;
    let mut trail = vec![];
    let mut next = first.next().map(str::to_owned);
    let mut seen = BTreeSet::new();
    engine.set_ceilings(Ceilings::unbounded());
    while let Some(cursor) = next {
        if !seen.insert(cursor.clone()) || trail.len() > case.rows.len() + 1 {
            return Err("cursor-cycle".into());
        }
        let mut args = case.args.clone();
        args["c"] = json!(cursor);
        let out = execute::execute(engine, case, "run", &args);
        if out.cut() || out.refusal().is_some() || out.value["unavailable"] == true {
            return Err("continuation-unavailable".into());
        }
        let rows = array(&out).ok_or("non-array-continuation")?;
        data.extend(rows);
        next = out.next().map(str::to_owned);
        trail.push(out);
    }
    Ok((data, trail))
}

pub fn check(
    case: &Case,
    engine: &mut impl execute::Executor,
    baseline: &Outcome,
    dimension: &str,
    n: u64,
) -> (Verdict, u64, Outcome) {
    let oracle = Oracle::Meter {
        dimension: dimension.into(),
        ceiling: n,
    };
    engine.set_ceilings(oracle::ceiling(dimension, n));
    let cut = execute::execute(engine, case, "run", &case.args);
    let fail =
        |field: &str| oracle::disagreement(&oracle, field, baseline.clone(), cut.clone(), vec![]);
    // A ceiling at a measured charge may already finish. It is a boundary
    // control and must equal the baseline, including every meter and site.
    if !cut.cut() {
        let v = match oracle::field(baseline, &cut, false) {
            Some(f) => fail(&f),
            None => Verdict::Pass,
        };
        return (v, 1, cut);
    }
    if cut.value.get("complete") == Some(&json!(true)) {
        return (fail("complete"), 1, cut);
    }
    // Repeating the same cut must agree on the entire outcome, including the
    // cursor, all seven counters, tables, expiry and the refusal envelope.
    engine.set_ceilings(oracle::ceiling(dimension, n));
    let again = execute::execute(engine, case, "run", &case.args);
    if let Some(f) = oracle::field(&cut, &again, false) {
        return (fail(&format!("repeat-{f}")), 2, cut);
    }
    if cut.refusal().is_some() {
        return (
            Verdict::Unsupported(format!("{dimension}-refusal-no-continuation")),
            2,
            cut,
        );
    }
    if !matches!(
        case.program.body,
        Body::Read {
            kind: Read::Page,
            ..
        }
    ) {
        return (Verdict::Unsupported("return-not-pageable".into()), 2, cut);
    }
    if matches!(dimension, "heap_bytes" | "steps" | "output_bytes") {
        return (
            Verdict::Unsupported(format!("{dimension}-unwind-no-continuation")),
            2,
            cut,
        );
    }
    if cut.next().is_none() {
        if array(&cut).is_some_and(|a| !a.is_empty()) {
            return (fail("cut-without-cursor"), 2, cut);
        }
        return (
            Verdict::Unsupported(format!("{dimension}-opening-no-position")),
            2,
            cut,
        );
    }
    let full = drain(engine, case, baseline);
    let resumed = drain(engine, case, &cut);
    match (full, resumed) {
        (Ok((a, mut x)), Ok((b, y))) => {
            let count = 2 + x.len() as u64 + y.len() as u64;
            x.extend(y);
            let v = if a != b {
                oracle::disagreement(&oracle, "continued-data", baseline.clone(), cut.clone(), x)
            } else {
                Verdict::Pass
            };
            (v, count, cut)
        }
        (Err(e), _) => (fail(&format!("baseline-{e}")), 2, cut),
        (_, Err(e)) => (fail(&e), 2, cut),
    }
}
