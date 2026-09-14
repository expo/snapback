use super::loss_fixture as fixture;
use snapback4_core::engine::{Context, Engine};
use std::collections::BTreeMap;

fn engine(source: &str, scopes: [usize; 2]) -> Engine {
    let mut bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    for bound in &mut bound.programs { fixture::repeat_owned_site(&mut bound.program); }
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(fixture::rows(scopes)).unwrap();
    engine
}

macro_rules! case {
    ($test:ident, $op:literal, $a:literal, $b:literal) => {
        #[test]
        fn $test() {
            fixture::check($op, [$a, $b], engine(fixture::SOURCE, [$a, $b]).query($op, Context::new("dev:alice", BTreeMap::new())).unwrap());
        }
    };
}

case!(interrupted_twice_4_1, "interruptedTwice", 4, 1);
case!(interrupted_twice_5_0, "interruptedTwice", 5, 0);
case!(interrupted_twice_0_5, "interruptedTwice", 0, 5);
case!(interrupted_twice_1_1, "interruptedTwice", 1, 1);
case!(still_whole_4, "stillWhole", 4, 0);
case!(still_whole_5, "stillWhole", 5, 0);
case!(still_whole_6, "stillWhole", 6, 0);
case!(different_result_4, "differentResult", 4, 0);
case!(different_result_1, "differentResult", 1, 0);
case!(whole_and_different_4, "wholeAndDifferent", 4, 0);
case!(whole_and_different_6, "wholeAndDifferent", 6, 0);
case!(auxiliary_field, "auxiliaryField", 4, 0);
case!(auxiliary_finishes, "auxiliaryFinishes", 6, 0);
case!(auxiliary_breaks, "auxiliaryBreaks", 4, 0);
case!(overwritten_collector, "overwrittenCollector", 4, 0);
case!(direct_return_4, "directReturn", 4, 0);
case!(direct_return_1, "directReturn", 1, 0);
case!(direct_return_0, "directReturn", 0, 0);
case!(repeated_count_loses_first_cursor, "repeatedCount", 6, 0);
case!(repeated_count_exhausted, "repeatedCount", 5, 0);

#[test]
fn generated_row_coverage() {
    let mut cases = 0;
    for shape in fixture::shapes() {
        let source = fixture::generated(shape);
        for a in 0..=7 {
            for b in 0..=7 {
                let read = engine(&source, [a, b]).query("generated", Context::new("dev:alice", BTreeMap::new())).unwrap();
                fixture::oracle(shape, [a, b], read);
                cases += 1;
            }
        }
    }
    println!("generated row coverage: {cases} cases");
}

#[test]
fn repeated_owned_site_keeps_only_last_cursor() {
    for scopes in [[4, 7], [6, 1], [6, 7], [7, 0], [0, 7]] {
        let mut engine = engine(fixture::SOURCE, scopes);
        let repeated = engine.query("ownedAgain", Context::new("dev:alice", BTreeMap::new())).unwrap();
        let last = engine.query("ownedOnly", Context::new("dev:alice", BTreeMap::new())).unwrap();
        fixture::check_owned(scopes, repeated, last);
    }
}
