//! Product W4 tail generator and the experimental C/ordered-C adaptations.
// @ref LLP 3000.009.001.000.000.003#47-the-flight-of-a-c-batch — every check raises before COMMIT.
pub use checks::{FENCE, GUARD};
use postgres::Client;
use serde_json::{Value as Json, json};
mod checks {
    include!("check_calls.rs");
}
mod store {
    pub fn signed(n: u64) -> Result<i64, crate::RuntimeError> {
        i64::try_from(n).map_err(|_| crate::RuntimeError::Input("overflow".into()))
    }
}
mod group_tail {
    use super::*;
    #[allow(dead_code)]
    pub struct Commit {
        pub seq: u64,
        pub at: i64,
        pub program: String,
        pub principal: String,
        pub kind: String,
        pub touched: String,
        pub writes: u64,
        pub footprint: String,
    }
    pub struct Image {
        pub t: String,
        pub id: String,
        pub data: String,
    }
    pub struct Log<'a> {
        pub partition: &'a str,
        pub seq: u64,
        pub ord: i64,
        pub t: &'a str,
        pub kind: &'a str,
        pub id: &'a str,
        pub data: &'a Option<String>,
    }
    pub struct Effect<'a> {
        pub seq: u64,
        pub at: i64,
        pub id: &'a str,
        pub effect: &'a str,
        pub payload: &'a str,
        pub next_at: Option<i64>,
        pub work: &'a str,
        pub deadline: Option<i64>,
        pub contract: &'a str,
        pub explicit_release: bool,
        pub release: Option<&'a str>,
    }
    pub struct Presence<'a> {
        pub principal: &'a str,
        pub id: &'a str,
        pub deadline: i64,
    }
    pub struct Receipt {
        pub principal: String,
        pub id: String,
        pub seq: u64,
        pub outcome: String,
        pub name: Option<String>,
        pub args_digest: Option<String>,
        pub at: i64,
    }
    pub struct Payload<'a> {
        pub commits: Vec<&'a Commit>,
        pub images: Vec<Image>,
        pub log: Vec<Log<'a>>,
        pub effects: Vec<Effect<'a>>,
        pub presence: Vec<Presence<'a>>,
        pub receipts: Vec<&'a Receipt>,
    }
    mod typed {
        include!("typed.rs");
    }
    pub fn build(
        templates: &[Json],
        base_images: &[Json],
        ids: &[usize],
        values: &[i64],
        lo: i64,
        k: u64,
        _wm: i64,
        arm: &str,
    ) -> (String, Vec<String>) {
        let commits: Vec<_> = ids
            .iter()
            .enumerate()
            .map(|(i, u)| {
                let t = &templates[*u];
                Commit {
                    seq: (lo + i as i64 + 1) as u64,
                    at: 1700000000000 + lo + i as i64 + 1,
                    program: t["program"].as_str().unwrap().into(),
                    principal: t["principal"].as_str().unwrap().into(),
                    kind: t["kind"].as_str().unwrap().into(),
                    touched: t["touched"].as_str().unwrap().into(),
                    writes: t["writes"].as_u64().unwrap(),
                    footprint: t["footprint"].as_str().unwrap().into(),
                }
            })
            .collect();
        let images = ids
            .iter()
            .zip(values)
            .map(|(u, v)| {
                let mut data = base_images[*u].clone();
                data["Row"]["n"]["Int"] = json!(v);
                Image {
                    t: "counters".into(),
                    id: format!("c{u:04}"),
                    data: serde_json::to_string(&data).unwrap(),
                }
            })
            .collect();
        let p = Payload {
            commits: commits.iter().collect(),
            images,
            log: vec![],
            effects: vec![],
            presence: vec![],
            receipts: vec![],
        };
        let attempt = format!("c0-{k}");
        let prev = format!("c0-{}", k - 1);
        let tail = typed::Tail::new(
            &p,
            true,
            arm == "O1",
            lo,
            lo + ids.len() as i64,
            lo + ids.len() as i64,
            &attempt,
            lo,
            &prev,
        )
        .unwrap();
        let mut sql = tail.sql;
        if arm != "O1" {
            let head = "head AS (UPDATE _head SET seq=input.last,revision=input.revision,attempt=input.attempt FROM input WHERE singleton AND seq OPERATOR(pg_catalog.=) input.first AND _head.revision OPERATOR(pg_catalog.=) input.previous_revision AND attempt OPERATOR(pg_catalog.=) input.previous_attempt RETURNING _head.seq,_head.revision)";
            // typed.rs qualifies _head.attempt; assert exact match, never silently
            // price a product head update in the independent lane.
            let head = head.replace(" AND attempt OPERATOR", " AND _head.attempt OPERATOR");
            assert!(sql.contains(&head));
            sql = sql.replace(&head, "head AS (SELECT last AS seq,revision FROM input)");
            let old = "UPDATE r SET data=w.data FROM unnest";
            assert!(sql.contains(old));
            sql=sql.replace(old,&format!("UPDATE r SET odata=r.data,data=w.data,orev=(SELECT revision FROM input),owm=$19 FROM unnest"));
            sql = sql.replace(
                "WHERE r.t=w.t AND r.id=w.id RETURNING r.id",
                &format!(
                    "WHERE r.t=w.t AND r.id=w.id AND (r.orev IS NULL OR r.orev<=$19) RETURNING r.id"
                ),
            );
        }
        let params = tail.params.iter().skip(6).map(|p| {
            // Six controls are typed explicitly; remaining compact columns are TEXT.
            let mut out = postgres::types::private::BytesMut::new();
            let ty = p.as_ref();
            // All controls can be constructed directly below, avoiding decoding
            // driver-private values. Column values are ToSql TEXT binary UTF8.
            ty.to_sql_checked(&postgres::types::Type::TEXT, &mut out)
                .unwrap();
            literal(std::str::from_utf8(&out).unwrap())
        });
        // Driver ToSql controls differ from TEXT: enumerate separately.
        let mut args = vec![
            format!("('{lo}')::pg_catalog.int8"),
            format!("('{}')::pg_catalog.int8", lo + ids.len() as i64),
            format!("('{}')::pg_catalog.int8", lo + ids.len() as i64),
            literal(&attempt),
            format!("('{lo}')::pg_catalog.int8"),
            literal(&prev),
        ];
        args.extend(params);
        (sql, args)
    }
}
pub use group_tail::build as tail;
pub fn literal(s: &str) -> String {
    let mut hex = String::with_capacity(s.len() * 2);
    use std::fmt::Write;
    for b in s.bytes() {
        write!(hex, "{b:02x}").unwrap();
    }
    format!("(pg_catalog.convert_from(pg_catalog.decode('{hex}','hex'),'UTF8'))::pg_catalog.text")
}
pub fn prepare(c: &mut Client, name: &str, sql: &str, args: &[String]) {
    let types = (0..args.len() + 2)
        .map(|i| {
            if i >= args.len() || (i < 6 && i != 3 && i != 5) {
                "pg_catalog.int8"
            } else {
                "pg_catalog.text"
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    c.batch_execute(&format!("PREPARE {name}({types}) AS {sql}"))
        .unwrap();
}
pub fn execute(name: &str, args: &[String]) -> String {
    format!("EXECUTE {name}({});", args.join(","))
}
pub fn raising_tail(sql: &str, n: usize) -> String {
    let (with, select) = sql.rsplit_once(" SELECT ").unwrap();
    let counts = select.split(", (SELECT revision").next().unwrap();
    let expected = [1, n, n, 0, 0, 0, 0, n].map(|n| n.to_string()).join(",");
    format!(
        "{with} SELECT sb4_assert(ARRAY[{counts}]::bigint[]=ARRAY[{expected}]::bigint[]),{select}"
    )
}
