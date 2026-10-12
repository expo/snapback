//! LLP 3000.040 §5: the generator draws calendar builtins and bounded ints,
//! every generated program compiles, the calendar cases are inside the Lean
//! model's fragment (so `run-lean` compares them rather than skipping them),
//! and the bounded cases run on the server and both device stores.
use snapback4_difftest::{ast::{Body, Expr, Type}, execute, generate, lean};

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

#[test]
fn calendar_and_bounded_cases_are_drawn_compile_and_reach_the_model() {
    let (mut calendars, mut bounds, mut supported) = (0, 0, 0);
    for seed in 0..3_000 {
        // The Lean campaign's case: the shared generator, half narrowed into the fragment.
        let case = lean::generate(seed);
        let source = case.program.source();
        if calendar(&case) || bounded(&case) {
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
}
