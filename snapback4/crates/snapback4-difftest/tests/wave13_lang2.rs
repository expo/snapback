//! Generated source reaches the native, model and both actual device stores.
use snapback4_difftest::{campaign::{self,Report}, devices, execute, generate, lean, oracle::Verdict};

#[test]
fn generated_lang2_plans_have_no_new_native_device_or_lean_signatures() {
    lean::refresh().unwrap();
    assert!(lean::oracle_path().is_file(), "LANG2 qualification requires the Lean oracle");
    let mut files = devices::Files::new().unwrap();
    for seed in (0..8).chain([281]) {
        for shape in 0..3 {
            let case = generate::lang2(seed,shape);
            let source = case.program.source();
            execute::compile(&source).unwrap_or_else(|e| panic!("{seed}/{shape}: {e}\n{source}"));
            let mut native = Report::default();
            campaign::check(&case,&mut native, |finding| panic!("{seed}/{shape}: {finding:?}\n{source}"));
            assert!(!native.failed(), "{native:?}\n{source}");
            let model = lean::compare(&case,&source).unwrap();
            assert!(matches!(model.verdict,Verdict::Pass), "{seed}/{shape}: {:?}\n{source}",model.verdict);
            let mut device = Report::default();
            devices::check(&case,&mut device,&mut files,|finding| panic!("{seed}/{shape}: {finding:?}\n{source}")).unwrap();
            assert!(!device.failed(), "{device:?}\n{source}");
        }
    }
}
