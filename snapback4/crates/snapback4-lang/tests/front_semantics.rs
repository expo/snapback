use snapback4_core::{Context, Engine, Value};
use snapback4_lang::compile;
use std::collections::BTreeMap;

#[test]
fn utc_clock_hour_uses_existing_ir_for_negative_times_and_i53_extremes() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("time").unwrap()).into_iter().find(|s| s.contains("query clock(t:")).unwrap();
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for t in [-9_007_199_254_740_991i64, -86_400_001, -86_400_000, -3_600_001, -3_600_000, -1, 0, 3_599_999, 3_600_000, 86_399_999, 86_400_000, 1_791_739_800_000, 9_007_199_254_740_991] {
        let result = engine.query("clock", Context::new("dev:test", BTreeMap::from([("t".into(), Value::Int(t))]))).unwrap().data;
        assert_eq!(result.field("ordinal").unwrap(), &Value::Int(t.div_euclid(3_600_000)), "{t}");
        assert_eq!(result.field("clock").unwrap(), &Value::Int(t.div_euclid(3_600_000).rem_euclid(24)), "{t}");
    }
    for source in ["query q(t: time ?):\n  return hourOfDay(t)\n", "query q(t: int):\n  return hourOfDay(t)\n", "query q():\n  return hourOfDay()\n", "query q():\n  return hourOfDay(now, 1h)\n"] {
        assert!(!compile(&[("schema.q".into(), source.into())]).diagnostics.is_empty(), "{source}");
    }
}

const SWEEP: &str = "table tickets:\n  deadline: time\n  closed: bool\n  public\n  insert <- allow\n  update <- allow\n  cap 10\n  online only\njob closeDue():\n  for t in tickets:\n    if t.deadline <= now:\n      update tickets[t.id] { closed: true }\nschedule sweep every 1m: closeDue\nmutation act(id: tickets):\n  row = tickets[id] ! else NOT_FOUND\n  require not row.closed else CLOSED\n  update tickets[id] { closed: false }\n";
fn notes(source: &str) -> Vec<snapback4_lang::Diagnostic> {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}\n{source}", b.diagnostics);
    b.notes.into_iter().filter(|n| n.code == "N_SWEEP_DEADLINE").collect()
}
#[test]
fn sweep_deadline_names_the_exact_row_and_does_not_invent_guard_direction() {
    let n = notes(SWEEP); assert_eq!(n.len(), 1, "{n:?}");
    for text in ["mutation act", "job closeDue", "row.deadline", "row.closed", "not a proof"] { assert!(n[0].message.contains(text), "{n:?}"); }
    assert!(n[0].rewrite.contains("opening/closing direction and equality"));
    assert!(!n[0].rewrite.contains("require row.deadline > now"));
    let open = SWEEP.replace("closed", "open").replace("<= now", ">= now").replace("require not row.open", "require row.open");
    assert_eq!(notes(&open).len(), 1, "an opening is not an expiry");
    for comparison in ["row.deadline > now", "now < row.deadline", "row.deadline >= now", "now <= row.deadline"] {
        let guarded = SWEEP.replace("  require not row.closed", &format!("  require {comparison} else EXPIRED\n  require not row.closed"));
        assert!(notes(&guarded).is_empty(), "{comparison}");
    }
    // Unrelated clock work is not a guard on this row's deadline.
    let unrelated = SWEEP.replace("  require not row.closed", "  require now > 0 else EARLY\n  require not row.closed");
    assert_eq!(notes(&unrelated).len(), 1);
    let unrelated_table = SWEEP.replace("job closeDue():", "table other:\n  closed: bool\n  public\n  online only\njob closeDue():").replace("mutation act(id: tickets):", "mutation act(id: other):").replace("row = tickets[id] ! else NOT_FOUND", "row = other[id] ! else NOT_FOUND").replace("update tickets[id] { closed: false }", "return true");
    assert!(notes(&unrelated_table).is_empty());
    assert!(notes(&SWEEP.replace("schedule sweep every 1m: closeDue\n", "")).is_empty());
    let period = SWEEP.replace("job closeDue():", "job closeDue(periodEnd: time):").replace("<= now", "<= periodEnd");
    assert_eq!(notes(&period).len(), 1);
}

#[test]
fn sweep_notes_follow_qualified_job_targets_in_modules() {
    let source = SWEEP.replace("schedule sweep every 1m: closeDue", "schedule sweep every 1m: workflow.closeDue");
    let b = compile(&[("workflow.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let notes: Vec<_> = b.notes.iter().filter(|n| n.code == "N_SWEEP_DEADLINE").collect();
    assert_eq!(notes.len(), 1, "{:?}", b.notes);
    assert!(notes[0].message.contains("job workflow.closeDue") && notes[0].message.contains("mutation workflow.act"), "{:?}", notes);
}

#[test]
fn a_confirmation_guard_cannot_replace_the_deadline_used_by_its_overdue_sweep() {
    let source = SWEEP.replace("  closed: bool", "  closed: bool\n  confirmed: bool\n  unrelated: bool")
        .replace("if t.deadline <= now:", "if not t.confirmed and t.deadline <= now:")
        .replace("require not row.closed", "require not row.confirmed")
        .replace("{ closed: false }", "{ confirmed: true }");
    let found = notes(&source); assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].message.contains("tests row.confirmed") && found[0].message.contains("writes column tickets.confirmed") && found[0].message.contains("also tests that column"), "{found:?}");
    let guarded = source.replace("  require not row.confirmed", "  require row.deadline > now else EXPIRED\n  require not row.confirmed");
    assert!(notes(&guarded).is_empty());
    assert!(notes(&source.replace("require not row.confirmed", "require not row.unrelated").replace("{ confirmed: true }", "{ unrelated: true }")).is_empty());
    let separate = source.replace("if not t.confirmed and t.deadline <= now:
      update tickets[t.id] { closed: true }", "if t.deadline <= now:
      update tickets[t.id] { closed: true }
    if not t.confirmed:
      continue");
    let correlation = notes(&separate); assert_eq!(correlation.len(), 1, "{correlation:?}");
    assert!(correlation[0].message.contains("not a proof of control flow, row identity or safety"), "{correlation:?}");
    assert!(!correlation[0].message.contains("before its timed status update"));
}
