//! Reply deadlines belong to emitted answers, not attempted authorization.
use super::{Backend, MODEL, ctx, id, system};
use snapback4_core::{Value, error::MeterKind, meter::Ceilings};

const CLOCK: &str = "\ntable clocks:\n  until: time\n  expire at .until\n  read <- allow\n  insert <- allow\nmutation clock():\n  insert clocks { id: 'k', until: 700 }\n";
const GATES: &str = "\ntable gates:\n  owner: principal\n  until: time\n  unique owner\n  expire at .until\n  read <- deny\n  insert <- allow\ntable guards:\n  owner: principal\n  unique owner\n  read <- deny\n  insert <- allow\nmutation gate(owner: principal, until: time):\n  insert gates { owner, until }\n  insert guards { owner }\n";
fn group(e: &mut dyn Backend, name: &str, deadline: i64) {
    system(
        e,
        "parent",
        &[
            ("id", id(name)),
            ("owner", id(name)),
            ("until", Value::Null),
        ],
    );
    system(
        e,
        "child",
        &[
            ("id", id(name)),
            ("parent", id(name)),
            ("until", Value::Int(900)),
        ],
    );
    system(
        e,
        "gate",
        &[("owner", id(name)), ("until", Value::Int(deadline))],
    );
}
fn aggregate() -> String {
    format!(
        "{MODEL}{CLOCK}{GATES}\nview totals: count children by .parent.owner\n  read <- exists gates[owner = .owner] and exists guards[owner = .owner] and viewer = 'service:allowed'\nquery point():\n  return totals['alice']\nquery pageTotals():\n  return totals first 10 by .owner\nquery afterClock():\n  clock = clocks['k'].until\n  page = totals first 10 by .owner\n  return {{ clock, page }}\n"
    )
}

pub fn admitted_aggregate_emission_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for op in ["point", "pageTotals", "afterClock"] {
        let mut replies = Vec::new();
        let mut aborts = Vec::new();
        for deadline in [300, 500] {
            let mut e = factory(&aggregate());
            group(&mut *e, "alice", deadline);
            system(&mut *e, "clock", &[]);
            let limit = Ceilings {
                examined: if op == "afterClock" { 2 } else { 1 },
                ..Ceilings::default()
            };
            let context = ctx("service:allowed", 200, &[]);
            if let Some(o) = e.query(op, context.clone(), limit) {
                assert_eq!(o.data, Value::Null, "{o:?}");
                assert!(!o.complete && o.unavailable, "{o:?}");
                assert_eq!(
                    o.capped_at.as_ref().map(|cut| cut.0),
                    Some(MeterKind::Examined)
                );
                assert_eq!(o.metered.examined, limit.examined + 1);
                // A non-uniform page reserves (take + 1) x rule probes before its first candidate (LLP 3000.015 s2).
                assert_eq!(o.metered.rule_probes, if op == "point" { 2 } else { 22 });
                assert_eq!(o.next_expiry, (op == "afterClock").then_some(700), "{o:?}");
                replies.push(o);
            } else {
                let o = e.run(op, context, limit);
                assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                aborts.push(o);
            }
            if let Some(o) = e.query(op, ctx("service:allowed", 200, &[]), Ceilings::default()) {
                assert!(!o.unavailable && o.capped_at.is_none());
                assert_eq!(o.next_expiry, Some(deadline));
                if op == "point" {
                    assert!(o.complete);
                    assert_eq!(o.data, Value::Int(1));
                } else if op == "pageTotals" {
                    assert_eq!(o.data.as_array().unwrap().len(), 1);
                } else {
                    assert_eq!(o.data.field("page").unwrap().as_array().unwrap().len(), 1);
                }
            }
        }
        for pair in replies.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
        for pair in aborts.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }
}

pub fn uniform_prefix_emission_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{CLOCK}{GATES}\nmutation guard(owner: principal):\n  insert guards {{ owner }}\ntable docs:\n  body: text <=100\n  by search: words(body), id\n  read <- exists gates[owner = viewer] and exists guards[owner = viewer]\n  insert <- allow\nmutation doc():\n  insert docs {{ id: 'd', body: 'hello' }}\nquery page():\n  return docs first 10 by .id\nquery words():\n  return docs matching 'hello' first 10 by .id\nquery afterClock():\n  clock = clocks['k'].until\n  page = docs first 10 by .id\n  return {{ clock, page }}\n"
    );
    for op in ["page", "words", "afterClock"] {
        for occupied in [false, true] {
            let mut replies = Vec::new();
            let mut aborts = Vec::new();
            for deadline in [None, Some(300), Some(500)] {
                let mut e = factory(&source);
                if let Some(deadline) = deadline {
                    system(
                        &mut *e,
                        "gate",
                        &[("owner", id("bob")), ("until", Value::Int(deadline))],
                    );
                } else {
                    system(&mut *e, "guard", &[("owner", id("bob"))]);
                }
                system(&mut *e, "clock", &[]);
                if occupied {
                    system(&mut *e, "doc", &[]);
                }
                let limit = Ceilings {
                    rule_probes: 1,
                    ..Ceilings::default()
                };
                let context = ctx("bob", 200, &[]);
                if let Some(mut o) = e.query(op, context.clone(), limit) {
                    let rows = if op == "afterClock" {
                        o.data.field("page").unwrap()
                    } else {
                        &o.data
                    };
                    assert!(rows.as_array().unwrap().is_empty(), "{o:?}");
                    assert!(!o.complete && !o.unavailable, "{o:?}");
                    assert_eq!(o.metered.rule_probes, 2);
                    assert_eq!(
                        o.capped_at.as_ref().map(|cut| cut.0),
                        Some(MeterKind::RuleProbes)
                    );
                    assert_eq!(o.next_expiry, (op == "afterClock").then_some(700), "{o:?}");
                    o.seq = 0; // Population varies, so compare the read observation at a common watermark.
                    replies.push(o);
                } else {
                    let o = e.run(op, context, limit);
                    assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                    aborts.push(o);
                }
                if let Some(o) = e.query(op, ctx("bob", 200, &[]), Ceilings::default()) {
                    let rows = if op == "afterClock" {
                        o.data.field("page").unwrap()
                    } else {
                        &o.data
                    };
                    assert_eq!(
                        rows.as_array().unwrap().len(),
                        usize::from(occupied && deadline.is_some())
                    );
                    assert!(o.complete && !o.unavailable, "{o:?}");
                    assert_eq!(
                        o.next_expiry,
                        if occupied && deadline.is_some() {
                            deadline
                        } else {
                            (op == "afterClock").then_some(700)
                        }
                    );
                }
            }
            for pair in replies.windows(2) {
                assert_eq!(pair[0], pair[1]);
            }
            for pair in aborts.windows(2) {
                assert_eq!(pair[0], pair[1]);
            }
        }
    }
}

pub fn partial_page_keeps_emitted_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let mut replies = Vec::new();
    for second_deadline in [250, 500] {
        let mut e = factory(&aggregate());
        group(&mut *e, "alice", 300);
        group(&mut *e, "bob", second_deadline);
        // The page prepays its whole rule-probe reservation (LLP 3000.015 s2), so the
        // cut that stops it between the first and second group is the examined meter:
        // the page unit, the first group's recount, then the second candidate.
        let limit = Ceilings {
            examined: 2,
            ..Ceilings::default()
        };
        let context = ctx("service:allowed", 200, &[]);
        if let Some(o) = e.query("pageTotals", context.clone(), limit) {
            let rows = o.data.as_array().unwrap();
            assert_eq!(rows.len(), 1, "{o:?}");
            assert_eq!(rows[0].field("owner"), Ok(&id("alice")));
            assert_eq!(rows[0].field("value"), Ok(&Value::Int(1)));
            assert!(!o.complete && !o.unavailable, "{o:?}");
            assert_eq!(o.metered.rule_probes, 22);
            assert_eq!(o.metered.examined, 3);
            assert_eq!(
                o.capped_at.as_ref().map(|cut| cut.0),
                Some(MeterKind::Examined)
            );
            assert_eq!(o.next_expiry, Some(300));
            replies.push(o);
        } else {
            assert_eq!(
                e.run("pageTotals", context, limit).0.unwrap_err().code,
                "E_BOUND"
            );
        }
        if let Some(o) = e.query(
            "pageTotals",
            ctx("service:allowed", 200, &[]),
            Ceilings::default(),
        ) {
            assert_eq!(o.data.as_array().unwrap().len(), 2);
            assert!(!o.unavailable && o.capped_at.is_none());
            assert_eq!(o.next_expiry, Some(second_deadline.min(300)));
        }
    }
    for pair in replies.windows(2) {
        assert_eq!(pair[0], pair[1]);
    }
}

pub fn unreturned_candidates_discard_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{}\nquery firstGroup():\n  return totals first 1 by .owner\nquery rejected():\n  return totals where .value > 1 first 10 by .owner\n",
        aggregate()
    );
    let mut e = factory(&source);
    group(&mut *e, "alice", 500);
    group(&mut *e, "bob", 300);
    for (op, count, expiry) in [("firstGroup", 1, Some(500)), ("rejected", 0, None)] {
        let context = ctx("service:allowed", 200, &[]);
        if let Some(o) = e.query(op, context.clone(), Ceilings::default()) {
            assert_eq!(o.data.as_array().unwrap().len(), count, "{o:?}");
            assert!(!o.unavailable && o.capped_at.is_none(), "{o:?}");
            assert_eq!(o.next_expiry, expiry, "{o:?}");
        } else {
            assert_eq!(
                e.run(op, context, Ceilings::default())
                    .0
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .len(),
                count
            );
        }
    }
}
