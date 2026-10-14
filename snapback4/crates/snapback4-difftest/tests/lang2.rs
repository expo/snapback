//! LLP 3000.040 §5: the generator draws calendar builtins and bounded ints,
//! every generated program compiles, the calendar cases are inside the Lean
//! model's fragment (so `run-lean` compares them rather than skipping them),
//! and the bounded cases run on the server and both device stores.
use snapback4_difftest::{
    ast::{Body, Expr, Type},
    campaign::Report,
    devices, execute, generate, lean,
    oracle::Verdict,
};
use std::collections::BTreeSet;

fn calendar(case: &generate::Case) -> bool {
    fn has(e: &Expr) -> bool {
        match e {
            Expr::Calendar(..) => true,
            Expr::Binary(_, a, b) => has(a) || has(b),
            Expr::Identity(a) | Expr::Assert(a) => has(a),
            _ => false,
        }
    }
    matches!(&case.program.body, Body::Scalar(e) if has(e))
}

fn bounded(case: &generate::Case) -> bool {
    case.program.tables[0].columns.iter().any(|c| matches!(c.ty, Type::IntRange(..))) || case.program.arg_bound.is_some()
}

fn rounding(case: &generate::Case) -> Option<(&'static str, Option<u8>)> {
    match &case.program.body {
        Body::Scalar(Expr::RoundedDivide(mode, scale, ..)) => Some((mode.source(), *scale)),
        _ => None,
    }
}

#[test]
fn calendar_bounded_and_rounded_cases_are_drawn_compile_and_reach_the_model() {
    let (mut calendars, mut bounds, mut supported, mut rounded) = (0, 0, 0, 0);
    let mut modes = BTreeSet::new();
    let mut scales = BTreeSet::new();
    let mut rounded_representative = None;
    for seed in 0..3_000 {
        // The Lean campaign's case: the shared generator, half narrowed into the fragment.
        let case = lean::generate(seed);
        let source = case.program.source();
        if calendar(&case) || bounded(&case) || rounding(&case).is_some() {
            execute::compile(&source).unwrap_or_else(|e| panic!("seed {seed}: {e}\n{source}"));
        }
        if calendar(&case) {
            calendars += 1;
            assert!(case.args["t"].is_i64(), "seed {seed}");
            // Another dimension (expiry, a projection) may leave the fragment;
            // a calendar builtin never does.
            match lean::module(&source).and_then(|m| m.program("run").map(|_| ()).map_err(|u| u.reason)) {
                Ok(()) => supported += 1,
                Err(reason) => assert!(!reason.starts_with("call-") && !reason.starts_with("calendar"), "seed {seed}: {reason}\n{source}"),
            }
        }
        if let Some((mode, scale)) = rounding(&case) {
            rounded += 1;
            modes.insert(mode);
            scales.insert(scale);
            rounded_representative.get_or_insert_with(|| case.clone());
            let module = lean::module(&source).unwrap_or_else(|reason| panic!("seed {seed}: {reason}\n{source}"));
            module.program("run").unwrap_or_else(|unsupported| panic!("seed {seed}: {}\n{source}", unsupported.reason));
        }
        let widened = generate::generate(seed);
        if bounded(&widened) {
            bounds += 1;
            execute::compile(&widened.program.source()).unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            if let Some(range) = widened.program.arg_bound {
                assert!(widened.program.source().contains(&format!("a: {}", Type::IntRange(range.0, range.1).source_text())), "seed {seed}");
            }
        }
    }
    assert!(calendars >= 100, "{calendars} calendar cases in 3,000 seeds");
    assert!(supported * 2 >= calendars, "{supported} of {calendars} calendar cases are compared by run-lean");
    assert!(bounds >= 300, "{bounds} bounded cases in 3,000 seeds");
    assert!(rounded >= 20, "{rounded} rounded-division cases in 3,000 seeds");
    assert_eq!(modes, ["away-from-zero", "ceiling", "floor", "half-away-from-zero", "half-even", "toward-zero"].into_iter().collect());
    assert_eq!(scales, [None, Some(0), Some(2), Some(6), Some(12)].into_iter().collect());

    // One drawn member of the new family must execute, not merely compile:
    // native server versus the independent Lean evaluator, then the same
    // server outcome versus both device stores.
    let case = rounded_representative.expect("a rounded-division representative");
    let source = case.program.source();
    lean::refresh().unwrap();
    assert!(lean::oracle_path().is_file(), "build the required Lean oracle first");
    let checked = lean::compare(&case, &source).unwrap();
    assert!(matches!(checked.verdict, Verdict::Pass) && checked.executed > 0,
        "rounded native/Lean execution: {:?}\n{source}", checked.verdict);
    let mut report = Report::default();
    let mut files = devices::Files::new().unwrap();
    devices::check(&case, &mut report, &mut files, |finding| panic!("rounded device disagreement: {finding:?}")).unwrap();
    assert!(!report.failed() && report.executed > 0, "rounded device executions: {report:#?}");
}
