//! Review regressions: provisional accounting can defer a write, never lose it.
// @ref LLP 3000.022#14.3 — receipt-dependent refusals retain durable outbox custody.
use super::*;

fn request(op: &str, args: serde_json::Value, n: u64) -> Queued {
    let mut q = queued("alice", n);
    q.op = op.into();
    q.args = args;
    q
}
fn deferred<S: DeviceStore>(d: &mut Device<S>, q: Queued) -> Queued {
    let fact = &d.schema().operations[&q.op];
    assert_eq!(fact.predicts.as_deref(), Some("never"), "{}: {fact:?}", q.op);
    assert!(fact.sites.iter().any(|s| s.kind == "receipt dependency"), "{}: {fact:?}", q.op);
    let result = d.admit(q);
    assert!(
        result.is_ok(),
        "provisional refusal must keep the write: {result:?}"
    );
    let q = result.unwrap();
    assert!(!q.predictable, "{q:?}");
    assert!(
        q.predicted.is_empty(),
        "deferred attempt must roll back its rows"
    );
    assert!(
        d.queued()
            .unwrap()
            .iter()
            .any(|entry| entry.id == q.id && !entry.predictable)
    );
    q
}
fn settle<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, q: &Queued) {
    let values = q
        .args
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                snapback4_core::wire::from_json(&e.program(&q.op).unwrap().args[k], v).unwrap(),
            )
        })
        .collect();
    let outcome = e
        .mutate(
            &q.op,
            Some(&q.id),
            Context::new(&q.viewer, values)
                .at(q.now)
                .with_ids(q.new_ids.clone()),
        )
        .unwrap();
    let committed = seq(&outcome.state);
    d.settle(&q.id, Some(committed)).unwrap();
    publish(e, d, &q.viewer);
    assert!(!d.queued().unwrap().iter().any(|entry| entry.id == q.id));
}
fn reopen<H: Host>(host: &mut H, d: Device<H::Store>, ids: &[&str]) -> Device<H::Store> {
    host.close("dependencies", d);
    let mut d = host.open("dependencies", None).unwrap();
    assert_eq!(
        d.queued()
            .unwrap()
            .iter()
            .map(|q| q.id.as_str())
            .collect::<Vec<_>>(),
        ids
    );
    d
}
fn same_transaction<H: Host>(host: &mut H) {
    let source = source()
        + r#"
mutation checkedSend(conversation: conversations):
  m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }
  require receipt(m) != null else NEED_RECEIPT
  return m.id
"#;
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = deferred(
        &mut d,
        request("checkedSend", json!({"conversation":"c"}), 1),
    );
    assert!(d.store().raw_rows("messages").is_empty());
    let mut d = reopen(host, d, &[&q.id]);
    settle(&mut e, &mut d, &q);
    assert_eq!(e.store().rows("messages").unwrap().len(), 1);
}
fn followup<H: Host>(host: &mut H, rule: Option<&str>, condition: &str) {
    let rule = rule.unwrap_or("next.sender = viewer");
    let source = source().replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    );
    let source = source.replace("  immutable conversation, sender, ordinal, recipients, at", &format!("  immutable conversation, sender, ordinal, recipients, at\n  update (old, next) <- {rule}")) + &format!(r#"
mutation followup(message: messages):
  m = messages[message] ! else MISSING
  require {condition} else NOT_SETTLED
  update messages[m] {{ text: 'followup' }}
"#);
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let send = d.admit(queued("alice", 1)).unwrap();
    assert!(send.predictable);
    let follow = deferred(
        &mut d,
        request("followup", json!({"message":send.new_ids[0]}), 2),
    );
    let mut d = reopen(host, d, &[&send.id, &follow.id]);
    assert!(!d.queued().unwrap()[1].predictable);
    settle(&mut e, &mut d, &send);
    assert_eq!(
        d.queued().unwrap().len(),
        1,
        "settling send must retain its follow-up"
    );
    settle(&mut e, &mut d, &follow);
    assert_eq!(
        e.store().rows("messages").unwrap()[0].field("text"),
        Ok(&Value::String("followup".into()))
    );
}
fn pending_membership<H: Host>(host: &mut H, expression: &str) {
    // Generated queries are not callable Quarry functions. Exercise their exact
    // compiler-produced bodies as a write with a non-null postcondition on each
    // return, including progress's early null return (no hand-copied recipe).
    use snapback4_core::ir::{BinaryOp, Expr, ProgramKind, Stmt};
    fn require_return(body: &mut Vec<Stmt>) {
        let mut checked = vec![];
        for mut stmt in std::mem::take(body) {
            match &mut stmt {
                Stmt::Return(value) => checked.push(Stmt::Require {
                    condition: Expr::Binary {
                        op: BinaryOp::Ne,
                        left: Box::new(value.clone()),
                        right: Box::new(Expr::Literal(Value::Null)),
                    },
                    code: "NOT_SETTLED".into(),
                    site: None,
                }),
                Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    require_return(then_body);
                    require_return(else_body);
                }
                _ => {}
            }
            checked.push(stmt);
        }
        *body = checked;
    }
    let (_, mut b) = compile(&source());
    let mut followup = b
        .programs
        .iter()
        .find(|p| p.name == expression)
        .unwrap()
        .clone();
    followup.name = "memberFollowup".into();
    followup.kind = ProgramKind::Mutation;
    require_return(&mut followup.body);
    let fact = snapback4_lang::bind::residency::execution(&b.schema, &followup);
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    b.schema.operations.insert(followup.name.clone(), fact);
    b.programs.push(followup);
    let mut e = Engine::memory(b.schema.clone(), b.programs.clone()).unwrap();
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let create = d
        .admit(request("createConversation", json!({"title":"pending"}), 1))
        .unwrap();
    assert!(create.predictable);
    let follow = deferred(
        &mut d,
        request(
            "memberFollowup",
            if expression == "progress" {
                json!({"conversation":create.new_ids[0], "c":null})
            } else {
                json!({"conversation":create.new_ids[0]})
            },
            2,
        ),
    );
    let mut d = reopen(host, d, &[&create.id, &follow.id]);
    settle(&mut e, &mut d, &create);
    settle(&mut e, &mut d, &follow);
    assert!(d.queued().unwrap().is_empty());
}
fn ordinal_rule<H: Host>(host: &mut H, rule: &str, action: &str) {
    let source = source().replace(
        "  immutable conversation, sender, ordinal, recipients, at",
        &format!("  immutable conversation, sender, ordinal, recipients, at\n  {rule}"),
    ) + &format!(
        r#"
mutation ordinalSend(conversation: conversations):
  m = insert messages {{ conversation, sender: viewer, text: 'checked', photo: null, at: now }}
  {action}
"#
    );
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    send(&mut e, 1, NOW); // The device's held counter remains zero.
    let q = deferred(
        &mut d,
        request("ordinalSend", json!({"conversation":"c"}), 1),
    );
    assert!(d.store().raw_rows("messages").is_empty());
    let mut d = reopen(host, d, &[&q.id]);
    settle(&mut e, &mut d, &q);
    assert_eq!(
        int(&e.store().rows("conversations").unwrap()[0], "lastOrdinal"),
        2
    );
}
fn final_exists<H: Host>(host: &mut H) {
    let source = source().replace("  unique byConversationOrdinal: conversation, ordinal", "  unique byConversationOrdinal: conversation, ordinal\n  after insert <- exists permits[position = .ordinal]") + r#"
table permits:
  position: int
  unique position
  public
  sync public
"#;
    let (mut e, b) = compile(&source);
    seed(&mut e);
    e.seed_at(
        [(
            "permits".into(),
            object([("id", id("p2")), ("position", Value::Int(2))]),
        )],
        NOW,
    )
    .unwrap();
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    e.seed_at(
        [(
            "permits".into(),
            object([("id", id("p1")), ("position", Value::Int(1))]),
        )],
        NOW,
    )
    .unwrap();
    send(&mut e, 1, NOW);
    let q = deferred(&mut d, queued("alice", 1));
    let mut d = reopen(host, d, &[&q.id]);
    settle(&mut e, &mut d, &q);
    assert_eq!(
        int(&e.store().rows("conversations").unwrap()[0], "lastOrdinal"),
        2
    );
}
fn aggregate<H: Host>(host: &mut H, member_bound: bool, expiring: bool) {
    // Full source coverage makes this an actual predicate refusal, not an
    // acquisition refusal. recipients is a residual, not the range index.
    let base = if expiring {
        source().replace(
            "  text: text <=2000",
            "  until: time ?\n  expire at .until\n  text: text <=2000",
        )
    } else {
        source()
    };
    let predicate = if member_bound {
        ".recipients = m.joinedOrdinal"
    } else {
        ".recipients > 0"
    };
    let source = base.replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    ) + &format!(
        r#"
view qualified: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and {predicate}
mutation addKnown(conversation: conversations, principal: principal, id: id):
  insert members {{ id, conversation, principal }}
mutation aggregateFollowup(member: members):
  total = qualified[member] ! else NO_COUNT
  require total {expected} else NOT_SETTLED
  row = members[member] ! else NO_MEMBER
  update conversations[row.conversation] {{ title: 'aggregate checked' }}
"#,
        expected = if member_bound { "= 0" } else { "> 0" }
    );
    let (mut e, b) = compile(&source);
    seed(&mut e);
    if member_bound {
        send(&mut e, 1, NOW);
    }
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let first = if member_bound {
        send(&mut e, 2, NOW);
        d.admit(request(
            "addKnown",
            json!({"conversation":"c","principal":"carol","id":"queued-member"}),
            1,
        ))
        .unwrap()
    } else {
        d.admit(queued("alice", 1)).unwrap()
    };
    assert!(!first.predictable, "row-view declarations consume receipt state during maintenance");
    assert!(first.predicted.is_empty());
    let member = if member_bound {
        "queued-member"
    } else {
        "a"
    };
    let follow = deferred(
        &mut d,
        request("aggregateFollowup", json!({"member":member}), 2),
    );
    let mut d = reopen(host, d, &[&first.id, &follow.id]);
    settle(&mut e, &mut d, &first);
    settle(&mut e, &mut d, &follow);
    assert_eq!(
        e.store().rows("conversations").unwrap()[0].field("title"),
        Ok(&Value::String("aggregate checked".into()))
    );
}
macro_rules! both {
    ($memory:ident, $sqlite:ident, $test:ident $(, $arg:expr)*) => {
        #[test] fn $memory() { $test(&mut Memory::new() $(, $arg)*); }
        #[test] fn $sqlite() { $test(&mut Sqlite::new(stringify!($sqlite)) $(, $arg)*); }
    };
}
both!(
    same_transaction_memory,
    same_transaction_sqlite,
    same_transaction
);
both!(
    receipt_followup_memory,
    receipt_followup_sqlite,
    followup,
    None,
    "receipt(m) != null"
);
both!(
    direct_count_memory,
    direct_count_sqlite,
    followup,
    None,
    "m.recipients > 0"
);
both!(
    next_count_rule_memory,
    next_count_rule_sqlite,
    followup,
    Some("next.recipients > 0"),
    "true"
);
both!(
    old_count_rule_memory,
    old_count_rule_sqlite,
    followup,
    Some("old.recipients > 0"),
    "true"
);
both!(
    member_followup_memory,
    member_followup_sqlite,
    pending_membership,
    "receiptMember"
);
both!(
    progress_followup_memory,
    progress_followup_sqlite,
    pending_membership,
    "progress"
);
both!(
    ordinal_update_memory,
    ordinal_update_sqlite,
    ordinal_rule,
    "update <- .ordinal = 2",
    "update messages[m] { text: 'edited' }"
);
both!(
    ordinal_delete_memory,
    ordinal_delete_sqlite,
    ordinal_rule,
    "delete <- .ordinal = 2",
    "delete messages[m]"
);
both!(final_exists_memory, final_exists_sqlite, final_exists);
both!(
    aggregate_source_memory,
    aggregate_source_sqlite,
    aggregate,
    false,
    false
);
both!(
    aggregate_member_memory,
    aggregate_member_sqlite,
    aggregate,
    true,
    false
);
both!(
    residual_rule_memory,
    residual_rule_sqlite,
    followup,
    Some("exists messages[id = next.id, recipients = 1]"),
    "true"
);

both!(
    aggregate_live_source_memory,
    aggregate_live_source_sqlite,
    aggregate,
    false,
    true
);
both!(
    aggregate_live_member_memory,
    aggregate_live_member_sqlite,
    aggregate,
    true,
    true
);

fn scalar<H: Host>(host: &mut H, view: &str, expression: &str) {
    let source = source().replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    ) + &format!(
        r#"
{view}
mutation scalarFollowup(conversation: conversations):
  require {expression} > 0 else NOT_SETTLED
  update conversations[conversation] {{ title: 'scalar checked' }}
"#
    );
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let send = d.admit(queued("alice", 1)).unwrap();
    assert_eq!(send.predictable, view.is_empty(), "authored receipt-derived maintenance also reads accounting");
    let follow = deferred(
        &mut d,
        request("scalarFollowup", json!({"conversation":"c"}), 2),
    );
    let mut d = reopen(host, d, &[&send.id, &follow.id]);
    settle(&mut e, &mut d, &send);
    settle(&mut e, &mut d, &follow);
}
both!(
    scalar_max_memory,
    scalar_max_sqlite,
    scalar,
    "",
    "(max(messages where .conversation = conversation, .recipients) ?? 0)"
);
both!(
    scalar_sum_memory,
    scalar_sum_sqlite,
    scalar,
    "",
    "sum(messages where .conversation = conversation, .recipients)"
);
both!(
    maintained_sum_memory,
    maintained_sum_sqlite,
    scalar,
    "view totals: sum messages of .recipients by .conversation",
    "totals[conversation]"
);
both!(
    maintained_filter_memory,
    maintained_filter_sqlite,
    scalar,
    "view totals: count messages where .recipients > 0 by .conversation",
    "totals[conversation]"
);

fn collection<H: Host>(host: &mut H, condition: &str) {
    let source = source().replace(
        "sync to members[.conversation] last 500 by byConversationOrdinal",
        "sync to members[.conversation]",
    ) + &format!(
        r#"
mutation collectionFollowup(conversation: conversations):
  rows = messages where .conversation = conversation first 10 by .at
  require {condition} else NOT_SETTLED
  update conversations[conversation] {{ title: 'collection checked' }}
"#
    );
    let (mut e, b) = compile(&source);
    seed(&mut e);
    send(&mut e, 1, NOW - 1);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let send = d.admit(queued("alice", 1)).unwrap();
    assert!(send.predictable);
    let follow = deferred(
        &mut d,
        request("collectionFollowup", json!({"conversation":"c"}), 2),
    );
    let mut d = reopen(host, d, &[&send.id, &follow.id]);
    settle(&mut e, &mut d, &send);
    settle(&mut e, &mut d, &follow);
}
both!(
    group_memory,
    group_sqlite,
    collection,
    "count(group(rows, 'recipients')) = 1"
);
both!(
    sort_memory,
    sort_sqlite,
    collection,
    "first(sort(rows, 'recipients')).text = 'm1'"
);

fn terminal<H: Host>(host: &mut H) {
    let source = source()
        + r#"
mutation terminal(message: messages):
  require true or receipt(messages[message] ! else MISSING) != null else UNREACHABLE
  require false else TERMINAL
"#;
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let send = d.admit(queued("alice", 1)).unwrap();
    let q = deferred(&mut d, request("terminal", json!({"message":send.new_ids[0]}), 2));
    assert_eq!(d.queued().unwrap().len(), 2, "static analysis includes untaken code");
    settle(&mut e, &mut d, &send);
    let outcome = e.mutate(&q.op, Some(&q.id), Context::new("alice", args(&[("message", id(&send.new_ids[0]))])).at(q.now)).unwrap();
    assert!(matches!(outcome.state, WriteState::Failed { .. }));
    d.settle(&q.id, None).unwrap();
    assert!(d.queued().unwrap().is_empty());
}
both!(terminal_control_memory, terminal_control_sqlite, terminal);

#[test]
fn private_receipt_capture_is_rejected_by_the_compiler() {
    // The starter's private receipt target cannot become a recorded capture.
    // The public-message variant below is admitted and needs provenance.
    let source = source()
        + r#"
table marks:
  conversation: conversations
  message: messages
  immutable message
  public
  sync public
view marked: count marks where .message.recipients = 1 by .conversation
"#;
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.code == "E_QUARRY_MAINTAIN" && d.message.contains("public")),
        "{:?}",
        b.diagnostics
    );
}

fn captured_public<H: Host>(host: &mut H, split: bool) {
    let source = source()
        .replace(
            "  read <- exists members[.conversation, viewer]\n  insert <- .sender",
            "  read <- allow\n  insert <- .sender",
        )
        .replace(
            "sync to members[.conversation] last 500 by byConversationOrdinal",
            "sync public",
        )
        + r#"
table marks:
  conversation: conversations
  message: messages
  immutable message
  insert <- allow
  public
  sync public
view marked: count marks where .message.recipients = 1 by .conversation
mutation capturedFollowup(conversation: conversations, message: messages):
  insert marks { conversation, message }
  require marked[conversation] > 0 else NOT_SETTLED

mutation captureOnly(conversation: conversations, message: messages):
  insert marks { conversation, message }
mutation captureRead(conversation: conversations):
  require marked[conversation] > 0 else NOT_SETTLED
"#;
    let (mut e, b) = compile(&source);
    seed(&mut e);
    let mut d = host.open("dependencies", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let send = d.admit(queued("alice", 1)).unwrap();
    assert!(send.predictable);
    let args = json!({"conversation":"c", "message":send.new_ids[0]});
    let capture = split.then(|| d.admit(request("captureOnly", args.clone(), 2)).unwrap());
    let follow = deferred(
        &mut d,
        if split {
            request("captureRead", json!({"conversation":"c"}), 3)
        } else {
            request("capturedFollowup", args, 2)
        },
    );
    let ids = if let Some(q) = &capture {
        vec![send.id.as_str(), q.id.as_str(), follow.id.as_str()]
    } else {
        vec![send.id.as_str(), follow.id.as_str()]
    };
    let mut d = reopen(host, d, &ids);
    settle(&mut e, &mut d, &send);
    if let Some(q) = capture {
        settle(&mut e, &mut d, &q);
    }
    assert_eq!(d.queued().unwrap().len(), 1);
    settle(&mut e, &mut d, &follow);
    assert_eq!(
        int(&e.store().rows("marks").unwrap()[0], "message.recipients"),
        1
    );
}
both!(
    captured_public_memory,
    captured_public_sqlite,
    captured_public,
    false
);
both!(
    captured_followup_memory,
    captured_followup_sqlite,
    captured_public,
    true
);

#[path = "generated_dependencies.rs"]
mod generated;

#[path = "compound_values.rs"]
mod compound_values;

#[path = "generated_value_taint.rs"]
mod generated_value_taint;

#[path = "static_prediction.rs"]
mod static_prediction;
