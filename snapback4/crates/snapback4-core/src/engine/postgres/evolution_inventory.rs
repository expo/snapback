//! Factual inventory of retained ordinary rows, cells and logical index entries.
use super::store::{Tx, decode};
use crate::{RuntimeError, Schema, Value, release_history::DormantItem};
use std::collections::BTreeSet;

pub(super) fn inventory(
    tx: &Tx<'_>,
    after: Option<&str>,
    limit: usize,
) -> Result<Vec<DormantItem>, RuntimeError> {
    let rows = tx.query("SELECT path,kind,table_name,part FROM (SELECT table_name AS path,'table' AS kind,table_name,NULL::text AS part FROM _dormant_tables UNION ALL SELECT table_name||'.'||column_name,'column',table_name,column_name FROM _dormant_columns c WHERE NOT EXISTS(SELECT 1 FROM _dormant_tables d WHERE d.table_name=c.table_name) OR EXISTS(SELECT 1 FROM _dormant_values v WHERE v.t=c.table_name AND v.column_name=c.column_name) UNION ALL SELECT table_name||'.'||index_name,'index',table_name,index_name FROM _dormant_indexes UNION ALL SELECT DISTINCT t,'rows',t,NULL::text FROM _dormant_narrow_rows) s WHERE ($1::bytea IS NULL OR convert_to(kind||':'||path,'UTF8')>$1) ORDER BY (kind||':'||path) COLLATE \"C\" LIMIT $2", &[&after.map(str::as_bytes),&(limit.min(i64::MAX as usize) as i64)])?;
    let mut out = Vec::new();
    for row in rows {
        let path: String = row.get(0);
        let kind: String = row.get(1);
        let name: String = row.get(2);
        let column: Option<String> = row.get(3);
        let stats = if kind == "rows" {
            tx.query("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0)::bigint FROM _dormant_narrow_rows WHERE t=$1 AND $2::text IS NULL",&[&name,&column])?
        } else if kind == "table" {
            tx.query("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0)::bigint FROM _dormant_rows WHERE t=$1 AND $2::text IS NULL", &[&name,&column])?
        } else if kind == "column" {
            tx.query("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0)::bigint FROM _dormant_values v WHERE t=$1 AND column_name=$2 AND EXISTS(SELECT 1 FROM r WHERE r.t=v.t AND r.id=v.id)", &[&name,&column])?
        } else {
            Vec::new()
        };
        let mut count = stats.first().map_or(0, |r| r.get::<_, i64>(0) as u64);
        let mut bytes = stats.first().map_or(0, |r| r.get::<_, i64>(1) as u64);
        let mut samples = BTreeSet::new();
        let mut sample_ids = Vec::new();
        let definition_only;
        if kind == "index" {
            let text: String = tx.query(
                "SELECT definition FROM _dormant_indexes WHERE table_name=$1 AND index_name=$2",
                &[&name, &column],
            )?[0]
                .get(0);
            let index = decode(&text)?;
            let schema: Option<Schema> =
                tx.previous_schema_text()?.map(|s| decode(&s)).transpose()?;
            for relation in ["r", "_dormant_rows", "_dormant_narrow_rows"] {
                super::evolution::walk(tx, relation, &name, |id, mut image| {
                    if let Some(table) = schema.as_ref().and_then(|s| s.table(&name)) {
                        crate::schema::materialize_optional_fields(&mut image, table);
                    }
                    for row in tx.query("SELECT column_name,data FROM _dormant_values WHERE t=$1 AND id=$2 ORDER BY column_name", &[&name,&id])? {
                        if let Value::Row(fields) | Value::Map(fields) = &mut image { fields.entry(row.get::<_,String>(0)).or_insert(decode(row.get(1))?); }
                    }
                    let entries = crate::rows::index_keys(&index, &image, id).len() as u64;
                    count += entries;
                    if entries > 0 {
                        samples.insert(bounded(id));
                        if samples.len() > 5 {
                            samples.pop_last();
                        }
                    }
                    Ok(())
                })?;
            }
            definition_only = count == 0;
        } else {
            let query = if kind == "rows" {
                "SELECT id FROM _dormant_narrow_rows WHERE t=$1 AND $2::text IS NULL ORDER BY id LIMIT 5"
            } else if kind == "table" {
                "SELECT id FROM _dormant_rows WHERE t=$1 AND $2::text IS NULL ORDER BY id LIMIT 5"
            } else {
                "SELECT id FROM _dormant_values v WHERE t=$1 AND column_name=$2 AND EXISTS(SELECT 1 FROM r WHERE r.t=v.t AND r.id=v.id) ORDER BY id LIMIT 5"
            };
            for row in tx.query(query, &[&name, &column])? {
                sample_ids.push(bounded(row.get(0)));
            }
            definition_only = if kind == "column" {
                !tx.query(
                    "SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE t=$1 AND column_name=$2)",
                    &[&name, &column],
                )?[0]
                    .get::<_, bool>(0)
            } else {
                count == 0
            };
            if matches!(kind.as_str(),"table"|"rows") {
                let query=if kind=="table" {
                    "SELECT COALESCE(SUM(octet_length(id)+octet_length(data)),0)::bigint FROM _dormant_values v WHERE t=$1 AND EXISTS(SELECT 1 FROM _dormant_rows d WHERE d.t=v.t AND d.id=v.id)"
                }else{
                    "SELECT COALESCE(SUM(octet_length(id)+octet_length(data)),0)::bigint FROM _dormant_values v WHERE t=$1 AND EXISTS(SELECT 1 FROM _dormant_narrow_rows d WHERE d.t=v.t AND d.id=v.id)"
                };
                bytes += tx.query(query,&[&name])?[0].get::<_,i64>(0) as u64;
            }
        }
        if kind == "index" {
            sample_ids = samples.into_iter().collect();
        }
        out.push(DormantItem {
            key: format!("{kind}:{path}"),
            path,
            kind,
            action: "dormant".into(),
            rows: count,
            bytes,
            asset_bytes: 0,
            definition_only,
            sample_ids,
            before_rows: None,
            after_rows: None,
            restored_rows: None,
            before_sample_ids: None,
        });
    }
    Ok(out)
}
impl Tx<'_> {
    fn previous_schema_text(&self) -> Result<Option<String>, RuntimeError> {
        crate::activation::ActivationReader::previous_schema(self)
    }
}

fn bounded(s: &str) -> String {
    if s.len() <= 256 {
        return s.into();
    }
    let mut end = 256;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [truncated]", &s[..end])
}
