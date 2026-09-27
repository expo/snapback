//! Server delivery: authored binding, output provenance, independent bounds and receipts.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, WriteState, meter::Ceilings, value::object};
const SOURCE: &str = include_str!("delivery/schema.q");
fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}
fn engine(source: &str) -> Engine {
    let bound = compile(source);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e =
        Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    e.seed([
        (
            "chats".into(),
            object([
                ("id", Value::Id("c1".into())),
                ("name", Value::String("chat".into())),
            ]),
        ),
        ("messages".into(), row("m1", 1, "alice", Some("m2"))),
        ("messages".into(), row("m2", 2, "alice", None)),
        ("messages".into(), row("m3", 3, "bob", None)),
    ])
    .unwrap();
    e
}
fn row(id: &str, ordinal: i64, owner: &str, quote: Option<&str>) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("chat", Value::Id("c1".into())),
        ("ordinal", Value::Int(ordinal)),
        ("text", Value::String("hello".into())),
        ("owner", Value::Id(owner.into())),
        (
            "quote",
            quote.map_or(Value::Null, |id| Value::Id(id.into())),
        ),
    ])
}
fn context(viewer: &str) -> Context {
    Context::new(viewer, Default::default()).at(100)
}
fn manifest(e: &mut Engine, op: &str) -> Json {
    serde_json::to_value(e.query(op, context("alice")).unwrap().delivery).unwrap()
}
fn rows(e: &mut Engine, op: &str) -> Json {
    manifest(e, op)[0]["rows"].clone()
}

#[test]
fn manifest_tracks_only_qualifying_surviving_images() {
    let mut e = engine(SOURCE);
    for op in ["raw", "fields", "alias", "spread", "variable"] {
        assert_eq!(rows(&mut e, op), json!([["c1", 1]]), "{op}");
    }
    for op in [
        "empty",
        "replaced",
        "copiedPosition",
        "replacedAndPosition",
        "scalar",
        "countOnly",
        "removed",
        "quoteOnly",
        "overwrittenSpread",
        "replacedVariable",
    ] {
        assert_eq!(rows(&mut e, op), json!([]), "{op}");
    }
    assert_eq!(rows(&mut e, "page"), json!([["c1", 1], ["c1", 2]]));
    assert_eq!(rows(&mut e, "filtered"), json!([["c1", 2]]));
    assert_eq!(rows(&mut e, "quoteImage"), json!([["c1", 2]]));
    assert_eq!(rows(&mut e, "nested"), json!([["c1", 1], ["c1", 2]]));
    assert_eq!(
        manifest(&mut e, "fields")[0]["args"],
        json!(["group", "low", "high"])
    );
    let unrelated = e.query("unrelated", context("alice")).unwrap();
    assert!(unrelated.delivery.is_none() && unrelated.delivery_meter.is_none());
    let hidden = e.query("raw", context("eve")).unwrap();
    assert_eq!(hidden.data, Value::Null);
    assert_eq!(
        serde_json::to_value(hidden.delivery).unwrap()[0]["rows"],
        json!([])
    );
    let provenance = e
        .query("fields", context("alice").with_row_provenance())
        .unwrap();
    assert_eq!(
        serde_json::to_value(provenance.delivery).unwrap()[0]["rows"],
        json!([["c1", 1]])
    );
}

#[test]
fn report_noop_keeps_receipt_at_head_and_replays_before_body_lookup() {
    let mut e = engine(SOURCE);
    let args = [
        ("group".into(), Value::Id("c1".into())),
        ("low".into(), Value::Int(1)),
        ("high".into(), Value::Int(1)),
    ]
    .into();
    let ctx = Context::new("alice", args).at(200);
    let head = e.seq().unwrap();
    let counts = |e: &Engine| {
        ["_commits", "_log", "_outbox"].map(|table| {
            e.store()
                .conn()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap()
        })
    };
    let before_counts = counts(&e);
    let out = e.mutate("delivered", Some("noop"), ctx.clone()).unwrap();
    assert!(matches!(out.state, WriteState::Sent { seq, .. } if seq == head));
    assert!(out.receipt_only && !out.replayed && out.events == 0);
    assert_eq!(e.seq().unwrap(), head);
    assert_eq!(counts(&e), before_counts);
    let recorded = e.store().applied_outcome("alice", "noop").unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<Json>(&recorded).unwrap()["seq"],
        head
    );
    let replacement = compile(&SOURCE.replace(
        "  return null\nmutation ordinary",
        "  require false else BODY_RAN\n  return null\nmutation ordinary",
    ));
    assert!(
        replacement.diagnostics.is_empty(),
        "{:?}",
        replacement.diagnostics
    );
    e.adopt(
        replacement.schema,
        replacement.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    let replay = e.mutate("delivered", Some("noop"), ctx).unwrap();
    assert!(matches!(replay.state, WriteState::Sent { seq, .. } if seq == head));
    assert!(replay.replayed && replay.receipt_only);
    let before = e.seq().unwrap();
    let normal = e.mutate("ordinary", None, context("alice")).unwrap();
    assert!(!normal.receipt_only);
    assert_eq!(e.seq().unwrap(), before + 1);
}

#[test]
fn supplemental_overflow_never_changes_answer_or_its_meter() {
    let mut with = engine(SOURCE);
    let without_source =
        SOURCE.replace("\n  reports delivery of messages by .chat, .ordinal:", ":");
    let mut without = engine(&without_source);
    for ceiling in [128, 512, 1024, 4096, 65536] {
        let limits = Ceilings {
            output_bytes: ceiling,
            ..Ceilings::default()
        };
        with.set_ceilings(limits);
        without.set_ceilings(limits);
        for op in ["page", "alias", "nested", "countOnly"] {
            let yes = with.query(op, context("alice"));
            let no = without.query(op, context("alice"));
            if let (Err(yes), Err(no)) = (&yes, &no) {
                assert_eq!(yes, no);
                continue;
            }
            let (yes, no) = (yes.unwrap(), no.unwrap());
            assert_eq!(
                (
                    &yes.data,
                    yes.complete,
                    yes.cut,
                    &yes.capped_at,
                    yes.metered,
                    yes.unavailable
                ),
                (
                    &no.data,
                    no.complete,
                    no.cut,
                    &no.capped_at,
                    no.metered,
                    no.unavailable
                ),
                "{ceiling} {op}"
            );
            if let Some(meter) = yes.delivery_meter {
                assert!(meter.output_bytes <= (ceiling / 4).max(128));
                assert!(
                    meter.steps <= limits.steps / 4 && meter.heap_bytes <= limits.heap_bytes / 4
                );
            }
        }
    }
    with.set_ceilings(Ceilings {
        output_bytes: 128,
        ..Ceilings::default()
    });
    assert_eq!(manifest(&mut with, "fields"), json!("partial"));
}

#[test]
fn two_bindings_have_separate_rows_and_self_describing_names() {
    let source = format!(
        "{SOURCE}\ntable notes:\n  chat: chats\n  position: int\n  text: text <=80\n  unique chat, position\n  immutable chat, position\n  public\nmutation noteDelivery(room: chats, start: int, end: int) reports delivery of notes by .chat, .position:\n  return null\nquery both():\n  return {{message: messages['m1'], note: notes['n1']}}\n"
    );
    let mut e = engine(&source);
    e.seed([(
        "notes".into(),
        object([
            ("id", Value::Id("n1".into())),
            ("chat", Value::Id("c1".into())),
            ("position", Value::Int(1)),
            ("text", Value::String("note".into())),
        ]),
    )])
    .unwrap();
    let answer = manifest(&mut e, "both");
    assert_eq!(
        answer,
        json!([
            {"table":"messages","mutation":"delivered","args":["group","low","high"],"rows":[["c1",1]]},
            {"table":"notes","mutation":"noteDelivery","args":["room","start","end"],"rows":[["c1",1]]}
        ])
    );
}

#[test]
fn row_and_effect_reports_still_commit_but_empty_reports_do_not() {
    let args = || {
        [
            ("group".into(), Value::Id("c1".into())),
            ("low".into(), Value::Int(1)),
            ("high".into(), Value::Int(1)),
        ]
        .into()
    };
    for body in [
        "update messages['m1'] {text: 'reported'}",
        "emit notified { group }",
    ] {
        let source = format!(
            "effect notified\n{}",
            SOURCE.replacen(
                "  return null\nmutation ordinary",
                &format!("  {body}\n  return null\nmutation ordinary"),
                1
            )
        );
        let mut e = engine(&source);
        let head = e.seq().unwrap();
        let out = e
            .mutate("delivered", Some("active"), Context::new("alice", args()))
            .unwrap();
        assert!(
            matches!(out.state, WriteState::Sent { seq, .. } if seq == head + 1),
            "{body}: {out:?}"
        );
        assert!(!out.receipt_only);
        assert_eq!(e.seq().unwrap(), head + 1);
    }
}

#[test]
fn partial_preserves_rows_so_far_and_bounds_stamping_heap() {
    let mut e = engine(SOURCE);
    e.load((4..=83).map(|n| ("messages".into(), row(&format!("m{n}"), n, "alice", None))))
        .unwrap();
    e.set_ceilings(Ceilings {
        output_bytes: 1024,
        ..Ceilings::default()
    });
    let out = e.query("filtered", context("alice")).unwrap();
    let delivery = serde_json::to_value(out.delivery).unwrap();
    assert_eq!(delivery[0]["partial"], true, "{delivery}");
    let rows = delivery[0]["rows"].as_array().unwrap();
    assert!(
        !rows.is_empty() && rows.len() < out.data.as_array().unwrap().len(),
        "{delivery}"
    );
    // Many rejected candidates must release their stamping heap. Their work
    // still consumes steps, but the high-water heap does not grow per reject.
    let source = format!(
        "{SOURCE}\nquery rejects():\n  return messages where .chat = 'c1' and .text != 'hello' first 20 by .ordinal\n"
    );
    let mut e = engine(&source);
    let small = e
        .query("rejects", context("alice"))
        .unwrap()
        .delivery_meter
        .unwrap();
    e.load((4..=83).map(|n| ("messages".into(), row(&format!("m{n}"), n, "alice", None))))
        .unwrap();
    let big = e
        .query("rejects", context("alice"))
        .unwrap()
        .delivery_meter
        .unwrap();
    assert!(big.steps > small.steps);
    assert!(
        big.heap_bytes <= small.heap_bytes + 128,
        "{small:?} vs {big:?}"
    );
}

#[test]
fn step_heap_and_read_cuts_remain_the_answers_own() {
    let mut yes = engine(SOURCE);
    let mut no =
        engine(&SOURCE.replace("\n  reports delivery of messages by .chat, .ordinal:", ":"));
    for ceilings in [
        Ceilings {
            steps: 30,
            ..Ceilings::default()
        },
        Ceilings {
            heap_bytes: 512,
            ..Ceilings::default()
        },
        Ceilings {
            heap_bytes: 16_384,
            ..Ceilings::default()
        },
        Ceilings {
            examined: 1,
            ..Ceilings::default()
        },
        Ceilings {
            index_entries: 2,
            ..Ceilings::default()
        },
    ] {
        yes.set_ceilings(ceilings);
        no.set_ceilings(ceilings);
        for op in ["page", "nested", "alias"] {
            let a = yes.query(op, context("alice"));
            let b = no.query(op, context("alice"));
            if let (Err(a), Err(b)) = (&a, &b) {
                assert_eq!(a, b);
                continue;
            }
            let (a, b) = (a.unwrap(), b.unwrap());
            assert_eq!(
                (
                    &a.data,
                    a.complete,
                    a.cut,
                    &a.capped_at,
                    a.metered,
                    a.unavailable
                ),
                (
                    &b.data,
                    b.complete,
                    b.cut,
                    &b.capped_at,
                    b.metered,
                    b.unavailable
                ),
                "{ceilings:?}, {op}"
            );
            if a.unavailable {
                assert!(a.delivery.is_none());
            }
            if let Some(meter) = a.delivery_meter {
                assert!(
                    meter.steps <= ceilings.steps / 4
                        && meter.heap_bytes <= ceilings.heap_bytes / 4
                );
            }
        }
    }
}

#[test]
fn map_backed_authorized_source_images_are_tracked_too() {
    let mut e = engine(SOURCE);
    let Value::Row(fields) = row("m1", 1, "alice", Some("m2")) else {
        unreachable!()
    };
    e.load([("messages".into(), Value::Map(fields))]).unwrap();
    assert_eq!(rows(&mut e, "raw"), json!([["c1", 1]]));
}
