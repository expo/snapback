use snapback4_core::{
    Context, Value,
    error::Refusal,
    meter::{Ceilings, Metered},
};

pub type Outcome = (Result<Value, Refusal>, Metered);
pub trait Backend {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome;
    fn adopt(&mut self, source: &str, now: i64);
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
    for rule in [".value != 1", ".value = 2"] {
        let source = format!(
            "{MODEL}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\n"
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
                Value::Null,
                "{rule}: hidden aggregate is null"
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
        // The stored total is still two; authorization must see the live total one.
        assert_eq!(
            run(&mut *e, "total", "bob", 200, &[("p", id("p"))])
                .0
                .unwrap(),
            Value::Null
        );
        system(&mut *e, "eraseChild", &[("id", id("c"))]);
        assert_eq!(
            run(&mut *e, "total", "bob", 200, &[("p", id("p"))])
                .0
                .unwrap(),
            if rule == ".value != 1" {
                Value::Int(0)
            } else {
                Value::Null
            },
            "authorize the logical zero too"
        );
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
