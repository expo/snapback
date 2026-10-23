//! Cell 2: a statement-level MODEL of the engine's increment protocol,
//! replayed against the engine's own tables (a namespace created and seeded
//! by the real Engine). The statement texts, parameter types and
//! order are the ones captured from the engine with log_statement=all
//! (see README "Captured statement sequence"). Every statement is one
//! synchronous round trip, as in the engine's driver.
//!
//! Protocols:
//! - R: the reference. Per mutation, the read-only replay pre-check
//!   transaction (4 calls, outside the head lock), then the locked
//!   transaction (14 calls: START, head FOR UPDATE, ..., COMMIT).
//! - 0: the serial batch. Writers run the same pre-check on their own
//!   connections, then enqueue. One committer drains up to N and runs them in
//!   ONE transaction: START, head FOR UPDATE, generation once; per member the
//!   receipt check, SAVEPOINT, the four reads, UPDATE r, RELEASE, then either
//!   the member's own tail CTE (no head update) and _ops INSERT
//!   (`--tail per-member`, today's adapter calls) or nothing until one
//!   coalesced tail for the batch (`--tail coalesced`); one head update to the
//!   batch's last sequence; COMMIT.
//! - A: the commit stage of the optimistic committer, an UPPER BOUND. It
//!   assumes execution and validation happened elsewhere and the write sets
//!   are known (the committer folds increments into an in-memory head). Per
//!   batch: START, one CTE applying every member's row writes plus the head
//!   update, _commits, _log and _ops rows as unnest arrays, COMMIT
//!   (`--txn explicit`), or the CTE alone as an implicit transaction
//!   (`--txn implicit`). It omits execution, snapshot reads, read-set
//!   validation and conflict reruns by construction.
use crate::{Args, common::*, create_engine, slot};
use postgres::{Client, Statement};
use serde_json::{Value as Json, json};
use snapback4_core::{Value, key};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Condvar, Mutex, mpsc},
    thread,
};

const ARGS_DIGEST: &str = "9acc01a1b8d6d1476070406c156e19349f53cf23b10a42535ccb17cd923f8a22";

pub(crate) const Q_GEN_HEAD: &str = "SELECT generation, (SELECT seq FROM _head WHERE singleton) FROM _backend WHERE singleton";
pub(crate) const Q_OPS: &str = "SELECT outcome,name,args_digest FROM _ops WHERE principal = $1 AND id = $2";
const Q_HEAD_LOCK: &str = "SELECT seq FROM _head WHERE singleton FOR UPDATE";
pub(crate) const Q_GEN: &str = "SELECT generation FROM _backend WHERE singleton";
pub(crate) const Q_SIZES: &str = "SELECT octet_length(r.data)::bigint, octet_length(i.k)::bigint FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5";
pub(crate) const Q_DATA: &str = "SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5";
const Q_UPDATE: &str = "UPDATE r SET data = $3 WHERE t = $1 AND id = $2";
// The engine's tail, verbatim (crates/snapback4-core/src/engine/postgres/tail.rs).
const Q_TAIL: &str = "WITH head AS (
            UPDATE _head SET seq = $1::bigint WHERE singleton AND seq = $1::bigint - 1 RETURNING seq
        ), committed AS (
            INSERT INTO _commits SELECT seq,$2,$3,$4,$5,$6,$7 FROM head RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT l.partition,c.seq,l.ord,l.t,l.kind,l.id,l.data FROM committed c
            CROSS JOIN unnest($8::text[],$9::bigint[],$10::text[],$11::text[],$12::text[],$13::text[]) AS l(partition,ord,t,kind,id,data)
        ), effects AS (
            INSERT INTO _outbox SELECT e.id,c.seq,e.effect,e.payload,'queued',0,$2 FROM committed c
            CROSS JOIN unnest($14::text[],$15::text[],$16::text[]) AS e(id,effect,payload)
        ) SELECT count(*) FROM committed";
// (0) per member: the same tail without the head update (the batch makes one).
const Q_MEMBER_TAIL: &str = "WITH committed AS (
            INSERT INTO _commits SELECT $1::bigint,$2,$3,$4,$5,$6,$7 RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT l.partition,c.seq,l.ord,l.t,l.kind,l.id,l.data FROM committed c
            CROSS JOIN unnest($8::text[],$9::bigint[],$10::text[],$11::text[],$12::text[],$13::text[]) AS l(partition,ord,t,kind,id,data)
        ), effects AS (
            INSERT INTO _outbox SELECT e.id,c.seq,e.effect,e.payload,'queued',0,$2 FROM committed c
            CROSS JOIN unnest($14::text[],$15::text[],$16::text[]) AS e(id,effect,payload)
        ) SELECT count(*) FROM committed";
const Q_OPS_INSERT: &str = "INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) VALUES ($1,$2,$3,$4,$5,$6,$7)";
const Q_HEAD_SET: &str = "UPDATE _head SET seq = $2::bigint WHERE singleton AND seq = $1::bigint - 1";
// (0) coalesced: every member's _commits, _log and _ops rows, one statement.
const Q_BATCH_TAIL: &str = "WITH committed AS (
            INSERT INTO _commits SELECT c.seq,$1,'increment','alice','mutation','[\"counters\"]',1 FROM unnest($2::bigint[]) AS c(seq) RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT 'public',l.seq,0,'counters','put',l.id,l.data FROM unnest($2::bigint[],$3::text[],$4::text[]) AS l(seq,id,data)
        ), ops AS (
            INSERT INTO _ops SELECT 'alice',o.id,o.seq,o.outcome,'increment',$5,$1 FROM unnest($6::text[],$2::bigint[],$7::text[]) AS o(id,seq,outcome)
        ) SELECT count(*) FROM committed";
// (A): rows, head, commits, log and receipts in one statement.
const Q_COMMIT_STAGE: &str = "WITH head AS (
            UPDATE _head SET seq = $2::bigint WHERE singleton AND seq = $1::bigint - 1 RETURNING seq
        ), w AS (
            UPDATE r SET data = u.data FROM unnest($3::text[],$4::text[]) AS u(id,data), head WHERE r.t = 'counters' AND r.id = u.id RETURNING 1
        ), committed AS (
            INSERT INTO _commits SELECT c.seq,$5,'increment','alice','mutation','[\"counters\"]',1 FROM head, unnest($6::bigint[]) AS c(seq) RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT 'public',l.seq,0,'counters','put',l.id,l.data FROM head, unnest($6::bigint[],$3::text[],$4::text[]) AS l(seq,id,data)
        ), ops AS (
            INSERT INTO _ops SELECT 'alice',o.id,o.seq,o.outcome,'increment',$7,$5 FROM head, unnest($8::text[],$6::bigint[],$9::text[]) AS o(id,seq,outcome)
        ) SELECT (SELECT count(*) FROM head), (SELECT count(*) FROM w), (SELECT count(*) FROM committed)";

// @ref LLP 3000.009.001.000#6.3 — all durable operations share the stream; pins fold by max
// S1a uses the actual _sessions (including its two secondary indexes).
// Footprints and revision/pin rows model the proposed, not-yet-built store.
const Q_FULL_STAGE: &str = "WITH head AS (
            UPDATE _head SET seq = $2 WHERE singleton AND seq = $1 RETURNING seq
        ), w AS (
            UPDATE r SET data = u.data FROM unnest($3::text[],$4::text[]) AS u(id,data), head WHERE r.t='counters' AND r.id=u.id RETURNING 1
        ), committed AS (
            INSERT INTO _commits SELECT c.seq,$5,'increment','alice','mutation','[\"counters\"]',1 FROM head, unnest($6::bigint[]) c(seq) RETURNING seq
        ), logged AS (
            INSERT INTO _log SELECT 'public',l.seq,0,'counters','put',l.id,l.data FROM head, unnest($6::bigint[],$3::text[],$4::text[]) l(seq,id,data)
        ), ops AS (
            INSERT INTO _ops SELECT 'alice',o.id,o.seq,o.outcome,o.name,$7,$5 FROM head, unnest($8::text[],$9::bigint[],$10::text[],$11::text[]) o(id,seq,outcome,name) RETURNING 1
        ), sessions AS (
            INSERT INTO _sessions SELECT s.id,'alice','account',$5,$5+3600000,s.id FROM head, unnest($12::text[]) s(id) RETURNING 1
        ), footprints AS (
            INSERT INTO _s1a_footprints SELECT f.revision,f.keys,'session:alice;principal-generation:alice;owner-lease' FROM head, unnest($13::bigint[],$14::text[]) f(revision,keys) RETURNING 1
        ), revision AS (
            UPDATE _s1a_meta SET value=$15 WHERE key='revision' AND value=$16 RETURNING 1
        ), pin AS (
            UPDATE _s1a_meta SET value=greatest(value,$17) WHERE key='time_audience_clock' RETURNING 1
        ) SELECT (SELECT count(*) FROM head),(SELECT count(*) FROM w),(SELECT count(*) FROM committed),
            (SELECT count(*) FROM ops),(SELECT count(*) FROM sessions),(SELECT count(*) FROM footprints),
            (SELECT count(*) FROM revision),(SELECT count(*) FROM pin)";

const AT: i64 = 1000;

pub struct Conn {
    client: Client,
    calls: u64,
    st: HashMap<&'static str, Statement>,
}

impl Conn {
    pub fn new(net: &Net, schema: &str) -> Conn {
        let mut client = net.connect();
        client.batch_execute(&format!("SET search_path = \"{schema}\", pg_catalog; SET statement_timeout = '5s'; SET lock_timeout = '5s';")).unwrap();
        let mut st = HashMap::new();
        for q in [Q_GEN_HEAD, Q_OPS, Q_HEAD_LOCK, Q_GEN, Q_SIZES, Q_DATA, Q_UPDATE, Q_TAIL, Q_MEMBER_TAIL, Q_OPS_INSERT, Q_HEAD_SET, Q_BATCH_TAIL, Q_COMMIT_STAGE] {
            st.insert(q, client.prepare(q).unwrap());
        }
        Conn { client, calls: 0, st }
    }
    fn simple(&mut self, sql: &str) -> Result<(), String> {
        self.calls += 1;
        self.client.batch_execute(sql).map_err(|e| format!("{sql}: {e:?}"))
    }
    fn q(&mut self, sql: &'static str, p: &[&(dyn postgres::types::ToSql + Sync)]) -> Result<Vec<postgres::Row>, String> {
        self.calls += 1;
        let st = self.st[sql].clone();
        self.client.query(&st, p).map_err(|e| format!("{e:?}"))
    }

    /// The replay pre-check: a read-only snapshot transaction, outside the lock.
    fn precheck(&mut self, op: &str) -> Result<(), String> {
        self.simple("START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")?;
        self.q(Q_GEN_HEAD, &[])?;
        let found = self.q(Q_OPS, &[&"alice", &op])?;
        self.simple("ROLLBACK")?;
        if !found.is_empty() {
            return Err(format!("op id {op} already applied"));
        }
        Ok(())
    }

    // @ref LLP 3000.009.001.002#9-phases — S1a bounds execution without an overlay
    pub fn execution(&mut self, counter: &str, op: &str) -> Result<u64, String> {
        let before = self.calls;
        self.simple("START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")?;
        // Every read-only SELECT from the capture, in order. The head's
        // FOR UPDATE is a commit-side reservation, not an execution read.
        self.q(Q_GEN_HEAD, &[])?;
        self.q(Q_OPS, &[&"alice", &op])?;
        self.q(Q_GEN, &[])?;
        self.q(Q_OPS, &[&"alice", &op])?;
        let lo = key::encode(&[Value::Id(counter.into())]);
        let hi = key::upper_bound(&lo);
        for _ in 0..2 {
            let sizes = self.q(Q_SIZES, &[&"counters", &"byId", &lo, &hi, &1i64])?;
            let data = self.q(Q_DATA, &[&"counters", &"byId", &lo, &hi, &1i64])?;
            if sizes.len() != 1 || data.len() != 1 {
                return Err("execution counter missing".into());
            }
        }
        self.simple("ROLLBACK")?;
        Ok(self.calls - before)
    }

    /// The program's reads and write, as the engine issues them: the scan
    /// preflight and fetch twice (the `!` read and the update's read), then
    /// the row image update. Returns the new row image.
    fn program(&mut self, counter: &str) -> Result<String, String> {
        let lo = key::encode(&[Value::Id(counter.into())]);
        let hi = key::upper_bound(&lo);
        let mut data = String::new();
        for _ in 0..2 {
            self.q(Q_SIZES, &[&"counters", &"byId", &lo, &hi, &1i64])?;
            let rows = self.q(Q_DATA, &[&"counters", &"byId", &lo, &hi, &1i64])?;
            data = rows.first().ok_or("counter missing")?.get::<_, String>(0);
        }
        let value: Json = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        let n = value["Row"]["value"]["Int"].as_i64().ok_or("bad row image")?;
        let image = format!("{{\"Row\":{{\"id\":{{\"Id\":\"{counter}\"}},\"value\":{{\"Int\":{}}}}}}}", n + 1);
        self.q(Q_UPDATE, &[&"counters", &counter, &image])?;
        Ok(image)
    }

    fn receipt(op: &str, seq: i64) -> String {
        format!("{{\"id\":\"{op}\",\"replayed\":true,\"seq\":{seq},\"state\":\"sent\"}}")
    }

    /// (R): one mutation under the reference committer.
    fn reference(&mut self, counter: &str, op: &str) -> Result<(), String> {
        self.precheck(op)?;
        self.simple("START TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")?;
        let r = (|| {
            let head: i64 = self.q(Q_HEAD_LOCK, &[])?[0].get(0);
            self.q(Q_GEN, &[])?;
            if !self.q(Q_OPS, &[&"alice", &op])?.is_empty() {
                return Err("raced receipt".to_string());
            }
            self.simple("SAVEPOINT program")?;
            let image = self.program(counter)?;
            self.simple("RELEASE SAVEPOINT program")?;
            let seq = head + 1;
            let n = self.q(Q_TAIL, &[&seq, &AT, &"increment", &"alice", &"mutation", &"[\"counters\"]", &1i64,
                &vec!["public"], &vec![0i64], &vec!["counters"], &vec!["put"], &vec![counter], &vec![image.as_str()],
                &Vec::<&str>::new(), &Vec::<&str>::new(), &Vec::<&str>::new()])?[0].get::<_, i64>(0);
            if n != 1 {
                return Err("head moved".into());
            }
            self.q(Q_OPS_INSERT, &[&"alice", &op, &seq, &Self::receipt(op, seq), &"increment", &ARGS_DIGEST, &AT])?;
            self.simple("COMMIT")
        })();
        if r.is_err() {
            let _ = self.client.batch_execute("ROLLBACK");
        }
        r
    }

    /// (0): one batch in one transaction. Returns calls made.
    fn serial_batch(&mut self, jobs: &[Job], coalesced: bool) -> Result<(), String> {
        self.simple("START TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")?;
        let r = (|| {
            let head: i64 = self.q(Q_HEAD_LOCK, &[])?[0].get(0);
            self.q(Q_GEN, &[])?;
            let (mut seqs, mut ids, mut images, mut ops, mut outcomes) = (vec![], vec![], vec![], vec![], vec![]);
            for (i, job) in jobs.iter().enumerate() {
                let seq = head + 1 + i as i64;
                if !self.q(Q_OPS, &[&"alice", &job.op])?.is_empty() {
                    return Err("raced receipt".to_string());
                }
                self.simple("SAVEPOINT program")?;
                let image = self.program(&job.counter)?;
                self.simple("RELEASE SAVEPOINT program")?;
                if coalesced {
                    seqs.push(seq);
                    ids.push(job.counter.clone());
                    images.push(image);
                    ops.push(job.op.clone());
                    outcomes.push(Self::receipt(&job.op, seq));
                } else {
                    self.q(Q_MEMBER_TAIL, &[&seq, &AT, &"increment", &"alice", &"mutation", &"[\"counters\"]", &1i64,
                        &vec!["public"], &vec![0i64], &vec!["counters"], &vec!["put"], &vec![job.counter.as_str()], &vec![image.as_str()],
                        &Vec::<&str>::new(), &Vec::<&str>::new(), &Vec::<&str>::new()])?;
                    self.q(Q_OPS_INSERT, &[&"alice", &job.op, &seq, &Self::receipt(&job.op, seq), &"increment", &ARGS_DIGEST, &AT])?;
                }
            }
            if coalesced {
                self.q(Q_BATCH_TAIL, &[&AT, &seqs, &ids, &images, &ARGS_DIGEST, &ops, &outcomes])?;
            }
            let last = head + jobs.len() as i64;
            let first = head + 1;
            if self.client.execute(&self.st[Q_HEAD_SET].clone(), &[&first, &last]).map_err(|e| format!("{e:?}"))? != 1 {
                return Err("head moved".into());
            }
            self.calls += 1;
            self.simple("COMMIT")
        })();
        if r.is_err() {
            let _ = self.client.batch_execute("ROLLBACK");
        }
        r
    }

    /// (A): the batch commit stage with known write sets. Values come from
    /// the committer's in-memory folded head (`values`).
    fn commit_stage(&mut self, jobs: &[Job], values: &mut HashMap<String, i64>, head: &mut i64, explicit: bool) -> Result<(), String> {
        let first = *head + 1;
        let last = *head + jobs.len() as i64;
        let (mut seqs, mut ids, mut images, mut ops, mut outcomes) = (vec![], vec![], vec![], vec![], vec![]);
        for (i, job) in jobs.iter().enumerate() {
            let seq = first + i as i64;
            let v = values.entry(job.counter.clone()).or_insert(0);
            *v += 1;
            seqs.push(seq);
            ids.push(job.counter.clone());
            images.push(format!("{{\"Row\":{{\"id\":{{\"Id\":\"{}\"}},\"value\":{{\"Int\":{}}}}}}}", job.counter, v));
            ops.push(job.op.clone());
            outcomes.push(Self::receipt(&job.op, seq));
        }
        if explicit {
            self.simple("START TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")?;
        }
        let r = (|| {
            let row = self.q(Q_COMMIT_STAGE, &[&first, &last, &ids, &images, &AT, &seqs, &ARGS_DIGEST, &ops, &outcomes])?;
            let (h, w) = (row[0].get::<_, i64>(0), row[0].get::<_, i64>(1));
            if h != 1 || w != jobs.len() as i64 {
                return Err(format!("commit stage applied head={h} rows={w} for {} members", jobs.len()));
            }
            if explicit { self.simple("COMMIT") } else { Ok(()) }
        })();
        if r.is_err() {
            if explicit {
                let _ = self.client.batch_execute("ROLLBACK");
            }
            // Values folded for a failed batch are wrong now; reread.
            values.clear();
        } else {
            *head = last;
        }
        r
    }

    fn full_stage(&mut self, jobs: &[Job], values: &mut HashMap<String, i64>, head: &mut i64, revision: &mut i64) -> Result<(), String> {
        let mut seq = *head;
        let (mut seqs, mut ids, mut images, mut ops, mut op_seqs, mut outcomes, mut names, mut sessions, mut revisions, mut keys) =
            (vec![], vec![], vec![], vec![], vec![], vec![], vec![], vec![], vec![], vec![]);
        for (i, job) in jobs.iter().enumerate() {
            if job.non_head {
                sessions.push(job.op.clone());
                names.push("session-mint");
                keys.push(format!("session:{};receipt:alice:{}", job.op, job.op));
            } else {
                seq += 1;
                let v = values.entry(job.counter.clone()).or_insert(0);
                *v += 1;
                seqs.push(seq);
                ids.push(job.counter.clone());
                images.push(format!("{{\"Row\":{{\"id\":{{\"Id\":\"{}\"}},\"value\":{{\"Int\":{}}}}}}}", job.counter, v));
                names.push("increment");
                keys.push(format!("r:counters:{};receipt:alice:{}", job.counter, job.op));
            }
            ops.push(job.op.clone());
            op_seqs.push(seq);
            outcomes.push(Self::receipt(&job.op, seq));
            revisions.push(*revision + i as i64 + 1);
        }
        let next_revision = *revision + jobs.len() as i64;
        let pin = jobs.iter().map(|j| j.pin).max().unwrap();
        self.simple("START TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")?;
        let result = (|| {
            let rows = self.q(Q_FULL_STAGE, &[&*head, &seq, &ids, &images, &AT, &seqs, &ARGS_DIGEST,
                &ops, &op_seqs, &outcomes, &names, &sessions, &revisions, &keys, &next_revision, &*revision, &pin])?;
            let expected = [1, ids.len() as i64, ids.len() as i64, jobs.len() as i64, sessions.len() as i64, jobs.len() as i64, 1, 1];
            for (column, count) in expected.iter().enumerate() {
                if rows[0].get::<_, i64>(column) != *count {
                    return Err(format!("full write set count mismatch in column {column}"));
                }
            }
            self.simple("COMMIT")
        })();
        if result.is_ok() {
            *head = seq;
            *revision = next_revision;
        } else {
            let _ = self.client.batch_execute("ROLLBACK");
            values.clear();
        }
        result
    }
}

struct Job {
    counter: String,
    op: String,
    non_head: bool,
    pin: i64,
    reply: mpsc::Sender<Result<u64, String>>,
}

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Job>,
    stop: bool,
    submitted: u64,
}

type Shared = Arc<(Mutex<Queue>, Condvar)>;

fn committer(shared: Shared, net: Arc<Net>, schema: String, protocol: String, batch: usize, coalesced: bool, explicit: bool, full: bool) -> Json {
    let mut conn = Conn::new(&net, &schema);
    let mut revision = 0i64;
    if full {
        conn.st.insert(Q_FULL_STAGE, conn.client.prepare(Q_FULL_STAGE).unwrap());
        revision = conn.client.query_one("SELECT value FROM _s1a_meta WHERE key='revision'", &[]).unwrap().get(0);
    }
    let mut values: HashMap<String, i64> = HashMap::new();
    let mut head = 0i64;
    let mut sizes: HashMap<usize, u64> = HashMap::new();
    let mut batches = 0u64;
    let mut non_head_ops = 0u64;
    let mut max_pin = 0i64;
    if protocol == "A" {
        head = conn.client.query_one("SELECT seq FROM _head WHERE singleton", &[]).unwrap().get(0);
        for row in conn.client.query("SELECT id, data FROM r WHERE t = 'counters'", &[]).unwrap() {
            let data: Json = serde_json::from_str(row.get::<_, &str>(1)).unwrap();
            values.insert(row.get(0), data["Row"]["value"]["Int"].as_i64().unwrap());
        }
    }
    loop {
        let jobs: Vec<Job> = {
            let (lock, cv) = &*shared;
            let mut q = lock.lock().unwrap();
            while q.jobs.is_empty() && !q.stop {
                q = cv.wait(q).unwrap();
            }
            if q.jobs.is_empty() && q.stop {
                break;
            }
            let n = q.jobs.len().min(batch);
            q.jobs.drain(..n).collect()
        };
        let before = conn.calls;
        let result = if protocol == "0" {
            conn.serial_batch(&jobs, coalesced)
        } else {
            if values.is_empty() {
                for row in conn.client.query("SELECT id, data FROM r WHERE t = 'counters'", &[]).unwrap() {
                    let data: Json = serde_json::from_str(row.get::<_, &str>(1)).unwrap();
                    values.insert(row.get(0), data["Row"]["value"]["Int"].as_i64().unwrap());
                }
            }
            if full { conn.full_stage(&jobs, &mut values, &mut head, &mut revision) }
            else { conn.commit_stage(&jobs, &mut values, &mut head, explicit) }
        };
        if result.is_ok() {
            non_head_ops += jobs.iter().filter(|j| j.non_head).count() as u64;
            max_pin = max_pin.max(jobs.iter().map(|j| j.pin).max().unwrap());
        }
        let per = (conn.calls - before).div_ceil(jobs.len() as u64);
        batches += 1;
        *sizes.entry(jobs.len()).or_default() += 1;
        for job in jobs {
            let _ = job.reply.send(result.clone().map(|_| per));
        }
    }
    let mut hist: Vec<(usize, u64)> = sizes.into_iter().collect();
    hist.sort();
    json!({"batches": batches, "batch_size_histogram": hist, "non_head_ops":non_head_ops, "max_pin":max_pin})
}

pub fn run(args: &Args) -> Json {
    let protocol = args.req("--protocol").to_string();
    assert!(["R", "0", "A"].contains(&protocol.as_str()), "--protocol R|0|A");
    let net = Arc::new(Net::parse(args.req("--net")));
    let disjoint = args.req("--counters") == "disjoint";
    let batch = args.num("--batch", 1);
    let writers = args.num("--writers", if protocol == "R" { 4 } else { (2 * batch).max(4) });
    let coalesced = args.get("--tail") == Some("coalesced");
    let explicit = args.get("--txn") != Some("implicit");
    let full = args.flag("--full-writes");
    let non_head_pct = args.num("--non-head-pct", 0);
    assert!(non_head_pct <= 100 && (full || non_head_pct == 0));
    assert!(!full || (protocol == "A" && explicit), "full write sets require A with explicit transactions");
    assert!(protocol != "A" || disjoint, "(A) folds same-counter members into one write; by (a)'s validation only one increment of a counter enters a batch, so same-counter (A) is the N=1 cell");
    assert!(writers <= 256);
    let timing = Timing::from_env();
    let (schema, engine) = create_engine("cpmod");
    drop(engine);
    if full {
        admin().batch_execute(&format!("CREATE TABLE {schema}._s1a_meta (key text PRIMARY KEY, value bigint NOT NULL);
            INSERT INTO {schema}._s1a_meta VALUES ('revision',0),('time_audience_clock',0);
            CREATE TABLE {schema}._s1a_footprints (revision bigint PRIMARY KEY, keys text NOT NULL, authority text NOT NULL);")).unwrap();
    }
    let tag = format!("{:x}", snapback4_core::ids::seed() & 0xffff_ffff);
    let mut runs = Vec::new();
    let mut total = 0i64;
    let mut total_non_head = 0i64;
    let mut max_pin = 0i64;
    for run in 0..args.runs() {
        let tag = tag.clone();
        let result = if protocol == "R" {
            let (n2, s2) = (net.clone(), schema.clone());
            closed_loop(writers, &timing, Some(true), move |_| Conn::new(&n2, &s2), move |c, w, i| {
                let before = c.calls;
                c.reference(&slot(disjoint, w), &format!("{tag}-{run}-{w}-{i}"))?;
                Ok(c.calls - before)
            })
        } else {
            let shared: Shared = Arc::new((Mutex::new(Queue::default()), Condvar::new()));
            let handle = {
                let (sh, n2, s2, p2) = (shared.clone(), net.clone(), schema.clone(), protocol.clone());
                thread::spawn(move || committer(sh, n2, s2, p2, batch, coalesced, explicit, full))
            };
            let (sh, n2, s2, p2) = (shared.clone(), net.clone(), schema.clone(), protocol.clone());
            let mut result = closed_loop(
                writers,
                &timing,
                Some(true),
                move |_| {
                    let (tx, rx) = mpsc::channel();
                    // (0) keeps the engine's replay pre-check on the writer's own
                    // connection, outside the serial section; (A) omits execution.
                    let conn = (p2 == "0").then(|| Conn::new(&n2, &s2));
                    (conn, tx, rx)
                },
                move |(conn, tx, rx), w, i| {
                    let op = format!("{tag}-{run}-{w}-{i}");
                    let mut calls = 0;
                    if let Some(conn) = conn {
                        let before = conn.calls;
                        conn.precheck(&op)?;
                        calls += conn.calls - before;
                    }
                    {
                        let (lock, cv) = &*sh;
                        let mut queue = lock.lock().unwrap();
                        let ordinal = queue.submitted;
                        queue.submitted += 1;
                        queue.jobs.push_back(Job { counter: slot(disjoint, w), op,
                            non_head: full && (ordinal * 37) % 100 < non_head_pct as u64,
                            pin: AT + run as i64 * 1_000_000_000 + ordinal as i64, reply: tx.clone() });
                        cv.notify_one();
                    }
                    Ok(calls + rx.recv().map_err(|e| e.to_string())??)
                },
            );
            {
                let (lock, cv) = &*shared;
                lock.lock().unwrap().stop = true;
                cv.notify_all();
            }
            result["committer"] = handle.join().unwrap();
            total_non_head += result["committer"]["non_head_ops"].as_i64().unwrap();
            max_pin = max_pin.max(result["committer"]["max_pin"].as_i64().unwrap());
            result
        };
        total += result["total_ops"].as_i64().unwrap();
        runs.push(result);
    }
    let mut admin = admin();
    let sum: i64 = admin
        .query(&format!("SELECT data FROM \"{schema}\".r WHERE t = 'counters'"), &[])
        .unwrap()
        .iter()
        .map(|r| serde_json::from_str::<Json>(r.get::<_, &str>(0)).unwrap()["Row"]["value"]["Int"].as_i64().unwrap())
        .sum();
    let full_check = if full {
        let row = admin.query_one(&format!("SELECT (SELECT count(*) FROM {schema}._ops),
            (SELECT count(*) FROM {schema}._sessions), (SELECT count(*) FROM {schema}._s1a_footprints),
            (SELECT value FROM {schema}._s1a_meta WHERE key='revision'),
            (SELECT value FROM {schema}._s1a_meta WHERE key='time_audience_clock')"), &[]).unwrap();
        let counts: Vec<i64> = (0..5).map(|i| row.get(i)).collect();
        let ok = counts == vec![total, total_non_head, total, total, max_pin];
        assert!(ok, "full-write-set verification failed: {counts:?}");
        json!({"ok":ok, "receipts":counts[0], "sessions":counts[1], "footprints":counts[2], "revision":counts[3], "pin":counts[4]})
    } else { Json::Null };
    json!({"cell": "model", "protocol": protocol, "label": match protocol.as_str() {
            "R" => "MODEL of the reference committer (captured statements)",
            "0" => "MODEL of the serial batch (0)",
            _ => "UPPER BOUND: commit stage of (a) only; execution, snapshot reads, validation and reruns omitted",
        },
        "net": net.describe(), "batch": batch, "writers": writers, "counters": if disjoint {"disjoint"} else {"same"},
        "tail": if protocol == "0" { Some(if coalesced {"coalesced"} else {"per-member"}) } else { None },
        "txn": if protocol == "A" { Some(if explicit {"explicit"} else {"implicit"}) } else { None },
        "full_writes":full, "non_head_pct":non_head_pct, "full_write_check":full_check,
        "schema": schema, "counter_check": {"acknowledged": total-total_non_head, "counter_sum": sum, "ok": total-total_non_head == sum},
        "summary": aggregate(&runs), "runs": runs})
}
