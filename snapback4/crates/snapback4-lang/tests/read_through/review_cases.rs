use snapback4_core::{
    Context, Value,
    error::Refusal,
    meter::{Ceilings, Metered},
};

#[path = "review_metadata.rs"]
mod metadata;
pub use metadata::*;

pub type Outcome = (Result<Value, Refusal>, Metered);
pub trait Backend {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome;
    fn adopt(&mut self, source: &str, now: i64);
    fn refused_query(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Option<Refusal> {
        self.run(op, context, ceilings).0.err()
    }
    fn query(
        &mut self,
        _op: &str,
        _context: Context,
        _ceilings: Ceilings,
    ) -> Option<snapback4_core::engine::QueryOutcome> {
        None
    }
}
pub fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
pub fn id(s: &str) -> Value {
    Value::Id(s.into())
}
pub fn ctx(viewer: &str, now: i64, args: &[(&str, Value)]) -> Context {
    Context::new(
        viewer,
        args.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn run(e: &mut dyn Backend, op: &str, viewer: &str, now: i64, args: &[(&str, Value)]) -> Outcome {
    e.run(op, ctx(viewer, now, args), Ceilings::default())
}
fn system(e: &mut dyn Backend, op: &str, args: &[(&str, Value)]) {
    run(e, op, snapback4_core::SYSTEM_PRINCIPAL, 100, args)
        .0
        .unwrap();
}
const MODEL: &str = include_str!("lifetime.q");

pub fn aggregate_actual_row(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for inherited in [false, true] {
        for rule in [".value != 1", ".value = 2"] {
            let source = format!(
                "{}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\n",
                MODEL.replace("  expire at .until\n", "").replace(
                    "read through .parent",
                    if inherited {
                        "read through .parent"
                    } else {
                        "read <- allow"
                    }
                )
            );
            let mut e = factory(&source);
            system(
                &mut *e,
                "parent",
                &[
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Null),
                ],
            );
            system(
                &mut *e,
                "child",
                &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
            );
            for viewer in ["alice", "bob"] {
                assert_eq!(
                    run(&mut *e, "total", viewer, 100, &[("p", id("p"))])
                        .0
                        .unwrap(),
                    if inherited { Value::Null } else { Value::Int(0) },
                    "{rule}: preserve each aggregate form's denied result"
                );
            }
            system(
                &mut *e,
                "child",
                &[
                    ("id", id("d")),
                    ("parent", id("p")),
                    ("until", Value::Int(150)),
                ],
            );
            assert_eq!(
                run(&mut *e, "total", "bob", 100, &[("p", id("p"))])
                    .0
                    .unwrap(),
                Value::Int(2)
            );
            // Without an expiry declaration the stored total remains the live total.
            assert_eq!(
                run(&mut *e, "total", "bob", 200, &[("p", id("p"))])
                    .0
                    .unwrap(),
                Value::Int(2)
            );
            system(&mut *e, "eraseChild", &[("id", id("c"))]);
            system(&mut *e, "eraseChild", &[("id", id("d"))]);
            assert_eq!(
                run(&mut *e, "total", "bob", 200, &[("p", id("p"))])
                    .0
                    .unwrap(),
                if rule == ".value != 1" || !inherited {
                    Value::Int(0)
                } else {
                    Value::Null
                },
                "authorize the logical zero too"
            );
        }
    }
}

pub fn aggregate_existence(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{MODEL}\nview totals: count children by .parent\nquery total(p: parents):\n  return totals[p]\nquery present(p: parents):\n  return exists totals[parent = p]\nquery matching(p: parents, v: int ?):\n  return exists totals[parent = p, value = v]\n"
    );
    for world in ["absent", "hidden", "empty", "occupied", "expired"] {
        let mut e = factory(&source);
        if world != "absent" {
            system(
                &mut *e,
                "parent",
                &[
                    ("id", id("p")),
                    ("owner", id(if world == "hidden" { "bob" } else { "alice" })),
                    (
                        "until",
                        if world == "expired" {
                            Value::Int(150)
                        } else {
                            Value::Null
                        },
                    ),
                ],
            );
            if world != "empty" {
                system(
                    &mut *e,
                    "child",
                    &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
                );
            }
        }
        assert_eq!(
            run(&mut *e, "present", "alice", 200, &[("p", id("p"))])
                .0
                .unwrap(),
            Value::Bool(world == "occupied"),
            "{world}"
        );
        for v in [Value::Null, Value::Int(1)] {
            assert_eq!(
                run(
                    &mut *e,
                    "matching",
                    "alice",
                    200,
                    &[("p", id("p")), ("v", v.clone())]
                )
                .0
                .unwrap(),
                Value::Bool(world == "occupied" && v == Value::Int(1)),
                "{world}/{v:?}"
            );
        }
        let scalar = match world {
            "empty" => Value::Int(0),
            "occupied" => Value::Int(1),
            _ => Value::Null,
        };
        assert_eq!(
            run(&mut *e, "total", "alice", 200, &[("p", id("p"))])
                .0
                .unwrap(),
            scalar,
            "{world}"
        );
    }
}

pub fn expiry_default(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let original = "table parents:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\ntable middle:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\ntable children:\n  parent: middle\n  immutable parent\n  read through .parent\n  insert <- allow\nmutation setup():\n  insert parents { id: 'p', owner: viewer }\n  insert middle { id: 'm', parent: 'p' }\n  insert children { id: 'c', parent: 'm' }\nquery parent():\n  return parents['p']\nquery middle():\n  return middle['m']\nquery child():\n  return children['c']\n";
    for adoption_time in [100, 200] {
        let mut e = factory(original);
        run(&mut *e, "setup", "alice", 50, &[]).0.unwrap();
        let at300 = original.replace(
            "immutable owner",
            "immutable owner, until\n  until: time default 300\n  expire at .until",
        );
        e.adopt(&at300, 100);
        assert_ne!(
            run(&mut *e, "child", "alice", 200, &[]).0.unwrap(),
            Value::Null
        );
        let at150 = at300.replace("default 300", "default 150");
        e.adopt(&at150, adoption_time);
        for op in ["parent", "middle", "child"] {
            assert_ne!(
                run(&mut *e, op, "alice", 149, &[]).0.unwrap(),
                Value::Null,
                "{op} before expiry"
            );
            for now in [150, 200] {
                assert_eq!(
                    run(&mut *e, op, "alice", now, &[]).0.unwrap(),
                    Value::Null,
                    "{op} at {now}"
                );
            }
        }
    }
}

pub fn probe_source() -> String {
    format!(
        "table seats:\n  owner: principal\n  principal: principal\n  unique owner, principal\n  read <- allow\n  insert <- allow\nmutation seat():\n  insert seats {{ id: 's', owner: 'alice', principal: 'alice' }}\n{}\ntable labels:\n  parent: parents\n  label: text <=1000\n  until: time ?\n  immutable parent\n  expire at .until\n  read through .parent\n  insert <- allow\nmutation label(until: time ?):\n  insert labels {{ id: 'l', parent: 'p', label: 'one', until }}\n",
        MODEL.replace(
            "read <- .owner = viewer",
            "read <- exists seats[.owner, viewer]"
        )
    )
}

pub fn reuse_refusal(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = probe_source();
    for viewer in ["bob", "alice"] {
        let mut outcomes = Vec::new();
        let mut bounded = [Vec::new(), Vec::new()];
        for world in ["live", "children", "labels"] {
            let mut e = factory(&source);
            system(&mut *e, "seat", &[]);
            system(
                &mut *e,
                "parent",
                &[
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Int(if world == "live" { 300 } else { 150 })),
                ],
            );
            if world == "children" {
                system(
                    &mut *e,
                    "child",
                    &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
                );
            }
            if world == "labels" {
                system(&mut *e, "label", &[("until", Value::Null)]);
            }
            let result = run(
                &mut *e,
                "parent",
                viewer,
                200,
                &[
                    ("id", id("p")),
                    ("owner", id(viewer)),
                    ("until", Value::Null),
                ],
            );
            assert_eq!(
                result.0.as_ref().unwrap_err().code,
                if viewer == "bob" {
                    "E_RULE"
                } else {
                    "E_CONSTRAINT"
                },
                "{viewer}/{world}: {result:?}"
            );
            outcomes.push(result);
            for (slot, ceilings) in [
                Ceilings {
                    examined: 1,
                    ..Ceilings::default()
                },
                Ceilings {
                    heap_bytes: 1500,
                    ..Ceilings::default()
                },
            ]
            .into_iter()
            .enumerate()
            {
                if viewer == "alice" && world == "live" {
                    continue;
                }
                let result = e.run(
                    "parent",
                    ctx(
                        viewer,
                        200,
                        &[
                            ("id", id("p")),
                            ("owner", id(viewer)),
                            ("until", Value::Null),
                        ],
                    ),
                    ceilings,
                );
                assert_eq!(
                    result.0.as_ref().unwrap_err().code,
                    if viewer == "bob" { "E_RULE" } else { "E_BOUND" }
                );
                bounded[slot].push(result);
            }
        }
        for out in &outcomes[1..] {
            assert_eq!(
                out, &outcomes[0],
                "{viewer}: same code, message, and every meter field as a live collision"
            );
        }
        for outcomes in bounded {
            for out in &outcomes[1..] {
                assert_eq!(
                    out, &outcomes[0],
                    "{viewer}: the full child probe reservation precedes every seek"
                );
            }
        }
    }
}

pub fn delete_refusal(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = probe_source();
    let mut outcomes = Vec::new();
    for child in ["children", "labels"] {
        for until in [150, 300] {
            let mut e = factory(&source);
            system(&mut *e, "seat", &[]);
            system(
                &mut *e,
                "parent",
                &[
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Null),
                ],
            );
            if child == "children" {
                system(
                    &mut *e,
                    "child",
                    &[
                        ("id", id("c")),
                        ("parent", id("p")),
                        ("until", Value::Int(until)),
                    ],
                );
            } else {
                system(&mut *e, "label", &[("until", Value::Int(until))]);
            }
            let result = run(&mut *e, "erase", "alice", 200, &[("id", id("p"))]);
            assert_eq!(result.0.as_ref().unwrap_err().code, "E_PARENT_HAS_CHILDREN");
            outcomes.push(result);
        }
    }
    for out in &outcomes[1..] {
        assert_eq!(
            out, &outcomes[0],
            "delete must not identify occupied child tables or their expiry"
        );
    }
}

pub fn probe_meter_equivalence(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{}\nview totals: count children by .parent\nquery total(p: parents):\n  return totals[p]\n",
        probe_source()
    );
    let mut positive = factory(&source);
    system(&mut *positive, "seat", &[]);
    system(
        &mut *positive,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ],
    );
    run(
        &mut *positive,
        "child",
        "alice",
        100,
        &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
    )
    .0
    .unwrap();
    assert_eq!(
        run(&mut *positive, "total", "alice", 100, &[("p", id("p"))])
            .0
            .unwrap(),
        Value::Int(1),
        "the exists probe has a positive witness"
    );
    let page = run(
        &mut *positive,
        "page",
        "alice",
        100,
        &[("id", id("p")), ("c", Value::Null)],
    )
    .0
    .unwrap();
    assert_eq!(page.as_array().unwrap().len(), 1);
    for op in ["page", "child", "total"] {
        let mut outcomes = Vec::new();
        for hidden in [false, true] {
            let mut e = factory(&source);
            system(&mut *e, "seat", &[]);
            if hidden {
                system(
                    &mut *e,
                    "parent",
                    &[
                        ("id", id("p")),
                        ("owner", id("alice")),
                        ("until", Value::Null),
                    ],
                );
            }
            let args = match op {
                "page" => vec![("id", id("p")), ("c", Value::Null)],
                "total" => vec![("p", id("p"))],
                _ => vec![("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
            };
            outcomes.push(run(&mut *e, op, "bob", 100, &args));
        }
        assert_eq!(
            outcomes[0], outcomes[1],
            "{op}: absent and unreadable parents with an exists probe"
        );
        assert!(
            outcomes[0].1.rule_probes > 0,
            "{op} reserved the exists probe even in the absent world"
        );
    }
}

pub fn aggregate_denial_work(factory: impl FnMut(&str) -> Box<dyn Backend>) {
    aggregate_denial_cases(factory, true);
}
pub fn aggregate_denial_dependencies(factory: impl FnMut(&str) -> Box<dyn Backend>) {
    aggregate_denial_cases(factory, false);
}
fn aggregate_denial_cases(mut factory: impl FnMut(&str) -> Box<dyn Backend>, cuts: bool) {
    // The explicit key rule denies every group before recounting. Expired physical rows also leave
    // a stored aggregate candidate, but must disclose no extra dependency.
    for wide in [false, true] {
        let model = MODEL.replace("immutable parent", "immutable parent\n  cap 4 by parent");
        let model = if wide {
            model.replace("text <=100", "text <=1000000")
        } else {
            model
        };
        let source = format!(
            "{model}\nview totals: count children by .parent\n  read <- .parent != .parent\nquery total(p: parents):\n  return totals[p]\n"
        );
        for ceilings in [
            Ceilings {
                heap_bytes: 1000,
                ..Ceilings::default()
            },
            Ceilings {
                examined: 0,
                heap_bytes: 256 << 20,
                ..Ceilings::default()
            },
            Ceilings::default(),
            Ceilings {
                heap_bytes: 256 << 20,
                ..Ceilings::default()
            },
        ] {
            let enough = ceilings.heap_bytes >= (if wide { 256 << 20 } else { 1 << 20 })
                && ceilings.examined > 0;
            if !cuts && !enough {
                continue;
            }
            let mut native = Vec::new();
            let mut replies = Vec::new();
            for world in ["empty", "occupied", "expired"] {
                let mut e = factory(&source);
                // Wide declared rows also reserve write scratch; seed under an
                // ample ceiling, then restore the query's identical ceiling.
                let seed = Ceilings {
                    heap_bytes: 512 << 20,
                    ..Ceilings::default()
                };
                e.run(
                    "parent",
                    ctx(
                        snapback4_core::SYSTEM_PRINCIPAL,
                        100,
                        &[
                            ("id", id("p")),
                            ("owner", id("alice")),
                            ("until", Value::Null),
                        ],
                    ),
                    seed,
                )
                .0
                .unwrap();
                if world != "empty" {
                    e.run(
                        "child",
                        ctx(
                            snapback4_core::SYSTEM_PRINCIPAL,
                            100,
                            &[
                                ("id", id("c")),
                                ("parent", id("p")),
                                (
                                    "until",
                                    if world == "expired" {
                                        Value::Int(150)
                                    } else {
                                        Value::Null
                                    },
                                ),
                            ],
                        ),
                        seed,
                    )
                    .0
                    .unwrap();
                }
                let context = ctx("bob", 200, &[("p", id("p"))]);
                if let Some(mut o) = e.query("total", context.clone(), ceilings) {
                    assert_eq!(o.data, Value::Null, "{world}");
                    assert_eq!(o.complete, enough, "{world}: {o:?}");
                    assert_eq!(o.unavailable, !enough, "{world}: {o:?}");
                    assert_eq!(
                        o.tables,
                        vec!["children", "totals"],
                        "{world}: source dependency is declared even on denial"
                    );
                    assert_eq!(o.next_expiry, None);
                    assert_eq!(o.capped_at.is_none(), enough);
                    o.seq = 0; // Deliberately different committed fixture histories.
                    replies.push(o);
                } else {
                    let o = e.run("total", context, ceilings);
                    if enough {
                        assert_eq!(o.0, Ok(Value::Null));
                    } else {
                        assert_eq!(o.0.as_ref().unwrap_err().code, "E_BOUND");
                    }
                    native.push(o);
                }
            }
            for o in &native[1.min(native.len())..] {
                assert_eq!(o, &native[0]);
            }
            for o in &replies[1.min(replies.len())..] {
                assert_eq!(o, &replies[0]);
            }
        }
    }
}

pub fn aggregate_sequential_reads(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for rule in [".parent = .parent", ".parent != .parent", ".id = .id"] {
        let model = MODEL.replace("text <=100", "text <=100000");
        let source = format!(
            "{model}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\nquery twice(p: parents):\n  return [totals[p], totals[p]]\n"
        );
        for world in ["empty", "occupied", "expired"] {
            let mut e = factory(&source);
            system(
                &mut *e,
                "parent",
                &[
                    ("id", id("p")),
                    ("owner", id("alice")),
                    ("until", Value::Null),
                ],
            );
            if world != "empty" {
                system(
                    &mut *e,
                    "child",
                    &[
                        ("id", id("c")),
                        ("parent", id("p")),
                        (
                            "until",
                            if world == "expired" {
                                Value::Int(150)
                            } else {
                                Value::Null
                            },
                        ),
                    ],
                );
            }
            let one = run(&mut *e, "total", "bob", 200, &[("p", id("p"))]);
            let value = if rule.contains("!=") {
                Value::Null
            } else {
                Value::Int(i64::from(world == "occupied"))
            };
            assert_eq!(one.0, Ok(value.clone()));
            let two = run(&mut *e, "twice", "bob", 200, &[("p", id("p"))]);
            assert_eq!(
                two.0,
                Ok(Value::Array(vec![value.clone(), value].into())),
                "{rule}/{world}"
            );
            assert!(
                two.1.heap_bytes < 1 << 20,
                "scratch has been released: {two:?}"
            );
            assert!(
                two.1.heap_bytes >= one.1.heap_bytes,
                "retained results stay owned"
            );
            assert_eq!(two.1.examined, one.1.examined * 2, "work is not refunded");
            let tight = Ceilings {
                heap_bytes: 10 << 20,
                ..Ceilings::default()
            };
            let context = ctx("bob", 200, &[("p", id("p"))]);
            if let Some(o) = e.query("twice", context.clone(), tight) {
                assert!(
                    !o.complete && o.unavailable && o.capped_at.is_some(),
                    "{o:?}"
                );
            } else {
                assert_eq!(
                    e.run("twice", context, tight).0.unwrap_err().code,
                    "E_BOUND"
                );
            }
        }
    }
}

pub fn aggregate_multi_batch(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{MODEL}\nview totals: count children by .parent\n  read <- .parent = .parent\nquery total(p: parents):\n  return totals[p]\n"
    );
    let mut e = factory(&source);
    system(
        &mut *e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ],
    );
    for n in 0..65 {
        system(
            &mut *e,
            "child",
            &[
                ("id", id(&format!("c{n:02}"))),
                ("parent", id("p")),
                ("until", if n < 33 { Value::Int(150) } else { Value::Null }),
            ],
        );
    }
    for (now, count) in [(100, 65), (200, 32)] {
        let o = run(&mut *e, "total", "bob", now, &[("p", id("p"))]);
        assert_eq!(o.0, Ok(Value::Int(count)));
        assert!(
            o.1.examined >= 66 && o.1.steps >= 65,
            "all contributions stay metered: {o:?}"
        );
    }
}
