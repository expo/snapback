//! Operator fixture, through the same Engine::seed_at path as dev /seed.
//! Credentials and sessions are private files; neither is written to stdout.
// @ref LLP 3000.009.001.002#4-controls — unchanged fixture and engine-owned maintained columns.
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, Value, store_port::{AnyStore, LeasePolicy, StoreLease}};
use std::{fs, sync::mpsc, thread, time::{Duration, Instant}};

fn batch(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows: Vec<(String, Value)> = rows.into_iter().map(|(table, row)|
        (table.into(), snapback4_core::wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect();
    let n = rows.len();
    assert_eq!(engine.seed_at(rows, snapback4_core::now_ms()).unwrap(), n as u64);
}

fn main() {
    let start = Instant::now();
    let config: Json = serde_json::from_slice(&fs::read(std::env::args().nth(1).expect("private config path")).unwrap()).unwrap();
    let connection = config["connection"].as_str().unwrap();
    let mut lease = StoreLease::connect(connection, "bench", config["store_id"].as_str().unwrap(), "c002", LeasePolicy::default()).unwrap();
    assert!(lease.acquire().unwrap().is_some());
    let mut engine = Engine::open(AnyStore::open_postgres_owned(connection, "bench", &lease).unwrap()).unwrap();
    let (stop, stopped) = mpsc::channel();
    let renew = thread::spawn(move || {
        while stopped.recv_timeout(Duration::from_millis(700)).is_err() { assert!(lease.renew().unwrap()); }
        assert!(lease.release().unwrap());
    });
    if config["drain_only"].as_bool()==Some(true) {
        let session=snapback4_core::identity::service_session(engine.store(),"s1pg2-drain",snapback4_core::now_ms(),7).unwrap();
        fs::write(config["session_path"].as_str().unwrap(),session.token).unwrap();
        drop(engine);stop.send(()).unwrap();renew.join().unwrap();
        println!("native service drain session created");
        return;
    }
    let rows = config["rows"].as_u64().unwrap();
    let mut parents = Vec::new();
    for u in 0..256 { parents.push(("users", json!({"id":format!("u{u:04}"),"principal":format!("bench:{u}")}))); }
    for r in 0..1025 { parents.push(("rooms", json!({"id":format!("r{r:04}")}))); }
    batch(&mut engine, parents);
    let mut members = Vec::new();
    for u in 0..256 {
        for r in (0..32).map(|j| (u*4+j)%1024).chain([1024]) {
            let total = if r==1024 {0} else {(rows+1023-r)/1024};
            members.push(("memberships",json!({"id":format!("a{r:04}-{u:04}"),"room":format!("r{r:04}"),"principal":format!("bench:{u}"),"last_read":total.saturating_sub(10)})));
        }
    }
    for chunk in members.chunks(2000) { batch(&mut engine, chunk.to_vec()); }
    batch(&mut engine,(0..257).map(|i|("counters",json!({"id":format!("c{i:04}"),"owner":if i<256 {json!(format!("bench:{i}"))} else {Json::Null},"room":"r1024"}))).collect());
    let message_start = Instant::now();
    for offset in (0..rows).step_by(4000) {
        batch(&mut engine, (offset+1..=(offset+4000).min(rows)).map(|g|("messages",json!({"id":format!("m{g:010}"),"room":format!("r{:04}",(g-1)%1024),"sender":format!("u{:04}",((g-1)%1024)/4),"at":1700000000000_u64+g,"body":format!("message-{g} {}","chat ".repeat(30))}))).collect());
        println!("{}",json!({"seeded":(offset+4000).min(rows),"elapsed_s":start.elapsed().as_secs_f64()}));
    }
    let message_s = message_start.elapsed().as_secs_f64();
    let tokens: Vec<_> = (0..256).map(|u|snapback4_core::identity::open_session(engine.store(),&format!("bench:{u}"),"account",snapback4_core::now_ms()).unwrap().token).collect();
    fs::write(config["tokens_path"].as_str().unwrap(),serde_json::to_vec(&tokens).unwrap()).unwrap();
    drop(engine); stop.send(()).unwrap(); renew.join().unwrap();
    println!("{}",json!({"messages":rows,"message_seed_s":message_s,"total_seed_s":start.elapsed().as_secs_f64(),"path":"Engine::seed_at; 4000-message transactions; owned store; periodic standard lease renewal","assigned_maintained_columns":false}));
}
