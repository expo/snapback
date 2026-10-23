//! Exercise the normal store oracle over the request fact collector too.
use super::*;
use serde_json::json;
use snapback4_core::{
    Context, Engine, Value, engine::DeliveryManifest, identity, store_port::AnyStore,
};
use std::collections::BTreeMap;
fn fixture(pg: bool, seed: u64) -> (Engine, String) {
    let source = format!(
        "use identity\n{}",
        include_str!("../../../../experiments/scale-controls/snapback-app/snapback/schema.q")
    );
    let b = execute::compile(&source).unwrap();
    let store = if pg {
        AnyStore::create_postgres(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private PG16"),
            &format!("g4a_diff_{:x}", snapback4_core::ids::seed()),
        )
        .unwrap()
    } else {
        AnyStore::memory().unwrap()
    };
    let mut e = Engine::new_at(
        store,
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        1000,
    )
    .unwrap();
    let mut rows = vec![("users", json!({"id":"u","principal":"alice"}))];
    for n in 0..35 {
        let room = format!("r{n:04}");
        rows.push(("rooms", json!({"id":room})));
        rows.push(("memberships",json!({"id":format!("g{n}"),"room":room,"principal":if seed%2==0 {"alice"}else{"bob"},"last_read":(n+seed)%4})));
        for m in 0..if n == 0 {
            26
        } else {
            ((n + seed) % 4) as usize
        } {
            rows.push(("messages",json!({"id":format!("m{n:04}-{m:03}"),"room":room,"sender":"u","at":m,"body":"tab \t and Unicode 雪"})));
        }
    }
    let rows = rows
        .into_iter()
        .map(|(t, v)| {
            (
                t.into(),
                snapback4_core::wire::row_from_json(&e.schema().tables[t], &v).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    e.seed_at(rows, 1000).unwrap();
    let session = identity::open_session(e.store(), "alice", "account", 1000).unwrap();
    (e, identity::session_digest(&session.token))
}
fn read(
    e: &mut Engine,
    digest: &str,
    name: &str,
    args: BTreeMap<String, Value>,
    planned: bool,
) -> Outcome {
    let context = Context::new("alice", args)
        .at(1000)
        .with_request_credential(if planned { "account" } else { "reference" });
    let (result, _, _) = e.query_materialized_search_with_request(
        name,
        context,
        None,
        DeliveryManifest::Build,
        digest,
        |snapshot, _| {
            let authority = snapshot
                .request_authority(
                    digest,
                    identity::ServiceSample {
                        now: 1000,
                        supervisor_revision: 0,
                    },
                )
                .map_err(|e| e.refusal())?;
            if authority.capability.is_none() {
                return Err(snapback4_core::Refusal::new(
                    "E_AUTH",
                    "auth",
                    "absent session",
                ));
            }
            Ok(())
        },
    );
    Outcome {
        kind: "query".into(),
        value: match result {
            Ok(out) => execute::query_record(&out),
            Err(error) => json!({"refusal":error}),
        },
    }
}
#[test]
fn composed_request_facts_use_the_store_oracle_with_planted_differentials() {
    let oracle = Oracle::Store {
        prefetch: true,
        dimension: Some("composed-facts".into()),
        ceiling: 0,
    };
    for seed in 0..4 {
        let (mut pg, digest) = fixture(true, seed);
        let (mut sqlite, sqlite_digest) = fixture(false, seed);
        for (name, args) in [
            (
                "W1",
                [("message".into(), Value::Id("m0000-025".into()))].into(),
            ),
            ("W2", [("room".into(), Value::Id("r0000".into()))].into()),
            ("W3", BTreeMap::new()),
            (
                "W1",
                [("message".into(), Value::Id("missing".into()))].into(),
            ),
        ] {
            let a = read(&mut sqlite, &sqlite_digest, name, args.clone(), false);
            let ordinary = read(&mut pg, &digest, name, args.clone(), false);
            let b = read(&mut pg, &digest, name, args.clone(), true);
            assert!(matches!(
                compare(&oracle, &(a.clone(), vec![]), &(ordinary, vec![])),
                Verdict::Pass
            ));
            assert!(
                matches!(
                    compare(&oracle, &(a.clone(), vec![]), &(b.clone(), vec![])),
                    Verdict::Pass
                ),
                "{name} seed={seed}: {:?}",
                compare(&oracle, &(a.clone(), vec![]), &(b.clone(), vec![]))
            );
            if seed == 0 && name != "W1" {
                let scope = snapback4_core::round_trips::Scope::begin();
                read(&mut pg, &digest, name, args, true);
                assert_eq!(
                    scope.counts().postgres,
                    1,
                    "{name} really uses the composed path"
                );
            }
            for field in ["data", "metered", "next", "refusal"] {
                let mut faulty = b.clone();
                faulty.value[field] = json!({"planted":"wrong fact/charge/cursor/refusal"});
                let verdict = compare(&oracle, &(a.clone(), vec![]), &(faulty, vec![]));
                assert!(
                    matches!(verdict, Verdict::Disagree(_)),
                    "oracle missed {field}"
                );
                if let Verdict::Disagree(f) = verdict {
                    assert!(
                        f.store_trace.is_some(),
                        "a disagreement retains both real request records"
                    );
                }
            }
        }
    }
}
