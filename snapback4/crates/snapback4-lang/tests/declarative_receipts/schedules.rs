use super::*;
// Exact state equivalence with the handwritten recipe is scoped to live,
// contiguous allocation. Gap-aware normalization has a separate oracle below.
fn state(e: &mut Engine, now: i64) -> Value {
    let p = e
        .query(
            "progress",
            ctx("bob", &[("conversation", id("c")), ("c", Value::Null)], now),
        )
        .unwrap()
        .data;
    canonical(&p)
}
fn canonical(p: &Value) -> Value {
    let m = p.field("member").unwrap();
    let mut runs: Vec<_> = p
        .field("runs")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r.field("fromOrdinal").unwrap().as_int().unwrap(),
                r.field("throughOrdinal").unwrap().as_int().unwrap(),
            )
        })
        .collect();
    runs.sort();
    object([
        ("delivered", m.field("deliveredOrdinal").unwrap().clone()),
        ("seen", m.field("seenOrdinal").unwrap().clone()),
        ("floor", m.field("joinedOrdinal").unwrap().clone()),
        (
            "runs",
            Value::Array(
                runs.into_iter()
                    .map(|(a, b)| Value::Array(vec![Value::Int(a), Value::Int(b)]))
                    .collect(),
            ),
        ),
    ])
}
fn schedule<H: Host>(host: &mut H, seed_number: u64) {
    let service = |s: &str| {
        s.replace(
            "read <- exists members[.conversation, viewer]",
            "read <- exists members[.conversation, viewer] or viewer = 'service:admin'",
        )
        .replacen(
            "delete <- .principal = viewer",
            "delete <- .principal = viewer or viewer = 'service:admin'",
            1,
        )
    };
    // The manual control must explicitly grant its cleanup authority; the
    // declarative cleanup must work without any service read grant on runs.
    let manual=service(MANUAL).replace("  delete <- .principal = viewer\n  sync to members[.conversation]","  delete <- .principal = viewer or viewer = 'service:admin'\n  sync to members[.conversation]")+"\nmutation kick(conversation: conversations, principal: principal):\n  for run in runs where .conversation = conversation and .principal = principal:\n    delete runs[run]\n  delete members[conversation, principal]\n";
    let decl = service(DECLARATIVE)
        + "\nmutation kick(conversation: conversations, principal: principal):\n  delete members[conversation, principal]\n";
    let (mut m, mb) = compile(&manual);
    let (mut d, db) = compile(&decl);
    seed(&mut m);
    seed(&mut d);
    let mut md = host.open("manual", Some(mb)).unwrap();
    let mut dd = host.open("decl", Some(db)).unwrap();
    let now = 4_000_000_000_000 + seed_number as i64;
    let mut transitions = 0;
    let mut check = |m: &mut Engine, d: &mut Engine| {
        assert_eq!(
            state(m, now),
            state(d, now),
            "seed {seed_number}, transition {transitions}"
        );
        assert_eq!(receipt(m, now), receipt(d, now));
        for (e, dev) in [(&mut *m, &mut md), (&mut *d, &mut dd)] {
            for (i, p) in snapshot_pages(e, "bob", 1000).iter().enumerate() {
                dev.apply(p, i == 0).unwrap();
            }
            let answer = dev
                .query(
                    "progress",
                    "bob",
                    &json!({"conversation":"c","c":null}),
                    now,
                )
                .unwrap();
            assert!(answer.complete);
            assert_eq!(canonical(&answer.data), state(e, now));
            let answer = dev
                .query(
                    "messageReceipts",
                    "bob",
                    &json!({"conversation":"c","c":null}),
                    now,
                )
                .unwrap();
            assert!(answer.complete);
            assert_eq!(answer.data, receipt(e, now));
        }
        transitions += 1;
    };
    for n in 1..=260 {
        send(&mut m, n, now);
        send(&mut d, n, now);
        check(&mut m, &mut d);
    }
    let mut apply = |op: &str, who: &str, values: Vec<(&str, Value)>, refusal: bool| {
        for e in [&mut m, &mut d] {
            let r = mutate(e, who, op, &values, now);
            if refusal {
                assert!(format!("{r:?}").contains("RUNS_FULL"));
            } else {
                sent(r);
            }
        }
        check(&mut m, &mut d);
    };
    // Every generated schedule reaches the cap before random delivery can
    // coalesce it. Intervals have width two, with live gaps between them.
    let mut order: Vec<_> = (0..64).collect();
    let mut rng = seed_number;
    for i in (1..order.len()).rev() {
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
        order.swap(i, (rng as usize) % (i + 1));
    }
    for i in order {
        apply(
            "delivered",
            "bob",
            vec![
                ("conversation", id("c")),
                ("from", Value::Int(i * 4 + 2)),
                ("through", Value::Int(i * 4 + 3)),
            ],
            false,
        );
    }
    apply(
        "delivered",
        "bob",
        vec![
            ("conversation", id("c")),
            ("from", Value::Int(260)),
            ("through", Value::Int(260)),
        ],
        true,
    );
    // Out-of-order interval bridges free slots and advance the prefix.
    // Service removal below still has many stored runs to retire.
    for (a, b) in [(98, 107), (6, 15), (1, 97)] {
        apply(
            "delivered",
            "bob",
            vec![
                ("conversation", id("c")),
                ("from", Value::Int(a)),
                ("through", Value::Int(b)),
            ],
            false,
        );
    }
    apply(
        "seen",
        "bob",
        vec![("conversation", id("c")), ("through", Value::Int(260))],
        false,
    );
    drop(apply);
    for e in [&mut m, &mut d] {
        sent(mutate(
            e,
            "service:admin",
            "kick",
            &[("conversation", id("c")), ("principal", id("bob"))],
            now,
        ));
        assert!(e.store().rows("runs").unwrap().is_empty());
        sent(mutate(
            e,
            "alice",
            "add",
            &[("conversation", id("c")), ("principal", id("bob"))],
            now,
        ));
    }
    check(&mut m, &mut d);
    for n in 261..=264 {
        send(&mut m, n, now);
        send(&mut d, n, now);
        check(&mut m, &mut d);
    }
    for (a, b) in [(263, 264), (261, 262)] {
        for e in [&mut m, &mut d] {
            sent(mutate(
                e,
                "bob",
                "delivered",
                &[
                    ("conversation", id("c")),
                    ("from", Value::Int(a)),
                    ("through", Value::Int(b)),
                ],
                now,
            ));
        }
        check(&mut m, &mut d);
    }
    drop(check);
    host.close("manual", md);
    host.close("decl", dd);
}
#[test]
fn full_state_schedules_memory() {
    for seed in 1..=3 {
        schedule(&mut Memory::new(), seed);
    }
}
#[test]
fn full_state_schedules_sqlite() {
    for seed in 1..=3 {
        schedule(&mut Sqlite::new("rx-state"), seed);
    }
}

// Gap semantics may change representation, never coverage of a live message.
pub(super) fn assert_live_coverage(manual: &mut Engine, decl: &mut Engine, now: i64, gaps: bool) {
    let member = |e: &Engine| {
        e.store()
            .rows("members")
            .unwrap()
            .into_iter()
            .find(|m| m.field("principal").unwrap() == &id("bob"))
            .unwrap()
    };
    let m = member(manual);
    let d = member(decl);
    for field in ["seenOrdinal", "joinedOrdinal"] {
        assert_eq!(m.field(field).unwrap(), d.field(field).unwrap());
    }
    if !gaps {
        assert_eq!(state(manual, now), state(decl, now));
    }
    let covered = |e: &Engine, member: &Value, n: i64| {
        n <= member
            .field("deliveredOrdinal")
            .unwrap()
            .as_int()
            .unwrap()
            .max(member.field("joinedOrdinal").unwrap().as_int().unwrap())
            || e.store().rows("runs").unwrap().iter().any(|r| {
                r.field("principal").unwrap() == &id("bob")
                    && r.field("fromOrdinal").unwrap().as_int().unwrap() <= n
                    && r.field("throughOrdinal").unwrap().as_int().unwrap() >= n
            })
    };
    for message in manual.store().rows("messages").unwrap() {
        if message
            .field("expiresAt")
            .ok()
            .and_then(|v| v.as_int().ok())
            .is_some_and(|expiry| expiry <= now)
        {
            continue;
        }
        let n = message.field("ordinal").unwrap().as_int().unwrap();
        assert_eq!(
            covered(manual, &m, n),
            covered(decl, &d, n),
            "live position {n}"
        );
    }
    let prefix = d
        .field("deliveredOrdinal")
        .unwrap()
        .as_int()
        .unwrap()
        .max(d.field("joinedOrdinal").unwrap().as_int().unwrap());
    for r in decl
        .store()
        .rows("runs")
        .unwrap()
        .iter()
        .filter(|r| r.field("principal").unwrap() == &id("bob"))
    {
        assert!(
            r.field("throughOrdinal").unwrap().as_int().unwrap() > prefix,
            "no stranded covered run"
        );
    }
}
