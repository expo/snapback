//! Generated source reaches the native, model and both actual device stores.
use snapback4_difftest::{campaign::{self,Report}, devices, execute, generate, lean, oracle::Verdict};

#[test]
fn generated_lang2_plans_have_no_new_native_device_or_lean_signatures() {
    lean::refresh().unwrap();
    assert!(lean::oracle_path().is_file(), "LANG2 qualification requires the Lean oracle");
    let mut files = devices::Files::new().unwrap();
    for seed in (0..8).chain([281]) {
        for shape in 0..4 {
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

#[test]
fn immutable_equality_notes_preserve_native_device_and_lean_outcomes() {
    lean::refresh().unwrap();
    assert!(lean::oracle_path().is_file());
    let mut files = devices::Files::new().unwrap();
    for seed in 0..8 {
        for shape in 0..8 {
            let case = generate::immutable_patch(seed,shape);
            let source = case.program.source();
            let bound = snapback4_lang::compile(&[("schema.q".into(),source.clone())]);
            assert!(bound.diagnostics.is_empty(),"{:?}\n{source}",bound.diagnostics);
            assert!(bound.notes.iter().any(|d|d.code=="N_IMMUTABLE_PATCH"),"{source}");
            let mut native = Report::default();
            campaign::check(&case,&mut native,|finding|panic!("{seed}/{shape}: {finding:?}\n{source}"));
            assert!(!native.failed(),"{native:?}");
            if matches!(shape,1|5) { assert_eq!(native.runtime_refusals.get("E_CONSTRAINT"),Some(&1)); }
            else { assert!(native.runtime_refusals.is_empty(),"{native:?}"); }
            let model = lean::compare(&case,&source).unwrap();
            assert!(matches!(model.verdict,Verdict::Pass),"{seed}/{shape}: {:?}\n{source}",model.verdict);
            let mut device = Report::default();
            devices::check(&case,&mut device,&mut files,|finding|panic!("{seed}/{shape}: {finding:?}\n{source}")).unwrap();
            assert!(!device.failed(),"{device:?}");
            for store in devices::STORES {
                let kind = if matches!(shape,4|5) { "update" } else { "upsert" };
                let class = match shape { 1 | 5 => "refused-E_CONSTRAINT", 2 => "unpredictable-unsynced-table", 6 | 7 => "prediction-declined", _ => "predicted" };
                assert_eq!(device.store_stats.get(&format!("device-{store}-write-{kind}-{class}")),Some(&1),"{seed}/{shape}: {device:?}");
                for phase in ["write", "converge"] {
                    let counts = &device.by_oracle[&format!("device-{store}-{phase}")];
                    assert_eq!(counts.attempted,1);
                    assert!(counts.named.is_empty());
                    if shape == 2 || matches!(shape,6|7) && phase == "write" {
                        let reason = match (shape,phase) { (2,"write") => "unpredictable-unsynced-table", (2,_) => "converge-observe-online-only-unknown-incomplete", _ => "prediction-declined" };
                        assert_eq!(counts.passed,0);
                        assert_eq!(counts.unsupported.len(),1);
                        assert_eq!(counts.unsupported.get(reason),Some(&1));
                    } else {
                        assert_eq!(counts.passed,1,"{seed}/{shape}: {device:?}");
                        assert!(counts.unsupported.is_empty(),"{seed}/{shape}: {device:?}");
                    }
                }
            }
        }
    }
}
