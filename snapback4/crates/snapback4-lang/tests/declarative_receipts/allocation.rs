//! RY: a reference state machine independent of generated receipt programs.
use super::*;
use snapback4_device::{
    device::{Device, Queued},
    store::DeviceStore,
};
use std::collections::{BTreeMap, BTreeSet};
const NOW: i64 = 4_000_000_000_000;
const STATE: &str = r#"
query allocationState(conversation: conversations):
  people = members where .conversation = conversation first 50 by .principal
  history = messages where .conversation = conversation last 100 by .ordinal { *, label: receipt(.) }
  return { scope: conversations[id = conversation], members: people, messages: history }
mutation sendOnce(conversation: conversations, id: id):
  return insert messages { id, conversation, sender: viewer, text: 'once', photo: null, at: now } if absent
mutation failedSend(conversation: conversations):
  insert messages { conversation, sender: viewer, text: 'rollback', photo: null, at: now }
  require false else ROLLBACK
"#;
fn source() -> String {
    format!("{DECLARATIVE}\n{STATE}")
}
fn seq(s: &WriteState) -> u64 {
    match s {
        WriteState::Sent { seq, .. } => *seq,
        _ => panic!("{s:?}"),
    }
}
fn int(v: &Value, field: &str) -> i64 {
    v.field(field).unwrap().as_int().unwrap()
}
fn state(e: &mut Engine) -> Value {
    let q = e
        .query(
            "allocationState",
            ctx("alice", &[("conversation", id("c"))], NOW),
        )
        .unwrap();
    assert!(q.complete);
    q.data
}
fn publish<S: DeviceStore>(e: &mut Engine, d: &mut Device<S>, viewer: &str) {
    for (i, page) in snapshot_pages(e, viewer, 1000).iter().enumerate() {
        d.apply(page, i == 0).unwrap();
    }
}
#[derive(Default)]
struct Member {
    floor: i64,
    seen: i64,
    delivered: BTreeSet<i64>,
}
#[derive(Default)]
struct Model {
    members: BTreeMap<String, Member>,
    messages: Vec<(String, i64)>,
}
impl Model {
    fn new() -> Self {
        Self {
            members: ["alice", "bob"]
                .map(|p| (p.into(), Member::default()))
                .into(),
            ..Self::default()
        }
    }
    fn check(&self, actual: &Value) {
        assert_eq!(
            int(actual.field("scope").unwrap(), "lastOrdinal"),
            self.messages.len() as i64
        );
        let members = actual.field("members").unwrap().as_array().unwrap();
        assert_eq!(members.len(), self.members.len());
        for row in members {
            let member = &self.members[row.field("principal").unwrap().as_str().unwrap()];
            assert_eq!(int(row, "joinedOrdinal"), member.floor);
            assert_eq!(int(row, "seenOrdinal"), member.seen);
        }
        let mut messages: Vec<_> = actual
            .field("messages")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .collect();
        messages.sort_by_key(|m| int(m, "ordinal"));
        assert_eq!(messages.len(), self.messages.len());
        for (i, (row, (sender, count))) in messages.iter().zip(&self.messages).enumerate() {
            let ordinal = i as i64 + 1;
            assert_eq!(int(row, "ordinal"), ordinal);
            assert_eq!(int(row, "recipients"), *count);
            let required: Vec<_> = self
                .members
                .iter()
                .filter(|(p, m)| *p != sender && m.floor < ordinal)
                .map(|(_, m)| m)
                .collect();
            let label = if required.iter().any(|m| !m.delivered.contains(&ordinal)) {
                "sent"
            } else if required.iter().any(|m| m.seen < ordinal) {
                "delivered"
            } else if required.is_empty() && *count == 0 {
                "sent"
            } else {
                "read"
            };
            assert_eq!(
                row.field("label").unwrap().as_str().unwrap(),
                label,
                "ordinal {ordinal}"
            );
        }
    }
}
fn model<H: Host>(host: &mut H) {
    // 16 deterministic schedules per store, 80 transitions each. The first
    // transitions force leave/rejoin; subsequent choices interleave two senders,
    // joins, leaves, out-of-order reports, duplicate reports and seen.
    for seed_number in 1..=16_u64 {
        let (mut e, backend) = compile(&source());
        seed(&mut e);
        let mut d = host
            .open(&format!("model{seed_number}"), Some(backend))
            .unwrap();
        let mut model = Model::new();
        let mut rng = seed_number;
        for step in 0..80 {
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let who = if (rng >> 32) % 2 == 0 { "bob" } else { "carol" };
            let choice = if step < 6 {
                [0, 3, 0, 2, 4, 5][step]
            } else {
                (rng >> 40) % 7
            };
            let high = model.messages.len() as i64;
            let group = ("conversation", id("c"));
            match choice {
                0 | 1 => {
                    let sender = if choice == 1 && model.members.contains_key(who) {
                        who
                    } else {
                        "alice"
                    };
                    sent(mutate(
                        &mut e,
                        sender,
                        "send",
                        &[
                            group,
                            ("text", Value::String(format!("{seed_number}:{step}"))),
                            ("photo", Value::Null),
                        ],
                        NOW,
                    ));
                    model.messages.push((
                        sender.into(),
                        model
                            .members
                            .keys()
                            .filter(|p| p.as_str() != sender)
                            .count() as i64,
                    ));
                }
                2 => {
                    sent(mutate(
                        &mut e,
                        "alice",
                        "add",
                        &[group, ("principal", id(who))],
                        NOW,
                    ));
                    model.members.entry(who.into()).or_insert_with(|| Member {
                        floor: high,
                        ..Default::default()
                    });
                }
                3 if model.members.contains_key(who) => {
                    sent(mutate(&mut e, who, "leave", &[group], NOW));
                    model.members.remove(who);
                }
                4 | 6 if high > 0 && model.members.contains_key(who) => {
                    let n = 1 + ((rng >> 16) % high as u64) as i64;
                    let values = [group, ("from", Value::Int(n)), ("through", Value::Int(n))];
                    sent(mutate(&mut e, who, "delivered", &values, NOW));
                    sent(mutate(&mut e, who, "delivered", &values, NOW));
                    model.members.get_mut(who).unwrap().delivered.insert(n);
                }
                5 if high > 0 && model.members.contains_key(who) => {
                    let n = 1 + ((rng >> 16) % high as u64) as i64;
                    sent(mutate(
                        &mut e,
                        who,
                        "seen",
                        &[group, ("through", Value::Int(n))],
                        NOW,
                    ));
                    let member = model.members.get_mut(who).unwrap();
                    member.seen = member.seen.max(n);
                }
                _ => {}
            }
            let actual = state(&mut e);
            model.check(&actual);
            publish(&mut e, &mut d, "alice");
            let local = d
                .query(
                    "allocationState",
                    "alice",
                    &json!({"conversation":"c"}),
                    NOW,
                )
                .unwrap();
            assert!(
                local.complete,
                "{} seed {seed_number} step {step}",
                host.label()
            );
            assert_eq!(local.data, actual);
            model.check(&local.data);
        }
        host.close(&format!("model{seed_number}"), d);
    }
}
#[test]
fn allocation_model_memory() {
    model(&mut Memory::new());
}
#[test]
fn allocation_model_sqlite() {
    model(&mut Sqlite::new("ry-model"));
}

fn queued(viewer: &str, n: u64) -> Queued {
    Queued {
        id: format!("{viewer}{n}"),
        seq: n,
        op: "send".into(),
        args: json!({"conversation":"c","text":format!("{viewer}{n}"),"photo":null}),
        viewer: viewer.into(),
        now: NOW,
        new_ids: vec![],
        predicted: vec![],
        predictable: true,
        sent_seq: None,
        receipt_store: None,
        observed_seq: None,
        dispatch: None,
    }
}
fn offline<H: Host>(host: &mut H) {
    let (mut e, b) = compile(&source());
    seed(&mut e);
    let mut devices = [
        host.open("alice", Some(b.clone())).unwrap(),
        host.open("bob", Some(b)).unwrap(),
    ];
    for (i, who) in ["alice", "bob"].iter().enumerate() {
        publish(&mut e, &mut devices[i], who);
        for n in 1..=3 {
            let q = devices[i].admit(queued(who, n)).unwrap();
            assert!(!q.predictable);
            assert!(q.predicted.is_empty());
        }
        let local = devices[i]
            .query("history", who, &json!({"conversation":"c","c":null}), NOW)
            .unwrap();
        assert!(
            local.data.as_array().unwrap().is_empty(),
            "no guessed ordinal can enter history"
        );
    }
    let [a, b] = devices;
    host.close("alice", a);
    host.close("bob", b);
    let mut devices = [
        host.open("alice", None).unwrap(),
        host.open("bob", None).unwrap(),
    ];
    let mut order = vec![];
    for i in [1, 0, 0, 1, 1, 0] {
        let who = ["alice", "bob"][i];
        let q = devices[i].queued().unwrap()[0].clone();
        let values = [
            ("conversation", id("c")),
            ("text", Value::String(q.id.clone())),
            ("photo", Value::Null),
        ];
        let r = e
            .mutate("send", Some(&q.id), ctx(who, &values, NOW))
            .unwrap();
        let replay = e
            .mutate("send", Some(&q.id), ctx(who, &values, NOW))
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(seq(&r.state), seq(&replay.state));
        let WriteState::Sent { seq, .. } = r.state else {
            panic!("{:?}", r.state)
        };
        devices[i].settle(&q.id, Some(seq)).unwrap();
        for (d, principal) in devices.iter_mut().zip(["alice", "bob"]) {
            publish(&mut e, d, principal);
        }
        order.push(q.id);
        let actual = state(&mut e);
        let mut rows: Vec<_> = actual
            .field("messages")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .collect();
        rows.sort_by_key(|m| int(m, "ordinal"));
        assert_eq!(rows.len(), order.len());
        for (j, row) in rows.iter().enumerate() {
            assert_eq!(int(row, "ordinal"), j as i64 + 1);
            assert_eq!(int(row, "recipients"), 1);
            assert_eq!(row.field("text").unwrap().as_str().unwrap(), order[j]);
            assert_eq!(row.field("label").unwrap().as_str().unwrap(), "sent");
        }
    }
    for who in ["alice", "bob"] {
        sent(mutate(
            &mut e,
            who,
            "delivered",
            &[
                ("conversation", id("c")),
                ("from", Value::Int(1)),
                ("through", Value::Int(6)),
            ],
            NOW,
        ));
        sent(mutate(
            &mut e,
            who,
            "seen",
            &[("conversation", id("c")), ("through", Value::Int(6))],
            NOW,
        ));
    }
    for (d, who) in devices.iter_mut().zip(["alice", "bob"]) {
        publish(&mut e, d, who);
        assert!(d.queued().unwrap().is_empty());
        let local = d
            .query("allocationState", who, &json!({"conversation":"c"}), NOW)
            .unwrap();
        assert!(local.complete);
        assert_eq!(local.data, state(&mut e));
        assert!(
            local
                .data
                .field("messages")
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .all(|m| m.field("label").unwrap().as_str().unwrap() == "read")
        );
    }
}
#[test]
fn offline_two_devices_memory() {
    offline(&mut Memory::new());
}
#[test]
fn offline_two_devices_sqlite() {
    offline(&mut Sqlite::new("ry-offline"));
}

#[test]
fn simultaneous_writers_allocate_without_gaps_or_duplicates() {
    let host = Sqlite::new("ry-concurrent");
    let b = bound(&source());
    let mut e = Engine::new(
        snapback4_core::store::Store::open(&host.path("server")).unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    seed(&mut e);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let threads: Vec<_> = (0..8)
        .map(|worker| {
            let path = host.path("server");
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut e =
                    Engine::open(snapback4_core::store::Store::open(&path).unwrap()).unwrap();
                barrier.wait();
                for n in 0..10 {
                    let write = format!("w{worker}:{n}");
                    let values = [
                        ("conversation", id("c")),
                        ("text", Value::String(write.clone())),
                        ("photo", Value::Null),
                    ];
                    let r = e
                        .mutate("send", Some(&write), ctx("alice", &values, NOW))
                        .unwrap();
                    sent(r.state.clone());
                    let replay = e
                        .mutate("send", Some(&write), ctx("alice", &values, NOW))
                        .unwrap();
                    assert!(replay.replayed);
                    assert_eq!(seq(&r.state), seq(&replay.state));
                }
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let mut model = Model::new();
    model.messages = vec![("alice".into(), 1); 80];
    model.check(&state(&mut e));
}

#[test]
fn failed_noop_and_metered_sends_preserve_counter() {
    let (mut e, _) = compile(&source());
    seed(&mut e);
    let group = ("conversation", id("c"));
    assert!(
        format!(
            "{:?}",
            mutate(&mut e, "alice", "failedSend", &[group.clone()], NOW)
        )
        .contains("ROLLBACK")
    );
    assert_eq!(int(state(&mut e).field("scope").unwrap(), "lastOrdinal"), 0);
    for _ in 0..3 {
        sent(mutate(
            &mut e,
            "alice",
            "sendOnce",
            &[group.clone(), ("id", id("once"))],
            NOW,
        ));
    }
    assert_eq!(int(state(&mut e).field("scope").unwrap(), "lastOrdinal"), 1);
    let original = e.ceilings();
    e.set_ceilings(snapback4_core::meter::Ceilings {
        rows_written: 1,
        ..original
    });
    let failure = mutate(
        &mut e,
        "alice",
        "send",
        &[
            group,
            ("text", Value::String("meter".into())),
            ("photo", Value::Null),
        ],
        NOW,
    );
    assert!(format!("{failure:?}").contains("E_BOUND"));
    e.set_ceilings(original);
    assert_eq!(int(state(&mut e).field("scope").unwrap(), "lastOrdinal"), 1);
    send(&mut e, 2, NOW);
    assert_eq!(int(state(&mut e).field("scope").unwrap(), "lastOrdinal"), 2);
}

#[test]
fn ownership_initialization_results_and_scope_authority() {
    let source = source()
        .replace(
            "  lastOrdinal: int default 0",
            "  lastOrdinal: int\n  secret: text <=80 default '' written by .creatorId",
        )
        .replace("  update <- exists members[.id, viewer]\n", "")
        .replace("read <- exists members[.id, viewer]", "public")
        .replace("sync to members[.id]", "sync public")
        + r#"
mutation badOrdinal(conversation: conversations):
  insert messages { conversation, sender: viewer, ordinal: 1, text: 'bad', photo: null, at: now }
mutation badCount(conversation: conversations):
  insert messages { conversation, sender: viewer, recipients: 0, text: 'bad', photo: null, at: now }
mutation badFloor(conversation: conversations):
  insert members { conversation, principal: viewer, joinedOrdinal: 0 }
mutation badCounter(conversation: conversations):
  update conversations[id = conversation] { lastOrdinal: 999 }
mutation badScope():
  insert conversations { creatorId: viewer, lastOrdinal: 999 }
mutation returned(conversation: conversations):
  return insert messages { conversation, sender: viewer, text: 'result', photo: null, at: now }
mutation reset(conversation: conversations):
  delete conversations[id = conversation]
"#;
    let (mut e, _) = compile(&source);
    let result = e
        .mutate(
            "createConversation",
            None,
            ctx("alice", &[("title", Value::String("Created".into()))], NOW)
                .with_ids(["c".into(), "a".into()]),
        )
        .unwrap();
    sent(result.state);
    assert_eq!(
        int(&e.store().rows("conversations").unwrap()[0], "lastOrdinal"),
        0
    );
    assert_eq!(
        int(&e.store().rows("members").unwrap()[0], "joinedOrdinal"),
        0
    );
    e.seed_at(
        [(
            "conversations".into(),
            object([
                ("id", id("c")),
                ("secret", Value::String("keep private".into())),
            ]),
        )],
        NOW,
    )
    .unwrap();
    sent(mutate(
        &mut e,
        "alice",
        "add",
        &[("conversation", id("c")), ("principal", id("bob"))],
        NOW,
    ));
    for op in [
        "badOrdinal",
        "badCount",
        "badFloor",
        "badCounter",
        "badScope",
        "reset",
    ] {
        let values = if op == "badScope" {
            vec![]
        } else {
            vec![("conversation", id("c"))]
        };
        assert!(
            format!("{:?}", mutate(&mut e, "bob", op, &values, NOW)).contains("E_RECEIPTS_OWNED"),
            "{op}"
        );
    }
    let r = e
        .mutate(
            "returned",
            None,
            ctx("bob", &[("conversation", id("c"))], NOW),
        )
        .unwrap();
    let WriteState::Sent { result, .. } = r.state else {
        panic!("{:?}", r.state)
    };
    assert_eq!(int(&result, "ordinal"), 1);
    assert_eq!(int(&result, "recipients"), 1);
    let scope = &e.store().rows("conversations").unwrap()[0];
    assert_eq!(int(scope, "lastOrdinal"), 1);
    assert_eq!(
        scope.field("secret").unwrap().as_str().unwrap(),
        "keep private"
    );
    assert!(
        e.query(
            "conversationScreen",
            ctx("bob", &[("conversation", id("c"))], NOW)
        )
        .unwrap()
        .data
        .field("secret")
        .is_err()
    );
}

#[test]
fn sequence_counters_and_other_groups_cannot_consume_receipt_positions() {
    let source = source()
        + r#"
table otherEvents:
  conversation: conversations
  number: sequence by conversation
  public
  insert <- true
  sync public
mutation other(conversation: conversations):
  insert otherEvents { conversation }
"#;
    let (mut e, _) = compile(&source);
    seed(&mut e);
    for _ in 0..3 {
        sent(mutate(
            &mut e,
            "alice",
            "other",
            &[("conversation", id("c"))],
            NOW,
        ));
    }
    send(&mut e, 1, NOW);
    sent(mutate(
        &mut e,
        "alice",
        "add",
        &[("conversation", id("c")), ("principal", id("carol"))],
        NOW,
    ));
    send(&mut e, 2, NOW);
    sent(mutate(
        &mut e,
        "alice",
        "createConversation",
        &[("title", Value::String("other".into()))],
        NOW,
    ));
    let groups = e.store().rows("conversations").unwrap();
    assert_eq!(
        int(
            groups
                .iter()
                .find(|r| r.field("id").unwrap() == &id("c"))
                .unwrap(),
            "lastOrdinal"
        ),
        2
    );
    assert_eq!(
        int(
            groups
                .iter()
                .find(|r| r.field("id").unwrap() != &id("c"))
                .unwrap(),
            "lastOrdinal"
        ),
        0
    );
    let messages = e.store().rows("messages").unwrap();
    assert_eq!(
        messages
            .iter()
            .map(|r| int(r, "ordinal"))
            .collect::<BTreeSet<_>>(),
        [1, 2].into()
    );
}

#[test]
fn unsafe_accounting_declarations_refuse_at_the_clause() {
    for source in [
        DECLARATIVE.replace("count .recipients", "count .ordinal"),
        DECLARATIVE.replace(
            "insert <- .sender = viewer and exists members[.conversation, viewer]",
            "insert <- .ordinal = 1",
        ),
        DECLARATIVE.replace("lastOrdinal: int default 0", "lastOrdinal: int default 17"),
        DECLARATIVE.replace(
            "lastOrdinal: int default 0",
            "lastOrdinal: int default 0\n  immutable lastOrdinal",
        ),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == "E_RECEIPTS_CLAUSE"),
            "{:?}",
            b.diagnostics
        );
    }
}

fn runtime_guard<H: Host>(host: &mut H) {
    let (mut e, mut b) = compile(&source());
    seed(&mut e);
    b.schema.operations.clear();
    let mut d = host.open("guard", Some(b)).unwrap();
    publish(&mut e, &mut d, "alice");
    let q = d.admit(queued("alice", 1)).unwrap();
    assert!(!q.predictable);
    assert!(q.predicted.is_empty());
    assert!(
        d.query(
            "history",
            "alice",
            &json!({"conversation":"c","c":null}),
            NOW
        )
        .unwrap()
        .data
        .as_array()
        .unwrap()
        .is_empty()
    );
}
#[test]
fn runtime_prediction_guard_memory() {
    runtime_guard(&mut Memory::new());
}
#[test]
fn runtime_prediction_guard_sqlite() {
    runtime_guard(&mut Sqlite::new("ry-guard"));
}

#[test]
fn recipient_capture_never_prices_another_members_private_payload() {
    let source = source().replace(
        "  joinedOrdinal: int",
        "  joinedOrdinal: int\n  private: text <=1000 default '' written by .principal",
    );
    let outcome = |private: &str| {
        let (mut e, _) = compile(&source);
        seed(&mut e);
        e.seed_at(
            [(
                "members".into(),
                object([("id", id("b")), ("private", Value::String(private.into()))]),
            )],
            NOW,
        )
        .unwrap();
        let r = e
            .mutate(
                "send",
                None,
                ctx(
                    "alice",
                    &[
                        ("conversation", id("c")),
                        ("text", Value::String("same".into())),
                        ("photo", Value::Null),
                    ],
                    NOW,
                )
                .with_ids(["m".into()]),
            )
            .unwrap();
        sent(r.state);
        assert_eq!(
            int(&e.store().rows("messages").unwrap()[0], "recipients"),
            1
        );
        r.metered
    };
    assert_eq!(outcome(""), outcome(&"x".repeat(1000)));
}
