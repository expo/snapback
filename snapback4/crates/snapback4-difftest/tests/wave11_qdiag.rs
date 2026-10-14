use snapback4_difftest::{generate,execute,lean};
#[test]
fn generated_contextual_sources_match_native_and_lean(){
    for seed in 0..32 {
        let (case,implicit,explicit)=generate::qdiag(seed);
        let a=execute::execute(&mut execute::engine(&case,&implicit).unwrap(),&case,"run",&case.args);
        let b=execute::execute(&mut execute::engine(&case,&explicit).unwrap(),&case,"run",&case.args);
        assert_eq!(a,b,"seed {seed}");
        for source in [&implicit,&explicit] {
            let checked=lean::compare(&case,source).unwrap();
            assert!(matches!(checked.verdict,snapback4_difftest::oracle::Verdict::Pass),"seed {seed}: {:?}",checked.verdict);
        }
    }
}
