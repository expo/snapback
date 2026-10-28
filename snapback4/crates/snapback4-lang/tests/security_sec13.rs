//! Actual wave-32 source shapes, copied without touching running lanes.
// @ref LLP 3000.036.004.001#sec13-required-evidence-and-time-anchors — names ask questions; safe variants must not acquire gates.
use snapback4_lang::{compile,security};
fn notes(source:&str)->Vec<snapback4_lang::Diagnostic> {
    let sources=vec![("schema.q".into(),source.into())];let bound=compile(&sources);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    security::time_anchors::candidates(&sources,&bound).into_iter().map(|q|q.note).collect()
}
#[test]fn wave32_mutable_move_and_self_relative_reschedule() {
    let downsizing=include_str!("security/sec13/004.q");
    let ns=notes(downsizing);
    assert!(ns.iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"&&n.message.contains("updateMove")&&n.message.contains("scheduleVisit")&&n.message.contains("moves.moveDate")),"{ns:?}");
    let piano=include_str!("security/sec13/029.q");let ns=notes(piano);
    assert!(ns.iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"&&n.message.contains("reschedule")&&n.message.contains("moves.scheduledAt")),"{ns:?}");
    let safe=piano.replace("  scheduledAt: time\n","  scheduledAt: time\n  originalAt: time\n  immutable originalAt\n").replace("stops, scheduledAt }","stops, scheduledAt, originalAt: scheduledAt }").replace("m.scheduledAt + 60d","m.originalAt + 60d");
    assert!(!notes(&safe).iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"));
    let safe=downsizing.replace(" { address, phone, careNeeds, price, moveDate }"," { address, phone, careNeeds, price }");
    assert!(!notes(&safe).iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"));
}
#[test]fn wave32_booking_clock_is_not_the_sitting_time() {
    let source=include_str!("security/sec13/025.q");let ns=notes(source);
    assert!(ns.iter().any(|n|n.code=="N_EVENT_TIME_ANCHOR"&&n.message.contains("bookExam")&&n.message.contains("scheduledAt")&&n.message.contains("completedAt")),"{ns:?}");
    let safe=source.replace("now <= prior.completedAt + 30d","scheduledAt <= prior.completedAt + 30d");
    assert!(!notes(&safe).iter().any(|n|n.code=="N_EVENT_TIME_ANCHOR"),"{:?}",notes(&safe));
}
#[test]fn same_resource_identity_and_immutable_anchor_controls() {
    let source="table tasks:\n  at: time\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation edit(task: tasks, at: time):\n  t = tasks[task] ! else MISSING\n  require now <= t.at + 1d else CLOSED\n  return update tasks[task] { at }\n";
    assert!(notes(source).iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"));
    let safe=source.replace("{ at }","{ at: t.at }");
    assert!(!notes(&safe).iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"));
    let wrong=safe.replace("mutation edit(task: tasks, at: time)","mutation edit(task: tasks, other: tasks, at: time)").replace("at: t.at","at: tasks[other].at ! else MISSING");
    assert!(notes(&wrong).iter().any(|n|n.code=="N_MOVABLE_TIME_ANCHOR"));
}
