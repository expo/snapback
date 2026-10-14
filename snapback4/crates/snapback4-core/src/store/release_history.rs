//! Database-authoritative release history and explicit dormant pruning.
// @ref LLP 3000.000.000#4-explicit-pruning-and-audit — no implicit collector or unaudited data loss.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DormantItem {
    /// Stable cursor; column/index names may coincide.
    pub key: String,
    pub path: String,
    pub kind: String,
    pub action: String,
    pub rows: u64,
    pub bytes: u64,
    pub asset_bytes: u64,
    pub sample_ids: Vec<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub before_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub after_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub restored_rows:Option<u64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub before_sample_ids:Option<Vec<String>>,
}

impl DormantItem {
    pub fn unit(&self) -> &'static str {
        match (self.kind.as_str(), self.rows) { ("column", 1) => "cell", ("column", _) => "cells", ("index", 1) => "entry", ("index", _) => "entries", (_, 1) => "row", _ => "rows" }
    }
}

impl Store {
    /// Values presently in active rows, independently of table population or other columns.
    pub fn rollback_incompatible_values(&self, current: &Schema, target: &Schema, name: &str, column: &str) -> Result<(u64, Vec<String>), RuntimeError> {
        let tx = self.authority_transaction()?;
        let table = &target.tables[name];
        let kind = &table.columns[column];
        if table.engine_field(column) || table.maintained.contains_key(column) { return Ok((0, Vec::new())); }
        let mut count = 0;
        let mut samples = std::collections::BTreeSet::new();
        let mut statement = tx.conn().prepare("SELECT data FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1) ORDER BY id")?;
        for data in statement.query_map([name], |r| r.get::<_, String>(0))? {
            let mut row: Value = serde_json::from_str(&data?).map_err(|e| RuntimeError::Store(e.to_string()))?;
            crate::schema::materialize_optional_fields(&mut row, &current.tables[name]);
            if let Ok(value) = row.field(column)
                && super::narrowed::incompatible_column(&tx, table, name, column, kind, value)? {
                count += 1;
                if samples.len() < 5 {
                    let text = match value { Value::String(s) => format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n").replace('\r', "\\r")), _ => canonical_json(value) };
                    samples.insert(super::adopt_refusals::bounded(&text));
                }
            }
        }
        Ok((count, samples.into_iter().collect()))
    }
}

fn sql_number(n: u64) -> Result<i64, RuntimeError> {
    i64::try_from(n).map_err(|_| {
        RuntimeError::Generation("release counter exceeds SQLite integer range".into())
    })
}

pub(super) fn present(conn: &Connection) -> Result<bool, RuntimeError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_dormant_tables')",
        [],
        |r| r.get(0),
    )?)
}
pub(crate) fn inventory(
    conn: &Connection,
    after: Option<&str>,
    limit: usize,
) -> Result<Vec<DormantItem>, RuntimeError> {
    if !present(conn)? {
        return Ok(Vec::new());
    }
    let narrowed = if super::narrowed::present(conn)? {
        " UNION ALL SELECT c.name,'rows',c.name,NULL FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t GROUP BY n.t "
    } else {""};
    let query=format!("SELECT path,kind,table_name,column_name FROM (
        SELECT table_name AS path,'table' AS kind,table_name,NULL AS column_name FROM _dormant_tables
        UNION ALL SELECT table_name||'.'||column_name,'column',table_name,column_name FROM _dormant_columns c WHERE table_name NOT IN (SELECT table_name FROM _dormant_tables) OR EXISTS(SELECT 1 FROM _dormant_values v JOIN _catalog t ON t.num=v.t WHERE t.name=c.table_name AND v.column_name=c.column_name)
        UNION ALL SELECT table_name||'.'||index_name,'index',table_name,index_name FROM _dormant_indexes {narrowed})
        WHERE (?1 IS NULL OR kind||':'||path>?1) ORDER BY kind||':'||path LIMIT ?2");
    let mut statement=conn.prepare(&query)?;
    let items: Vec<(String, String, String, Option<String>)> = statement
        .query_map(
            params![after, i64::try_from(limit).unwrap_or(i64::MAX)],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (path, kind, name, column) in items {
        let t: Option<i64> = conn
            .query_row("SELECT num FROM _catalog WHERE name=?1", [&name], |r| {
                r.get(0)
            })
            .optional()?;
        let Some(t) = t else { continue };
        let (mut count,bytes):(u64,u64)=match kind.as_str(){
            "table"=>conn.query_row("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0) FROM _dormant_rows WHERE t=?1",[t],|r|Ok((r.get::<_,i64>(0)? as u64,r.get::<_,i64>(1)? as u64)))?,
            "rows"=>conn.query_row("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0) FROM _dormant_narrow_rows WHERE t=?1",[t],|r|Ok((r.get::<_,i64>(0)? as u64,r.get::<_,i64>(1)? as u64)))?,
            "column"=>conn.query_row("SELECT COUNT(*),COALESCE(SUM(octet_length(id)+octet_length(data)),0) FROM _dormant_values WHERE t=?1 AND column_name=?2",params![t,column],|r|Ok((r.get::<_,i64>(0)? as u64,r.get::<_,i64>(1)? as u64)))?,
            _=>conn.query_row("SELECT COUNT(*),0 FROM (SELECT id FROM r WHERE t=?1 UNION SELECT id FROM _dormant_rows WHERE t=?1)",[t],|r|Ok((r.get::<_,i64>(0)? as u64,r.get::<_,i64>(1)? as u64)))?,
        };
        let query = match kind.as_str() {
            "rows" => "SELECT id FROM _dormant_narrow_rows WHERE t=?1 AND ?2 IS NULL ORDER BY id LIMIT 5",
            "table" => "SELECT id FROM _dormant_rows WHERE t=?1 AND ?2 IS NULL ORDER BY id LIMIT 5",
            "column" => {
                "SELECT id FROM _dormant_values WHERE t=?1 AND column_name=?2 ORDER BY id LIMIT 5"
            }
            _ => {
                "SELECT id FROM (SELECT id FROM r WHERE t=?1 UNION SELECT id FROM _dormant_rows WHERE t=?1) WHERE ?2 IS NOT NULL ORDER BY id LIMIT 5"
            }
        };
        let mut ids = conn
            .prepare(query)?
            .query_map(params![t, column], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|id| super::adopt_refusals::bounded(&id))
            .collect();
        if kind == "index" {
            (count, ids) = index_entries(conn, t, &name, column.as_deref().unwrap())?;
        }
        let asset_bytes = if kind == "index" {
            0
        } else {
            let selector=match kind.as_str(){
                "rows"=>"EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=?3 AND n.id=_assets.home_id)",
                "column"=>"EXISTS(SELECT 1 FROM _dormant_values v WHERE v.t=?3 AND v.id=_assets.home_id AND v.column_name=_assets.home_column)",
                _=>"?3 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dormant_values v WHERE v.t=?3 AND v.id=_assets.home_id AND v.column_name=_assets.home_column)",
            };
            conn.query_row(&format!("SELECT COALESCE(SUM(bytes),0) FROM _assets WHERE home_table=?1 AND (?2 IS NULL OR home_column=?2) AND released_at IS NULL AND {selector}"),params![name,if kind=="table" || kind=="rows" {None}else{column.as_deref()},t],|r|r.get::<_,i64>(0).map(|n|n as u64))?
        };
        out.push(DormantItem {
            key: format!("{kind}:{path}"),
            path,
            kind,
            action: "dormant".into(),
            rows: count,
            bytes,
            asset_bytes,
            sample_ids: ids,
            before_rows:None,after_rows:None,restored_rows:None,before_sample_ids:None,
        });
    }
    Ok(out)
}

/// Retained definitions represent logical entries, rebuilt on restoration.
/// A words index has zero or many entries per image; a row count is not its size.
fn index_entries(conn: &Connection, t: i64, table: &str, index: &str) -> Result<(u64, Vec<String>), RuntimeError> {
    let definition: String = conn.query_row("SELECT definition FROM _dormant_indexes WHERE table_name=?1 AND index_name=?2", params![table, index], |r| r.get(0))?;
    let index: crate::schema::Index = serde_json::from_str(&definition).map_err(|e| RuntimeError::Store(e.to_string()))?;
    let schema: Option<String> = conn.query_row("SELECT schema FROM _generations WHERE generation=(SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation')", [], |r| r.get(0)).optional()?;
    let schema: Option<Schema> = schema.map(|s| serde_json::from_str(&s).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?;
    let query = if super::narrowed::present(conn)? {
        "SELECT id,data FROM r WHERE t=?1 UNION ALL SELECT id,data FROM _dormant_rows WHERE t=?1 UNION ALL SELECT id,data FROM _dormant_narrow_rows WHERE t=?1 ORDER BY id"
    } else { "SELECT id,data FROM r WHERE t=?1 UNION ALL SELECT id,data FROM _dormant_rows WHERE t=?1 ORDER BY id" };
    let mut count = 0;
    let mut samples = std::collections::BTreeSet::new();
    let mut statement = conn.prepare(query)?;
    for image in statement.query_map([t], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (id, data) = image?;
        let mut row: Value = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
        if let Some(table) = schema.as_ref().and_then(|s| s.table(table)) { crate::schema::materialize_optional_fields(&mut row, table); }
        for cell in conn.prepare("SELECT column_name,data FROM _dormant_values WHERE t=?1 AND id=?2")?.query_map(params![t, id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (column, value) = cell?;
            if let Value::Row(fields) | Value::Map(fields) = &mut row {
                fields.entry(column).or_insert(serde_json::from_str(&value).map_err(|e| RuntimeError::Store(e.to_string()))?);
            }
        }
        let entries = crate::rows::index_keys(&index, &row, &id).len() as u64;
        count += entries;
        if entries > 0 && samples.len() < 5 { samples.insert(super::adopt_refusals::bounded(&id)); }
    }
    Ok((count, samples.into_iter().collect()))
}

// @ref LLP 3000.000.000#91-per-row-narrowed-value-dormancy — only rows surviving every activation phase count as restored.
pub(crate) fn finalize_restorations(tx:&Tx<'_>) -> Result<(),RuntimeError> {
    let entries=tx.conn().prepare("SELECT key,value FROM _meta WHERE key LIKE 'activation_narrowed_restored_ids:%' OR key LIKE 'activation_column_restored_ids:%' OR key LIKE 'activation_table_restored_ids:%'")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
    let mut narrowed=0u64;
    for (key,ids) in entries {
        let (prefix,path)=key.split_once(':').expect("activation restoration key");
        let table=if prefix=="activation_column_restored_ids" {path.split_once('.').expect("column path").0} else {path};
        let count:u64=tx.conn().query_row("SELECT COUNT(*) FROM r WHERE t=?1 AND id IN (SELECT value FROM json_each(?2))",params![tx.num(table)?,ids],|r|r.get::<_,i64>(0).map(|n|n as u64))?;
        tx.set_meta(&format!("{}:{path}",prefix.trim_end_matches("_ids")),&count.to_string())?;
        if prefix=="activation_narrowed_restored_ids" {narrowed+=count;}
    }
    tx.set_meta("activation_narrowed_restored",&narrowed.to_string())?;
    Ok(())
}

pub(crate) fn event(
    tx: &Tx<'_>,
    operation: &str,
    release: Option<u64>,
    previous: Option<u64>,
    summary: serde_json::Value,
    items: &[DormantItem],
) -> Result<u64, RuntimeError> {
    let revision = tx
        .meta("release_revision")?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| RuntimeError::Generation("release revision exhausted".into()))?;
    tx.set_meta("release_revision", &revision.to_string())?;
    let generation = tx
        .meta("generation")?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1);
    tx.conn().execute("INSERT INTO _release_events(at,operation,release,previous,generation,revision,summary) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![crate::now_ms(),operation,release.map(sql_number).transpose()?,previous.map(sql_number).transpose()?,sql_number(generation)?,sql_number(revision)?,summary.to_string()])?;
    let id = tx.conn().last_insert_rowid();
    for item in items {
        tx.conn().execute(
            "INSERT INTO _release_event_items VALUES(?1,?2,?3)",
            params![id, item.key, canonical_json(item)],
        )?;
    }
    Ok(revision)
}

impl Store {
    pub fn dormant_inventory(
        &mut self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DormantItem>, RuntimeError> {
        let tx = self.read_transaction()?;
        let items = inventory(tx.conn(), after, limit)?;
        tx.rollback()?;
        Ok(items)
    }
    /// One snapshot: current identity, bounded history and storage inventories.
    pub fn release_status(
        &mut self,
        after: u64,
        items_after: Option<&str>,
        event_id: Option<u64>,
    ) -> Result<serde_json::Value, RuntimeError> {
        let tx = self.read_transaction()?;
        let mut events = Vec::new();
        let mut inventory_page = Vec::<serde_json::Value>::new();
        if present(tx.conn())? {
            let mut s=tx.conn().prepare("SELECT id,at,operation,release,previous,generation,revision,summary FROM _release_events WHERE id>?1 ORDER BY id LIMIT 16")?;
            let mut rows = s.query([sql_number(after)?])?;
            while let Some(r) = rows.next()? {
                events.push(serde_json::json!({"id":r.get::<_,i64>(0)?,"at":r.get::<_,i64>(1)?,"operation":r.get::<_,String>(2)?,"release":r.get::<_,Option<i64>>(3)?,"previous":r.get::<_,Option<i64>>(4)?,"generation":r.get::<_,i64>(5)?,"revision":r.get::<_,i64>(6)?,"summary":serde_json::from_str::<serde_json::Value>(&r.get::<_,String>(7)?).map_err(|e|RuntimeError::Store(e.to_string()))?}));
            }
            if let Some(event) = event_id {
                let mut s=tx.conn().prepare("SELECT detail FROM _release_event_items WHERE event=?1 AND (?2 IS NULL OR path>?2) ORDER BY path LIMIT 16")?;
                for item in s.query_map(params![sql_number(event)?, items_after], |r| {
                    r.get::<_, String>(0)
                })? {
                    inventory_page.push(
                        serde_json::from_str(&item?)
                            .map_err(|e| RuntimeError::Store(e.to_string()))?,
                    );
                }
            } else {
                inventory_page = inventory(tx.conn(), items_after, 16)?
                    .into_iter()
                    .map(|i| serde_json::to_value(i).unwrap())
                    .collect();
            }
        }
        let workers:Vec<(String,String)>=tx.conn().prepare("SELECT key,value FROM _meta WHERE key='worker:status' OR key LIKE 'worker:status:%' ORDER BY key LIMIT 16")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<_,_>>()?;
        let previous_active: Option<u64> = if present(tx.conn())? {tx.conn().query_row("SELECT previous FROM _release_events WHERE release IS NOT NULL AND previous != release AND operation != 'prune' ORDER BY id DESC LIMIT 1",[],|r|r.get::<_,Option<i64>>(0)).optional()?.flatten().map(|n|n as u64)} else {None};
        let result = serde_json::json!({"previous_active":previous_active,"release":tx.meta("release")?.and_then(|v|v.parse::<u64>().ok()),"revision":tx.meta("release_revision")?.and_then(|v|v.parse::<u64>().ok()).unwrap_or(0),"generation":tx.meta("generation")?.and_then(|v|v.parse::<u64>().ok()).unwrap_or(1),"native_digest":tx.meta("release_native_digest")?,"events_after":events.last().map(|e|e["id"].clone()),"events":events,"items_after":inventory_page.last().map(|i|i["key"].clone()),"items":inventory_page,"event":event_id,"workers":workers});
        tx.rollback()?;
        Ok(result)
    }
    pub fn prune_dormant(
        &mut self,
        confirm: bool,
        expected_revision: Option<u64>,
    ) -> Result<serde_json::Value, RuntimeError> {
        let tx = self.transaction()?;
        let held = tx
            .meta("release_revision")?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        if expected_revision.is_some_and(|n| n != held) {
            return Err(RuntimeError::Generation(
                "release revision changed; run releases and retry prune".into(),
            ));
        }
        let items = inventory(tx.conn(), None, usize::MAX)?;
        if !confirm {
            tx.rollback()?;
            return Ok(
                serde_json::json!({"pruned":false,"items":items,"rewrite":"snapback4 prune <dir> --allow-destructive"}),
            );
        }
        if !present(tx.conn())? {
            tx.rollback()?;
            return Ok(serde_json::json!({"pruned":true,"items":[],"revision":held}));
        }
        // Release only dormant homes; active application data is untouched.
        tx.conn().execute("UPDATE _assets SET released_at=COALESCE(released_at,?1) WHERE home_table IN (SELECT table_name FROM _dormant_tables) OR EXISTS(SELECT 1 FROM _dormant_values v JOIN _catalog c ON c.num=v.t WHERE c.name=_assets.home_table AND v.column_name=_assets.home_column AND v.id=_assets.home_id)",[crate::now_ms()])?;
        if super::narrowed::present(tx.conn())? {
            tx.conn().execute("UPDATE _assets SET released_at=COALESCE(released_at,?1) WHERE EXISTS(SELECT 1 FROM _dormant_narrow_rows n JOIN _catalog c ON c.num=n.t WHERE c.name=_assets.home_table AND n.id=_assets.home_id)",[crate::now_ms()])?;
            tx.conn().execute("DELETE FROM _dormant_values WHERE EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=_dormant_values.t AND n.id=_dormant_values.id)",[])?;
            tx.conn().execute("DELETE FROM _dormant_narrow_rows",[])?;
        }
        let revision = event(
            &tx,
            "prune",
            tx.meta("release")?.and_then(|v| v.parse().ok()),
            None,
            serde_json::json!({"dropped_items":items.len(),"bytes":items.iter().map(|i|i.bytes).sum::<u64>(),"asset_bytes":items.iter().map(|i|i.asset_bytes).sum::<u64>()}),
            &items,
        )?;
        let event_id = tx.conn().last_insert_rowid();
        tx.conn().execute_batch("DELETE FROM _dormant_values;DELETE FROM _dormant_rows;DELETE FROM _dormant_refs;DELETE FROM _dormant_columns;DELETE FROM _dormant_indexes;DELETE FROM _dormant_tables;")?;
        tx.commit()?;
        Ok(serde_json::json!({"pruned":true,"items":items,"revision":revision,"event":event_id}))
    }
}
