//! RT5 envelope statement models. Shared timing driver, fresh process per cell.
//! @ref LLP 3000.009.001.000.001#4-the-budgets — the 6/3/5 read and 16/8/11 mutation schedules.
use crate::{
    Args,
    common::*,
    literal::{self, Datum, Prepared},
};
use postgres::{Client, SimpleQueryMessage, types::ToSql};
use serde_json::{Value as Json, json};
use std::{
    sync::Arc,
    sync::atomic::{AtomicU64, Ordering},
};

const AUTH: &str = "SELECT a.principal,g.generation,h.seq FROM _rt5_authority a CROSS JOIN _rt5_generation g CROSS JOIN _rt5_head h WHERE a.digest=$1 AND a.expires>$2 AND g.singleton AND h.singleton";
const MESSAGE: &str = "SELECT room,value FROM _rt5_messages WHERE id=$1";
const MEMBER: &str = "SELECT principal FROM _rt5_memberships WHERE room=$1";
const FENCE: &str = "SELECT sb4_fence($1::bigint)";
const HEAD: &str = "SELECT seq FROM _rt5_head WHERE singleton FOR UPDATE";
const GENERATION: &str = "SELECT sb4_generation($1::bigint)";
const UPDATE: &str = "UPDATE _rt5_messages SET value=$2 WHERE id=$1";
const TAIL: &str = "UPDATE _rt5_head SET seq=seq+1 WHERE singleton AND seq=$1 RETURNING seq";
const READ_OPEN: &str = "SELECT principal,generation,head,room,value FROM sb4_read($1,$2,$3)";
const OPEN: &str = "SELECT head,generation,principal,receipt FROM sb4_open($1,$2,$3,$4,$5)";
const TAIL_FN: &str = "SELECT sb4_tail($1::bigint)";
const BEGIN_READ: &str = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const BEGIN_WRITE: &str = "BEGIN ISOLATION LEVEL READ COMMITTED";
const SAVEPOINTS: &str = "SAVEPOINT member; SAVEPOINT program";
const SETTINGS: &str = "SET LOCAL synchronous_commit=on";

// Void outputs are deliberately ignored; the store reads them only for errors.
struct Conn {
    c: Client,
    p: Vec<Prepared>,
    variant: String,
    shape: String,
}
impl Conn {
    fn new(net: &Net, schema: &str, variant: &str, shape: &str) -> Self {
        let mut c = net.connect();
        literal::configure(&mut c).unwrap();
        c.batch_execute(&format!(
            "SET search_path={schema},pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s'"
        ))
        .unwrap();
        let queries = [
            AUTH, MESSAGE, MEMBER, FENCE, HEAD, GENERATION, UPDATE, TAIL, READ_OPEN, OPEN, TAIL_FN,
        ];
        let p = queries
            .iter()
            .enumerate()
            .map(|(i, q)| Prepared::new(&mut c, &format!("rt5_{i}"), q).unwrap())
            .collect();
        Self {
            c,
            p,
            variant: variant.into(),
            shape: shape.into(),
        }
    }
    fn query(&mut self, i: usize, args: &[&(dyn ToSql + Sync)]) -> Result<Vec<Vec<Datum>>, String> {
        let rows = self
            .c
            .query(&self.p[i].bind, args)
            .map_err(|e| format!("{e:?}"))?;
        // Only the typed fact columns used by Rust are decoded.
        let mut out = Vec::new();
        for r in rows {
            let mut row = Vec::new();
            for (j, c) in r.columns().iter().enumerate() {
                use postgres::types::Type;
                row.push(match *c.type_() {
                    Type::INT8 => r.get::<_, Option<i64>>(j).map_or(Datum::Null, Datum::Int),
                    Type::INT4 => r
                        .get::<_, Option<i32>>(j)
                        .map_or(Datum::Null, |i| Datum::Int(i as i64)),
                    Type::TEXT => r
                        .get::<_, Option<String>>(j)
                        .map_or(Datum::Null, Datum::Text),
                    Type::VOID => Datum::Null,
                    _ => return Err(format!("unexpected result {}", c.type_())),
                });
            }
            out.push(row);
        }
        Ok(out)
    }
    fn simple(&mut self, sql: &str, statements: &[usize]) -> Result<Vec<Vec<Datum>>, String> {
        let messages = self.c.simple_query(sql).map_err(|e| format!("{e:?}"))?;
        let mut out = Vec::new();
        let mut next = statements.iter();
        let mut current = None;
        for message in messages {
            match message {
                SimpleQueryMessage::RowDescription(_) => {
                    current = next.next().copied();
                    if current.is_none() {
                        return Err("unexpected result set".into());
                    }
                }
                SimpleQueryMessage::Row(row) => {
                    let p = &self.p[current.ok_or("missing result description")?];
                    let decoded = p
                        .bind
                        .columns()
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            literal::text(c.type_(), row.get(i)).map_err(|e| format!("{e:?}"))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    out.push(decoded);
                }
                _ => {}
            }
        }
        if next.next().is_some() {
            return Err("missing result set".into());
        }
        Ok(out)
    }
    fn batch(&mut self, s: &str) -> Result<(), String> {
        self.c.batch_execute(s).map_err(|e| format!("{e:?}"))
    }
    fn cmd(&self, i: usize, a: &[&(dyn ToSql + Sync)]) -> Result<String, String> {
        self.p[i].command(a).map_err(|e| format!("{e:?}"))
    }
    fn operation(&mut self, w: usize) -> Result<u64, String> {
        let id = w as i32;
        let simple = self.variant == "simple";
        let envelope = self.variant == "envelope";
        let auth_args: &[&(dyn ToSql + Sync)] = &[&"digest", &0i64];
        // Live ingress, independent of the request snapshot, on every form.
        let ingress = self.query(0, auth_args)?;
        if ingress.len() != 1 || ingress[0][0] != Datum::Text("before".into()) {
            return Err("ingress mismatch".into());
        }
        if self.shape == "w1" {
            let room;
            if simple {
                let cmds = format!(
                    "{BEGIN_READ};{};{}",
                    self.cmd(0, auth_args)?,
                    self.cmd(1, &[&id])?
                );
                let rows = self.simple(&cmds, &[0, 1])?;
                ensure_text(
                    &rows[0],
                    &["before", "1", &int(&ingress[0][2])?.to_string()],
                )?;
                room = int(&rows[1][0])? as i32;
                if room != id || int(&rows[1][1])? != 0 {
                    return Err("W1 row mismatch".into());
                }
                let rows = self.simple(&format!("{};ROLLBACK", self.cmd(2, &[&room])?), &[2])?;
                ensure_text(&rows[0], &["before"])?;
            } else {
                self.batch(BEGIN_READ)?;
                if envelope {
                    let rows = self.query(8, &[&"digest", &0i64, &id])?;
                    if rows[0]
                        != vec![
                            Datum::Text("before".into()),
                            Datum::Int(1),
                            ingress[0][2].clone(),
                            Datum::Int(id as i64),
                            Datum::Int(0),
                        ]
                    {
                        return Err("read envelope mismatch".into());
                    }
                    room = int(&rows[0][3])? as i32;
                } else {
                    if self.query(0, auth_args)? != ingress {
                        return Err("authority mismatch".into());
                    }
                    let rows = self.query(1, &[&id])?;
                    if rows[0] != vec![Datum::Int(id as i64), Datum::Int(0)] {
                        return Err("W1 row mismatch".into());
                    }
                    room = id;
                }
                if self.query(2, &[&room])? != vec![vec![Datum::Text("before".into())]] {
                    return Err("membership mismatch".into());
                }
                self.batch("ROLLBACK")?;
            }
            return Ok(if simple {
                3
            } else if envelope {
                5
            } else {
                6
            });
        }
        let head;
        if simple {
            self.simple(&format!("{BEGIN_WRITE};{}", self.cmd(3, &[&1i64])?), &[3])?;
            let rows = self.simple(
                &format!(
                    "{};{};{};{SAVEPOINTS}",
                    self.cmd(4, &[])?,
                    self.cmd(5, &[&1i64])?,
                    self.cmd(0, auth_args)?
                ),
                &[4, 5, 0],
            )?;
            head = int(&rows[0][0])?;
            ensure_text(&rows[1], &["1"])?;
            ensure_text(&rows[2], &["before", "1", &head.to_string()])?;
        } else {
            self.batch(BEGIN_WRITE)?;
            if envelope {
                let rows = self.query(9, &[&1i64, &1i64, &"digest", &0i64, &None::<&str>])?;
                head = int(&rows[0][0])?;
                if rows[0][1..] != [Datum::Int(1), Datum::Text("before".into()), Datum::Null] {
                    return Err("write envelope mismatch".into());
                }
                self.batch(SAVEPOINTS)?;
            } else {
                self.query(3, &[&1i64])?;
                head = int(&self.query(4, &[])?[0][0])?;
                if self.query(5, &[&1i64])? != vec![vec![Datum::Int(1)]] {
                    return Err("generation mismatch".into());
                }
                let rows = self.query(0, auth_args)?;
                if rows[0]
                    != vec![
                        Datum::Text("before".into()),
                        Datum::Int(1),
                        Datum::Int(head),
                    ]
                {
                    return Err("authority mismatch".into());
                }
                self.batch("SAVEPOINT member")?;
                self.batch("SAVEPOINT program")?;
            }
        }
        // Three dependent program flights. Compute the increment in Rust.
        let before = if simple {
            let cmd = self.cmd(1, &[&id])?;
            int(&self.simple(&cmd, &[1])?[0][1])?
        } else {
            int(&self.query(1, &[&id])?[0][1])?
        };
        let next = before.checked_add(1).ok_or("counter overflow")?;
        if simple {
            let cmd = self.cmd(6, &[&id, &next])?;
            self.simple(&cmd, &[])?;
        } else {
            self.query(6, &[&id, &next])?;
        }
        let after = if simple {
            let cmd = self.cmd(1, &[&id])?;
            int(&self.simple(&cmd, &[1])?[0][1])?
        } else {
            int(&self.query(1, &[&id])?[0][1])?
        };
        if after != next {
            return Err("read after write mismatch".into());
        }
        if simple {
            let rows = self.simple(
                &format!(
                    "RELEASE SAVEPOINT program;{};RELEASE SAVEPOINT member;{SETTINGS}",
                    self.cmd(7, &[&head])?
                ),
                &[7],
            )?;
            if rows.len() != 1 || int(&rows[0][0])? != head + 1 {
                return Err("zero-row tail".into());
            }
        } else {
            self.batch("RELEASE SAVEPOINT program")?;
            if envelope {
                self.query(10, &[&head])?;
                self.batch(&format!("RELEASE SAVEPOINT member;{SETTINGS}"))?;
            } else {
                let rows = self.query(7, &[&head])?;
                if rows != vec![vec![Datum::Int(head + 1)]] {
                    return Err("zero-row tail".into());
                }
                self.batch("RELEASE SAVEPOINT member")?;
                self.batch(SETTINGS)?;
            }
        }
        self.batch("COMMIT")?; // Always its own flight, after all Rust checks.
        Ok(if simple {
            8
        } else if envelope {
            11
        } else {
            16
        })
    }
}
fn int(d: &Datum) -> Result<i64, String> {
    if let Datum::Int(n) = d {
        Ok(*n)
    } else {
        Err(format!("not bigint: {d:?}"))
    }
}
fn ensure_text(row: &[Datum], wanted: &[&str]) -> Result<(), String> {
    if row
        == wanted
            .iter()
            .map(|s| {
                s.parse::<i64>()
                    .map_or_else(|_| Datum::Text((*s).into()), Datum::Int)
            })
            .collect::<Vec<_>>()
    {
        Ok(())
    } else {
        Err(format!("transcript mismatch: {row:?} != {wanted:?}"))
    }
}

pub fn run(args: &Args) -> Json {
    let variant = args.req("--variant");
    assert!(["serial", "simple", "envelope"].contains(&variant));
    let shape = args.req("--shape");
    assert!(["w1", "mutation"].contains(&shape));
    assert_eq!(
        args.runs(),
        1,
        "runner must use a fresh process per repetition"
    );
    let c = args.num("--connections", 32);
    assert_eq!(c, 32);
    let net = Arc::new(Net::parse(args.req("--net")));
    let schema = format!("rt5_bench_{}", std::process::id());
    let mut admin = admin();
    admin
        .batch_execute(&format!(
            "CREATE SCHEMA {schema}; SET search_path={schema},pg_catalog; {}",
            include_str!("../../../crates/snapback4-core/src/engine/postgres/flight_fixture.sql")
        ))
        .unwrap();
    let count = Arc::new(AtomicU64::new(0));
    let ok = count.clone();
    let (n, s, v, h) = (
        net.clone(),
        schema.clone(),
        variant.to_owned(),
        shape.to_owned(),
    );
    let result = closed_loop(
        c,
        &Timing::from_env(),
        Some(true),
        move |_| Conn::new(&n, &s, &v, &h),
        move |conn, w, _| {
            let flights = conn.operation(w)?;
            ok.fetch_add(1, Ordering::Relaxed);
            Ok(flights)
        },
    );
    let acknowledged = count.load(Ordering::Relaxed);
    let sum: i64 = admin
        .query_one("SELECT sum(value)::bigint FROM _rt5_messages", &[])
        .unwrap()
        .get(0);
    let head: i64 = admin
        .query_one("SELECT seq FROM _rt5_head WHERE singleton", &[])
        .unwrap()
        .get(0);
    let correct = if shape == "mutation" {
        sum as u64 == acknowledged && head == sum
    } else {
        sum == 0 && head == 0
    };
    admin
        .batch_execute(&format!("DROP SCHEMA {schema} CASCADE"))
        .unwrap();
    json!({"cell":"rt5-flight","label":"STATEMENT MODEL; loopback is non-qualifying; no interpreter or serving change",
        "variant":variant,"shape":shape,"connections":c,"net":net.describe(),"summary":aggregate(&[result.clone()]),"runs":[result],
        "counter_check":{"ok":correct,"acknowledged_including_warmup_and_drain":acknowledged,"counter_sum":sum,"head":head},"schema_dropped":true})
}
