//! M1: S1-shaped read cost controls, never linked into the product.
// @ref LLP 3000.009.001.002#9-phases — isolated measurements supply no engine capacity claim.
use postgres::{Client, NoTls};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, engine::DeliveryManifest, identity};
use std::{collections::BTreeMap, fs, time::Instant};

#[path = "../m1_measure.rs"]
mod measure;

fn connection() -> String {
    std::env::var("PG_UNIX_URL").unwrap()
}
fn client() -> Client {
    Client::connect(&connection(), NoTls).unwrap()
}
fn guard() {
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    assert_eq!(
        unsafe { libc::statvfs(c"/home".as_ptr(), stat.as_mut_ptr()) },
        0
    );
    let stat = unsafe { stat.assume_init() };
    assert!(
        stat.f_bavail as u128 * stat.f_frsize as u128 >= 25 * 1024u128.pow(3),
        "M1 disk stop"
    );
}
fn batch(e: &mut Engine, rows: Vec<(&str, Json)>) {
    guard();
    let rows: Vec<_> = rows
        .into_iter()
        .map(|(t, r)| {
            (
                t.to_string(),
                snapback4_core::wire::row_from_json(&e.schema().tables[t], &r).unwrap(),
            )
        })
        .collect();
    let n = rows.len();
    assert_eq!(e.seed_at(rows, snapback4_core::now_ms()).unwrap(), n as u64);
}
fn setup(out: &str) {
    guard();
    let start = Instant::now();
    let bound = snapback4_lang::compile(&[(
        "schema.q".into(),
        include_str!("../../../scale-controls/snapback-app/snapback/schema.q").into(),
    )]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::create_postgres_evaluation(
        connection().parse().unwrap(),
        "sb4_eval_m1",
        bound.schema,
        bound.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    let mut c = client();
    c.batch_execute("SET search_path=sb4_eval_m1,pg_catalog")
        .unwrap();
    // Freeze plan-state arms without disabling cluster-wide autovacuum.
    let tables = c
        .query(
            "SELECT tablename FROM pg_tables WHERE schemaname='sb4_eval_m1'",
            &[],
        )
        .unwrap();
    for row in tables {
        let name: String = row.get(0);
        c.batch_execute(&format!(
            "ALTER TABLE \"{}\" SET (autovacuum_enabled=false)",
            name.replace('"', "\"\"")
        ))
        .unwrap();
    }
    let rows = 131072_u64;
    let mut parents = vec![];
    for u in 0..256 {
        parents.push((
            "users",
            json!({"id":format!("u{u:04}"),"principal":format!("bench:{u}")}),
        ));
    }
    for r in 0..1025 {
        parents.push(("rooms", json!({"id":format!("r{r:04}")})));
    }
    batch(&mut e, parents);
    for u in 0..256 {
        batch(&mut e,(0..32).map(|j|(u*4+j)%1024).chain([1024]).map(|r| ("memberships",json!({"id":format!("a{r:04}-{u:04}"),"room":format!("r{r:04}"),"principal":format!("bench:{u}"),"last_read":if r==1024 {0} else {118}}))).collect());
    }
    batch(&mut e,(0..257).map(|i|("counters",json!({"id":format!("c{i:04}"),"owner":if i<256 {json!(format!("bench:{i}"))} else {Json::Null},"room":"r1024"}))).collect());
    for offset in (0..rows).step_by(4000) {
        batch(&mut e,(offset+1..=(offset+4000).min(rows)).map(|g| ("messages",json!({"id":format!("m{g:010}"),"room":format!("r{:04}",(g-1)%1024),"sender":format!("u{:04}",((g-1)%1024)/4),"at":1700000000000_u64+g,"body":format!("message-{g} {}","chat ".repeat(30))}))).collect());
        eprintln!(
            "seeded {} elapsed {:.1}s",
            (offset + 4000).min(rows),
            start.elapsed().as_secs_f64()
        );
    }
    let mut tokens = vec![];
    for u in 0..256 {
        tokens.push(
            identity::open_session(
                e.store(),
                &format!("bench:{u}"),
                "account",
                snapback4_core::now_ms(),
            )
            .unwrap()
            .token,
        );
    }
    fs::write(
        format!("{out}/tokens.json"),
        serde_json::to_vec(&tokens).unwrap(),
    )
    .unwrap();
    fs::write(
        format!("{out}/schema.json"),
        serde_json::to_vec_pretty(e.schema()).unwrap(),
    )
    .unwrap();
    println!(
        "{}",
        json!({"messages":rows,"users":256,"rooms":1025,"memberships":8448,"read_memberships_per_user":32,"write_room_membership_per_user":1,"seed_path":"Engine::seed_at, source postgres-seed shape","elapsed_s":start.elapsed().as_secs_f64()})
    );
}
fn trace(out: &str) {
    let mut e =
        Engine::open_postgres_evaluation(connection().parse().unwrap(), "sb4_eval_m1").unwrap();
    let tokens: Vec<String> =
        serde_json::from_slice(&fs::read(format!("{out}/tokens.json")).unwrap()).unwrap();
    let token = &tokens[0];
    let digest = identity::session_digest(token);
    let mut c = client();
    c.batch_execute("SET search_path=sb4_eval_m1,pg_catalog")
        .unwrap();
    let store_id: String = c
        .query_one("SELECT value FROM _meta WHERE key='store_id'", &[])
        .unwrap()
        .get(0);
    for _ in 0..2 {
        for shape in ["W1", "W2", "W3"] {
            perform(&mut e, shape, &digest, &store_id);
        }
    }
    // Separate connection records delimiters; captured statements retain their
    // own backend PID, so connection-opening chatter is excluded.
    c.batch_execute("SELECT 'M1_TRACE_BEGIN'").unwrap();
    for shape in ["W1", "W2", "W3"] {
        c.batch_execute(&format!("SELECT 'M1_{shape}_BEGIN'"))
            .unwrap();
        let result = perform(&mut e, shape, &digest, &store_id);
        fs::write(
            format!("{out}/{shape}-oracle.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
        c.batch_execute(&format!("SELECT 'M1_{shape}_END'"))
            .unwrap();
    }
    c.batch_execute("SELECT 'M1_TRACE_END'").unwrap();
}
fn perform(e: &mut Engine, shape: &str, digest: &str, store_id: &str) -> Json {
    let now = snapback4_core::now_ms();
    let cap = identity::resolve_ingress_supervised(
        e.store(),
        digest,
        identity::ServiceSample {
            now,
            supervisor_revision: 0,
        },
        Some(store_id),
    )
    .unwrap()
    .unwrap();
    e.advance_time_audiences_at(now).unwrap();
    let args: BTreeMap<String, Value> = match shape {
        "W1" => [("message".into(), Value::Id("m0000130049".into()))].into(),
        "W2" => [("room".into(), Value::Id("r0000".into()))].into(),
        _ => BTreeMap::new(),
    };
    let (outcome, _, _) = e.query_materialized_search_with_request(
        shape,
        Context::new(&cap.0, args).at(now),
        None,
        DeliveryManifest::Skip,
        digest,
        |snapshot, _| {
            let facts = snapshot
                .request_authority(
                    digest,
                    identity::ServiceSample {
                        now,
                        supervisor_revision: 0,
                    },
                )
                .map_err(|e| e.refusal())?;
            assert_eq!(facts.capability.as_ref().unwrap(), &cap);
            Ok(())
        },
    );
    let result = outcome.unwrap();
    assert!(result.complete);
    serde_json::to_value(result.data).unwrap()
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    match args[1].as_str() {
        "measure" => measure::run(&args[2], &args[3]),
        "setup" => setup(&args[2]),
        "trace" => trace(&args[2]),
        _ => panic!("setup|trace private-output"),
    }
}
