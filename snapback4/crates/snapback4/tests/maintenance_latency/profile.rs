//! Commit wall time includes the automatic checkpoint, when one is due.
use super::*;
use rusqlite::trace::{TraceEvent, TraceEventCodes};
use std::cell::RefCell;

thread_local! {
    static COMMITS: RefCell<(Option<Instant>, Vec<f64>)> = const { RefCell::new((None, Vec::new())) };
}
fn trace(event: TraceEvent<'_>) {
    match event {
        TraceEvent::Stmt(_, "COMMIT") => COMMITS.with_borrow_mut(|s| s.0 = Some(Instant::now())),
        TraceEvent::Profile(_, _) => COMMITS.with_borrow_mut(|s| {
            if let Some(start) = s.0.take() { s.1.push(start.elapsed().as_secs_f64() * 1000.0); }
        }),
        _ => (),
    }
}

#[test]
#[ignore = "FULL/NORMAL and automatic-checkpoint comparison; explicit storage qualification"]
fn following_commit_cost() {
    for synchronous in ["NORMAL", "FULL"] {
        for checkpoint in [1000, 0] {
            let fixture = Fixture::new(&format!("commit-{synchronous}-{checkpoint}"));
            let mut engine = fixture.engine();
            engine.store().conn().execute_batch(&format!("PRAGMA synchronous={synchronous}; PRAGMA wal_autocheckpoint={checkpoint};")).unwrap();
            // Same 20-post store as the HTTP witness. Report steady-state cost.
            for n in 0..20 {
                let result = engine.mutate("post", None, Context::new("dev:big", [("postId".into(), Value::Id(format!("preload-{n}"))), ("parentId".into(), Value::Null)].into()).at(2)).unwrap();
                assert!(matches!(result.state, WriteState::Sent { .. }));
                while engine.run_timeline_chunk_for(3, Duration::MAX).unwrap().is_some() {}
            }
            engine.store().conn().trace_v2(TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_PROFILE, Some(trace));
            for budget in [Duration::MAX, Duration::from_millis(1), Duration::from_millis(2)] {
                let result = engine.mutate("post", None, Context::new("dev:big", [("postId".into(), Value::Id(format!("profile-{budget:?}"))), ("parentId".into(), Value::Null)].into()).at(4)).unwrap();
                assert!(matches!(result.state, WriteState::Sent { .. }));
                COMMITS.with_borrow_mut(|s| s.1.clear());
                let start = Instant::now();
                let mut copies = 0;
                while let Some(meter) = {
                    let chunk = Instant::now();
                    let result = engine.run_timeline_chunk_for(5, budget).unwrap();
                    if budget == Duration::MAX && copies == 0 {
                        let commit = COMMITS.with_borrow(|s| s.1.last().copied().unwrap());
                        println!("MEASURE first_chunk synchronous={synchronous} autocheckpoint={checkpoint} copies={} commit_ms={commit:.3} elapsed_ms={:.3}", result.unwrap().rows_written - 1, chunk.elapsed().as_secs_f64()*1000.0);
                    }
                    result
                } {
                    copies += meter.rows_written - 1;
                }
                assert_eq!(copies, 900);
                let elapsed = start.elapsed();
                let commits = COMMITS.with_borrow_mut(|s| std::mem::take(&mut s.1));
                report(&format!("commit synchronous={synchronous} autocheckpoint={checkpoint} budget={budget:?}"), &commits);
                println!("MEASURE profile synchronous={synchronous} autocheckpoint={checkpoint} budget={budget:?} commit_total_ms={:.3} copies={copies} elapsed_ms={:.3} us_per_copy={:.3}", commits.iter().sum::<f64>(), elapsed.as_secs_f64()*1000.0, elapsed.as_secs_f64()*1e6/copies as f64);
            }
        }
    }
}
