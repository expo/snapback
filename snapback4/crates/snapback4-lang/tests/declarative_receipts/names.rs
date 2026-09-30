use super::*;
pub(super) const SOURCE: &str = r#"
table rooms:
  total: int
  public
  sync public
table audience:
  group: rooms
  who: principal
  joined: int
  unique group, who
  cap 50 by group
  immutable group, who, joined
  read <- exists audience[.group, viewer]
  update <- .who = viewer
  sync to audience[.group] by .who
table notes:
  receipts inbox by .room, .number from .author to audience:
    member .group, .who
    counter .total
    floor .joined
    count .size
    watermarks .received, .viewed
    runs inboxRuns
    operations inboxReceipt, inboxDelivered, inboxSeen, inboxMember, inboxProgress, inboxCompact
  room: rooms
  number: int
  author: principal
  size: int
  unique room, number
  immutable room, number, author, size
  read <- exists audience[.room, viewer]
  sync to audience[.room] by .who
query badge(note: notes):
  return inboxReceipt(notes[note] ! else NOT_FOUND)
"#;
pub(super) fn renamed(source: &str, old: &str, new: &str) -> String {
    let mut out = String::new();
    let mut word = String::new();
    for c in source.chars().chain([' ']) {
        if c.is_ascii_alphanumeric() || c == '_' {
            word.push(c);
        } else {
            out.push_str(if word == old { new } else { &word });
            word.clear();
            out.push(c);
        }
    }
    out
}
#[test]
fn generated_field_and_scope_names_compile_and_run() {
    // All lexer Word classes, including contextual and hyphenated words.
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
        "null",
        "true",
        "false",
        "not",
        "exists",
        "created",
        "walk",
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
    ];
    let fields = [
        "room", "number", "author", "size", "group", "who", "joined", "total", "received", "viewed",
    ];
    let mut failures = Vec::new();
    let mut cases = 0;
    for field in fields {
        for name in names {
            let b = snapback4_lang::compile(&[("schema.q".into(), renamed(SOURCE, field, name))]);
            if !b.diagnostics.is_empty() {
                failures.push(format!("{field} -> {name}: {:?}", b.diagnostics));
                continue;
            }
            exercise(
                b,
                |s| if s == field { name.into() } else { s.into() },
                &format!("{field} -> {name}"),
            );
            cases += 1;
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures in {} cases:\n{}",
        failures.len(),
        cases + failures.len(),
        failures.join("\n")
    );
    eprintln!("generated field/scope cases: {cases}");
}
pub(super) fn exercise(b: snapback4_lang::Bound, mapped: impl Fn(&str) -> String, label: &str) {
    let binding = b.schema.delivery[0].clone();
    let cursor_arg = b
        .programs
        .iter()
        .find(|p| p.program.name == mapped("inboxProgress"))
        .unwrap()
        .program
        .args
        .keys()
        .find(|name| **name != binding.args[0])
        .unwrap()
        .clone();
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let row = |fields: Vec<(String, Value)>| object(fields);
    e.seed_at(
        [
            (
                mapped("rooms"),
                row(vec![
                    ("id".into(), id("r")),
                    (mapped("total"), Value::Int(3)),
                ]),
            ),
            (
                mapped("audience"),
                row(vec![
                    ("id".into(), id("b")),
                    (mapped("group"), id("r")),
                    (mapped("who"), id("bob")),
                    (mapped("joined"), Value::Int(0)),
                ]),
            ),
            (
                mapped("notes"),
                row(vec![
                    ("id".into(), id("n")),
                    (mapped("room"), id("r")),
                    (mapped("number"), Value::Int(1)),
                    (mapped("author"), id("alice")),
                    (mapped("size"), Value::Int(1)),
                ]),
            ),
        ],
        1,
    )
    .unwrap();
    let delivery_args = [
        (binding.args[0].as_str(), id("r")),
        (binding.args[1].as_str(), Value::Int(3)),
        (binding.args[2].as_str(), Value::Int(3)),
    ];
    sent(mutate(
        &mut e,
        "bob",
        &mapped("inboxDelivered"),
        &delivery_args,
        2,
    ));
    assert_eq!(
        e.store().rows(&mapped("inboxRuns")).unwrap().len(),
        1,
        "{label}"
    );
    let member = e
        .query(
            &mapped("inboxMember"),
            ctx("bob", &[(binding.args[0].as_str(), id("r"))], 2),
        )
        .unwrap();
    assert_eq!(member.data.field("id").unwrap(), &id("b"));
    let progress = e
        .query(
            &mapped("inboxProgress"),
            ctx(
                "bob",
                &[
                    (binding.args[0].as_str(), id("r")),
                    (&cursor_arg, Value::Null),
                ],
                2,
            ),
        )
        .unwrap();
    assert!(progress.complete);
    assert_eq!(
        progress
            .data
            .field("runs")
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut context = ctx("bob", &[(binding.args[0].as_str(), id("r"))], 2);
    context.delivery_fingerprint = Some(binding.fingerprint.clone());
    sent(
        e.mutate(&mapped("inboxCompact"), None, context)
            .unwrap()
            .state,
    );
    assert_eq!(
        e.query("badge", ctx("bob", &[("note", id("n"))], 2))
            .unwrap()
            .data,
        Value::String("sent".into())
    );
    let mut values = delivery_args;
    values[1].1 = Value::Int(1);
    values[2].1 = Value::Int(1);
    sent(mutate(&mut e, "bob", &mapped("inboxDelivered"), &values, 3));
    sent(mutate(
        &mut e,
        "bob",
        &mapped("inboxSeen"),
        &[
            (binding.args[0].as_str(), id("r")),
            (binding.args[2].as_str(), Value::Int(3)),
        ],
        3,
    ));
    assert_eq!(
        e.query("badge", ctx("bob", &[("note", id("n"))], 3))
            .unwrap()
            .data,
        Value::String("read".into())
    );
    assert!(e.store().rows(&mapped("inboxRuns")).unwrap().is_empty());
}
macro_rules! fingerprint_case {
    ($test:ident,$index:expr) => {
        #[test]
        fn $test() {
            let names = [
                "receipt",
                "delivered",
                "seen",
                "receiptMember",
                "progress",
                "compactReceipts",
            ];
            let mut changed = names;
            changed[$index] = "renamedPublic";
            let source = DECLARATIVE
                .replace(
                    &format!("operations {}", names.join(", ")),
                    &format!("operations {}", changed.join(", ")),
                )
                .replace(
                    "receipt(.)",
                    if $index == 0 {
                        "renamedPublic(.)"
                    } else {
                        "receipt(.)"
                    },
                );
            assert_ne!(
                bound(DECLARATIVE).schema.delivery[0].fingerprint,
                bound(&source).schema.delivery[0].fingerprint
            );
        }
    };
}
fingerprint_case!(fingerprint_covers_receipt, 0);
fingerprint_case!(fingerprint_covers_delivered, 1);
fingerprint_case!(fingerprint_covers_seen, 2);
fingerprint_case!(fingerprint_covers_receipt_member, 3);
fingerprint_case!(fingerprint_covers_progress, 4);
fingerprint_case!(fingerprint_covers_compact, 5);

#[test]
fn unsupported_generated_fields_refuse_at_receipts_declaration() {
    for name in ["id"] {
        let b = snapback4_lang::compile(&[(
            "schema.q".into(),
            renamed(
                SOURCE.split("\nquery badge").next().unwrap(),
                "received",
                name,
            ),
        )]);
        assert!(!b.diagnostics.is_empty(), "{name}");
        assert!(
            b.diagnostics
                .iter()
                .all(|d| d.code == "E_RECEIPTS_CLAUSE" && d.site.line == 17),
            "{name}: {:?}",
            b.diagnostics
        );
    }
}
