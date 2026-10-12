//! Release-only storage outside the active row/index namespace.
// @ref LLP 3000.000.000#2-retain-by-default — moves, restorations and deletion evidence share activation's transaction.
use super::*;
use crate::schema::{ColumnDefault, ColumnType, materialize_optional_fields};
use serde::{Deserialize, Serialize};

pub(crate) const VERSION: &str = "snapback4-release-store-2";

#[derive(Serialize, Deserialize)]
struct Column {
    kind: ColumnType,
    default: Option<ColumnDefault>,
    authoritative: bool,
}

pub(crate) fn enable(conn: &Connection) -> Result<(), RuntimeError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS _dormant_tables(table_name TEXT PRIMARY KEY, definition TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS _dormant_rows(t INTEGER NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS _dormant_columns(table_name TEXT NOT NULL,column_name TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(table_name,column_name)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS _dormant_values(t INTEGER NOT NULL,id TEXT NOT NULL,column_name TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id,column_name)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS _dormant_indexes(table_name TEXT NOT NULL,index_name TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(table_name,index_name)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS _dormant_refs(t INTEGER NOT NULL,id TEXT NOT NULL,column_name TEXT NOT NULL,parent_t INTEGER NOT NULL,parent_id TEXT NOT NULL,invalid INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(t,id,column_name,parent_t,parent_id)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS _dormant_parent ON _dormant_refs(parent_t,parent_id);
        CREATE TABLE IF NOT EXISTS _release_events(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,operation TEXT NOT NULL,release INTEGER,previous INTEGER,generation INTEGER NOT NULL,revision INTEGER NOT NULL,summary TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS _release_event_items(event INTEGER NOT NULL,path TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(event,path)) WITHOUT ROWID;")?;
    conn.execute("UPDATE _meta SET value=?1 WHERE key='version'", [VERSION])?;
    Ok(())
}

pub(super) fn enabled(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.meta("version")?.as_deref() == Some(VERSION))
}

fn authoritative(table: &Table, column: &str) -> bool {
    !table.maintained.contains_key(column) && !table.engine_field(column)
}

fn definition(tx: &Tx<'_>, name: &str, table: &Table, column: &str) -> Result<(), RuntimeError> {
    let value = Column {
        kind: table.columns[column].clone(),
        default: table.defaults.get(column).cloned(),
        authoritative: authoritative(table, column),
    };
    tx.conn().execute("INSERT INTO _dormant_columns VALUES(?1,?2,?3) ON CONFLICT(table_name,column_name) DO UPDATE SET definition=excluded.definition", params![name,column,canonical_json(&value)])?;
    Ok(())
}

fn references(kind: &ColumnType, value: &Value, out: &mut Vec<(String, String)>) {
    match (kind, value) {
        (ColumnType::Optional(inner), value) => references(inner, value, out),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, Value::Array(values)) => {
            for value in values {
                references(of, value, out);
            }
        }
        (ColumnType::Ref { table }, Value::Id(id)) => out.push((table.clone(), id.clone())),
        _ => {}
    }
}

fn capture_refs(
    tx: &Tx<'_>,
    t: i64,
    id: &str,
    column: &str,
    kind: &ColumnType,
    value: &Value,
) -> Result<(), RuntimeError> {
    tx.conn().execute(
        "DELETE FROM _dormant_refs WHERE t=?1 AND id=?2 AND column_name=?3",
        params![t, id, column],
    )?;
    let mut refs = Vec::new();
    references(kind, value, &mut refs);
    for (parent, parent_id) in refs {
        let parent_t = tx.num(&parent)?;
        let invalid = tx.get(&parent, &parent_id)?.is_none();
        tx.conn().execute(
            "INSERT OR IGNORE INTO _dormant_refs VALUES(?1,?2,?3,?4,?5,?6)",
            params![t, id, column, parent_t, parent_id, invalid],
        )?;
    }
    Ok(())
}

fn save_cell(
    tx: &Tx<'_>,
    name: &str,
    table: &Table,
    id: &str,
    column: &str,
    value: &Value,
    capture: bool,
) -> Result<(), RuntimeError> {
    let t = tx.num(name)?;
    tx.conn().execute("INSERT INTO _dormant_values VALUES(?1,?2,?3,?4) ON CONFLICT(t,id,column_name) DO UPDATE SET data=excluded.data",params![t,id,column,canonical_json(value)])?;
    if capture {
        capture_refs(tx, t, id, column, &table.columns[column], value)
    } else {
        Ok(())
    }
}

fn refuse(message: String) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_ADOPT",
        message,
    }
}

fn check_owner(tx: &Tx<'_>, name: &str, old: &Table, next: &Schema) -> Result<(), RuntimeError> {
    let Some(new) = next.table(name) else {
        return Ok(());
    };
    let evidence = || -> Result<String, RuntimeError> {
        let mut samples = super::adopt_refusals::Samples::default();
        super::activation::walk(tx, tx.num(name)?, |id, _| {
            samples.add(id, "storage ownership");
            Ok(())
        })?;
        if samples.count == 0 {
            let t = tx.num(name)?;
            let count: i64 =
                tx.conn()
                    .query_row("SELECT COUNT(*) FROM _dormant_rows WHERE t=?1", [t], |r| {
                        r.get(0)
                    })?;
            let ids = tx
                .conn()
                .prepare("SELECT id FROM _dormant_rows WHERE t=?1 ORDER BY id LIMIT 5")?
                .query_map([t], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(format!(
                "{count} affected rows; sample ids [{}]",
                ids.iter()
                    .map(|i| super::adopt_refusals::bounded(i))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        Ok(samples.describe())
    };
    if new.ephemeral.is_some() {
        return Err(refuse(format!(
            "table {name}: {}; durable storage cannot become ephemeral; deploy without {name}, run `snapback4 prune <dir> --allow-destructive`, then deploy the ephemeral table",
            evidence()?
        )));
    }
    if next.maintain_for(name).is_some() {
        return Err(refuse(format!(
            "table {name}: {}; authoritative storage cannot become a derived table; rename the derived table, or retire {name}, run `snapback4 prune <dir> --allow-destructive`, then deploy",
            evidence()?
        )));
    }
    for column in old
        .columns
        .keys()
        .filter(|column| authoritative(old, column))
    {
        if new.columns.contains_key(column) && !authoritative(new, column) {
            return Err(refuse(format!(
                "column {name}.{column}: {}; authoritative values cannot become maintained/captured values; rename the new column, or retire it, run `snapback4 prune <dir> --allow-destructive`, then deploy",
                evidence()?
            )));
        }
    }
    Ok(())
}

/// Restore all parents before checking any retained child's lifetime. Consume
/// only candidate-visible cells, so partial table restoration is reversible.
pub(super) fn transition(
    tx: &Tx<'_>,
    next: &Schema,
    previous: Option<&Schema>,
    restore: bool,
) -> Result<(), RuntimeError> {
    if !enabled(tx)? {
        return Ok(());
    }
    let whole: Vec<(String, String)> = tx
        .conn()
        .prepare("SELECT table_name,definition FROM _dormant_tables ORDER BY table_name")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut restoring = Vec::new();
    for (name, text) in &whole {
        let old: Table =
            serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))?;
        check_owner(tx, name, &old, next)?;
        if next.tables.contains_key(name) {
            restoring.push((name.clone(), old));
        }
    }
    let cells:Vec<(String,String,String)>=tx.conn().prepare("SELECT table_name,column_name,definition FROM _dormant_columns ORDER BY table_name,column_name")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<Result<_,_>>()?;
    let mut reuse: Vec<String> = restoring.iter().map(|(n, _)| n.clone()).collect();
    for (name, column, text) in &cells {
        if let Some(table) = next.table(name).filter(|t| t.columns.contains_key(column)) {
            let old: Column =
                serde_json::from_str(text).map_err(|e| RuntimeError::Store(e.to_string()))?;
            if old.authoritative && !authoritative(table, column) {
                let mut samples = super::adopt_refusals::Samples::default();
                let t = tx.num(name)?;
                let mut statement = tx.conn().prepare(
                    "SELECT id,data FROM _dormant_values WHERE t=?1 AND column_name=?2 ORDER BY id",
                )?;
                for row in statement.query_map(params![t, column], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })? {
                    let (id, value) = row?;
                    samples.add(&id, &super::adopt_refusals::bounded(&value));
                }
                return Err(refuse(format!(
                    "column {name}.{column}: {}; dormant authoritative values cannot become maintained/captured; rename the new column, or run `snapback4 prune <dir> --allow-destructive` while it is dormant, then deploy",
                    samples.describe()
                )));
            }
            reuse.push(format!("{name}.{column}"));
        }
    }
    let indexes: Vec<(String, String)> = tx
        .conn()
        .prepare(
            "SELECT table_name,index_name FROM _dormant_indexes ORDER BY table_name,index_name",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (name, index) in &indexes {
        if next
            .table(name)
            .is_some_and(|t| t.indexes.contains_key(index))
        {
            reuse.push(format!("{name}.{index}"));
        }
    }
    if !restore && !reuse.is_empty() {
        let inventory = super::release_history::inventory(tx.conn(), None, usize::MAX)?;
        return Err(refuse(format!(
            "dormant names [{}] require restoration intent; retained storage: {}; proceed with `snapback4 deploy <dir> --restore-dormant`, or `snapback4 prune <dir> --allow-destructive` before fresh creation",
            reuse.join(", "),
            canonical_json(&inventory)
        )));
    }
    if let Some(previous) = previous {
        for (name, old) in previous
            .tables
            .iter()
            .filter(|(n, t)| t.ephemeral.is_none() && previous.maintain_for(n).is_none())
        {
            check_owner(tx, name, old, next)?;
            let candidate = next.table(name);
            let removed: Vec<_> = old
                .columns
                .keys()
                .filter(|c| candidate.is_none_or(|t| !t.columns.contains_key(*c)))
                .cloned()
                .collect();
            for column in &removed {
                definition(tx, name, old, column)?;
            }
            for (index, definition) in &old.indexes {
                if candidate.is_none_or(|t| !t.indexes.contains_key(index)) {
                    tx.conn().execute("INSERT INTO _dormant_indexes VALUES(?1,?2,?3) ON CONFLICT(table_name,index_name) DO UPDATE SET definition=excluded.definition",params![name,index,canonical_json(definition)])?;
                }
            }
            if candidate.is_none() {
                tx.conn().execute("INSERT INTO _dormant_tables VALUES(?1,?2) ON CONFLICT(table_name) DO UPDATE SET definition=excluded.definition",params![name,canonical_json(old)])?;
            }
            if removed.is_empty() && candidate.is_some() {
                continue;
            }
            super::activation::walk(tx, tx.num(name)?, |id, mut row| {
                materialize_optional_fields(&mut row, old);
                if candidate.is_none() {
                    tx.conn().execute("INSERT INTO _dormant_rows VALUES(?1,?2,?3) ON CONFLICT(t,id) DO UPDATE SET data=excluded.data",params![tx.num(name)?,id,canonical_json(&row)])?;
                    for (column, kind) in &old.columns {
                        if let Ok(value) = row.field(column) {
                            capture_refs(tx, tx.num(name)?, id, column, kind, value)?;
                        }
                    }
                } else {
                    for column in &removed {
                        if let Ok(value) = row.field(column) {
                            save_cell(tx, name, old, id, column, value, true)?;
                        }
                    }
                }
                Ok(())
            })?;
            if candidate.is_none() {
                tx.conn()
                    .execute("DELETE FROM r WHERE t=?1", [tx.num(name)?])?;
                for index in old.indexes.keys() {
                    tx.conn().execute(
                        "DELETE FROM i WHERE ti=?1",
                        [tx.num(&format!("{name}.{index}"))?],
                    )?;
                }
            }
        }
    }
    for (name, old) in &restoring {
        let t = tx.num(name)?;
        let table = &next.tables[name];
        tx.conn().execute(
            "INSERT INTO r(t,id,data) SELECT t,id,data FROM _dormant_rows WHERE t=?1",
            [t],
        )?;
        for column in old
            .columns
            .keys()
            .filter(|c| !table.columns.contains_key(*c))
        {
            definition(tx, name, old, column)?;
        }
        super::activation::walk(tx, t, |id, mut row| {
            let removed: Vec<_> = row
                .as_object()?
                .iter()
                .filter(|(c, _)| !table.columns.contains_key(*c))
                .map(|(c, v)| (c.clone(), v.clone()))
                .collect();
            for (column, value) in removed {
                if old.columns.contains_key(&column) {
                    save_cell(tx, name, old, id, &column, &value, false)?;
                }
            }
            if let Value::Row(fields) | Value::Map(fields) = &mut row {
                fields.retain(|c, _| table.columns.contains_key(c));
            }
            tx.conn().execute(
                "UPDATE r SET data=?1 WHERE t=?2 AND id=?3",
                params![canonical_json(&row), t, id],
            )?;
            Ok(())
        })?;
        tx.conn()
            .execute("DELETE FROM _dormant_rows WHERE t=?1", [t])?;
        tx.conn()
            .execute("DELETE FROM _dormant_tables WHERE table_name=?1", [name])?;
    }
    for (name, table) in next.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
        let t = tx.num(name)?;
        if !cells
            .iter()
            .any(|(n, c, _)| n == name && table.columns.contains_key(c))
            && !restoring.iter().any(|(n, _)| n == name)
        {
            continue;
        }
        super::activation::walk(tx, t, |id, mut row| {
            let values: Vec<(String, String)> = tx
                .conn()
                .prepare_cached(
                    "SELECT column_name,data FROM _dormant_values WHERE t=?1 AND id=?2",
                )?
                .query_map(params![t, id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            for (column, data) in values
                .into_iter()
                .filter(|(c, _)| table.columns.contains_key(c))
            {
                let value: Value =
                    serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                match &mut row {
                    Value::Row(f) | Value::Map(f) => {
                        f.insert(column, value);
                    }
                    _ => {}
                }
            }
            tx.conn().execute(
                "UPDATE r SET data=?1 WHERE t=?2 AND id=?3",
                params![canonical_json(&row), t, id],
            )?;
            Ok(())
        })?;
    }
    check_references(tx, next)?;
    for (name, table) in next.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
        let t = tx.num(name)?;
        for column in table.columns.keys() {
            tx.conn().execute(
                "DELETE FROM _dormant_values WHERE t=?1 AND column_name=?2",
                params![t, column],
            )?;
            tx.conn().execute(
                "DELETE FROM _dormant_refs WHERE t=?1 AND column_name=?2",
                params![t, column],
            )?;
            tx.conn().execute(
                "DELETE FROM _dormant_columns WHERE table_name=?1 AND column_name=?2",
                params![name, column],
            )?;
        }
        for index in table.indexes.keys() {
            tx.conn().execute(
                "DELETE FROM _dormant_indexes WHERE table_name=?1 AND index_name=?2",
                params![name, index],
            )?;
        }
    }
    Ok(())
}

fn check_references(tx: &Tx<'_>, next: &Schema) -> Result<(), RuntimeError> {
    for (name, table) in next.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
        let t = tx.num(name)?;
        let mut bad = super::adopt_refusals::Samples::default();
        let mut statement=tx.conn().prepare("SELECT DISTINCT d.id,d.column_name,d.parent_id,d.invalid FROM _dormant_refs d LEFT JOIN r p ON p.t=d.parent_t AND p.id=d.parent_id WHERE d.t=?1 AND (d.invalid=1 OR p.id IS NULL) ORDER BY d.id,d.column_name")?;
        let mut rows = statement.query([t])?;
        while let Some(row) = rows.next()? {
            let column: String = row.get(1)?;
            if table.columns.contains_key(&column) {
                bad.add(
                    &row.get::<_, String>(0)?,
                    &format!(
                        "{column} → parent {} (deleted/reused/missing)",
                        row.get::<_, String>(2)?
                    ),
                );
            }
        }
        if bad.count > 0 {
            return Err(refuse(format!(
                "table {name}: {}; dormant references cannot acquire another parent lifetime; keep the current release and repair the named references, or prune the dormant storage before restoring",
                bad.describe()
            )));
        }
        if let Some(through) = &table.through {
            let restored: bool = tx.conn().query_row(
                "SELECT EXISTS(SELECT 1 FROM _dormant_refs WHERE t=?1 AND column_name=?2)",
                params![t, through.reference],
                |r| r.get(0),
            )?;
            if restored {
                let mut bad = super::adopt_refusals::Samples::default();
                super::activation::walk(tx, t, |id, row| {
                    if let Ok(Value::Id(parent_id)) = row.field(&through.reference) {
                        if let Some(parent) = tx.get(&through.parent, parent_id)? {
                            let parent =
                                crate::schema::row_image(&parent, &next.tables[&through.parent]);
                            if through.fields.iter().any(|(capture, field)| {
                                row.field(capture).ok() != parent.field(field).ok()
                            }) {
                                bad.add(id,&format!("{}.{} parent {parent_id}: captured audience/identity changed",name,through.reference));
                            }
                        }
                    }
                    Ok(())
                })?;
                if bad.count > 0 {
                    return Err(refuse(format!(
                        "table {name}: {}; restore cannot recapture a changed audience; restore its original parent audience or prune these dormant rows",
                        bad.describe()
                    )));
                }
            }
        }
    }
    Ok(())
}

pub(super) fn delete(tx: &Tx<'_>, t: i64, id: &str, name: &str) -> Result<(), RuntimeError> {
    if !enabled(tx)? {
        return Ok(());
    }
    tx.conn().execute(
        "UPDATE _dormant_refs SET invalid=1 WHERE parent_t=?1 AND parent_id=?2",
        params![t, id],
    )?;
    tx.conn().execute("UPDATE _assets SET released_at=COALESCE(released_at,?3) WHERE home_table=?1 AND home_id=?2 AND (home_column IN (SELECT column_name FROM _dormant_values WHERE t=?4 AND id=?2))",params![name,id,crate::now_ms(),t])?;
    tx.conn().execute(
        "DELETE FROM _dormant_values WHERE t=?1 AND id=?2",
        params![t, id],
    )?;
    tx.conn().execute(
        "DELETE FROM _dormant_rows WHERE t=?1 AND id=?2",
        params![t, id],
    )?;
    tx.conn().execute(
        "DELETE FROM _dormant_refs WHERE t=?1 AND id=?2",
        params![t, id],
    )?;
    Ok(())
}

pub(super) fn holds_home(tx: &Tx<'_>, table: &str, column: &str) -> Result<bool, RuntimeError> {
    if !enabled(tx)? {
        return Ok(false);
    }
    Ok(tx.conn().query_row("SELECT EXISTS(SELECT 1 FROM _dormant_tables WHERE table_name=?1) OR EXISTS(SELECT 1 FROM _dormant_columns WHERE table_name=?1 AND column_name=?2)",params![table,column],|r|r.get(0))?)
}
