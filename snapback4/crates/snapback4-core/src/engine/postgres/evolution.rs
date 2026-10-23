//! EV-1 moves ordinary storage without changing its interpretation or lifetime.
// @ref LLP 3000.009.001.000#3.5 — all moves, restoration and deletion evidence share activation's transaction.
use super::store::{Tx, decode};
use crate::{
    RuntimeError, Schema, Value,
    schema::{
        ColumnDefault, ColumnType, Constraint, Table, materialize_optional_fields,
        references::OnDelete,
    },
    value::canonical_json,
};
use serde::{Deserialize, Serialize};

#[derive(PartialEq, Serialize, Deserialize)]
pub(super) struct Column {
    pub kind: ColumnType,
    pub default: Option<ColumnDefault>,
    authoritative: bool,
    capture_source: Option<Table>,
    pub on_delete: Option<OnDelete>,
    pub constraints: Vec<Constraint>,
}
impl Column {
    // @ref LLP 3000.009.001.000#3.5 — a retired column retains interpretation and lifetime, not only its value type.
    pub(super) fn retained(table: &Table, column: &str) -> Self {
        Self {
            kind: table.columns[column].clone(),
            default: table.defaults.get(column).cloned(),
            authoritative: !table.maintained.contains_key(column) && !table.engine_field(column),
            capture_source: table.engine_field(column).then(|| table.clone()),
            on_delete: table.on_delete.get(column).copied(),
            constraints: table
                .constraints
                .iter()
                .filter(|c| matches!(c, Constraint::Text {field, ..} if field==column))
                .cloned()
                .collect(),
        }
    }
}
fn refusal(message: impl Into<String>) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_ADOPT",
        message: message.into(),
    }
}

/// A bounded cursor, including for index inventory; no population-sized images.
pub(super) fn walk(
    tx: &Tx<'_>,
    relation: &'static str,
    name: &str,
    mut visit: impl FnMut(&str, Value) -> Result<(), RuntimeError>,
) -> Result<(), RuntimeError> {
    let sql = match relation {
        "r" => {
            "SELECT id,data FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        "_dormant_narrow_rows" => {
            "SELECT id,data FROM _dormant_narrow_rows WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        "_dormant_rows" => {
            "SELECT id,data FROM _dormant_rows WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        _ => unreachable!(),
    };
    let sizes = match relation {
        "r" => {
            "SELECT octet_length(id),octet_length(data) FROM r WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        "_dormant_narrow_rows" => {
            "SELECT octet_length(id),octet_length(data)+64*octet_length(definition) FROM _dormant_narrow_rows WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        "_dormant_rows" => {
            "SELECT octet_length(id),octet_length(data) FROM _dormant_rows WHERE t=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT 1"
        }
        _ => unreachable!(),
    };
    let mut after: Option<String> = None;
    loop {
        use crate::{
            meter::{Ceilings, Cut, Meter},
            rows::{adoption, word_heap as heap},
        };
        let lengths = tx.query(sizes, &[&name, &after])?;
        let Some(length) = lengths.first() else {
            return Ok(());
        };
        // Reserve driver/text coexistence before fetching the payload, then
        // use the same decoder admission as the SQLite activation walker.
        let mut meter = Meter::new(Ceilings::job(), Cut::Abort);
        meter.at("adopt stored rows");
        meter.heap(
            8192 + after.as_deref().map_or(0, heap::text)
                + 3 * (heap::allocation(length.get::<_, i32>(0) as usize)
                    + heap::allocation(length.get::<_, i32>(1) as usize))
                + 64
                + heap::slots::<(String, String)>(1),
        )?;
        let rows = tx.query(sql, &[&name, &after])?;
        let Some(row) = rows.first() else {
            return Ok(());
        };
        let id: String = row.get(0);
        let data: &str = row.get(1);
        adoption::page_fits(
            std::iter::once(data),
            &mut meter,
            adoption::Work::DECODE,
            None,
        )?;
        adoption::charge(&mut meter, adoption::decode_bytes(data))?;
        let image = decode(data)?;
        visit(&id, image)?;
        after = Some(id);
    }
}
pub(super) fn definition(tx: &Tx<'_>, name: &str, table: &Table, column: &str) -> Result<(), RuntimeError> {
    let definition = canonical_json(&Column::retained(table, column));
    tx.execute("INSERT INTO _dormant_columns(table_name,column_name,definition) VALUES($1,$2,$3) ON CONFLICT(table_name,column_name) DO UPDATE SET definition=excluded.definition", &[&name,&column,&definition])?;
    Ok(())
}
pub(super) fn refs(kind: &ColumnType, value: &Value, out: &mut Vec<(String, String)>) {
    match (kind, value) {
        (ColumnType::Optional(inner), value) => refs(inner, value, out),
        (ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }, Value::Array(values)) => {
            for v in values {
                refs(of, v, out);
            }
        }
        (ColumnType::Ref { table }, Value::Id(id)) => out.push((table.clone(), id.clone())),
        _ => {}
    }
}
pub(super) fn capture(
    tx: &Tx<'_>,
    name: &str,
    id: &str,
    column: &str,
    kind: &ColumnType,
    value: &Value,
) -> Result<(), RuntimeError> {
    tx.execute(
        "DELETE FROM _dormant_refs WHERE t=$1 AND id=$2 AND column_name=$3",
        &[&name, &id, &column],
    )?;
    let mut references = Vec::new();
    refs(kind, value, &mut references);
    for (parent, parent_id) in references {
        let exists: bool = tx.query("SELECT EXISTS(SELECT 1 FROM r WHERE t=$1 AND id=$2) OR EXISTS(SELECT 1 FROM _dormant_rows WHERE t=$1 AND id=$2) OR EXISTS(SELECT 1 FROM _dormant_narrow_rows WHERE t=$1 AND id=$2)", &[&parent,&parent_id])?[0].get(0);
        let invalid: i64 = if exists { 0 } else { 2 };
        tx.execute("INSERT INTO _dormant_refs(t,id,column_name,parent_t,parent_id,invalid) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", &[&name,&id,&column,&parent,&parent_id,&invalid])?;
    }
    Ok(())
}
pub(super) fn save(
    tx: &Tx<'_>,
    name: &str,
    id: &str,
    column: &str,
    value: &Value,
) -> Result<(), RuntimeError> {
    tx.execute("INSERT INTO _dormant_values(t,id,column_name,data) VALUES($1,$2,$3,$4) ON CONFLICT(t,id,column_name) DO UPDATE SET data=excluded.data", &[&name,&id,&column,&canonical_json(value)])?;
    Ok(())
}

pub(super) fn transition(
    tx: &Tx<'_>,
    previous: &Schema,
    next: &Schema,
) -> Result<(), RuntimeError> {
    if tx.meta("dormant_enabled")?.as_deref() != Some("1") {
        // An unversioned hot adoption has the same destructive projection as
        // SQLite before its first release enables retain-by-default storage.
        for name in previous
            .tables
            .keys()
            .filter(|n| !next.tables.contains_key(*n))
        {
            tx.rows_cache.borrow_mut().invalidate(name);
            tx.execute("DELETE FROM r WHERE t=$1", &[name])?;
            tx.execute("DELETE FROM i WHERE t=$1", &[name])?;
        }
        return Ok(());
    }
    let restore = tx.meta("activation_restore")?.as_deref() != Some("false");
    let mut reuse = Vec::new();
    for (relation, query) in [
        (
            "_dormant_tables",
            "SELECT table_name,table_name FROM _dormant_tables ORDER BY table_name",
        ),
        (
            "_dormant_columns",
            "SELECT table_name,column_name FROM _dormant_columns ORDER BY table_name,column_name",
        ),
        (
            "_dormant_indexes",
            "SELECT table_name,index_name FROM _dormant_indexes ORDER BY table_name,index_name",
        ),
    ] {
        for row in tx.query(query, &[])? {
            let name: String = row.get(0);
            let part: String = row.get(1);
            if next.table(&name).is_some_and(|t| match relation {
                "_dormant_tables" => true,
                "_dormant_columns" => {
                    t.columns.contains_key(&part)
                        && previous
                            .table(&name)
                            .is_none_or(|old| !old.columns.contains_key(&part))
                }
                _ => t.indexes.contains_key(&part) && !part.starts_with("$intent:"),
            }) {
                reuse.push(format!("{name}.{part}"));
            }
        }
    }
    if !restore && !reuse.is_empty() {
        return Err(refusal(format!(
            "dormant names [{}] require restoration intent; proceed with `snapback4 deploy <dir> --restore-dormant`",
            reuse.join(", ")
        )));
    }
    // Archive before restoring any parents or checking retained references.
    for (name, old) in previous
        .tables
        .iter()
        .filter(|(n, t)| t.ephemeral.is_none() && previous.maintain_for(n).is_none())
    {
        let candidate = next.table(name);
        let removed: Vec<_> = old
            .columns
            .keys()
            .filter(|c| {
                candidate.is_none_or(|t| !t.columns.contains_key(*c))
                    && !old.maintained.contains_key(*c)
                    && !old.engine_field(c)
            })
            .cloned()
            .collect();
        for column in &removed {
            definition(tx, name, old, column)?;
        }
        for (index, definition) in &old.indexes {
            if !definition
                .columns()
                .iter()
                .any(|c| old.maintained.contains_key(c))
                && candidate.is_none_or(|t| !t.indexes.contains_key(index))
            {
                tx.execute("INSERT INTO _dormant_indexes(table_name,index_name,definition) VALUES($1,$2,$3) ON CONFLICT(table_name,index_name) DO UPDATE SET definition=excluded.definition", &[name,index,&canonical_json(definition)])?;
            }
        }
        if candidate.is_none() {
            tx.execute("INSERT INTO _dormant_tables(table_name,definition) VALUES($1,$2) ON CONFLICT(table_name) DO UPDATE SET definition=excluded.definition", &[name,&canonical_json(old)])?;
        }
        if candidate.is_some() && removed.is_empty() {
            continue;
        }
        walk(tx, "r", name, |id, mut row| {
            materialize_optional_fields(&mut row, old);
            if candidate.is_none() {
                tx.execute("INSERT INTO _dormant_rows(t,id,data) VALUES($1,$2,$3) ON CONFLICT(t,id) DO UPDATE SET data=excluded.data", &[name,&id,&canonical_json(&row)])?;
                for (column, kind) in &old.columns {
                    if let Ok(value) = row.field(column) {
                        capture(tx, name, id, column, kind, value)?;
                    }
                }
            } else {
                for column in &removed {
                    if let Ok(value) = row.field(column) {
                        save(tx, name, id, column, value)?;
                        capture(tx, name, id, column, &old.columns[column], value)?;
                    }
                }
            }
            Ok(())
        })?;
        if candidate.is_none() {
            tx.rows_cache.borrow_mut().invalidate(name);
            tx.execute("DELETE FROM r WHERE t=$1", &[name])?;
            tx.execute("DELETE FROM i WHERE t=$1", &[name])?;
        }
    }
    let mut restoring = std::collections::BTreeMap::new();
    for row in tx.query(
        "SELECT table_name,definition FROM _dormant_tables ORDER BY table_name",
        &[],
    )? {
        let name: String = row.get(0);
        let Some(table) = next.table(&name) else {
            continue;
        };
        let old: Table = decode(row.get(1))?;
        for column in old
            .columns
            .keys()
            .filter(|c| !table.columns.contains_key(*c))
        {
            definition(tx, &name, &old, column)?;
        }
        let mut count = 0u64;
        walk(tx, "_dormant_rows", &name, |id, row| {
            for (column, value) in row.as_object()? {
                if !table.columns.contains_key(column) && old.columns.contains_key(column) {
                    save(tx, &name, id, column, value)?;
                }
            }
            tx.execute(
                "INSERT INTO r(t,id,data) VALUES($1,$2,$3)",
                &[&name, &id, &canonical_json(&row)],
            )?;
            count += 1;
            Ok(())
        })?;
        if count > 0 {
            tx.set_meta("activation_population", "true")?;
        }
        tx.set_meta(
            &format!("activation_table_restored:{name}"),
            &count.to_string(),
        )?;
        tx.execute("DELETE FROM _dormant_rows WHERE t=$1", &[&name])?;
        tx.execute("DELETE FROM _dormant_tables WHERE table_name=$1", &[&name])?;
        restoring.insert(name, old);
    }
    for (name, table) in next.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
        let columns = tx.query(
            "SELECT column_name FROM _dormant_columns WHERE table_name=$1 ORDER BY column_name",
            &[name],
        )?;
        if !restoring.contains_key(name)
            && !columns
                .iter()
                .any(|r| table.columns.contains_key(r.get::<_, &str>(0)))
        {
            continue;
        }
        for column in table.columns.keys() {
            let count: i64 = tx.query("SELECT COUNT(*) FROM _dormant_values v WHERE t=$1 AND column_name=$2 AND EXISTS(SELECT 1 FROM r WHERE r.t=v.t AND r.id=v.id)", &[name,column])?[0].get(0);
            if count > 0 {
                tx.set_meta("activation_population", "true")?;
                tx.set_meta(
                    &format!("activation_column_restored:{name}.{column}"),
                    &count.to_string(),
                )?;
            }
        }
        // @ref LLP 3000.009.001.000#3.5 — match SQLite's predecessor materialization before overlay; raw bytes decide meters and change-evidence widening.
        walk(tx, "r", name, |id, mut image| {
            if let Some(old) = restoring.get(name).or_else(|| previous.table(name)) {
                materialize_optional_fields(&mut image, old);
            }
            for column in table.columns.keys() {
                let rows = tx.query(
                    "SELECT data FROM _dormant_values WHERE t=$1 AND id=$2 AND column_name=$3",
                    &[name, &id, column],
                )?;
                if let Some(row) = rows.first() {
                    if let Value::Row(fields) | Value::Map(fields) = &mut image {
                        fields.insert(column.clone(), decode(row.get(0))?);
                    }
                }
            }
            tx.execute(
                "UPDATE r SET data=$3 WHERE t=$1 AND id=$2",
                &[name, &id, &canonical_json(&image)],
            )?;
            Ok(())
        })?;
    }
    super::narrowed::transition(tx, previous, next, &restoring)?;
    // invalid=1 remembers a deleted parent even after its id is reused. invalid=2
    // denotes a parent already absent when captured, matching SQLite's policy.
    for row in tx.query("SELECT d.t,d.id,d.column_name FROM _dormant_refs d WHERE EXISTS(SELECT 1 FROM r c WHERE c.t=d.t AND c.id=d.id) AND (invalid=1 OR (invalid<>2 AND NOT EXISTS(SELECT 1 FROM r p WHERE p.t=d.parent_t AND p.id=d.parent_id))) ORDER BY d.t,d.id,d.column_name", &[])? {
        let name: String = row.get(0); let column: String = row.get(2);
        if next.table(&name).is_some_and(|t| t.columns.contains_key(&column)) { return Err(refusal(format!("table {name}: dormant references cannot acquire another parent lifetime"))); }
    }
    for (name, table) in &next.tables {
        for column in table.columns.keys() {
            tx.execute(
                "DELETE FROM _dormant_values v WHERE t=$1 AND column_name=$2 AND NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=v.t AND n.id=v.id)",
                &[name, column],
            )?;
            tx.execute(
                "DELETE FROM _dormant_refs v WHERE t=$1 AND column_name=$2 AND NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=v.t AND n.id=v.id)",
                &[name, column],
            )?;
            tx.execute(
                "DELETE FROM _dormant_columns WHERE table_name=$1 AND column_name=$2 AND NOT EXISTS(SELECT 1 FROM _dormant_values WHERE t=$1 AND column_name=$2)",
                &[name, column],
            )?;
        }
        for index in table.indexes.keys() {
            tx.execute(
                "DELETE FROM _dormant_indexes WHERE table_name=$1 AND index_name=$2",
                &[name, index],
            )?;
        }
    }
    Ok(())
}
