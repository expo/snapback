//! Round-5 cutoff metadata witnesses, shared by the three server adapters.
use super::{Backend, MODEL, bound, ctx, id, run, system};
use snapback4_core::{Value, error::MeterKind, meter::Ceilings, value::object};

const CLOCK: &str = "\ntable clocks:\n  until: time\n  expire at .until\n  read <- allow\n  insert <- allow\nmutation clock():\n  insert clocks { id: 'k', until: 700 }\n";
const GATES: &str = "\ntable gates:\n  owner: principal\n  until: time\n  unique owner\n  expire at .until\n  read <- deny\n  insert <- allow\ntable guards:\n  owner: principal\n  unique owner\n  read <- deny\n  insert <- allow\nmutation gates(until: time):\n  insert gates { id: 'g', owner: 'alice', until }\n  insert guards { id: 'g', owner: 'alice' }\n";
fn parent(e: &mut dyn Backend) {
    system(
        e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ],
    );
}
fn child(e: &mut dyn Backend, name: &str, until: i64) {
    system(
        e,
        "child",
        &[
            ("id", id(name)),
            ("parent", id("p")),
            ("until", Value::Int(until)),
        ],
    );
}

pub fn aggregate_page_cut_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{MODEL}{CLOCK}{GATES}\nview totals: count children by .parent.owner\n  read <- exists gates[owner = .owner] and exists guards[owner = .owner] and viewer = 'service:allowed'\nquery pageTotals():\n  return totals first 10 by .id\nquery afterClock():\n  clock = clocks['k'].until\n  page = totals first 10 by .id\n  return {{ clock, page }}\n"
    );
    for op in ["pageTotals", "afterClock"] {
        let mut replies = Vec::new();
        let mut native = Vec::new();
        for deadline in [300, 500] {
            let mut e = factory(&source);
            parent(&mut *e);
            child(&mut *e, "c", 900);
            system(&mut *e, "gates", &[("until", Value::Int(deadline))]);
            system(&mut *e, "clock", &[]);
            let limit = Ceilings {
                rule_probes: 1,
                ..Ceilings::default()
            };
            let context = ctx("bob", 200, &[]);
            if let Some(o) = e.query(op, context.clone(), limit) {
                let empty = Value::Array(vec![].into());
                let expected = if op == "pageTotals" {
                    empty
                } else {
                    object([("clock", Value::Int(700)), ("page", empty)])
                };
                assert_eq!(o.data, expected, "{o:?}");
                assert!(
                    !o.complete && !o.unavailable,
                    "a capped page retains its ordinary partial-page contract: {o:?}"
                );
                assert_eq!(
                    o.capped_at.as_ref().map(|cut| cut.0),
                    Some(MeterKind::RuleProbes)
                );
                assert_eq!(
                    o.metered.rule_probes, 22,
                    "the page's whole (take + 1) x rule-probe reservation is the cut (LLP 3000.015 s2)"
                );
                assert_eq!(o.next_expiry, (op == "afterClock").then_some(700), "{o:?}");
                replies.push(o);
            } else {
                let o = e.run(op, context, limit);
                assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                native.push(o);
            }
            // Both probes actually grant the allowed principal a group under ample meters.
            if let Some(o) = e.query(
                "pageTotals",
                ctx("service:allowed", 200, &[]),
                Ceilings::default(),
            ) {
                assert!(!o.unavailable && o.capped_at.is_none());
                assert_eq!(o.data.as_array().unwrap().len(), 1);
                assert_eq!(o.next_expiry, Some(deadline));
            } else {
                assert_eq!(
                    run(&mut *e, "pageTotals", "service:allowed", 200, &[])
                        .0
                        .unwrap()
                        .as_array()
                        .unwrap()
                        .len(),
                    1
                );
            }
        }
        for pair in replies.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
        for pair in native.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }
}

pub fn aggregate_inherited_only_dependencies(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for denied in [false, true] {
        let source = include_str!("inherited_deadline.q").replace(
            ".middle = .middle",
            if denied {
                ".middle != .middle"
            } else {
                ".middle = .middle"
            },
        );
        let b = bound(&source);
        for name in ["middles", "children"] {
            assert!(b.schema.tables[name].expire.is_none());
            assert!(b.schema.tables[name].is_expiring());
        }
        let mut denials = Vec::new();
        for world in ["empty", "expired", "live"] {
            let mut e = factory(&source);
            system(
                &mut *e,
                "root",
                &[(
                    "until",
                    Value::Int(if world == "expired" { 150 } else { 300 }),
                )],
            );
            system(&mut *e, "middle", &[]);
            if world != "empty" {
                system(&mut *e, "child", &[]);
            }
            let expected = if denied {
                Value::Null
            } else {
                Value::Int(i64::from(world == "live"))
            };
            assert_eq!(
                run(&mut *e, "total", "bob", 200, &[]).0,
                Ok(expected.clone())
            );
            if let Some(mut o) = e.query("total", ctx("bob", 200, &[]), Ceilings::default()) {
                assert!(o.complete && !o.unavailable, "{o:?}");
                assert_eq!(o.data, expected);
                assert_eq!(
                    o.tables,
                    vec!["children", "totals"],
                    "{world}/{denied}: {o:?}"
                );
                assert_eq!(o.next_expiry, (!denied && world == "live").then_some(300));
                if denied {
                    o.seq = 0;
                    denials.push(o);
                }
            }
        }
        for pair in denials.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }
}

pub fn aggregate_live_recount_cut_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{MODEL}{CLOCK}\nview totals: count children by .parent\n  read <- .parent = .parent\nquery total(p: parents):\n  return totals[p]\nquery afterClock(p: parents):\n  return [clocks['k'].until, totals[p]]\n"
    );
    for op in ["total", "afterClock"] {
        let mut replies = Vec::new();
        let mut native = Vec::new();
        for deadline in [300, 500] {
            let mut e = factory(&source);
            parent(&mut *e);
            child(&mut *e, "a", deadline);
            child(&mut *e, "b", 900);
            child(&mut *e, "expired", 150);
            system(&mut *e, "clock", &[]);
            // Q's server path steps over the expired backlog as store work
            // (LLP 3000.007 §20.24.6) and meters the lookup and the next live
            // seek. The device recount also exceeds this limit.
            let limit = Ceilings {
                examined: if op == "total" { 1 } else { 2 },
                ..Ceilings::default()
            };
            let context = ctx("bob", 200, &[("p", id("p"))]);
            if let Some(o) = e.query(op, context.clone(), limit) {
                assert_eq!(o.data, Value::Null);
                assert!(!o.complete && o.unavailable, "{o:?}");
                assert_eq!(
                    o.capped_at.as_ref().map(|cut| cut.0),
                    Some(MeterKind::Examined)
                );
                assert_eq!(o.metered.examined, limit.examined + 1);
                assert_eq!(o.next_expiry, (op == "afterClock").then_some(700), "{o:?}");
                replies.push(o);
            } else {
                let o = e.run(op, context, limit);
                assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                assert_eq!(o.1.examined, limit.examined + 1);
                native.push(o);
            }
            if let Some(o) = e.query(
                "total",
                ctx("bob", 200, &[("p", id("p"))]),
                Ceilings::default(),
            ) {
                assert!(o.complete && !o.unavailable);
                assert_eq!(o.data, Value::Int(2));
                assert_eq!(o.next_expiry, Some(deadline));
            } else {
                assert_eq!(
                    run(&mut *e, "total", "bob", 200, &[("p", id("p"))]).0,
                    Ok(Value::Int(2))
                );
            }
        }
        for pair in replies.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
        for pair in native.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }
}

pub fn aggregate_authorized_shortcut_cut(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let gates = GATES
        .replace("owner", "parent")
        .replace("principal", "parents")
        .replace("'alice'", "'p'");
    let source = format!(
        "{MODEL}{CLOCK}{gates}\nview totals: count children by .parent\n  read <- exists gates[parent = .parent] and exists guards[parent = .parent]\nquery total(p: parents):\n  return totals[p]\nquery afterClock(p: parents):\n  return [clocks['k'].until, totals[p]]\n"
    );
    for op in ["total", "afterClock"] {
        let mut replies = Vec::new();
        let mut native = Vec::new();
        for deadline in [300, 500] {
            let mut e = factory(&source);
            parent(&mut *e);
            child(&mut *e, "c", 900);
            system(&mut *e, "gates", &[("until", Value::Int(deadline))]);
            system(&mut *e, "clock", &[]);
            let limit = Ceilings {
                rule_probes: 1,
                ..Ceilings::default()
            };
            let context = ctx("bob", 200, &[("p", id("p"))]);
            if let Some(o) = e.query(op, context.clone(), limit) {
                assert!(!o.complete && o.unavailable, "{o:?}");
                assert_eq!(o.data, Value::Null);
                assert_eq!(
                    o.capped_at.as_ref().map(|cut| cut.0),
                    Some(MeterKind::RuleProbes)
                );
                assert_eq!(o.metered.rule_probes, 2);
                assert_eq!(o.next_expiry, (op == "afterClock").then_some(700));
                replies.push(o);
            } else {
                let o = e.run(op, context, limit);
                assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                native.push(o);
            }
            assert_eq!(
                run(&mut *e, "total", "bob", 200, &[("p", id("p"))]).0,
                Ok(Value::Int(1))
            );
        }
        for pair in replies.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
        for pair in native.windows(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }
}
