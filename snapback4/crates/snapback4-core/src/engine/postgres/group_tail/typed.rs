//! Typed collections and only the CTEs present in this physical tail.
// @ref LLP 3000.009.001.000.000.002#3.11 — ordered checks, typed tails and head-bound evidence maintenance.
// @ref LLP 3000.009.001.000.000.002#3.4 — every present family retains its exact count and depends on the head CAS.
use super::super::store::signed;
use super::Payload;
use crate::RuntimeError;
use postgres::types::ToSql;

pub(super) struct Tail<'a> {
    pub sql: String,
    counts: [String; 8],
    pub params: Vec<Box<dyn ToSql + Sync + 'a>>,
}
impl<'a> Tail<'a> {
    // The typed/omitted-family shape keeps WF's server-side check in the
    // same statement: a mismatch must raise before the co-dispatched COMMIT.
    pub fn assert_counts(&mut self, expected: Vec<i64>) {
        let expected = self.column(expected, "int8");
        self.sql.push_str(&format!(",pg_temp.sb4_assert_counts(ARRAY[{}],{expected})", self.counts.join(",")));
    }
    fn column<T: ArrayElement>(&mut self, values: Vec<T>, ty: &str) -> String {
        // One input value per typed column avoids a SQL expression tree for
        // every text element in RT5's literal ARRAY transport. PostgreSQL's
        // array input parser runs once; no JSON envelope is reconstructed.
        let mut input = String::from("{");
        for (i, value) in values.iter().enumerate() {
            if i != 0 {
                input.push(',');
            }
            value.append(&mut input);
        }
        input.push('}');
        self.params.push(Box::new(input));
        format!("${}::pg_catalog.text::pg_catalog.{ty}[]", self.params.len())
    }
    pub fn new(
        p: &'a Payload<'a>,
        cas: bool,
        publication: bool,
        first: i64,
        last: i64,
        revision: i64,
        attempt: &'a str,
        previous_revision: i64,
        previous_attempt: &'a str,
    ) -> Result<Self, RuntimeError> {
        let mut out = Self {
            sql: String::new(),
            counts: Default::default(),
            params: vec![
                Box::new(first),
                Box::new(last),
                Box::new(revision),
                Box::new(attempt),
                Box::new(previous_revision),
                Box::new(previous_attempt),
            ],
        };
        let mut ctes = vec!["input AS (SELECT $1::pg_catalog.int8 AS first,$2::pg_catalog.int8 AS last,$3::pg_catalog.int8 AS revision,$4::pg_catalog.text AS attempt,$5::pg_catalog.int8 AS previous_revision,$6::pg_catalog.text AS previous_attempt)".to_string()];
        ctes.push(format!("head AS (UPDATE _head SET seq=input.last{} FROM input WHERE singleton AND seq OPERATOR(pg_catalog.=) input.first {} RETURNING _head.seq,_head.revision)",
            if cas {",revision=input.revision,attempt=input.attempt"} else {""},
            if cas {"AND _head.revision OPERATOR(pg_catalog.=) input.previous_revision AND _head.attempt OPERATOR(pg_catalog.=) input.previous_attempt"} else {""}));
        let mut counts = [
            "1".to_string(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
            "0::pg_catalog.int8".into(),
        ];
        counts[0] = "(SELECT count(*) FROM head)".into();
        macro_rules! columns { ($rows:expr; $($field:ident : $ty:literal),+ $(,)?) => {{
            vec![$(out.column($rows.iter().map(|x| x.$field.clone()).collect::<Vec<_>>(), $ty)),+].join(",")
        }}; }
        if !p.images.is_empty() {
            let args = columns!(p.images; t:"text", id:"text", data:"text");
            ctes.push(format!("images AS (UPDATE r SET data=w.data FROM unnest({args}) AS w(t,id,data) CROSS JOIN head WHERE r.t=w.t AND r.id=w.id RETURNING r.id)"));
            counts[7] = "(SELECT count(*) FROM images)".into();
        }
        if !p.commits.is_empty() {
            let seq = out.column(
                p.commits
                    .iter()
                    .map(|c| signed(c.seq))
                    .collect::<Result<Vec<_>, _>>()?,
                "int8",
            );
            let args = columns!(p.commits; at:"int8", program:"text", principal:"text", kind:"text", touched:"text");
            let writes = out.column(
                p.commits
                    .iter()
                    .map(|c| signed(c.writes))
                    .collect::<Result<Vec<_>, _>>()?,
                "int8",
            );
            let footprint = out.column(
                p.commits
                    .iter()
                    .map(|c| c.footprint.as_str())
                    .collect::<Vec<_>>(),
                "text",
            );
            // Materialize the typed commit input once; evidence reuses it.
            ctes.push(format!("commits_input AS MATERIALIZED (SELECT * FROM unnest({seq},{args},{writes},{footprint}) AS c(seq,at,program,principal,kind,touched,writes,footprint))"));
            ctes.push("committed AS (INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) SELECT c.seq,c.at,c.program,c.principal,c.kind,c.touched,c.writes FROM commits_input c CROSS JOIN head RETURNING seq)".into());
            ctes.push("evidence AS (INSERT INTO _change_evidence(seq,footprint) SELECT c.seq,c.footprint FROM commits_input c JOIN committed USING(seq) RETURNING seq)".into());
            counts[1] = "(SELECT count(*) FROM committed)".into();
            counts[2] = "(SELECT count(*) FROM evidence)".into();
        }
        if !p.log.is_empty() {
            let seq = out.column(
                p.log
                    .iter()
                    .map(|l| signed(l.seq))
                    .collect::<Result<Vec<_>, _>>()?,
                "int8",
            );
            let args = columns!(p.log; partition:"text", ord:"int8", t:"text", kind:"text", id:"text", data:"text");
            ctes.push(format!("logged AS (INSERT INTO _log(partition,seq,ord,t,kind,id,data) SELECT l.partition,l.seq,l.ord,l.t,l.kind,l.id,l.data FROM unnest({seq},{args}) AS l(seq,partition,ord,t,kind,id,data) JOIN committed USING(seq) RETURNING seq)"));
            counts[3] = "(SELECT count(*) FROM logged)".into();
        }
        if !p.effects.is_empty() {
            let seq = out.column(
                p.effects
                    .iter()
                    .map(|e| signed(e.seq))
                    .collect::<Result<Vec<_>, _>>()?,
                "int8",
            );
            let args = columns!(p.effects; at:"int8", id:"text", effect:"text", payload:"text", next_at:"int8", work:"text", deadline:"int8", contract:"text", explicit_release:"bool", release:"text");
            ctes.push(format!("effects AS (INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at,work_spec,deadline,contract,release) SELECT e.id,e.seq,e.effect,e.payload,'queued',0,e.at,e.next_at,e.work,e.deadline,e.contract,CASE WHEN e.explicit_release THEN e.release ELSE (SELECT value FROM _meta WHERE key='release') END FROM unnest({seq},{args}) AS e(seq,at,id,effect,payload,next_at,work,deadline,contract,explicit_release,release) JOIN committed USING(seq) RETURNING id)"));
            counts[4] = "(SELECT count(*) FROM effects)".into();
        }
        if !p.presence.is_empty() {
            let args = columns!(p.presence; principal:"text", id:"text", deadline:"int8");
            ctes.push(format!("presence AS (INSERT INTO _effect_presence(principal,id,deadline) SELECT p.principal,p.id,p.deadline FROM unnest({args}) AS p(principal,id,deadline) JOIN effects USING(id) RETURNING id)"));
            counts[5] = "(SELECT count(*) FROM presence)".into();
        }
        if !p.receipts.is_empty() {
            let seq = out.column(
                p.receipts
                    .iter()
                    .map(|r| signed(r.seq))
                    .collect::<Result<Vec<_>, _>>()?,
                "int8",
            );
            let args = columns!(p.receipts; principal:"text", id:"text", outcome:"text", name:"text", args_digest:"text", at:"int8");
            ctes.push(format!("receipts AS (INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) SELECT r.principal,r.id,r.seq,r.outcome,r.name,r.args_digest,r.at FROM unnest({seq},{args}) AS r(seq,principal,id,outcome,name,args_digest,at) CROSS JOIN head RETURNING id)"));
            counts[6] = "(SELECT count(*) FROM receipts)".into();
        }
        out.sql = format!("WITH {} SELECT {}", ctes.join(","), counts.join(","));
        if publication {
            out.sql.push_str(", (SELECT revision FROM head),(SELECT seq FROM head),(SELECT generation FROM _backend WHERE singleton),(SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash')");
        }
        #[cfg(test)]
        if super::GENERIC.with(|g| g.get()) {
            out.sql = match (cas, publication) {
                (false, false) => super::SQL,
                (false, true) => super::PUBLICATION_SQL,
                (true, false) => super::CAS_SQL,
                (true, true) => super::CAS_PUBLICATION_SQL,
            }
            .into();
            out.params = vec![
                Box::new(serde_json::to_string(p).unwrap()),
                Box::new(first),
                Box::new(last),
            ];
            if cas {
                out.params.extend([
                    Box::new(revision) as Box<dyn ToSql + Sync>,
                    Box::new(attempt),
                    Box::new(previous_revision),
                    Box::new(previous_attempt),
                ]);
            }
        }
        out.counts = counts;
        Ok(out)
    }
}

// Array input distinguishes NULL from a quoted string, and escapes only the
// two array grammar characters inside quoted elements. Raw Unicode and control
// characters remain bytes in the outer, existing RT5 UTF8 text encoder.
trait ArrayElement {
    fn append(&self, out: &mut String);
}
impl ArrayElement for str {
    fn append(&self, out: &mut String) {
        out.push('"');
        for c in self.chars() {
            if matches!(c, '"' | '\\') {
                out.push('\\');
            }
            out.push(c);
        }
        out.push('"');
    }
}
impl ArrayElement for String {
    fn append(&self, out: &mut String) {
        <str as ArrayElement>::append(self.as_str(),out);
    }
}
impl<T: ArrayElement + ?Sized> ArrayElement for &T {
    fn append(&self, out: &mut String) {
        <T as ArrayElement>::append(*self,out);
    }
}
impl<T: ArrayElement> ArrayElement for Option<T> {
    fn append(&self, out: &mut String) {
        if let Some(value) = self {
            <T as ArrayElement>::append(value,out);
        } else {
            out.push_str("NULL");
        }
    }
}
impl ArrayElement for i64 {
    fn append(&self, out: &mut String) {
        use std::fmt::Write;
        write!(out, "{self}").unwrap();
    }
}
impl ArrayElement for bool {
    fn append(&self, out: &mut String) {
        out.push_str(if *self { "true" } else { "false" });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "private Postgres"]
    fn stage_p_compact_array_input_matches_binary_array_bytes() {
        let mut c = postgres::Client::connect(
            &std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),
            postgres::NoTls,
        )
        .unwrap();
        let values = vec![
            Some(""),
            None,
            Some("NULL"),
            Some("null"),
            Some("{x,y}"),
            Some("quote\"slash\\single'"),
            Some("a\nb\rc\td"),
            Some("Καλημέρα ☃ 東京"),
            Some("$1; DROP TABLE r; --"),
        ];
        let mut tail = Tail {
            sql: String::new(),
            params: Vec::new(),
        };
        let expr = tail.column(values.clone(), "text");
        let params = tail.params.iter().map(|v| v.as_ref()).collect::<Vec<_>>();
        let actual = c
            .query_one(&format!("SELECT {expr}"), &params)
            .unwrap()
            .get::<_, Vec<Option<String>>>(0);
        let expected = c
            .query_one("SELECT $1::pg_catalog.text[]", &[&values])
            .unwrap()
            .get::<_, Vec<Option<String>>>(0);
        assert_eq!(actual, expected);
        let numbers = vec![Some(i64::MIN), None, Some(0), Some(i64::MAX)];
        let mut tail = Tail {
            sql: String::new(),
            params: Vec::new(),
        };
        let expr = tail.column(numbers.clone(), "int8");
        let params = tail.params.iter().map(|v| v.as_ref()).collect::<Vec<_>>();
        assert_eq!(
            c.query_one(&format!("SELECT {expr}"), &params)
                .unwrap()
                .get::<_, Vec<Option<i64>>>(0),
            numbers
        );
    }
}
