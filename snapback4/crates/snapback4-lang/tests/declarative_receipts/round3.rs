use super::names::{SOURCE, exercise, renamed};
use super::*;

#[test]
fn authored_template_call_names_do_not_change_receipts_or_delivery() {
    // Every primitive/helper called by the receipt projection and delivery fold.
    // Tables also exercise the expression namespace (including viewer input).
    for name in [
        "max",
        "count",
        "first",
        "range",
        "inboxFold",
        "receiptPrivateFold",
        "receiptBuiltinMax",
        "receiptBuiltinCount",
        "receiptBuiltinFirst",
        "receiptBuiltinSettled",
        "receiptBuiltinRange",
        "viewer",
    ] {
        for kind in ["fn", "table"] {
            let declaration = if kind == "fn" {
                format!("\nfn {name}(a: int, b: int):\n  return a + b\n")
            } else {
                format!("\ntable {name}:\n  value: int\n  public\n")
            };
            let source = format!("{SOURCE}{declaration}");
            let b = bound(&source);
            exercise(b, str::to_owned, &format!("{kind} {name}"));
        }
    }
}

#[test]
fn duplicate_report_cannot_capture_authored_max_and_invent_delivery() {
    let (mut e, _) = compile(&format!(
        "{DECLARATIVE}\nfn max(a: int, b: int):\n  return a + b\n"
    ));
    seed(&mut e);
    let now = 4_000_000_000_200;
    for n in 1..=4 {
        send(&mut e, n, now);
    }
    for _ in 0..2 {
        sent(mutate(
            &mut e,
            "bob",
            "delivered",
            &[
                ("conversation", id("c")),
                ("from", Value::Int(2)),
                ("through", Value::Int(2)),
            ],
            now,
        ));
    }
    let runs = e.store().rows("runs").unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].field("fromOrdinal").unwrap(), &Value::Int(2));
    assert_eq!(runs[0].field("throughOrdinal").unwrap(), &Value::Int(2));
    let labels = receipt(&mut e, now);
    for row in labels.as_array().unwrap() {
        let expected = if row.field("id").unwrap() == &id("m2") {
            "delivered"
        } else {
            "sent"
        };
        assert_eq!(
            row.field("receipt").unwrap(),
            &Value::String(expected.into())
        );
    }
}

fn extra_keys(messages: bool, members: bool) {
    let mut source = SOURCE
        .replace(
            "audience[.group, viewer]",
            "audience[group = .group, who = viewer]",
        )
        .replace(
            "audience[.room, viewer]",
            "audience[group = .room, who = viewer]",
        );
    if messages {
        source = source.replace("  unique room, number", "  nonce: int default 0\n  unique room, number\n  unique byClientNonce: author, nonce\n  cap 100 by author\n  cap 100 by room, author");
    }
    if members {
        source = source.replace("  unique group, who", "  nonce: int default 0\n  unique group, who\n  unique byClientNonce: who, nonce\n  cap 100 by who\n  cap 100 by group, joined");
    }
    exercise(
        bound(&source),
        str::to_owned,
        &format!("messages={messages}, members={members}"),
    );
}
#[test]
fn extra_message_keys_and_caps_keep_receipts_and_delivery_named() {
    extra_keys(true, false);
}
#[test]
fn extra_member_keys_and_caps_keep_receipts_and_delivery_named() {
    extra_keys(false, true);
}
#[test]
fn extra_keys_and_caps_on_both_tables_keep_receipts_and_delivery_named() {
    extra_keys(true, true);
}

#[test]
fn every_mapping_position_supports_names_or_refuses_at_the_clause() {
    let positions = [
        "room",
        "number",
        "author",
        "size",
        "group",
        "who",
        "joined",
        "total",
        "received",
        "viewed",
        "rooms",
        "audience",
        "notes",
        "inbox",
        "inboxRuns",
        "inboxReceipt",
        "inboxDelivered",
        "inboxSeen",
        "inboxMember",
        "inboxProgress",
        "inboxCompact",
    ];
    let names = [
        "x",
        "X",
        "_",
        "_x",
        "x_9",
        "X9",
        "chat",
        "prefix",
        "all",
        "low",
        "high",
        "initial",
        "probes",
        "me",
        "from",
        "through",
        "c",
        "m",
        "member",
        "run",
        "state",
        "remaining",
        "delivered",
        "covered",
        "i",
        "__receipt_me",
        "principal",
        "fromOrdinal",
        "throughOrdinal",
        "viewer",
        "now",
        "commit",
        "new",
        "null",
        "true",
        "false",
        "not",
        "exists",
        "created",
        "walk",
        "insert",
        "update",
        "delete",
        "after",
        "upsert",
        "merge",
        "device",
        "oblivious",
        "where",
        "first",
        "last",
        "if",
        "else",
        "and",
        "or",
        "until-revoked",
        "delivered-history",
        "max",
        "count",
        "range",
        "return",
        "for",
        "require",
        "receiptPrivateFold",
        "receiptBuiltinMax",
    ];
    let mut failures = Vec::new();
    let mut passed = 0;
    let mut refused = 0;
    let mut syntax_refused = 0;
    for position in positions {
        for name in names {
            let source = renamed(
                SOURCE.split("\nquery badge").next().unwrap(),
                position,
                name,
            );
            let (_, syntax) = snapback4_lang::parse_document("schema.q", &source);
            if !syntax.is_empty() {
                // These names are not legal in this author's table/rule position;
                // they never enter expansion. Check their original source sites.
                assert!(syntax.iter().all(|d| d.site.file == "schema.q"
                    && d.site.line <= source.lines().count() as u32
                    && !format!("{d}").contains("__receipt")));
                syntax_refused += 1;
                continue;
            }
            let b = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
            if !b.diagnostics.is_empty() {
                if !b.diagnostics.iter().all(|d| {
                    d.code == "E_RECEIPTS_CLAUSE"
                        && d.site.file == "schema.q"
                        && d.site.line == 17
                        && !format!("{d}").contains("__receipt")
                        && !format!("{d}").contains("$builtin")
                        && d.message.contains(name)
                }) {
                    failures.push(format!("{position} -> {name}: {:?}", b.diagnostics));
                }
                refused += 1;
            } else {
                let badge = renamed(
                    "\nquery badge(note: notes):\n  return inboxReceipt(notes[note] ! else NOT_FOUND)\n",
                    position,
                    name,
                );
                let complete = snapback4_lang::compile(&[("schema.q".into(), source + &badge)]);
                if !complete.diagnostics.is_empty() {
                    failures.push(format!(
                        "{position} -> {name} admitted but unusable: {:?}",
                        complete.diagnostics
                    ));
                    continue;
                }
                exercise(
                    complete,
                    |s| if s == position { name.into() } else { s.into() },
                    &format!("{position} -> {name}"),
                );
                passed += 1;
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
    eprintln!(
        "all mapping positions: {passed} executed, {refused} clause refusals, {syntax_refused} authored syntax refusals"
    );
}

#[test]
fn generated_expression_and_delivery_diagnostics_name_the_receipts_clause() {
    for padding in [0, 10] {
        let source = format!("{}{}", "-- padding\n".repeat(padding), SOURCE);
        let b = bound(&source);
        for p in &b.programs {
            if p.program.name == "badge" {
                continue;
            }
            assert_eq!(p.site.line, 17 + padding as u32);
        }
        let source = source
            .split("\nquery badge")
            .next()
            .unwrap()
            .replace("  unique room, number\n", "");
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(!b.diagnostics.is_empty());
        assert!(
            b.diagnostics.iter().all(|d| d.code == "E_RECEIPTS_CLAUSE"
                && d.site.line == 17 + padding as u32
                && d.message.contains("number")
                && !format!("{d}").contains("__receipt")
                && !format!("{d}").contains("$receipt")),
            "{:?}",
            b.diagnostics
        );
    }
}

fn missing_run_coverage_only<H: Host>(host: &mut H) {
    use snapback4_core::schema::LeavePolicy;
    use snapback4_device::device::{Backend, Queued};
    let mut b = bound(DECLARATIVE);
    // The RX fixture made run coverage independently unknown while membership
    // authority stayed acquired. V4 queues removal even with complete runs:
    // both variants preserve settled accounting until server commitment.
    // The incomplete-coverage case remains a conservative custody regression.
    b.schema.tables.get_mut("runs").unwrap().leave = LeavePolicy::DeliveredHistory;
    let mut e = Engine::memory(
        b.schema.clone(),
        b.programs.iter().map(|p| p.program.clone()),
    )
    .unwrap();
    let backend = Backend {
        generation: e.generation(),
        schema: b.schema,
        programs: b.programs.into_iter().map(|p| p.program).collect(),
    };
    seed(&mut e);
    let now = 4_000_000_000_200;
    for n in 1..=4 {
        send(&mut e, n, now);
    }
    sent(mutate(
        &mut e,
        "bob",
        "delivered",
        &[
            ("conversation", id("c")),
            ("from", Value::Int(4)),
            ("through", Value::Int(4)),
        ],
        now,
    ));
    let mut d = host.open("guard", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut e, "bob", 1000).iter().enumerate() {
        d.apply(page, i == 0).unwrap();
    }
    // Start a new runs acquisition using the ordinary joined-group protocol.
    let seq = e.seq().unwrap();
    let mut page = stream_page(&mut e, "bob", seq);
    page.joined = serde_json::from_value(json!({"runs":[["c"]]})).unwrap();
    d.apply(&page, false).unwrap();
    let member = d
        .query("receiptMember", "bob", &json!({"conversation":"c"}), now)
        .unwrap();
    assert!(member.complete);
    assert_eq!(member.data.field("id").unwrap(), &id("b"));
    let runs_before = d.store().raw_rows("runs");
    assert_eq!(runs_before.len(), 1);
    let queued = d
        .admit(Queued { upload: None,
            id: "guard-leave".into(),
            seq: 1,
            op: "leave".into(),
            args: json!({"conversation":"c"}),
            viewer: "bob".into(),
            now,
            new_ids: vec![],
            predicted: vec![],
            predictable: true,
            sent_seq: None,
            receipt_store: None,
            observed_seq: None,
            dispatch: None,
        })
        .unwrap();
    assert!(!queued.predictable, "missing run coverage must queue leave");
    assert!(queued.predicted.is_empty());
    assert_eq!(d.store().raw_rows("runs"), runs_before);
    assert!(
        d.store()
            .raw_rows("members")
            .iter()
            .any(|r| r.field("id").unwrap() == &id("b"))
    );
    host.close("guard", d);
}
#[test]
fn receipt_specific_coverage_guard_memory() {
    missing_run_coverage_only(&mut Memory::new());
}
#[test]
fn receipt_specific_coverage_guard_sqlite() {
    missing_run_coverage_only(&mut Sqlite::new("rx-r3-coverage"));
}
