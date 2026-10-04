use super::*;

#[test]
fn sync_window_population_note_is_read_only_and_quiet_after_adoption() {
    let p = Project::new();
    let mut engine = p.seed(&p.store(), 25);
    let source = SOURCE.replace("  read <- allow", "  read <- allow\n  sync last 2 by .id");
    p.source(&source);
    let tx = engine.store_mut().transaction().unwrap(); // A live writer cannot block inspection.
    let bytes = || ["", "-wal"].map(|suffix| fs::read(format!("{}{suffix}", p.store().display())).unwrap_or_default());
    let before = bytes();
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let data = parsed(&output);
    let note = data["notes"].as_array().unwrap().iter().find(|n| n["code"] == "N_SYNC_WINDOW_SIZE").unwrap();
    assert!(note["message"].as_str().unwrap().contains("at least 20 stored rows across all groups"));
    assert_eq!(note["guide"], "sync");
    assert_eq!(bytes(), before);
    tx.rollback().unwrap(); drop(engine);
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    drop(Engine::new(Store::open(&p.store()).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap());
    assert!(!String::from_utf8_lossy(&p.run(&["check", "--json"]).stdout).contains("N_SYNC_WINDOW_SIZE"));
    // A changed window near the population and a probe above the work bound stay quiet.
    for last in [3, 2000] {
        p.source(&SOURCE.replace("  read <- allow", &format!("  read <- allow\n  sync last {last} by .id")));
        assert!(!String::from_utf8_lossy(&p.run(&["check", "--json"]).stdout).contains("N_SYNC_WINDOW_SIZE"));
    }
}

#[test]
fn sync_window_advice_leaves_unadopted_and_missing_stores_alone() {
    let p = Project::new();
    p.source(&SOURCE.replace("  read <- allow", "  read <- allow\n  sync last 2 by .id"));
    for initialized in [false, true] {
        if initialized { drop(Store::open(&p.store()).unwrap()); }
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert!(!String::from_utf8_lossy(&output.stdout).contains("N_SYNC_WINDOW_SIZE"));
    }
}
