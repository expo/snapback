use super::literal::*;
use super::store::Store;
use crate::RuntimeError;
use postgres::{
    Client, NoTls, SimpleQueryMessage,
    error::SqlState,
    types::{ToSql, Type},
};
use std::{
    thread,
    time::{Duration, Instant},
};

pub(super) const FIXTURE: &str = include_str!("flight_fixture.sql");
fn client() -> Client {
    Client::connect(
        &std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test cluster required"),
        NoTls,
    )
    .unwrap()
}
fn equal(a: &Datum, b: &Datum) {
    match (a, b) {
        (Datum::F32(a), Datum::F32(b)) => assert!(
            a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan(),
            "{a:?} != {b:?}"
        ),
        (Datum::F64(a), Datum::F64(b)) => assert!(
            a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan(),
            "{a:?} != {b:?}"
        ),
        (Datum::Array(a), Datum::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                equal(a, b);
            }
        }
        _ => assert_eq!(a, b),
    }
}
fn check(client: &mut Client, p: &Prepared, args: &[&(dyn ToSql + Sync)]) {
    let bind = client.query(&p.bind, args).unwrap();
    let messages = client.simple_query(&p.command(args).unwrap()).unwrap();
    let literal = p.rows(&messages).unwrap();
    assert_eq!(bind.len(), literal.len());
    for (bind, literal) in bind.iter().zip(literal) {
        for (i, got) in literal.iter().enumerate() {
            // The oracle uses the driver's ordinary typed Row::get, including
            // its array decoder, independently of the encoder's binary parser.
            macro_rules! scalar {
                ($t:ty,$map:expr) => {
                    bind.get::<_, Option<$t>>(i).map_or(Datum::Null, $map)
                };
            }
            macro_rules! array {
                ($t:ty,$map:expr) => {
                    bind.get::<_, Option<Vec<Option<$t>>>>(i)
                        .map_or(Datum::Null, |values| {
                            Datum::Array(
                                values
                                    .into_iter()
                                    .map(|v| v.map_or(Datum::Null, $map))
                                    .collect(),
                            )
                        })
                };
            }
            let expected = match *bind.columns()[i].type_() {
                Type::BOOL => scalar!(bool, Datum::Bool),
                Type::INT2 => scalar!(i16, |n| Datum::Int(n as i64)),
                Type::INT4 => scalar!(i32, |n| Datum::Int(n as i64)),
                Type::INT8 => scalar!(i64, Datum::Int),
                Type::FLOAT4 => scalar!(f32, Datum::F32),
                Type::FLOAT8 => scalar!(f64, Datum::F64),
                Type::BYTEA => scalar!(Vec<u8>, Datum::Bytes),
                Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME => {
                    scalar!(String, Datum::Text)
                }
                Type::BOOL_ARRAY => array!(bool, Datum::Bool),
                Type::INT2_ARRAY => array!(i16, |n| Datum::Int(n as i64)),
                Type::INT4_ARRAY => array!(i32, |n| Datum::Int(n as i64)),
                Type::INT8_ARRAY => array!(i64, Datum::Int),
                Type::FLOAT4_ARRAY => array!(f32, Datum::F32),
                Type::FLOAT8_ARRAY => array!(f64, Datum::F64),
                Type::TEXT_ARRAY => array!(String, Datum::Text),
                Type::BYTEA_ARRAY => array!(Vec<u8>, Datum::Bytes),
                ref ty => panic!("uncovered binary type {ty}"),
            };
            equal(&expected, got);
        }
    }
}

#[test]
fn encoder_refuses_nul_and_unsupported_types_without_server() {
    assert!(matches!(
        encode(&Datum::Text("a\0b".into()), &Type::TEXT),
        Err(RuntimeError::Input(_))
    ));
    assert!(encode(&Datum::Int(32768), &Type::INT2).is_err());
    assert!(encode(&Datum::Int(0), &Type::NUMERIC).is_err()); // no NUMERIC at the port
    assert_eq!(
        text(
            &Type::TEXT_ARRAY,
            Some(r#"{"NULL",NULL,"a,b","a\\b","a\"b","{}"}"#)
        )
        .unwrap(),
        Datum::Array(vec![
            Datum::Text("NULL".into()),
            Datum::Null,
            Datum::Text("a,b".into()),
            Datum::Text("a\\b".into()),
            Datum::Text("a\"b".into()),
            Datum::Text("{}".into())
        ])
    );
    assert!(text(&Type::INT8_ARRAY, Some("[0:1]={1,2}")).is_err());
}

#[test]
#[ignore = "requires private Postgres: scripts/test-postgres.sh"]
fn rt5_literal_bind_difftest() {
    let mut c = client();
    // Deliberately hostile input/output settings BEFORE connection qualification.
    for strings in ["on", "off"] {
        c.batch_execute(&format!("SET standard_conforming_strings={strings}; SET client_encoding='SQL_ASCII'; SET DateStyle='SQL, DMY'; SET extra_float_digits=-15; SET bytea_output='escape'; SET lc_numeric='C'; SET lc_monetary='C'; SET lc_time='C' ")).unwrap();
        configure(&mut c).unwrap();
        let bools = Prepared::new(&mut c, &format!("b_{strings}"), "SELECT $1::boolean").unwrap();
        for v in [None, Some(true), Some(false)] {
            check(&mut c, &bools, &[&v]);
        }
        let i16s = Prepared::new(&mut c, &format!("i16_{strings}"), "SELECT $1::smallint").unwrap();
        for v in [None, Some(i16::MIN), Some(i16::MAX), Some(0)] {
            check(&mut c, &i16s, &[&v]);
        }
        let i32s = Prepared::new(&mut c, &format!("i32_{strings}"), "SELECT $1::integer").unwrap();
        for v in [None, Some(i32::MIN), Some(i32::MAX), Some(0)] {
            check(&mut c, &i32s, &[&v]);
        }
        let ints = Prepared::new(&mut c, &format!("i64_{strings}"), "SELECT $1::bigint").unwrap();
        for v in [
            None,
            Some(i64::MIN),
            Some(i64::MAX),
            Some(0),
            Some(-1),
            Some(i64::MAX.saturating_add(1)),
            Some(i64::MIN.saturating_sub(1)),
        ] {
            check(&mut c, &ints, &[&v]);
        }
        let f64s = Prepared::new(
            &mut c,
            &format!("f64_{strings}"),
            "SELECT $1::double precision",
        )
        .unwrap();
        for v in [
            None,
            Some(0.),
            Some(-0.),
            Some(f64::MAX),
            Some(f64::MIN),
            Some(f64::MIN_POSITIVE),
            Some(f64::from_bits(1)),
            Some(1.0000000000000002),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
        ] {
            check(&mut c, &f64s, &[&v]);
        }
        let f32s = Prepared::new(&mut c, &format!("f32_{strings}"), "SELECT $1::real").unwrap();
        for v in [
            None,
            Some(0f32),
            Some(-0f32),
            Some(f32::MAX),
            Some(f32::MIN),
            Some(f32::MIN_POSITIVE),
            Some(f32::from_bits(1)),
            Some(f32::NAN),
            Some(f32::INFINITY),
            Some(f32::NEG_INFINITY),
        ] {
            check(&mut c, &f32s, &[&v]);
        }
        let texts = Prepared::new(
            &mut c,
            &format!("txt_{strings}"),
            "SELECT $1::text,$2::varchar,$3::bpchar,$4::name",
        )
        .unwrap();
        for v in [
            None,
            Some(""),
            Some("'\\$; --\n\r\t"),
            Some("雪💡e\u{301}é"),
            Some("NULL"),
            Some(" {\"x\": [\"a,b\", null]} "),
        ] {
            check(&mut c, &texts, &[&v, &v, &v, &v]);
        }
        let bytes = Prepared::new(&mut c, &format!("bytes_{strings}"), "SELECT $1::bytea").unwrap();
        for v in [None, Some(vec![]), Some((0..=255).collect::<Vec<u8>>())] {
            check(&mut c, &bytes, &[&v]);
        }
        let arrays = Prepared::new(&mut c,&format!("arrays_{strings}"),"SELECT $1::text[],$2::bigint[],$3::boolean[],$4::bytea[],$5::double precision[],$6::real[],$7::integer[],$8::smallint[]").unwrap();
        check(
            &mut c,
            &arrays,
            &[
                &None::<Vec<String>>,
                &None::<Vec<i64>>,
                &None::<Vec<bool>>,
                &None::<Vec<Vec<u8>>>,
                &None::<Vec<f64>>,
                &None::<Vec<f32>>,
                &None::<Vec<i32>>,
                &None::<Vec<i16>>,
            ],
        );
        for empty in [true, false] {
            let t = if empty {
                vec![]
            } else {
                vec![None, Some("NULL"), Some(""), Some("\"\\,{}'$雪e\u{301}")]
            };
            let i = if empty {
                vec![]
            } else {
                vec![None, Some(i64::MIN), Some(i64::MAX)]
            };
            let b = if empty {
                vec![]
            } else {
                vec![None, Some(false), Some(true)]
            };
            let bytes = if empty {
                vec![]
            } else {
                vec![None, Some(vec![]), Some((0..=255).collect::<Vec<u8>>())]
            };
            let f64s = if empty {
                vec![]
            } else {
                vec![
                    None,
                    Some(-0f64),
                    Some(f64::NAN),
                    Some(f64::INFINITY),
                    Some(f64::from_bits(1)),
                ]
            };
            let f32s = if empty {
                vec![]
            } else {
                vec![None, Some(f32::MAX), Some(f32::NEG_INFINITY)]
            };
            let i32s = if empty {
                vec![]
            } else {
                vec![None, Some(i32::MIN), Some(i32::MAX)]
            };
            let i16s = if empty {
                vec![]
            } else {
                vec![None, Some(i16::MIN), Some(i16::MAX)]
            };
            check(
                &mut c,
                &arrays,
                &[&t, &i, &b, &bytes, &f64s, &f32s, &i32s, &i16s],
            );
        }
        // Fixed seeded generation supplements, never replaces, the table above.
        let mut state = 0x727435_u64;
        for _ in 0..256 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            check(&mut c, &ints, &[&(state as i64)]);
            check(&mut c, &f64s, &[&f64::from_bits(state)]);
            let s = format!("'\\${state:x}雪e\u{301}");
            check(&mut c, &texts, &[&s, &s, &s, &s]);
        }
    }
    // Exactly tail.rs $8..$25: 13 text[], 4 bigint[], 1 boolean[].
    let types = [
        "text", "bigint", "text", "text", "text", "text", "text", "text", "text", "bigint", "text",
        "bigint", "text", "text", "text", "bigint", "boolean", "text",
    ];
    let sql = format!(
        "SELECT {}",
        types
            .iter()
            .enumerate()
            .map(|(i, t)| format!("${}::{t}[]", i + 1))
            .collect::<Vec<_>>()
            .join(",")
    );
    let tail = Prepared::new(&mut c, "tail", &sql).unwrap();
    let texts = vec![Some("'\\$雪,{}\""), None, Some("NULL")];
    let ints = vec![Some(i64::MIN), None, Some(i64::MAX)];
    let bools = vec![Some(true), None, Some(false)];
    let args: Vec<&(dyn ToSql + Sync)> = types
        .iter()
        .map(|t| match *t {
            "text" => &texts as _,
            "bigint" => &ints as _,
            _ => &bools as _,
        })
        .collect();
    check(&mut c, &tail, &args);
    // Server errors retain identical SQLSTATE and leave both transactions aborted.
    for (name, sql, arg) in [
        ("overflow", "SELECT $1::bigint + 1", i64::MAX),
        ("division", "SELECT 1::bigint / $1::bigint", 0),
    ] {
        let p = Prepared::new(&mut c, name, sql).unwrap();
        let mut codes = Vec::new();
        for literal in [false, true] {
            c.batch_execute("BEGIN").unwrap();
            let err = if literal {
                c.simple_query(&p.command(&[&arg]).unwrap()).unwrap_err()
            } else {
                c.query(&p.bind, &[&arg]).unwrap_err()
            };
            let db = err.as_db_error().unwrap();
            codes.push((
                db.code().clone(),
                db.message().to_owned(),
                db.detail().map(str::to_owned),
            ));
            assert_eq!(
                c.simple_query("SELECT 1").unwrap_err().code(),
                Some(&SqlState::IN_FAILED_SQL_TRANSACTION)
            );
            c.batch_execute("ROLLBACK").unwrap();
        }
        assert_eq!(codes[0], codes[1]);
    }
}

#[test]
#[ignore = "requires private Postgres: scripts/test-postgres.sh"]
fn rt5_nul_refusal_poisons_exactly_like_bind() {
    for kind in ["text", "optional", "array"] {
        for literal in [false, true] {
            for execute in [false, true] {
                let mut c = client();
                configure(&mut c).unwrap();
                c.batch_execute("CREATE TEMP TABLE poison(n bigint)")
                    .unwrap();
                let sql = if kind == "array" {
                    "SELECT $1::text[]"
                } else {
                    "SELECT $1::text"
                };
                let p = Prepared::new(&mut c, "poison", sql).unwrap();
                let mut store = Store::new(c);
                let tx = store.opening_transaction().unwrap();
                tx.execute("INSERT INTO poison VALUES(1)", &[]).unwrap();
                tx.batch("SAVEPOINT caught").unwrap();
                let value = "x\0y";
                let values = vec![Some(value), None];
                let optional = Some(value);
                let args: Vec<&(dyn ToSql + Sync)> = match kind {
                    "array" => vec![&values],
                    "optional" => vec![&optional],
                    _ => vec![&value],
                };
                let error = if literal {
                    tx.literal_query(&p, &args).unwrap_err()
                } else if execute {
                    tx.execute(sql, &args).unwrap_err()
                } else {
                    tx.query(sql, &args).unwrap_err()
                };
                assert!(
                    matches!(error,RuntimeError::Input(ref s) if s=="Postgres text parameters cannot contain U+0000")
                );
                assert!(matches!(
                    tx.query("SELECT 1", &[]),
                    Err(RuntimeError::Input(_))
                ));
                assert!(tx.rollback_named("caught").is_err());
                assert!(matches!(tx.commit(), Err(RuntimeError::Input(_))));
                assert_eq!(
                    store
                        .client
                        .query_one("SELECT count(*) FROM poison", &[])
                        .unwrap()
                        .get::<_, i64>(0),
                    0
                );
            }
        }
    }
}

fn setup() -> (Client, String) {
    let mut c = client();
    configure(&mut c).unwrap();
    let schema = format!("rt5_{}_{}", std::process::id(), crate::ids::seed());
    c.batch_execute(&format!(
        "CREATE SCHEMA {schema}; SET search_path={schema},pg_catalog; {FIXTURE}"
    ))
    .unwrap();
    (c, schema)
}
fn wait_blocked(c: &mut Client, holder: i32, contender: i32) {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        let blockers: Vec<i32> = c
            .query_one("SELECT pg_blocking_pids($1)", &[&contender])
            .unwrap()
            .get(0);
        if blockers.contains(&holder) {
            return;
        }
        thread::sleep(Duration::from_millis(5));
    }
    panic!("contender {contender} never waited on holder {holder}");
}

#[test]
#[ignore = "requires private Postgres: scripts/test-postgres.sh"]
fn rt5_ordered_error_guard_and_envelope_refusals() {
    let (mut c, schema) = setup();
    let p = Prepared::new(&mut c, "fence", "SELECT sb4_fence($1::bigint)").unwrap();
    for k in 0..3 {
        c.batch_execute("CREATE TEMP SEQUENCE ran START 1").unwrap();
        c.batch_execute("BEGIN; CREATE TEMP TABLE after_error(n integer) ON COMMIT DROP")
            .unwrap();
        let mut cmds = vec!["INSERT INTO after_error VALUES(nextval('ran'))".into(); 3];
        cmds[k] = p.command(&[&2i64]).unwrap();
        assert_eq!(
            c.simple_query(&cmds.join(";")).unwrap_err().code(),
            Some(&SqlState::OBJECT_NOT_IN_PREREQUISITE_STATE)
        );
        assert_eq!(
            c.simple_query("SELECT 1").unwrap_err().code(),
            Some(&SqlState::IN_FAILED_SQL_TRANSACTION)
        );
        // Recover only to inspect the witness; earlier writes roll back too.
        c.batch_execute("ROLLBACK").unwrap();
        let observed = c
            .query_one("SELECT last_value,is_called FROM ran", &[])
            .unwrap();
        let ran = if observed.get::<_, bool>(1) {
            observed.get::<_, i64>(0)
        } else {
            0
        };
        assert_eq!(ran, k as i64, "commands after k must not execute");
        c.batch_execute("DROP SEQUENCE ran").unwrap();
        assert!(
            c.query_one("SELECT to_regclass('after_error') IS NULL", &[])
                .unwrap()
                .get::<_, bool>(0)
        );
    }
    for (token, generation, code) in [
        (2i64, 1i64, SqlState::OBJECT_NOT_IN_PREREQUISITE_STATE),
        (1, 2, SqlState::T_R_SERIALIZATION_FAILURE),
    ] {
        c.batch_execute("BEGIN").unwrap();
        assert_eq!(
            c.query(
                "SELECT head,generation,principal,receipt FROM sb4_open($1,$2,'digest',0,'op')",
                &[&token, &generation]
            )
            .unwrap_err()
            .code(),
            Some(&code)
        );
        assert_eq!(
            c.simple_query("SELECT 1").unwrap_err().code(),
            Some(&SqlState::IN_FAILED_SQL_TRANSACTION)
        );
        c.batch_execute("ROLLBACK").unwrap();
    }
    c.batch_execute("BEGIN").unwrap();
    assert_eq!(
        c.simple_query("SELECT sb4_tail(99); SELECT 1")
            .unwrap_err()
            .code(),
        Some(&SqlState::OBJECT_NOT_IN_PREREQUISITE_STATE)
    );
    assert_eq!(
        c.simple_query("SELECT 1").unwrap_err().code(),
        Some(&SqlState::IN_FAILED_SQL_TRANSACTION)
    );
    c.batch_execute("ROLLBACK").unwrap();
    assert_eq!(
        c.query_one("SELECT seq FROM _rt5_head WHERE singleton", &[])
            .unwrap()
            .get::<_, i64>(0),
        0
    );
    c.batch_execute(&format!("DROP SCHEMA {schema} CASCADE"))
        .unwrap();
}

#[test]
#[ignore = "requires private Postgres: scripts/test-postgres.sh"]
fn rt5_lock_wait_visibility_simple_plpgsql_and_sql_control() {
    for variant in ["simple", "plpgsql", "sql"] {
        let (mut a, schema) = setup();
        let mut observer = client();
        let mut b = client();
        configure(&mut b).unwrap();
        b.batch_execute(&format!(
            "SET search_path={schema},pg_catalog; SET statement_timeout='10s'"
        ))
        .unwrap();
        let holder: i32 = a.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
        let contender: i32 = b.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
        // Prepare before A locks, so the observed wait belongs to execution.
        let head = Prepared::new(
            &mut b,
            "head",
            "SELECT seq FROM _rt5_head WHERE singleton FOR UPDATE",
        )
        .unwrap();
        let later=Prepared::new(&mut b,"later","SELECT g.generation,a.principal,(SELECT outcome FROM _rt5_receipts WHERE op=$2) FROM _rt5_generation g CROSS JOIN _rt5_authority a WHERE g.singleton AND a.digest=$1").unwrap();
        a.batch_execute("BEGIN; SELECT sb4_fence(1); UPDATE _rt5_head SET seq=1 WHERE singleton; UPDATE _rt5_generation SET generation=2; UPDATE _rt5_authority SET principal='after'; INSERT INTO _rt5_receipts VALUES('op','after')").unwrap();
        let join = thread::spawn(move || {
            b.batch_execute("BEGIN ISOLATION LEVEL READ COMMITTED")
                .unwrap();
            let result = if variant == "simple" {
                let msgs = b
                    .simple_query(&format!(
                        "{};{}",
                        head.command(&[]).unwrap(),
                        later.command(&[&"digest", &"op"]).unwrap()
                    ))
                    .unwrap();
                let rows: Vec<_> = msgs
                    .iter()
                    .filter_map(|m| {
                        if let SimpleQueryMessage::Row(r) = m {
                            Some(r)
                        } else {
                            None
                        }
                    })
                    .collect();
                (
                    rows[1].get(0).unwrap().parse::<i64>().unwrap(),
                    rows[1].get(1).unwrap().to_owned(),
                    rows[1].get(2).map(str::to_owned),
                )
            } else {
                let f = if variant == "plpgsql" {
                    "sb4_open"
                } else {
                    "sb4_open_sql"
                };
                let row = b
                    .query_one(
                        &format!("SELECT generation,principal,receipt FROM {f}($1,$2,$3,$4,$5)"),
                        &[&1i64, &2i64, &"digest", &0i64, &"op"],
                    )
                    .unwrap();
                (row.get(0), row.get(1), row.get(2))
            };
            b.batch_execute("ROLLBACK").unwrap();
            result
        });
        wait_blocked(&mut observer, holder, contender);
        a.batch_execute("COMMIT").unwrap();
        let got = join.join().unwrap();
        let expected = if variant == "sql" {
            (1, "before".into(), None)
        } else {
            (2, "after".into(), Some("after".into()))
        };
        assert_eq!(got, expected, "{variant}");
        eprintln!(
            "RT5 {variant}: proven lock wait; generation={} principal={} receipt={:?}",
            got.0, got.1, got.2
        );
        a.batch_execute(&format!("DROP SCHEMA {schema} CASCADE"))
            .unwrap();
    }
}
