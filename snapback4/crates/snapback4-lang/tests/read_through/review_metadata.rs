//! Round-4 reply metadata and live recount mutation witnesses, shared by adapters.
use super::{Backend, MODEL, ctx, id, run, system};
use snapback4_core::{Value, meter::Ceilings};

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
fn child(e: &mut dyn Backend, name: &str, until: Value) {
    system(
        e,
        "child",
        &[("id", id(name)), ("parent", id("p")), ("until", until)],
    );
}

pub fn aggregate_tables_constant(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for inherited in [false, true] {
        for denied in [false, true] {
            let model = if inherited {
                MODEL.to_owned()
            } else {
                MODEL.replace("read through .parent", "read <- allow")
            };
            let rule = if denied {
                ".parent != .parent"
            } else {
                ".parent = .parent"
            };
            let source = format!(
                "{model}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\ntable witnesses:\n  parent: parents\n  read <- exists totals[parent = .parent] and viewer = 'alice'\n  insert <- allow\nmutation witness():\n  insert witnesses {{ id: 'w', parent: 'p' }}\nquery probe():\n  return witnesses['w']\n"
            );
            let mut denied_replies = Vec::new();
            for world in ["empty", "expired", "live"] {
                let mut e = factory(&source);
                parent(&mut *e);
                system(&mut *e, "witness", &[]);
                if world != "empty" {
                    child(
                        &mut *e,
                        "c",
                        Value::Int(if world == "expired" { 150 } else { 300 }),
                    );
                }
                let expected = if denied && inherited {
                    Value::Null
                } else {
                    Value::Int(i64::from(!denied && world == "live"))
                };
                assert_eq!(
                    run(&mut *e, "total", "bob", 200, &[("p", id("p"))]).0,
                    Ok(expected.clone())
                );
                if let Some(mut o) = e.query(
                    "total",
                    ctx("bob", 200, &[("p", id("p"))]),
                    Ceilings::default(),
                ) {
                    assert!(o.complete && !o.unavailable, "{o:?}");
                    assert_eq!(o.data, expected);
                    assert_eq!(
                        o.tables,
                        if inherited { vec!["children", "parents", "totals"] } else { vec!["children", "totals"] },
                        "{inherited}/{denied}/{world}"
                    );
                    if denied {
                        o.seq = 0;
                        denied_replies.push(o);
                    }
                }
                // Rule witnesses are raw existence probes, independent of the view ACL.
                for viewer in ["alice", "bob"] {
                    let present = viewer == "alice" && world == "live";
                    assert_eq!(
                        run(&mut *e, "probe", viewer, 200, &[]).0.unwrap() != Value::Null,
                        present
                    );
                    if let Some(o) = e.query("probe", ctx(viewer, 200, &[]), Ceilings::default()) {
                        assert!(o.complete && !o.unavailable, "{o:?}");
                        assert_eq!(
                            o.tables,
                            if inherited { vec!["children", "parents", "totals", "witnesses"] } else { vec!["children", "totals", "witnesses"] },
                            "{world}/{viewer}"
                        );
                    }
                }
            }
            for pair in denied_replies.windows(2) {
                assert_eq!(pair[0], pair[1]);
            }
        }
    }
}

pub fn aggregate_denied_gate_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for path in ["synthetic", "stored", "ordinary"] {
        let model = match path {
            "stored" => MODEL.replace("  expire at .until\n", ""),
            "ordinary" => MODEL.replace("read through .parent", "read <- allow"),
            _ => MODEL.to_owned(),
        };
        let value_rule = if path == "stored" {
            " and .value != 2"
        } else {
            ""
        };
        let source = format!(
            "{model}\ntable gates:\n  parent: parents\n  until: time\n  unique parent\n  expire at .until\n  read <- deny\n  insert <- allow\ntable clocks:\n  until: time\n  expire at .until\n  read <- allow\n  insert <- allow\nview totals: count children by .parent\n  read <- exists gates[parent = .parent] and viewer = 'service:allowed'{value_rule}\nmutation gate(until: time):\n  insert gates {{ id: 'g', parent: 'p', until }}\nmutation clock():\n  insert clocks {{ id: 'k', until: 700 }}\nquery total(p: parents):\n  return totals[p]\nquery afterClock(p: parents):\n  return [clocks['k'].until, totals[p]]\n"
        );
        for op in ["total", "afterClock"] {
            let mut replies = Vec::new();
            let mut native = Vec::new();
            for until in [None, Some(300), Some(500)] {
                let mut e = factory(&source);
                parent(&mut *e);
                child(&mut *e, "c", Value::Null);
                system(&mut *e, "clock", &[]);
                if let Some(until) = until {
                    system(&mut *e, "gate", &[("until", Value::Int(until))]);
                }
                let context = ctx("bob", 200, &[("p", id("p"))]);
                let denied = if path == "ordinary" {
                    Value::Int(0)
                } else {
                    Value::Null
                };
                let expected = if op == "total" {
                    denied
                } else {
                    Value::Array(vec![Value::Int(700), denied].into())
                };
                if let Some(mut o) = e.query(op, context.clone(), Ceilings::default()) {
                    assert!(o.complete && !o.unavailable, "{o:?}");
                    assert_eq!(o.data, expected);
                    assert_eq!(
                        o.next_expiry,
                        (op == "afterClock").then_some(700),
                        "{path}/{until:?}: {o:?}"
                    );
                    o.seq = 0;
                    replies.push(o);
                } else {
                    let o = e.run(op, context, Ceilings::default());
                    assert_eq!(o.0, Ok(expected));
                    native.push(o);
                }
                // A real expiring gate permits the allowed principal and records its deadline.
                if let Some(until) = until {
                    assert_eq!(
                        run(&mut *e, "total", "service:allowed", 200, &[("p", id("p"))]).0,
                        Ok(Value::Int(1))
                    );
                    if let Some(o) = e.query(
                        "total",
                        ctx("service:allowed", 200, &[("p", id("p"))]),
                        Ceilings::default(),
                    ) {
                        assert!(o.complete && !o.unavailable);
                        assert_eq!(o.next_expiry, Some(until));
                    }
                }
                let tight = Ceilings {
                    rule_probes: 0,
                    ..Ceilings::default()
                };
                if let Some(o) = e.query("total", ctx("bob", 200, &[("p", id("p"))]), tight) {
                    assert!(
                        !o.complete && o.unavailable && o.capped_at.is_some(),
                        "{o:?}"
                    );
                    assert_eq!(o.next_expiry, None);
                } else {
                    assert_eq!(
                        e.run("total", ctx("bob", 200, &[("p", id("p"))]), tight)
                            .0
                            .unwrap_err()
                            .code,
                        "E_BOUND"
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
}

pub fn ordinary_expiring_page_recounts(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{}\nview totals: count children by .parent\n  read <- .parent = .parent\nquery totalsPage(p: parents):\n  return totals where .parent = p first 10 {{ value }}\n",
        MODEL.replace("read through .parent", "read <- allow")
    );
    let mut e = factory(&source);
    parent(&mut *e);
    child(&mut *e, "a", Value::Int(150));
    child(&mut *e, "b", Value::Int(350));
    for (now, count) in [(100, 2), (200, 1), (400, 0)] {
        let expected = Value::Array(
            if count == 0 {
                vec![]
            } else {
                vec![snapback4_core::value::object([(
                    "value",
                    Value::Int(count),
                )])]
            }
            .into(),
        );
        assert_eq!(
            run(&mut *e, "totalsPage", "bob", now, &[("p", id("p"))]).0,
            Ok(expected.clone())
        );
        if let Some(o) = e.query(
            "totalsPage",
            ctx("bob", now, &[("p", id("p"))]),
            Ceilings::default(),
        ) {
            assert!(o.complete && !o.unavailable, "{o:?}");
            assert_eq!(o.data, expected);
            assert_eq!(o.tables, vec!["children", "totals"]);
            assert_eq!(
                o.next_expiry,
                if now == 100 {
                    Some(150)
                } else if now == 200 {
                    Some(350)
                } else {
                    None
                }
            );
        }
    }
}

pub fn authorized_expiring_sum_overflow(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let model = MODEL.replace(
        "  body: text <=100",
        "  n: int default 0\n  body: text <=100",
    );
    let source = format!(
        "{model}\nview totals: sum children of .n by .parent\n  read <- .parent = .parent\nmutation amount(id: id, n: int, until: time ?):\n  insert children {{ id, parent: 'p', body: '', n, until }}\nquery total(p: parents):\n  return totals[p]\n"
    );
    for sign in [1, -1] {
        let mut e = factory(&source);
        parent(&mut *e);
        let max = snapback4_core::value::I53_MAX;
        for (name, n, until) in [
            ("a", sign * max, Value::Null),
            ("b", -sign * max, Value::Int(150)),
            ("c", sign * max, Value::Null),
        ] {
            system(
                &mut *e,
                "amount",
                &[("id", id(name)), ("n", Value::Int(n)), ("until", until)],
            );
        }
        assert_eq!(
            run(&mut *e, "total", "bob", 100, &[("p", id("p"))]).0,
            Ok(Value::Int(sign * max))
        );
        let why = e
            .refused_query(
                "total",
                ctx("bob", 200, &[("p", id("p"))]),
                Ceilings::default(),
            )
            .expect("live sum outside I53 must refuse");
        assert_eq!(why.code, "E_OVERFLOW");
    }
}

pub fn authorized_expired_backlog_stays_metered(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for denied in [false, true] {
        let rule = if denied {
            ".parent != .parent"
        } else {
            ".parent = .parent"
        };
        let source = format!(
            "{MODEL}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\n"
        );
        let mut replies = Vec::new();
        let mut native = Vec::new();
        for backlog in [0, 40] {
            let mut e = factory(&source);
            parent(&mut *e);
            for n in 0..backlog {
                child(&mut *e, &format!("c{n:02}"), Value::Int(150));
            }
            let ordinary = run(&mut *e, "total", "bob", 200, &[("p", id("p"))]);
            assert_eq!(
                ordinary.0,
                Ok(if denied { Value::Null } else { Value::Int(0) })
            );
            // An occupied group adds Q's metered live seek after the backlog;
            // a missing or denied group still stops at its point lookup.
            assert_eq!(ordinary.1.examined, if denied || backlog == 0 { 1 } else { backlog + 2 });
            let tight = Ceilings {
                examined: 16,
                ..Ceilings::default()
            };
            let capped = !denied && backlog > 0;
            let context = ctx("bob", 200, &[("p", id("p"))]);
            if let Some(mut o) = e.query("total", context.clone(), tight) {
                assert_eq!(o.complete, !capped, "{o:?}");
                assert_eq!(o.unavailable, capped, "{o:?}");
                assert_eq!(o.capped_at.is_some(), capped);
                assert_eq!(o.tables, vec!["children", "parents", "totals"]);
                assert_eq!(o.next_expiry, None);
                if denied {
                    o.seq = 0;
                    replies.push(o);
                }
            } else {
                let o = e.run("total", context, tight);
                if capped {
                    assert_eq!(o.0.unwrap_err().code, "E_BOUND");
                } else if denied {
                    native.push(o);
                }
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
