//! Round-five compositions now prove static classification before admission.
// @ref LLP 3000.022#14.3 — ordinary fields of a new row remain clean.
use super::*;

fn expressions() -> Vec<(&'static str, &'static str)> {
    vec![
        ("field", "m.recipients"),
        ("row", "m"),
        ("array", "[m]"),
        ("nested", "{ saved: [{ deep: m }] }"),
        ("shape", "m { * }"),
        ("add", "m.recipients + 1"),
        ("sub", "m.recipients - 1"),
        ("mul", "m.recipients * 2"),
        ("div", "m.recipients / 2"),
        ("mod", "m.recipients % 2"),
        ("neg", "-m.recipients"),
        ("eq", "m.recipients = 0"),
        ("ne", "m.recipients != 0"),
        ("lt", "m.recipients < 1"),
        ("le", "m.recipients <= 1"),
        ("gt", "m.recipients > 0"),
        ("ge", "m.recipients >= 0"),
        ("and", "m.recipients = 0 and true"),
        ("or", "m.recipients = 0 or false"),
        ("not", "not (m.recipients = 0)"),
        ("format", "'count=' + text"),
        ("format-row", "'row=' + text"),
        ("concat", "[m] + [m]"),
        ("lower", "lower('N=' + text)"),
        ("trim", "trim(' N=' + text)"),
        ("sha256", "sha256('N=' + text)"),
        ("join", "join(['N=' + text], ',')"),
        ("tokens", "tokens('@n' + text)"),
        ("length", "count('N=' + text)"),
        ("count", "count([m])"),
        ("slice", "slice([m], 0, 1)"),
        ("first", "first([m])"),
        ("last", "last([m])"),
        ("at", "at([m], 0)"),
        ("min-field", "min(m.recipients, 1)"),
        ("max-field", "max(m.recipients, 1)"),
        ("min-row", "min(m, m)"),
        ("max-row", "max(m, m)"),
        ("min-list", "min([m], [m])"),
        ("max-list", "max([m], [m])"),
        ("min-column", "min([m], .recipients)"),
        ("max-column", "max([m], .recipients)"),
        ("min-projection", "min([m], .recipients + 0)"),
        ("max-projection", "max([m], .recipients + 0)"),
        ("sum", "sum([m], .recipients)"),
        ("group-field", "group([m], 'recipients')"),
        ("group-row", "group([{ saved: m }], 'saved')"),
        ("sort-field", "sort([m], 'recipients')"),
        ("sort-row", "sort([{ saved: m }], 'saved')"),
        ("share-field", "share(m.recipients, ['alice'], 'alice')"),
        ("share-row", "share(1, [m], m)"),
        ("receipt", "receipt(m)"),
        ("ir-project", "m"),
        ("ir-optional", "m.recipients"),
        ("ir-calendar", "m.recipients"),
        ("ir-count-capped", "m.recipients"),
        ("ir-search-present", "m.recipients"),
        ("ir-connected", "m.recipients"),
        ("ir-format-field", "m.recipients"),
        ("ir-format-row", "m.recipients"),
        ("ir-same-value-zero", "m.recipients"),
    ]
}

fn internal_expression(name: &str, binding: &str) -> Option<snapback4_core::ir::Expr> {
    use snapback4_core::ir::{BinaryOp, Builtin as B, Expr as E};
    let row = E::Variable(binding.into());
    let field = E::Field {
        base: Box::new(row.clone()),
        name: "recipients".into(),
    };
    let formatted = |value| E::Builtin {
        builtin: B::Concat,
        args: vec![E::Literal(Value::String("n=".into())), value],
    };
    let (builtin, args) = match name {
        "ir-project" => (
            B::ProjectFields {
                table: "messages".into(),
            },
            vec![row],
        ),
        "ir-optional" => (
            B::OptionalField {
                field: "recipients".into(),
            },
            vec![row],
        ),
        "ir-calendar" => (B::Calendar { millis: 10 }, vec![field]),
        "ir-count-capped" => (B::CountCapped, vec![E::Array(vec![row])]),
        "ir-search-present" => (B::SearchPresent, vec![formatted(row)]),
        "ir-connected" => (B::Connected, vec![formatted(row)]),
        "ir-format-field" => return Some(formatted(field)),
        "ir-format-row" => return Some(formatted(row)),
        "ir-same-value-zero" => {
            return Some(E::Binary {
                op: BinaryOp::SameValueZero,
                left: Box::new(field),
                right: Box::new(E::Literal(Value::Int(0))),
            });
        }
        _ => return None,
    };
    Some(E::Builtin { builtin, args })
}

fn generated<H: Host>(host: &mut H) {
    let mut cases = 0;
    for (horizon, whole) in [(false, false), (false, true), (true, false), (true, true)] {
        // Compile every cross-product once, without filtering diagnostics. Each
        // fresh replica has the same visible rows; server accounting differs.
        let mut src = if horizon {
            source()
        } else {
            source().replace(
                "sync to members[.conversation] last 500 by byConversationOrdinal",
                "sync to members[.conversation]",
            )
        };
        src += "\neffect taintEmit\ntable taintChecks:\n  passed: bool\n  label: text <=40\n  unique passed\n  public\n  insert <- allow\n  update <- .passed\n  delete <- allow\n  sync public\nview taintTotals: count taintChecks by .passed\ntable taintHooks:\n  passed: bool\n  public\n  insert <- allow\n  after insert <- exists taintChecks[passed = .passed]\n  sync public\n";
        let sinks = [
            ("require-true", "require good else ACCOUNTING"),
            ("require-false", "require not good else ACCOUNTING"),
            (
                "branch",
                "if good:\n    insert taintChecks { passed: true, label: 'branch' }",
            ),
            (
                "branch-false",
                "if not good:\n    insert taintChecks { passed: true, label: 'branch-false' }",
            ),
            (
                "after-insert",
                "insert taintChecks { passed: true, label: 'permit' }\n  insert taintHooks { passed: good }",
            ),
            (
                "write",
                "insert taintChecks { passed: good, label: 'written' }",
            ),
            (
                "rule",
                "r = insert taintChecks { passed: good, label: 'rule' }\n  update taintChecks[r] { label: 'updated' }",
            ),
            (
                "write-key",
                "update taintChecks[passed = good] { label: 'key' }",
            ),
            ("delete-key", "delete taintChecks[passed = good]"),
            (
                "condition",
                "update taintChecks[passed = true] { label: 'condition' } if good",
            ),
            (
                "contribution",
                "insert taintChecks { passed: good, label: 'sum' }\n  require taintTotals[passed = good] > 0 else TOTAL",
            ),
            ("loop", "for p in [good]:\n    require p else ACCOUNTING"),
            ("effect", "emit taintEmit { value: n }"),
        ];
        for (i, (_, expression)) in expressions().iter().enumerate() {
            for (j, (_, sink)) in sinks.iter().enumerate() {
                let adapter = if [
                    "format",
                    "format-row",
                    "lower",
                    "trim",
                    "sha256",
                    "join",
                    "tokens",
                    "length",
                ]
                .contains(&expressions()[i].0)
                {
                    "  text = min({ saved: m, text: 'N' }, { saved: m, text: 'N' }).text\n"
                } else {
                    ""
                };
                let inserted = if whole { "original" } else { "m" };
                let whole_value = if whole {
                    "  m = min(original, original)\n"
                } else {
                    ""
                };
                src += &format!(
                    "\nmutation taint{i}_{j}(conversation: conversations):\n  {inserted} = insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}\n{whole_value}{adapter}  n = {expression}\n  good = n = n\n  {sink}\n"
                );
            }
        }
        let mut compiled = bound(&src);
        // Compiler-only variants have no standalone Quarry spelling. Substitute
        // just n's expression; the inserted row, admission, sinks and settlement
        // remain the same real engine/device path as the compiled cases.
        for (i, (name, _)) in expressions().iter().enumerate() {
            if internal_expression(name, "unused").is_some() {
                for j in 0..sinks.len() {
                    let program = &mut compiled
                        .programs
                        .iter_mut()
                        .find(|p| p.program.name == format!("taint{i}_{j}"))
                        .unwrap()
                        .program;
                    let binding = program
                        .body
                        .iter()
                        .find_map(|s| match s {
                            snapback4_core::ir::Stmt::Let { name, .. }
                                if name.strip_prefix("$m").is_some_and(|n| {
                                    !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())
                                }) =>
                            {
                                Some(name.clone())
                            }
                            _ => None,
                        })
                        .unwrap();
                    let expression = internal_expression(name, &binding).unwrap();
                    let mut replaced = 0;
                    for statement in &mut program.body {
                        if let snapback4_core::ir::Stmt::Let { name, value }
                        | snapback4_core::ir::Stmt::Const { name, value } = statement
                            && name.strip_prefix("$n").is_some_and(|n| {
                                !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())
                            })
                        {
                            *value = expression.clone();
                            replaced += 1;
                        }
                    }
                    assert_eq!(replaced, 1, "{name}");
                }
            }
        }
        for (i, (name, _)) in expressions().iter().enumerate() {
            for j in 0..sinks.len() {
                let operation = format!("taint{i}_{j}");
                if internal_expression(name, "unused").is_some() {
                    let p = compiled.programs.iter().find(|p| p.program.name == operation).unwrap();
                    let fact = snapback4_lang::bind::residency::execution(&compiled.schema, &p.program);
                    compiled.schema.operations.insert(operation.clone(), fact);
                }
                let fact = &compiled.schema.operations[&operation];
                assert_eq!(fact.predicts.as_deref(), Some("never"), "{operation}: {fact:?}");
                assert!(fact.sites.iter().any(|s| s.kind == "receipt dependency"));
            }
        }
        for (i, (name, _)) in expressions().iter().enumerate() {
            for (j, (sink, _)) in sinks.iter().enumerate() {
                let label = format!("taint-{horizon}-{whole}-{name}-{sink}");
                eprintln!("VALUE-TAINT {} {label}", host.label());
                let operation = format!("taint{i}_{j}");
                let mut schema = compiled.schema.clone();
                schema
                    .operations
                    .retain(|name, _| !name.starts_with("taint") || name == &operation);
                let programs: Vec<_> = compiled
                    .programs
                    .iter()
                    .filter(|p| !p.program.name.starts_with("taint") || p.program.name == operation)
                    .map(|p| p.program.clone())
                    .collect();
                let mut e = Engine::memory(schema.clone(), programs.clone()).unwrap();
                seed(&mut e);
                // Leave the true key absent for insert sinks; target sinks get
                // a real row so this proves success custody as well as refusal.
                if matches!(*sink, "write-key" | "delete-key" | "condition") {
                    e.seed_at(
                        [(
                            "taintChecks".into(),
                            object([
                                ("id", id("check")),
                                ("passed", Value::Bool(true)),
                                ("label", Value::String("before".into())),
                            ]),
                        )],
                        NOW,
                    )
                    .unwrap();
                }
                let backend = snapback4_device::device::Backend {
                    generation: e.generation(),
                    schema,
                    programs,
                };
                let mut d = host.open(&label, Some(backend)).unwrap();
                publish(&mut e, &mut d, "alice");
                let q = deferred(
                    &mut d,
                    request(&format!("taint{i}_{j}"), json!({"conversation":"c"}), 1),
                );
                assert!(d.store().raw_rows("messages").is_empty());
                host.close(&label, d);
                let mut d = host.open(&label, None).unwrap();
                assert_eq!(d.queued().unwrap()[0].id, q.id);
                let outcome = e
                    .mutate(
                        &q.op,
                        Some(&q.id),
                        Context::new(&q.viewer, args(&[("conversation", id("c"))]))
                            .at(q.now)
                            .with_ids(q.new_ids.clone()),
                    )
                    .unwrap();
                match outcome.state {
                    WriteState::Sent { seq, .. } => {
                        d.settle(&q.id, Some(seq)).unwrap();
                    }
                    WriteState::Failed { .. } => {
                        d.settle(&q.id, None).unwrap();
                    }
                }
                publish(&mut e, &mut d, "alice");
                for table in ["messages", "taintChecks", "taintTotals", "taintHooks"] {
                    let mut actual = d.store().raw_rows(table);
                    let mut expected = e.store().rows(table).unwrap();
                    actual.sort_by_key(|r| r.field("id").unwrap().as_str().unwrap().to_owned());
                    expected.sort_by_key(|r| r.field("id").unwrap().as_str().unwrap().to_owned());
                    assert_eq!(actual, expected, "{label}: {table}");
                }
                assert!(d.queued().unwrap().is_empty());
                cases += 1;
            }
        }
    }
    assert_eq!(cases, expressions().len() * 13 * 2 * 2);
    eprintln!("VALUE-TAINT {}: {cases} scenarios", host.label());
}
both!(generated_values_memory, generated_values_sqlite, generated);
