//! Real S1 schema and Engine::seed_at image; no product changes.
use postgres::{Client, NoTls};
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, Value};
use std::collections::BTreeMap;
pub const BASE: i64 = 1_000_000;

pub fn connect(direct: bool) -> Client {
    let mut c = Client::connect(
        &std::env::var(if direct { "G70_DIRECT" } else { "G70_LINK" }).unwrap(),
        NoTls,
    )
    .unwrap();
    c.batch_execute("SET search_path=sb4_eval_g70,pg_catalog; SET statement_timeout='10s'; SET lock_timeout='10s'").unwrap();
    c
}
fn batch(e: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows: Vec<_> = rows
        .into_iter()
        .map(|(t, r)| {
            (
                t.into(),
                snapback4_core::wire::row_from_json(&e.schema().tables[t], &r).unwrap(),
            )
        })
        .collect();
    let n = rows.len();
    assert_eq!(e.seed_at(rows, snapback4_core::now_ms()).unwrap(), n as u64);
}
pub fn setup() {
    let bound = snapback4_lang::compile(&[(
        "schema.q".into(),
        include_str!("../../scale-controls/snapback-app/snapback/schema.q").into(),
    )]);
    assert!(bound.diagnostics.is_empty());
    let mut e = Engine::create_postgres_evaluation(
        std::env::var("G70_DIRECT").unwrap().parse().unwrap(),
        "sb4_eval_g70",
        bound.schema,
        bound.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
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
        batch(&mut e,(0..32).map(|j|(u*4+j)%1024).chain([1024]).map(|r|("memberships",json!({"id":format!("a{r:04}-{u:04}"),"room":format!("r{r:04}"),"principal":format!("bench:{u}"),"last_read":if r==1024 {0} else {((1_000_000+1023-r)/1024_u64).saturating_sub(10)}}))).collect());
    }
    batch(&mut e,(0..257).map(|i|("counters",json!({"id":format!("c{i:04}"),"owner":if i<256 {json!(format!("bench:{i}"))} else {Json::Null},"room":"r1024"}))).collect());
    // Bulk-load immutable background messages with the product's own row and
    // index encoders. W4's parents/counters/templates still use Engine paths.
    // A real first chunk supplies an independent encoding parity witness.
    let message = |g: u64| json!({"id":format!("m{g:010}"),"room":format!("r{:04}",(g-1)%1024),"sender":format!("u{:04}",((g-1)%1024)/4),"at":1700000000000_u64+g,"body":format!("message-{g} {}","chat ".repeat(30))});
    batch(
        &mut e,
        (1..=1000).map(|g| ("messages", message(g))).collect(),
    );
    let mut loader = connect(true);
    let table = &e.schema().tables["messages"];
    for g in 1..=8 {
        let value = snapback4_core::wire::row_from_json(table, &message(g)).unwrap();
        let data: String = loader
            .query_one(
                "SELECT data FROM r WHERE t='messages' AND id=$1",
                &[&format!("m{g:010}")],
            )
            .unwrap()
            .get(0);
        assert_eq!(data, snapback4_core::value::canonical_json(&value));
        for (name, index) in &table.indexes {
            for key in
                snapback4_core::rows::stored_index_keys(table, index, &value, &format!("m{g:010}"))
            {
                assert!(loader.query_one("SELECT EXISTS(SELECT 1 FROM i WHERE t='messages' AND ix=$1 AND id=$2 AND k=$3)",&[name,&format!("m{g:010}"),&key]).unwrap().get::<_,bool>(0));
            }
        }
    }
    for offset in (1000..1_000_000_u64).step_by(10000) {
        super::guard();
        let mut rows = vec![];
        let mut indexes = vec![];
        for g in offset + 1..=(offset + 10000).min(1_000_000) {
            let id = format!("m{g:010}");
            let value = snapback4_core::wire::row_from_json(table, &message(g)).unwrap();
            for (name, index) in &table.indexes {
                for key in snapback4_core::rows::stored_index_keys(table, index, &value, &id) {
                    indexes.push((name.clone(), key, id.clone()));
                }
            }
            rows.push((id, snapback4_core::value::canonical_json(&value)));
        }
        loader.batch_execute("BEGIN").unwrap();
        {
            let sink = loader
                .copy_in("COPY r(t,id,data) FROM STDIN BINARY")
                .unwrap();
            let mut writer = postgres::binary_copy::BinaryCopyInWriter::new(
                sink,
                &[
                    postgres::types::Type::TEXT,
                    postgres::types::Type::TEXT,
                    postgres::types::Type::TEXT,
                ],
            );
            for (id, data) in &rows {
                writer.write(&[&"messages", id, data]).unwrap();
            }
            writer.finish().unwrap();
        }
        {
            let sink = loader
                .copy_in("COPY i(t,ix,k,id) FROM STDIN BINARY")
                .unwrap();
            let mut writer = postgres::binary_copy::BinaryCopyInWriter::new(
                sink,
                &[
                    postgres::types::Type::TEXT,
                    postgres::types::Type::TEXT,
                    postgres::types::Type::BYTEA,
                    postgres::types::Type::TEXT,
                ],
            );
            for (name, key, id) in &indexes {
                writer.write(&[&"messages", name, key, id]).unwrap();
            }
            writer.finish().unwrap();
        }
        loader.batch_execute("COMMIT").unwrap();
        if offset % 100000 == 1000 {
            eprintln!("background messages {}", (offset + 10000).min(1_000_000));
        }
    }
    loader.batch_execute("UPDATE r SET data=jsonb_set(data::jsonb,'{Row,total,Int}',to_jsonb(CASE WHEN id='r1024' THEN 0 ELSE (1000000+1023-substring(id,2)::bigint)/1024 END))::text WHERE t='rooms'; UPDATE r SET data=jsonb_set(data::jsonb,'{Row,sent,Int}',to_jsonb((SELECT sum((1000000+1023-room)/1024) FROM generate_series(substring(r.id,2)::int*4,substring(r.id,2)::int*4+3) room)))::text WHERE t='users';").unwrap();
    // Capture a real unkeyed W4 outcome for each principal, including canonical
    // touched/footprint/log bytes. All measured payloads derive from these rows.
    let mut c = connect(true);
    c.batch_execute("CREATE TABLE _g70_template(slot int PRIMARY KEY, commit jsonb NOT NULL, logs jsonb NOT NULL); CREATE TABLE _durable(slot int PRIMARY KEY,n bigint NOT NULL); INSERT INTO _durable SELECT g,0 FROM generate_series(0,3) g;").unwrap();
    for u in 0..32 {
        e.mutate(
            "increment",
            None,
            snapback4_core::Context::new(
                &format!("bench:{u}"),
                BTreeMap::from([("counter".into(), Value::Id(format!("c{u:04}")))]),
            ),
        )
        .unwrap();
        c.execute("INSERT INTO _g70_template SELECT $1, to_jsonb(c)||jsonb_build_object('footprint',e.footprint),coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM _log l WHERE l.seq=c.seq),'[]') FROM _commits c JOIN _change_evidence e USING(seq) WHERE c.seq=(SELECT seq FROM _head WHERE singleton)",&[&u]).unwrap();
    }
    c.batch_execute("CREATE TABLE IF NOT EXISTS _owner(singleton boolean PRIMARY KEY, store_id text COLLATE \"C\" NOT NULL,holder text COLLATE \"C\" NOT NULL,token bigint NOT NULL,lease_until timestamptz NOT NULL); INSERT INTO _owner VALUES(true,'00000000000000000000000000000000','g700',1,'infinity') ON CONFLICT(singleton) DO UPDATE SET token=1;").unwrap();
    // Synthetic session digests are confined to this private harness; no tokens.
    for u in 0..32 {
        c.execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES($1,$2,'account',0,9000000000000000,$1)",&[&format!("g70-{u}"),&format!("bench:{u}")]).unwrap();
    }
    c.batch_execute("VACUUM ANALYZE").unwrap();
    println!(
        "{}",
        json!({"messages":1_000_000,"counters":257,"templates":32,"schema":"real S1; Engine::seed_at parents/counters/first 1000 messages; product row/index codecs + binary COPY immutable background; real Engine::mutate templates"})
    );
}
pub fn reset() {
    let mut c = connect(true);
    c.batch_execute(&format!("TRUNCATE _log,_ops,_outbox CASCADE; DELETE FROM _change_evidence; DELETE FROM _commits WHERE seq>{BASE}; UPDATE _head SET seq={BASE},revision={BASE}; INSERT INTO _change_evidence SELECT g,(SELECT commit->>'footprint' FROM _g70_template ORDER BY slot LIMIT 1) FROM generate_series({BASE}-999,{BASE}) g; UPDATE _durable SET n=0; UPDATE r SET data=jsonb_set(data::jsonb,'{{Row,n,Int}}','0')::text WHERE t='counters'; SELECT pg_stat_force_next_flush();")).unwrap();
    c.batch_execute("VACUUM (ANALYZE) _commits").unwrap();
    c.batch_execute("CHECKPOINT; SELECT pg_stat_force_next_flush()")
        .unwrap();
}

/// Keep the commit index at S1's historical density instead of timing an empty
/// index. Historical entries use an actual Engine seed-commit template. W4's
/// evidence horizon is 1,000 rows; mutable benchmark rows live above BASE.
pub fn history() {
    let mut c = connect(true);
    c.batch_execute(&format!("INSERT INTO _commits SELECT g,c.at,c.program,c.principal,c.kind,c.touched,c.writes FROM generate_series((SELECT max(seq)+1 FROM _commits),{BASE}) g CROSS JOIN (SELECT * FROM _commits ORDER BY seq LIMIT 1) c;")).unwrap();
    c.batch_execute("VACUUM ANALYZE _commits").unwrap();
    reset();
    assert_eq!(
        c.query_one("SELECT count(*) FROM _commits", &[])
            .unwrap()
            .get::<_, i64>(0),
        BASE
    );
}
