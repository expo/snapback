//! Raw SQL replay and prepared read timers for the isolated M1 binary.
use postgres::{
    Client, NoTls, Row, Statement,
    types::{FromSql, ToSql, Type},
};
use serde_json::{Value as Json, json};
use std::{fs, time::Instant};

struct Bytes(Vec<u8>);
impl<'a> FromSql<'a> for Bytes {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        Ok(Self(raw.to_vec()))
    }
    fn accepts(_: &Type) -> bool {
        true
    }
}
fn stats(xs: &[f64]) -> Json {
    let mut s = xs.to_vec();
    s.sort_by(f64::total_cmp);
    json!({"n":s.len(),"mean":s.iter().sum::<f64>()/s.len() as f64,"p50":s[s.len()/2],"p99":s[(s.len()*99/100).min(s.len()-1)],"min":s[0],"max":s[s.len()-1]})
}
fn bytes(rows: &[Row]) -> (usize, usize) {
    let mut payload = 0;
    let mut wire = 0;
    for row in rows {
        let n = (0..row.len())
            .map(|i| row.get::<_, Option<Bytes>>(i).map_or(0, |v| v.0.len()))
            .sum::<usize>();
        payload += n;
        wire += n + 7 + 4 * row.len();
    }
    (payload, wire)
}
struct Query {
    stmt: Statement,
    explain: Option<String>,
    params: Vec<Box<dyn ToSql + Sync>>,
    sql: String,
}
fn params(stmt: &Statement, values: &Json) -> Vec<Box<dyn ToSql + Sync>> {
    stmt.params()
        .iter()
        .zip(values.as_array().unwrap())
        .map(|(t, v)| -> Box<dyn ToSql + Sync> {
            if v.is_null() {
                return Box::new(Option::<String>::None);
            }
            let s = v.as_str().unwrap();
            match *t {
                Type::INT8 => Box::new(s.parse::<i64>().unwrap()),
                Type::INT4 => Box::new(s.parse::<i32>().unwrap()),
                Type::BOOL => Box::new(s == "true" || s == "t"),
                Type::BYTEA => {
                    let hex = s.strip_prefix("\\x").unwrap();
                    Box::new(
                        (0..hex.len())
                            .step_by(2)
                            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                            .collect::<Vec<_>>(),
                    )
                }
                Type::TEXT_ARRAY => Box::new(
                    serde_json::from_str::<Vec<String>>(&format!("[{}]", &s[1..s.len() - 1]))
                        .unwrap(),
                ),
                Type::BYTEA_ARRAY => {
                    let values: Vec<String> =
                        serde_json::from_str(&format!("[{}]", &s[1..s.len() - 1])).unwrap();
                    Box::new(
                        values
                            .iter()
                            .map(|v| {
                                let hex = v.strip_prefix("\\x").unwrap();
                                (0..hex.len())
                                    .step_by(2)
                                    .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                                    .collect::<Vec<_>>()
                            })
                            .collect::<Vec<_>>(),
                    )
                }
                _ => Box::new(s.to_owned()),
            }
        })
        .collect()
}
fn query(c: &mut Client, q: &Query) -> Vec<Row> {
    if q.explain.is_none() {
        c.batch_execute(&q.sql).unwrap();
        return Vec::new();
    }
    let ps: Vec<&(dyn ToSql + Sync)> = q.params.iter().map(|v| v.as_ref()).collect();
    c.query(&q.stmt, &ps).unwrap()
}
fn explain(c: &mut Client, q: &Query, timing: bool) -> Json {
    let options = if timing {
        "ANALYZE, BUFFERS, FORMAT JSON"
    } else {
        "ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON"
    };
    let command = format!("EXPLAIN ({options}) {}", q.explain.as_ref().unwrap());
    let messages = c.simple_query(&command).unwrap();
    let row = messages
        .iter()
        .find_map(|m| {
            if let postgres::SimpleQueryMessage::Row(row) = m {
                Some(row)
            } else {
                None
            }
        })
        .unwrap();
    serde_json::from_str(row.get(0).unwrap()).unwrap()
}
pub fn run(config: &str, out: &str) {
    let cfg: Json = serde_json::from_slice(&fs::read(config).unwrap()).unwrap();
    let mut result = vec![];
    for cell in cfg["cells"].as_array().unwrap() {
        super::guard();
        let mut c = Client::connect(&std::env::var("M1_TCP_URL").unwrap(), NoTls).unwrap();
        c.batch_execute(&format!("SET search_path=sb4_eval_m1,pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s'; SET plan_cache_mode={}",cfg["plan_cache_mode"].as_str().unwrap())).unwrap();
        let pid: i32 = c.query_one("SELECT pg_backend_pid()", &[]).unwrap().get(0);
        let mut cached: std::collections::BTreeMap<String, Statement> = Default::default();
        let steps: Vec<_> = cell["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                let sql = s["sql"].as_str().unwrap();
                let stmt=if let Some(stmt)=cached.get(sql) {stmt.clone()} else {
                    let stmt=c.prepare(sql).unwrap();cached.insert(sql.to_owned(),stmt.clone());stmt
                };
                let parameters = params(&stmt, &s["params"]);
                let explain=if sql.trim_start().starts_with("SELECT") || sql.trim_start().starts_with("WITH") {
                    let name:String=c.query_one("SELECT name FROM pg_prepared_statements WHERE statement=$1 ORDER BY prepare_time DESC,name DESC LIMIT 1",&[&sql]).unwrap().get(0);
                    assert!(name.chars().all(|c|c.is_ascii_alphanumeric() || c=='_'));
                    // Only the private S1 fixture's values; standard strings
                    // preserve bytea/array input backslashes. Never product SQL.
                    let values=s["params"].as_array().unwrap().iter().map(|v|v.as_str().map_or("NULL".into(),|s|format!("'{}'",s.replace('\'',"''")))).collect::<Vec<_>>().join(",");
                    Some(format!("EXECUTE \"{name}\"({values})"))
                }else{None};
                Query {
                    stmt,
                    explain,
                    params: parameters,
                    sql: sql.to_owned(),
                }
            })
            .collect();
        let mut runs = vec![];
        for run in 0..3 {
            super::guard();
            let before = fs::read_to_string("/proc/loadavg").unwrap();
            let mut wall = vec![];
            let mut payload = 0;
            let mut wire = 0;
            let mut first = 0.;
            for i in 0..cfg["iterations"].as_u64().unwrap() + 50 {
                if i % 64 == 0 {
                    super::guard()
                }
                if i == 50 {
                    c.query_one("SELECT public.pg_stat_statements_reset()", &[])
                        .unwrap();
                }
                let start = Instant::now();
                let mut rows = vec![];
                for q in &steps {
                    rows.extend(query(&mut c, q));
                }
                let elapsed = start.elapsed().as_secs_f64() * 1e6;
                if i == 0 {
                    first = elapsed
                }
                let (p, w) = bytes(&rows);
                if i >= 50 {
                    wall.push(elapsed);
                    if i == 50 {
                        payload = p;
                        wire = w
                    } else {
                        assert_eq!((p, w), (payload, wire))
                    }
                }
            }
            let native=c.query_one("SELECT COALESCE(SUM(total_exec_time),0)::float8, COALESCE(SUM(calls),0)::bigint FROM public.pg_stat_statements WHERE toplevel AND query NOT LIKE '%pg_stat_statements%'",&[]).unwrap();
            let native_server_us =
                native.get::<_, f64>(0) * 1000. / cfg["iterations"].as_u64().unwrap() as f64;
            let native_calls: i64 = native.get(1);
            assert_eq!(
                native_calls,
                steps.len() as i64 * cfg["iterations"].as_u64().unwrap() as i64
            );
            let mut execution = vec![];
            let mut planning = vec![];
            let mut plans = vec![];
            for i in 0..cfg["explains"].as_u64().unwrap() {
                let mut ex = 0.;
                let mut pl = 0.;
                let mut last = vec![];
                for q in &steps {
                    if q.explain.is_some() {
                        let plan = explain(&mut c, q, true);
                        ex += plan[0]["Execution Time"].as_f64().unwrap() * 1000.;
                        pl += plan[0]["Planning Time"].as_f64().unwrap() * 1000.;
                        if i == 0 {
                            last.push(json!({"sql":q.sql,"plan":plan}))
                        }
                    } else {
                        query(&mut c, q);
                    }
                }
                execution.push(ex);
                planning.push(pl);
                if i == 0 {
                    plans = last;
                }
            }
            let mut execution_off = vec![];
            for _ in 0..cfg["explains"].as_u64().unwrap() {
                let mut ex = 0.;
                for q in &steps {
                    if q.explain.is_some() {
                        let plan = explain(&mut c, q, false);
                        ex += plan[0]["Execution Time"].as_f64().unwrap() * 1000.;
                    } else {
                        query(&mut c, q);
                    }
                }
                execution_off.push(ex);
            }
            let prepared:Vec<Json>=c.query("SELECT statement,generic_plans,custom_plans FROM pg_prepared_statements WHERE statement NOT LIKE 'EXPLAIN%' ORDER BY statement",&[]).unwrap().iter().map(|r|json!({"sql":r.get::<_,String>(0),"generic":r.get::<_,i64>(1),"custom":r.get::<_,i64>(2)})).collect();
            runs.push(json!({"run":run,"loadavg_before":before.trim(),"loadavg_after":fs::read_to_string("/proc/loadavg").unwrap().trim(),"first_wall_us":first,"plain_pg_stat_statements_server_us":native_server_us,"plain_pg_stat_statements_calls":native_calls,"wall_us":stats(&wall),"server_execution_us":stats(&execution),"server_planning_us":stats(&planning),"server_execution_timing_off_us":stats(&execution_off),"payload_bytes":payload,"data_row_wire_bytes":wire,"plans":plans,"prepared":prepared}));
        }
        result.push(json!({"shape":cell["shape"],"variant":cell["variant"],"backend_pid":pid,"statements":steps.len(),"runs":runs}));
        fs::write(out,serde_json::to_vec_pretty(&json!({"plan_state":cfg["plan_state"],"plan_cache_mode":cfg["plan_cache_mode"],"cells":result})).unwrap()).unwrap();
        eprintln!(
            "completed {} {} {} {}",
            cfg["plan_state"], cfg["plan_cache_mode"], cell["shape"], cell["variant"]
        );
    }
}
