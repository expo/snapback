//! Real TCP HTTP requests through serve's dispatcher, authority and engine.
// @ref LLP 3000.009.001.000.001#5 — warm per-class tables can only fall deliberately.
use super::*;
use snapback4_core::{
    identity,
    round_trips::{Counts, Scope},
};
use std::collections::BTreeMap;

pub(crate) struct RequestScope {
    scope: Scope,
    output: mpsc::Sender<Counts>,
}
impl Drop for RequestScope {
    fn drop(&mut self) {
        let _ = self.output.send(self.scope.counts());
    }
}
pub(crate) fn request_scope(shared: &Shared) -> Option<RequestScope> {
    lock(&shared.round_trips)
        .clone()
        .map(|output| RequestScope {
            scope: Scope::begin(),
            output,
        })
}

#[test]
fn round_trips_sqlite() {
    run(false);
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "requires private Postgres; scripts/test-postgres.sh"]
fn round_trips_postgres() {
    run(true);
}

fn run(pg: bool) {
    let directory = ReaderTestDirectory::new();
    let store = if pg {
        #[cfg(feature = "postgres")]
        {
            snapback4_core::store_port::AnyStore::create_postgres(
                &std::env::var("SNAPBACK4_EVAL_POSTGRES")
                    .expect("private scripts/test-postgres.sh cluster"),
                &format!("sb4_rt0_{:x}", snapback4_core::ids::seed()),
            )
            .unwrap()
        }
        #[cfg(not(feature = "postgres"))]
        {
            unreachable!()
        }
    } else {
        snapback4_core::store_port::AnyStore::open(&directory.0.join("store.sqlite")).unwrap()
    };
    // P1-MC isn't in this branch: retain RT-A's admitted S1 W1/W2 exactly.
    let source = include_str!("../../../../reports/20261022-rt-a-round-trips/admitted-s1.q");
    let host = Host::with_store(false, store, source);
    let now = host.shared.now();
    let (session, action, store_id) = {
        let mut engine = lock(&host.shared.engine);
        let session = identity::open_session(engine.store(), "guest:rt0", "guest", now).unwrap();
        let action =
            snapback4_core::round_trips::action_claim(engine.store_mut(), &session, now).unwrap();
        let store_id = engine.store().store_identity().unwrap().unwrap();
        (session, action, store_id)
    };
    let (tx, rx) = mpsc::channel();
    *lock(&host.shared.round_trips) = Some(tx);
    let request = |path: &str, token: Option<&str>, payload: Json| {
        let headers = token
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        let response = host.request("POST", path, &headers, &payload.to_string());
        let count = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("request count after all request cleanup");
        (status(&response), body(&response), count)
    };
    let token = Some(session.token.as_str());
    let setup = request("/m/setup", token, json!({"args":{}}));
    assert_eq!(setup.1["state"], "sent", "{}", setup.1);
    for n in 0..25 {
        let seeded = request(
            "/m/seedMessage",
            token,
            json!({"args":{"key":format!("m{n}"),"at":n}}),
        );
        assert_eq!(seeded.1["state"], "sent", "{}", seeded.1);
    }
    let mut measured = BTreeMap::new();
    let mut cold = BTreeMap::new();
    let classes = [
        ("w1_point", "/q/W1", json!({"message":"m24"})),
        ("w2_newest20", "/q/W2", json!({"room":"r0001"})),
        (
            "unkeyed_increment",
            "/m/increment",
            json!({"counter":"c0000"}),
        ),
        (
            "one_membership",
            "/m/checked",
            json!({"counter":"c0000","room":"r0001"}),
        ),
    ];
    for (class, path, args) in classes {
        for repetition in 0..4 {
            let (status, reply, counts) = request(path, token, json!({"args":args}));
            assert_eq!(status, 200, "{class}: {reply}");
            if class == "w1_point" {
                assert_eq!(reply["data"]["id"], "m24", "{reply}");
            } else if class == "w2_newest20" {
                assert_eq!(reply["data"].as_array().unwrap().len(), 20, "{reply}");
                assert_eq!(reply["data"][0]["id"], "m24");
                assert_eq!(reply["data"][19]["id"], "m5");
            } else {
                assert_eq!(reply["state"], "sent", "{reply}");
            }
            record(&mut measured, &mut cold, class, repetition, counts, pg);
        }
    }
    // Each first attempt has a fresh SDK-shaped id and store binding. Its replay
    // is measured independently; the counter value must not change on replay.
    for repetition in 0..4 {
        let payload = json!({"id":format!("rt0-{repetition}"),"store_id":store_id,"args":{"counter":"c0000"}});
        let (_, sent, counts) = request("/m/increment", token, payload.clone());
        assert_eq!(sent["state"], "sent", "{sent}");
        assert_ne!(sent["replayed"], true);
        record(
            &mut measured,
            &mut cold,
            "keyed_first",
            repetition,
            counts,
            pg,
        );
        let (_, replay, counts) = request("/m/increment", token, payload);
        assert_eq!(replay["replayed"], true, "{replay}");
        assert_eq!(replay["seq"], sent["seq"]);
        record(
            &mut measured,
            &mut cold,
            "replay_hit",
            repetition,
            counts,
            pg,
        );
    }
    for repetition in 0..4 {
        for (class, path, credential, payload, expected_status, code) in [
            (
                "action_session_w1",
                "/q/W1",
                Some(action.token.as_str()),
                json!({"args":{"message":"m24"}}),
                200,
                "",
            ),
            (
                "unauthenticated",
                "/q/W1",
                None,
                json!({"args":{"message":"m24"}}),
                401,
                "E_AUTH",
            ),
            (
                "unknown_token",
                "/q/W1",
                Some("rt0-unknown-token"),
                json!({"args":{"message":"m24"}}),
                401,
                "E_AUTH",
            ),
            (
                "unknown_operation",
                "/m/noSuchOperation",
                token,
                json!({"args":{}}),
                404,
                "E_OP",
            ),
            (
                "narrowed_argument",
                "/m/increment",
                token,
                json!({"args":{"counter":42}}),
                200,
                "E_INPUT",
            ),
        ] {
            let (status, reply, counts) = request(path, credential, payload);
            assert_eq!(status, expected_status, "{class}: {reply}");
            if code.is_empty() {
                assert_eq!(reply["data"]["id"], "m24", "{reply}");
            } else {
                assert!(reply.to_string().contains(code), "{class}: {reply}");
            }
            if matches!(class, "unknown_operation" | "narrowed_argument") {
                assert_eq!(reply["store_id"], store_id, "metadata refusal: {reply}");
            }
            record(&mut measured, &mut cold, class, repetition, counts, pg);
        }
    }
    // Exhaust the actual production identity limiter, then measure repeated 429s.
    let limited = (0..31).any(|_| request("/auth/guest", None, json!({})).0 == 429);
    assert!(
        limited,
        "production identity limiter must refuse within 31 attempts"
    );
    for repetition in 0..4 {
        let (status, reply, counts) = request("/auth/guest", None, json!({}));
        assert_eq!(status, 429);
        assert_eq!(reply["denied"]["code"], "E_RATE_LIMIT");
        record(
            &mut measured,
            &mut cold,
            "rate_limited",
            repetition,
            counts,
            pg,
        );
    }
    let store_name = if pg { "postgres" } else { "sqlite" };
    println!(
        "RT0 {store_name} warm: {}",
        serde_json::to_string(&measured).unwrap()
    );
    println!(
        "RT0 {store_name} cold/first-use: {}",
        serde_json::to_string(&cold).unwrap()
    );
    let expected: BTreeMap<String, u64> = serde_json::from_str(if pg {
        include_str!("postgres.json")
    } else {
        include_str!("sqlite.json")
    })
    .unwrap();
    assert_eq!(
        measured.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "every class must have one table row"
    );
    for (class, measured) in measured {
        let table = expected[&class];
        assert!(
            measured <= table,
            "{store_name} {class}: table {table}, measured {measured}: dependent work regressed"
        );
        assert!(
            measured >= table,
            "{store_name} {class}: table {table}, measured {measured}: lower the table"
        );
    }
}
fn record(
    warm: &mut BTreeMap<String, u64>,
    cold: &mut BTreeMap<String, u64>,
    class: &str,
    repetition: usize,
    counts: Counts,
    pg: bool,
) {
    let n = if pg {
        assert_eq!(counts.sqlite, 0);
        counts.postgres
    } else {
        assert_eq!(counts.postgres, 0);
        counts.sqlite
    };
    if repetition == 0 {
        cold.insert(class.into(), n);
    } else if let Some(previous) = warm.insert(class.into(), n) {
        assert_eq!(previous, n, "{class}: warm repetitions disagree");
    }
}
