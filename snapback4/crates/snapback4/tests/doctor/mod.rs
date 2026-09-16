use super::effect_health;
use snapback4_core::{Engine, Store};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc};

#[test]
fn w8r1b_doctor_effect_line_keeps_one_snapshot_across_a_concurrent_claim() {
    let path = std::env::temp_dir().join(format!("sb4-doctor-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir(&path).unwrap();
    let mut writer = Engine::new(Store::open(&path.join("store.sqlite")).unwrap(), Default::default(), []).unwrap();
    writer.store().conn().execute_batch("INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at) VALUES ('push',1,'push','null','queued',0,100,200); INSERT INTO _effect_presence(principal,id,deadline) VALUES ('alice','push',200);").unwrap();
    writer.store().set_meta("dev:suppressed-effects", "7").unwrap();
    let reader = Engine::open(Store::open_read_only(&path.join("store.sqlite")).unwrap()).unwrap();
    let (counts, deferred) = effect_health(&reader, 100).unwrap();
    assert_eq!(counts["queued"], 1); assert_eq!(counts["suppressed"], 7);
    assert_eq!(deferred.unwrap(), (1, Some(200)));
    let (claim, start) = mpsc::channel();
    let (finish, claimed) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        start.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
        let runs = writer.claim_effects("worker", None, 1, 1_000, 201).unwrap();
        finish.send(runs.len()).unwrap();
    });
    let fired = Arc::new(AtomicBool::new(false)); let observed = fired.clone();
    reader.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
        if matches!(ctx.action, rusqlite::hooks::AuthAction::Read { table_name: "_effect_presence", .. }) && !observed.swap(true, Ordering::SeqCst) {
            claim.send(()).unwrap();
            assert_eq!(claimed.recv_timeout(std::time::Duration::from_secs(10)).unwrap(), 1);
        }
        rusqlite::hooks::Authorization::Allow
    })).unwrap();
    let (counts, deferred) = effect_health(&reader, 100).unwrap();
    worker.join().unwrap();
    assert!(fired.load(Ordering::SeqCst));
    assert_eq!(counts["queued"], 1);
    assert_eq!(deferred.unwrap(), (1, Some(200)), "the same line cannot mix pre-claim counts and post-claim deferrals");
    let (counts, deferred) = effect_health(&reader, 100).unwrap();
    assert_eq!(counts["running"], 1); assert_eq!(counts["suppressed"], 7);
    assert_eq!(deferred.unwrap(), (0, None));
    println!("doctor: concurrent_claims=1 snapshot_queued=1 snapshot_deferred=1 next_read_running=1 next_read_deferred=0 suppressed=7");
    drop(reader); std::fs::remove_dir_all(path).unwrap();
}
// Runtime-only codes cannot be produced by Quarry source. Exercise the same
// report function check uses with located diagnostic pairs, including those codes.
#[test]
fn w11_check_renderer_has_a_dedicated_excerpt_for_every_registered_code() {
    let mut cards = std::collections::BTreeSet::new();
    let mut largest = 0;
    for code in snapback4_lang::guide::codes() {
        let mut bound = snapback4_lang::compile(&[]);
        bound.diagnostics = [1, 2].into_iter().map(|line| snapback4_lang::Diagnostic::new(
            &snapback4_lang::diag::Site::new("fixture.q", line, 1), code, "fixture refusal", "fixture repair",
        )).collect();
        let (reports, hidden) = super::problem_reports(&bound, true, false);
        assert_eq!(hidden, 0);
        assert_eq!(reports.len(), 2);
        let keyword = snapback4_lang::diag::guide_for(code);
        cards.insert(keyword);
        let pointer = format!("Full card: snapback4 guide {keyword}");
        assert_eq!(reports[0].matches(&pointer).count(), 1, "{code}: {}", reports[0]);
        assert!(!reports[1].contains(&pointer), "{code}: {}", reports[1]);
        let explanation = bound.diagnostics[0].explanation_section().unwrap();
        let section = explanation.split_once("\n\n").unwrap().1;
        assert!(section.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == code), "{explanation}");
        assert!(!explanation.contains("No dedicated section"));
        assert!(reports[0].contains(&explanation));
        largest = largest.max(explanation.len() + 1);
        bound.diagnostics.truncate(1);
        let (single, _) = super::problem_reports(&bound, true, false);
        assert!(!single[0].contains(&pointer));
    }
    println!("W11 check renderer: codes={} cards={} repeats=2 excerpts=1 single_excerpts=0 maximum_bytes={largest}", snapback4_lang::guide::codes().len(), cards.len());
}
