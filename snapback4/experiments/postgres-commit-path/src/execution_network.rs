//! S1b SQL-only execution models. The fixture's read addresses are input-known.
//! Two scan-size preflights gate the two data fetches; duplicate reads stay.
use crate::{Args, common::*, create_engine, model::*, slot};
use serde_json::{Value as Json, json};
use snapback4_core::{Value, key};
use std::sync::Arc;
use tokio_postgres::{Client, NoTls, Row, SimpleQueryMessage, Statement};

const BEGIN: &str = "START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";

// Each tag is one original logical read. UNION ALL and an ordinal input list
// preserve both duplicate receipts and both duplicate size/data reads.
const BATCH_FIRST: &str = "SELECT 0::bigint tag, jsonb_build_array(generation,(SELECT seq FROM _head WHERE singleton))::text payload FROM _backend WHERE singleton
 UNION ALL SELECT 1, jsonb_build_array(outcome,name,args_digest)::text FROM _ops WHERE principal=$1 AND id=$2
 UNION ALL SELECT 2, jsonb_build_array(generation)::text FROM _backend WHERE singleton
 UNION ALL SELECT 3, jsonb_build_array(outcome,name,args_digest)::text FROM _ops WHERE principal=$1 AND id=$2
 UNION ALL SELECT p.n+3, jsonb_build_array(s.d,s.k)::text
 FROM unnest($3::bytea[],$4::bytea[]) WITH ORDINALITY p(lo,hi,n)
 CROSS JOIN LATERAL (SELECT octet_length(r.data)::bigint d,octet_length(i.k)::bigint k
 FROM i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='counters' AND i.ix='byId'
 AND i.k>=p.lo AND i.k<p.hi ORDER BY i.k ASC LIMIT 1) s";
const BATCH_DATA: &str =
    "SELECT p.n+5 tag,jsonb_build_array(s.data,encode(s.k,'hex'))::text payload
 FROM unnest($1::bytea[],$2::bytea[]) WITH ORDINALITY p(lo,hi,n)
 CROSS JOIN LATERAL (SELECT r.data,i.k FROM i JOIN r ON r.t=i.t AND r.id=i.id
 WHERE i.t='counters' AND i.ix='byId' AND i.k>=p.lo AND i.k<p.hi ORDER BY i.k ASC LIMIT 1) s";

type Transcript = Vec<Vec<Json>>;

struct AsyncConn {
    rt: tokio::runtime::Runtime,
    client: Client,
    st: Vec<Statement>,
    lo: Vec<u8>,
    hi: Vec<u8>,
    expected: Transcript,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sql_literal(text: &str) -> String {
    format!("E'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn add_simple(out: &mut Transcript, messages: Vec<SimpleQueryMessage>) {
    for message in messages {
        if let SimpleQueryMessage::Row(row) = message {
            let tag: usize = row.get(0).unwrap().parse().unwrap();
            out[tag].push(serde_json::from_str(row.get(1).unwrap()).unwrap());
        }
    }
}

fn add_batch(out: &mut Transcript, rows: Vec<Row>) {
    for row in rows {
        let tag: i64 = row.get(0);
        let payload: String = row.get(1);
        out[tag as usize].push(serde_json::from_str(&payload).unwrap());
    }
}

impl AsyncConn {
    fn new(net: &Net, schema: &str, writer: usize) -> Self {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (client, st) = rt.block_on(async {
            let (client, connection) = tokio_postgres::connect(&net.url(), NoTls).await.expect("async connection");
            tokio::spawn(async move { connection.await.expect("async connection driver"); });
            client.batch_execute(&format!("SET search_path=\"{schema}\",pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s';")).await.unwrap();
            let mut st = Vec::new();
            for q in [Q_GEN_HEAD, Q_OPS, Q_GEN, Q_SIZES, Q_DATA, BATCH_FIRST, BATCH_DATA] {
                st.push(client.prepare(q).await.unwrap());
            }
            client.batch_execute(&format!("PREPARE s1b_first(text,text,bytea[],bytea[]) AS {BATCH_FIRST}; PREPARE s1b_data(bytea[],bytea[]) AS {BATCH_DATA};")).await.unwrap();
            (client, st)
        });
        let lo = key::encode(&[Value::Id(slot(true, writer))]);
        let hi = key::upper_bound(&lo);
        let mut conn = Self {
            rt,
            client,
            st,
            lo,
            hi,
            expected: vec![],
        };
        // Every optimized operation's complete read transcript is compared to
        // a serial transaction on this connection, outside the timed window.
        conn.expected = conn.execute("serial", "reference").unwrap();
        conn.check_snapshot_flights();
        conn
    }

    fn check_snapshot_flights(&self) {
        self.rt.block_on(async {
            let st = self.client.prepare("SELECT current_setting('transaction_isolation'), current_setting('transaction_read_only'), pg_current_snapshot()::text").await.unwrap();
            let (_, first) = tokio::try_join!(biased; self.client.batch_execute(BEGIN), self.client.query_one(&st, &[])).unwrap();
            let (last, _) = tokio::try_join!(biased; self.client.query_one(&st, &[]), self.client.batch_execute("ROLLBACK")).unwrap();
            assert_eq!(first.get::<_, &str>(0), "repeatable read");
            assert_eq!(first.get::<_, &str>(1), "on");
            for i in 0..3 { assert_eq!(first.get::<_, &str>(i), last.get::<_, &str>(i)); }
            let after = self.client.query_one(&st, &[]).await.unwrap();
            assert_eq!(after.get::<_, &str>(1), "off", "ROLLBACK must complete");
            let select = "SELECT current_setting('transaction_isolation'), current_setting('transaction_read_only'), pg_current_snapshot()::text";
            let mut witnesses = Vec::new();
            for text in [format!("{BEGIN}; {select}"), format!("{select}; ROLLBACK")] {
                for message in self.client.simple_query(&text).await.unwrap() {
                    if let SimpleQueryMessage::Row(row) = message {
                        witnesses.push((0..3).map(|i| row.get(i).unwrap().to_owned()).collect::<Vec<_>>());
                    }
                }
            }
            assert_eq!(witnesses.len(), 2);
            assert_eq!(witnesses[0][0], "repeatable read");
            assert_eq!(witnesses[0][1], "on");
            assert_eq!(witnesses[0], witnesses[1]);
            let after = self.client.query_one(&st, &[]).await.unwrap();
            assert_eq!(after.get::<_, &str>(1), "off", "simple ROLLBACK must complete");
        });
    }

    fn execute(&self, variant: &str, op: &str) -> Result<Transcript, String> {
        self.rt.block_on(async {
            let c = &self.client;
            let s = &self.st;
            let scans: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[&"counters", &"byId", &self.lo, &self.hi, &1i64];
            let receipts: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[&"alice", &op];
            let los = vec![self.lo.clone(), self.lo.clone()];
            let his = vec![self.hi.clone(), self.hi.clone()];
            let batch_args: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[&"alice", &op, &los, &his];
            let mut out = vec![vec![]; 8];
            if variant == "k3" {
                let lows = format!("ARRAY[decode('{}','hex'),decode('{}','hex')]",hex(&self.lo),hex(&self.lo));
                let highs = format!("ARRAY[decode('{}','hex'),decode('{}','hex')]",hex(&self.hi),hex(&self.hi));
                // One SimpleQuery message per flight prevents an intermediate
                // ReadyForQuery/Sync boundary between BEGIN and the first read.
                add_simple(&mut out,c.simple_query(&format!("{BEGIN}; EXECUTE s1b_first('alice',{},{lows},{highs})",sql_literal(op))).await?);
                if out[4].len()!=1 || out[5].len()!=1 {
                    return Err(std::io::Error::other("execution counter missing at size gate").into());
                }
                add_simple(&mut out,c.simple_query(&format!("EXECUTE s1b_data({lows},{highs}); ROLLBACK")).await?);
                return Ok(out);
            }
            if variant != "k3p" { c.batch_execute(BEGIN).await?; }
            if variant == "k2" || variant == "k3p" {
                let rows = if variant == "k3p" {
                    // Prepared queries send on first poll. Biased polling fixes
                    // wire order: BEGIN precedes the snapshot-taking SELECT.
                    let (_, rows) = tokio::try_join!(biased; c.batch_execute(BEGIN), c.query(&s[5], batch_args))?;
                    rows
                } else { c.query(&s[5], batch_args).await? };
                add_batch(&mut out, rows);
            } else {
                let (a,b,d,e,f,g) = if variant == "serial" {
                    (c.query(&s[0], &[]).await?, c.query(&s[1], receipts).await?,
                     c.query(&s[2], &[]).await?, c.query(&s[1], receipts).await?,
                     c.query(&s[3], scans).await?, c.query(&s[3], scans).await?)
                } else {
                    tokio::try_join!(c.query(&s[0], &[]), c.query(&s[1], receipts),
                        c.query(&s[2], &[]), c.query(&s[1], receipts),
                        c.query(&s[3], scans), c.query(&s[3], scans))?
                };
                for row in a { out[0].push(json!([row.get::<_, i64>(0),row.get::<_, i64>(1)])); }
                for (tag, rows) in [(1,b),(3,e)] {
                    for row in rows { out[tag].push(json!([row.get::<_, String>(0),row.get::<_, String>(1),row.get::<_, String>(2)])); }
                }
                for row in d { out[2].push(json!([row.get::<_, i64>(0)])); }
                for (tag, rows) in [(4,f),(5,g)] {
                    for row in rows { out[tag].push(json!([row.get::<_, i64>(0),row.get::<_, i64>(1)])); }
                }
            }
            // The same size gate applies before either physical row-image read.
            // This fixture always has one small row; no refusal path is modeled.
            if out[4].len()!=1 || out[5].len()!=1 { return Err(std::io::Error::other("execution counter missing at size gate").into()); }
            if variant == "k2" || variant == "k3p" {
                let args: &[&(dyn tokio_postgres::types::ToSql + Sync)] = &[&los,&his];
                let rows = if variant == "k3p" {
                    // Read is queued BEFORE rollback, in the same flight. The
                    // read's results are consumed before accepting completion.
                    let (rows, _) = tokio::try_join!(biased; c.query(&s[6], args), c.batch_execute("ROLLBACK"))?;
                    rows
                } else { c.query(&s[6], args).await? };
                add_batch(&mut out, rows);
            } else {
                let (a,b) = if variant == "serial" {
                    (c.query(&s[4], scans).await?, c.query(&s[4], scans).await?)
                } else { tokio::try_join!(c.query(&s[4], scans), c.query(&s[4], scans))? };
                for (tag, rows) in [(6,a),(7,b)] {
                    for row in rows { out[tag].push(json!([row.get::<_, String>(0),hex(&row.get::<_, Vec<u8>>(1))])); }
                }
            }
            if variant != "k3p" { c.batch_execute("ROLLBACK").await?; }
            Ok::<_, Box<dyn std::error::Error>>(out)
        }).map_err(|e| format!("{e:?}"))
    }
}

// @ref LLP 3000.009.001.000.000#42-execution — all reads share one read-only snapshot
pub fn run(args: &Args) -> Json {
    let variant = args.req("--variant").to_owned();
    assert!(["k1", "k2", "k3", "k3p"].contains(&variant.as_str()));
    let connections = args.num("--connections", 32);
    assert!((1..=256).contains(&connections));
    let net = Arc::new(Net::parse(args.req("--net")));
    let (schema, engine) = create_engine("cps1b");
    drop(engine);
    let mut runs = Vec::new();
    for run in 0..args.runs() {
        let (net, schema, v) = (net.clone(), schema.clone(), variant.clone());
        let result = closed_loop(
            connections,
            &Timing::from_env(),
            Some(true),
            move |w| AsyncConn::new(&net, &schema, w),
            move |conn, w, i| {
                let got = conn.execute(&v, &format!("s1b-{run}-{w}-{i}"))?;
                if got != conn.expected {
                    return Err(format!("read transcript mismatch: {got:?}"));
                }
                Ok(if v == "k1" { 10 } else { 4 })
            },
        );
        runs.push(result);
    }
    let unchanged: bool = admin().query_one(&format!("SELECT bool_and((data::jsonb #>> '{{Row,value,Int}}')::bigint=0) FROM {schema}.r WHERE t='counters'"),&[]).unwrap().get(0);
    assert!(unchanged);
    json!({"cell":"pg-execution-network","label":"MODEL: same eight reads, SQL transcript equivalence checked on every operation; no interpreter/overlay/validation",
        "variant":variant,"connections":connections,"net":net.describe(),"k_exec":if variant=="k3" || variant=="k3p" {2} else {4},
        "reads_per_execution":8,"counters_unchanged":unchanged,"read_transcript_check":true,"snapshot_flights_check":true,
        "summary":aggregate(&runs),"runs":runs})
}
