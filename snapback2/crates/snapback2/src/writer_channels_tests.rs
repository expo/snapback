use super::*;
use snapback2_core::{
    Channel, ColumnType, Index, IndexComponent, RuleExpr, RuleTerm, public_table,
};

fn state(label: &str, protected: bool) -> State {
    let mut state = super::super::writer_live_tests::state(label);
    let mut project = state.compiled.project.clone();
    project.schema.tables.insert(
        "permissions".into(),
        public_table(
            BTreeMap::from([
                ("id".into(), ColumnType::Id),
                ("user".into(), ColumnType::Principal),
                ("side".into(), ColumnType::Text { max: 20 }),
            ]),
            BTreeMap::from([(
                "byUserSide".into(),
                Index {
                    components: vec![
                        IndexComponent::Column("user".into()),
                        IndexComponent::Column("side".into()),
                    ],
                    unique: true,
                },
            )]),
        ),
    );
    let rule = |side: &str| {
        if protected {
            RuleExpr::Exists {
                table: "permissions".into(),
                index: "byUserSide".into(),
                key: vec![
                    RuleTerm::Viewer,
                    RuleTerm::Literal(Value::String(side.into())),
                ],
                provenance: KeyProvenance::Shape,
            }
        } else {
            RuleExpr::Allow
        }
    };
    project.schema.channels.insert(
        "typing".into(),
        Channel {
            args: BTreeMap::from([
                (
                    "room".into(),
                    ArgType::Text {
                        max: 2_000,
                        min: 0,
                        format: None,
                    },
                ),
                ("scope".into(), ArgType::Optional(Box::new(ArgType::Bool))),
            ]),
            value: BTreeMap::from([
                ("typing".into(), ArgType::Bool),
                (
                    "extra".into(),
                    ArgType::Optional(Box::new(ArgType::Json { max_bytes: 10_000 })),
                ),
            ]),
            publish: rule("publish"),
            subscribe: rule("subscribe"),
            ttl_ms: 1_000,
        },
    );
    project.programs.push(Program {
        name: "remove".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("id".into(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Delete {
                table: "permissions".into(),
                key: Expr::Variable("id".into()),
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    });
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    state
        .runtime_mut()
        .apply_successor(generation.clone())
        .unwrap();
    state.compiled.project = project;
    state.compiled.generation = generation;
    if protected {
        let rows = ["alice", "bob"]
            .iter()
            .flat_map(|user| {
                ["subscribe", "publish"].iter().map(move |side| {
                    (
                        "permissions".into(),
                        snapback2_core::object([
                            ("id", Value::Id(format!("{user}-{side}"))),
                            ("user", Value::Id(format!("dev:{user}"))),
                            ("side", Value::String((*side).into())),
                        ]),
                    )
                })
            })
            .collect::<Vec<_>>();
        state.runtime_mut().seed(&rows).unwrap();
    }
    state
}
fn open(state: &mut State, user: &str, room: &str) -> (u64, SseReceiver, Json) {
    let (events, receiver) = sse_queue();
    let meta = state
        .handle(Action::ChannelSubscribe {
            name: "typing".into(),
            args: json!({"room":room}),
            identity: Identity::Persona(user.into()),
            events,
        })
        .unwrap();
    let first = receiver.recv_timeout(Duration::ZERO).unwrap();
    assert_eq!(first.seq, None);
    assert_eq!(first.data["state"], "snapshot");
    (meta["id"].as_u64().unwrap(), receiver, first.data)
}
fn command(
    state: &mut State,
    user: &str,
    room: &str,
    lease: &Json,
    version: u64,
    value: Option<Json>,
) -> Result<Json, Refusal> {
    state.handle(Action::ChannelWrite {
        name: "typing".into(),
        args: json!({"room":room, "scope":null}),
        lease: lease.as_str().unwrap().into(),
        version: json!(version),
        value,
        identity: Identity::Persona(user.into()),
    })
}
fn next(receiver: &SseReceiver) -> Json {
    receiver.recv_timeout(Duration::ZERO).unwrap().data
}
fn remove_permission(state: &mut State, id: &str) {
    state
        .handle(Action::Execute {
            op: "remove".into(),
            args: json!({"id":id}),
            identity: Identity::Persona("alice".into()),
            expected: Some(ProgramKind::Mutation),
            expected_generation: None,
            offline: Default::default(),
            replay: None,
        })
        .unwrap();
}

#[test]
fn latest_snapshots_are_typed_scoped_and_connection_owned() {
    let mut state = state("channel-latest", false);
    let (first_id, first_rx, first) = open(&mut state, "alice", "one");
    assert_eq!(first["entries"], json!([]));
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        1,
        Some(json!({"typing":true})),
    )
    .unwrap();
    assert_eq!(
        next(&first_rx)["entries"][0]["value"],
        json!({"typing":true,"extra":null})
    );
    let (_, second_rx, second) = open(&mut state, "alice", "one");
    assert_ne!(first["key"], second["key"]);
    assert_ne!(first["lease"], second["lease"]);
    assert_eq!(second["entries"][0]["key"], first["key"]);
    assert!(second["entries"][0].get("lease").is_none());
    let (_, other_rx, other) = open(&mut state, "alice", "other");
    assert_eq!(other["entries"], json!([]));
    command(
        &mut state,
        "alice",
        "one",
        &second["lease"],
        1,
        Some(json!({"typing":false})),
    )
    .unwrap();
    assert_eq!(next(&first_rx)["entries"].as_array().unwrap().len(), 2);
    let entries = next(&second_rx)["entries"].as_array().unwrap().clone();
    assert!(
        entries
            .windows(2)
            .all(|pair| pair[0]["key"].as_str() < pair[1]["key"].as_str())
    );
    assert!(other_rx.recv_timeout(Duration::ZERO).is_err());
    command(&mut state, "alice", "one", &first["lease"], 2, None).unwrap();
    assert_eq!(next(&second_rx)["entries"].as_array().unwrap().len(), 1);
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        3,
        Some(json!({"typing":true})),
    )
    .unwrap();
    state
        .handle(Action::ChannelUnsubscribe { id: first_id })
        .unwrap();
    assert_eq!(next(&second_rx)["entries"].as_array().unwrap().len(), 1);
    assert_eq!(
        command(&mut state, "alice", "one", &first["lease"], 4, None)
            .unwrap_err()
            .code,
        "E_CHANNEL_LEASE"
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn lease_and_shape_checks_cannot_burn_versions_and_clear_fences_old_sets() {
    let mut state = state("channel-versions", false);
    let (_, rx, first) = open(&mut state, "alice", "one");
    for (user, room) in [("bob", "one"), ("alice", "two")] {
        assert_eq!(
            command(
                &mut state,
                user,
                room,
                &first["lease"],
                10,
                Some(json!({"typing":true}))
            )
            .unwrap_err()
            .code,
            "E_CHANNEL_LEASE"
        );
    }
    for value in [
        json!({}),
        json!({"typing":"yes"}),
        json!({"typing":true,"undeclared":false}),
        json!({"typing":true,"extra":"x".repeat(4_100)}),
    ] {
        assert!(command(&mut state, "alice", "one", &first["lease"], 10, Some(value)).is_err());
    }
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        1,
        Some(json!({"typing":true})),
    )
    .unwrap();
    command(&mut state, "alice", "one", &first["lease"], 3, None).unwrap();
    assert_eq!(
        command(
            &mut state,
            "alice",
            "one",
            &first["lease"],
            2,
            Some(json!({"typing":true}))
        )
        .unwrap_err()
        .code,
        "E_CHANNEL_VERSION"
    );
    assert_eq!(next(&rx)["entries"], json!([]));
    assert!(
        state
            .handle(Action::ChannelSubscribe {
                name: "typing".into(),
                args: json!({"room":"one","extra":1}),
                identity: Identity::Persona("alice".into()),
                events: sse_queue().0
            })
            .is_err()
    );
    let (sender, _receiver) = sse_queue();
    assert!(
        state
            .handle(Action::ChannelSubscribe {
                name: "typing".into(),
                args: json!({"room":"x".repeat(1100)}),
                identity: Identity::Persona("alice".into()),
                events: sender
            })
            .is_err()
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn retained_publish_authority_is_revoked_before_fanout_and_denial_consumes_version() {
    let mut state = state("channel-rule", true);
    let (_, alice_rx, alice) = open(&mut state, "alice", "one");
    let (_, bob_rx, _) = open(&mut state, "bob", "one");
    command(
        &mut state,
        "alice",
        "one",
        &alice["lease"],
        1,
        Some(json!({"typing":true})),
    )
    .unwrap();
    remove_permission(&mut state, "alice-publish");
    assert_eq!(next(&alice_rx)["entries"], json!([]));
    assert_eq!(next(&bob_rx)["entries"], json!([]));
    assert_eq!(
        command(
            &mut state,
            "alice",
            "one",
            &alice["lease"],
            4,
            Some(json!({"typing":true}))
        )
        .unwrap_err()
        .code,
        "E_RULE_CHANNEL_PUBLISH"
    );
    assert_eq!(
        command(&mut state, "alice", "one", &alice["lease"], 3, None)
            .unwrap_err()
            .code,
        "E_CHANNEL_VERSION"
    );
    command(&mut state, "alice", "one", &alice["lease"], 5, None).unwrap();
    remove_permission(&mut state, "bob-subscribe");
    let refused = bob_rx.recv_timeout(Duration::ZERO).unwrap();
    assert!(refused.terminal);
    assert_eq!(refused.data["code"], "E_RULE_CHANNEL_SUBSCRIBE");
    assert_eq!(state.channels.len(), 1);
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn expiry_uses_monotonic_time_and_preserves_the_connection_key() {
    let mut state = state("channel-clock", false);
    let (id, rx, first) = open(&mut state, "alice", "one");
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        1,
        Some(json!({"typing":true})),
    )
    .unwrap();
    state
        .channels
        .get_mut(&id)
        .unwrap()
        .entry
        .as_mut()
        .unwrap()
        .deadline = Instant::now();
    state.clock_offset_ms = -1_000_000;
    state.sweep_channels();
    assert_eq!(next(&rx)["entries"], json!([]));
    assert_eq!(state.channels[&id].key, first["key"].as_str().unwrap());
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        2,
        Some(json!({"typing":true})),
    )
    .unwrap();
    state.handle(Action::Clock { advance_ms: 1_000 }).unwrap();
    assert_eq!(next(&rx)["entries"], json!([]));
    command(&mut state, "alice", "one", &first["lease"], 3, None).unwrap();
    drop(rx);
    state.sweep_channels();
    assert!(state.channels.is_empty());
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn capacity_counts_live_handles_and_closed_receivers_release_it() {
    let mut state = state("channel-capacity", false);
    let mut receivers = Vec::new();
    for room in 0..16 {
        for _ in 0..64 {
            receivers.push(open(&mut state, "alice", &room.to_string()).1);
        }
    }
    let (events, _receiver) = sse_queue();
    let error = state
        .handle(Action::ChannelSubscribe {
            name: "typing".into(),
            args: json!({"room":"new"}),
            identity: Identity::Persona("alice".into()),
            events,
        })
        .unwrap_err();
    assert_eq!(error.code, "E_CHANNEL_CAPACITY");
    drop(receivers.pop());
    let (_, receiver, _) = open(&mut state, "alice", "new");
    assert_eq!(state.channels.len(), 1024);
    drop(receiver);
    state.sweep_channels();
    let (events, _receiver) = sse_queue();
    assert_eq!(
        state
            .handle(Action::ChannelSubscribe {
                name: "typing".into(),
                args: json!({"room":"0"}),
                identity: Identity::Persona("alice".into()),
                events
            })
            .unwrap_err()
            .code,
        "E_CHANNEL_CAPACITY"
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn reset_and_successor_close_leases_and_terminal_frames_supersede_snapshots() {
    let mut state = state("channel-reset", false);
    let (_, rx, first) = open(&mut state, "alice", "one");
    command(
        &mut state,
        "alice",
        "one",
        &first["lease"],
        1,
        Some(json!({"typing":true})),
    )
    .unwrap();
    let compiled = state.compiled.clone();
    state
        .handle(Action::Apply {
            compiled,
            migration: None,
            seed: None,
            cache: None,
        })
        .unwrap();
    assert_eq!(next(&rx)["code"], "E_CHANNEL_RESET");
    assert_eq!(
        command(&mut state, "alice", "one", &first["lease"], 2, None)
            .unwrap_err()
            .code,
        "E_CHANNEL_LEASE"
    );
    let (_, rx, next_frame) = open(&mut state, "alice", "one");
    assert_ne!(next_frame["key"], first["key"]);
    assert_eq!(next_frame["entries"], json!([]));
    state.handle(Action::Reset).unwrap();
    assert_eq!(next(&rx)["code"], "E_CHANNEL_RESET");
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn sibling_session_cannot_write_a_lease_and_logout_removes_only_its_value() {
    let mut state = state("channel-session", false);
    let now = state.now();
    let first = state.runtime_mut().persona("alice", now).unwrap();
    let second = state.runtime_mut().persona("alice", now).unwrap();
    let (events, receiver) = sse_queue();
    state
        .handle(Action::ChannelSubscribe {
            name: "typing".into(),
            args: json!({"room":"one"}),
            identity: Identity::Bearer(first.token.clone()),
            events,
        })
        .unwrap();
    let first_frame = next(&receiver);
    let (_, peer, _) = open(&mut state, "bob", "one");
    let write = |token: &str| Action::ChannelWrite {
        name: "typing".into(),
        args: json!({"room":"one"}),
        lease: first_frame["lease"].as_str().unwrap().into(),
        version: json!(1),
        value: Some(json!({"typing":true})),
        identity: Identity::Bearer(token.into()),
    };
    assert_eq!(
        state.handle(write(&second.token)).unwrap_err().code,
        "E_CHANNEL_LEASE"
    );
    state.handle(write(&first.token)).unwrap();
    assert_eq!(next(&peer)["entries"].as_array().unwrap().len(), 1);
    state.handle(Action::Logout { token: first.token }).unwrap();
    assert_eq!(next(&receiver)["code"], "E_AUTH_SESSION");
    assert_eq!(next(&peer)["entries"], json!([]));
    assert_eq!(state.channels.len(), 1);
    assert!(
        state
            .runtime()
            .authenticate(&second.token, state.now())
            .is_ok()
    );
    std::fs::remove_dir_all(&state.root).unwrap();
}

#[test]
fn closing_receivers_during_subscription_never_strands_a_handle() {
    let mut state = state("channel-close-race", false);
    for _ in 0..100 {
        let (events, receiver) = sse_queue();
        let closing = std::thread::spawn(move || drop(receiver));
        let _ = state.handle(Action::ChannelSubscribe {
            name: "typing".into(),
            args: json!({"room":"one"}),
            identity: Identity::Persona("alice".into()),
            events,
        });
        closing.join().unwrap();
        state.sweep_channels();
        assert!(state.channels.is_empty());
    }
    std::fs::remove_dir_all(&state.root).unwrap();
}
