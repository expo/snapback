//! Enforce a registered view's hiding policy inside its activation transaction.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — snapshots advise; the writer enforces the same closure.
use super::*;
use crate::Program;
use crate::{
    engine::release::VisibilityPolicy,
    meter::{Ceilings, Cut, Meter},
    schema::ColumnType,
};
use std::collections::BTreeSet;
fn refuse(s: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_ADOPT",
        message: s.into(),
    }
}
pub(super) fn capture(conn: &Connection) -> Result<(), RuntimeError> {
    let policy: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key='activation_visibility'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if policy.is_none() {
        return Ok(());
    }
    conn.execute_batch("CREATE TEMP TABLE _rollback_view_before AS SELECT c.name,r.t,r.id,r.data FROM r JOIN _catalog c ON c.num=r.t; CREATE INDEX temp._rollback_view_before_id ON _rollback_view_before(name,id);")?;
    Ok(())
}
fn clear(conn:&Connection)->Result<(),RuntimeError>{
    conn.execute_batch("DROP TABLE temp._rollback_view_before;")?;
    conn.execute("DELETE FROM _meta WHERE key='activation_visibility'", [])?;
    Ok(())
}
fn allowed(
    tx: &Tx<'_>,
    schema: &Schema,
    policy: &VisibilityPolicy,
    name: &str,
    id: &str,
    row: &Value,
    seen: &mut BTreeSet<(String, String)>,
    meter: &mut Meter,
) -> Result<bool, RuntimeError> {
    meter.step(1)?;
    meter.heap(
        row.retained_heap_bytes()
            .saturating_mul(2)
            .saturating_add(256),
    )?;
    if !seen.insert((name.into(), id.into())) {
        return Ok(false);
    }
    if policy
        .hides
        .iter()
        .any(|p| p.table == name && row.field(&p.column).map_or(true, |v| v == &Value::Null))
    {
        return Ok(true);
    }
    if let Some(table) = schema.table(name) {
        for (c, kind) in &table.columns {
            let ColumnType::Ref { table: parent } = kind.required() else {
                continue;
            };
            let Ok(Value::Id(parent_id)) = row.field(c) else {
                continue;
            };
            let invalid:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_refs d WHERE d.t=(SELECT p.t FROM temp._rollback_view_before p WHERE p.name=?1 AND p.id=?2) AND d.id=?2 AND d.column_name=?3 AND d.invalid<>0)",params![name,id,c],|r|r.get(0))?;
            if invalid {
                continue;
            }
            let data:Option<String>=tx.conn().query_row("SELECT p.data FROM temp._rollback_view_before p WHERE p.name=?1 AND p.id=?2 AND NOT EXISTS(SELECT 1 FROM r WHERE r.t=p.t AND r.id=p.id) AND (EXISTS(SELECT 1 FROM _dormant_narrow_rows d WHERE d.t=p.t AND d.id=p.id) OR EXISTS(SELECT 1 FROM _dormant_rows d WHERE d.t=p.t AND d.id=p.id))",params![parent,parent_id],|r|r.get(0)).optional()?;
            if let Some(data) = data {
                meter.heap((data.len() as u64).saturating_mul(64))?;
                let row: Value = serde_json::from_str(&data).map_err(|e| refuse(e.to_string()))?;
                if allowed(tx, schema, policy, parent, parent_id, &row, seen, meter)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
pub(super) fn validate(
    tx: &Tx<'_>,
    next: &Schema,
    programs: &BTreeMap<String, Program>,
) -> Result<(), RuntimeError> {
    let Some(text) = tx.meta("activation_visibility")? else {
        return Ok(());
    };
    let policy: VisibilityPolicy =
        serde_json::from_str(&text).map_err(|e| refuse(e.to_string()))?;
    let source:Option<String>=tx.conn().query_row("SELECT schema FROM _generations WHERE generation=(SELECT value FROM _meta WHERE key='generation')",[],|r|r.get(0)).optional()?;
    let source: Schema = source
        .map(|s| serde_json::from_str(&s).map_err(|e| refuse(e.to_string())))
        .transpose()?
        .unwrap_or_default();
    // @ref LLP 3000.000.000#22-wave-29-release-identity-rel2 — a validated singleton reverse projection may establish a native child receipt; every child must be represented.
    for e in source.extractions.iter().filter(|e|!e.each&&!next.extractions.contains(e)
        &&next.table(&e.child).is_none()&&next.table(&e.parent).is_some_and(|t|e.fields.values().any(|c|t.columns.contains_key(c)))) {
        let definition=super::extractions::key(tx,e)?;
        // Reverse projection must cover every parent as well as every child.
        // This writer-time check also catches a parent inserted after preview,
        // whose missing optional payload would otherwise be invented as null.
        let missing_parent:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM temp._rollback_view_before p WHERE p.name=?1 AND NOT EXISTS(SELECT 1 FROM _extraction_rows r WHERE r.definition=?2 AND r.parent_t=p.t AND r.parent_id=p.id))",params![e.parent,definition],|r|r.get(0))?;
        if missing_parent {return Err(refuse(format!("rollback cannot invent extracted cells for {} parents without a validated child projection; retain the current child population in a bridge",e.parent)));}
        let unowned:bool=tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM temp._rollback_view_before p WHERE p.name=?1 AND NOT EXISTS(SELECT 1 FROM _extraction_rows r WHERE r.definition=?2 AND r.child_t=p.t AND r.child_id=p.id))",params![e.child,definition],|r|r.get(0))?;
        if unowned {return Err(refuse(format!("rollback would hide independent {} children without a validated parent projection; retain the current child population in a bridge",e.child)));}
    }
    let mut hidden = BTreeSet::new();
    let mut bad = super::adopt_refusals::Samples::default();
    let mut q=tx.conn().prepare("SELECT p.name,p.id,octet_length(p.data),p.data,c.name FROM temp._rollback_view_before p JOIN _catalog c ON c.num=p.t WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.t=p.t AND r.id=p.id) AND (EXISTS(SELECT 1 FROM _dormant_narrow_rows d WHERE d.t=p.t AND d.id=p.id) OR EXISTS(SELECT 1 FROM _dormant_rows d WHERE d.t=p.t AND d.id=p.id)) ORDER BY p.name,p.id")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let target: String = r.get(4)?;
        hidden.insert(target.clone());
        if next.table(&target).is_none() {
            continue;
        }
        let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
        meter.heap(
            (r.get::<_, i64>(2)?.max(0) as u64)
                .saturating_mul(64)
                .saturating_add(8192),
        )?;
        let name: String = r.get(0)?;
        let id: String = r.get(1)?;
        let data: String = r.get(3)?;
        let row: Value = serde_json::from_str(&data).map_err(|e| refuse(e.to_string()))?;
        if !allowed(
            tx,
            &source,
            &policy,
            &name,
            &id,
            &row,
            &mut BTreeSet::new(),
            &mut meter,
        )? {
            bad.add(
                &id,
                &format!("{name}: hidden outside the source-declared null policy"),
            );
        }
    }
    if bad.count > 0 {
        return Err(refuse(format!(
            "rollback view refuses unacknowledged hiding: {}; preserve these rows in a bridge or declare truthful down",
            bad.describe()
        )));
    }
    super::rollback_guard_population::validate(next, programs, &hidden)?;
    drop(rows);
    drop(q);
    clear(tx.conn())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn row_before_image_cleans_up_after_commit_and_rollback() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE _meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE r(t INTEGER,id TEXT,data TEXT); CREATE TABLE _catalog(name TEXT,num INTEGER); INSERT INTO _meta VALUES('activation_visibility','{}'); INSERT INTO _catalog VALUES('items',1); INSERT INTO r VALUES(1,'kept','{}'); BEGIN;").unwrap();
        capture(&conn).unwrap();conn.execute_batch("INSERT INTO r VALUES(1,'new','{}');").unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM temp._rollback_view_before",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        clear(&conn).unwrap();conn.execute_batch("COMMIT; INSERT INTO _meta VALUES('activation_visibility','{}'); BEGIN;").unwrap();
        capture(&conn).unwrap();assert_eq!(conn.query_row("SELECT COUNT(*) FROM temp._rollback_view_before",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        conn.execute_batch("ROLLBACK;").unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM temp.sqlite_schema WHERE name='_rollback_view_before'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
}
