//! Verify copied rows independently before destroying their source.
// @ref LLP 3000.009.001.000.002#6 — exact expected destinations, in activation's transaction on both stores.
use super::store::Tx;
use crate::{RuntimeError, Value, value::canonical_json};

// A page has the same indexed row lookups as the bounded activation walker.
// No verification statement scans a population, even for count-only checks.
// LIMIT also fences each correlated PK lookup: a generic plan must not turn a
// bounded page into a whole-destination hash/merge join.
const PAGE: i64 = 64;
pub(super) fn begin(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.batch("CREATE TEMP TABLE _activation_images(relation TEXT COLLATE pg_catalog.\"C\" NOT NULL,t TEXT COLLATE pg_catalog.\"C\" NOT NULL,id TEXT COLLATE pg_catalog.\"C\" NOT NULL,col TEXT COLLATE pg_catalog.\"C\" NOT NULL,data TEXT NOT NULL,PRIMARY KEY(relation,t,id,col)) ON COMMIT DROP")?;
    #[cfg(test)]
    if fault::slow_pages() {
        tx.batch("SET LOCAL statement_timeout='400ms'")?;
    }
    super::managed_relations::verify_activation(tx)
}
fn remember(
    tx: &Tx<'_>,
    relation: &str,
    t: &str,
    id: &str,
    col: Option<&str>,
    value: &Value,
) -> Result<(), RuntimeError> {
    tx.execute("INSERT INTO pg_temp._activation_images VALUES($1,$2,$3,$4,$5) ON CONFLICT(relation,t,id,col) DO UPDATE SET data=excluded.data",&[&relation,&t,&id,&col.unwrap_or(""),&canonical_json(value)])?;
    Ok(())
}
pub(super) fn verify_expected(
    tx: &Tx<'_>,
    relation: &str,
    t: &str,
    id: &str,
) -> Result<(), RuntimeError> {
    assert_eq!(relation, "_dormant_narrow_rows");
    let n=tx.query("SELECT count(*) FROM _dormant_narrow_rows d JOIN pg_temp._activation_images e ON e.relation='_dormant_narrow_rows' AND e.t=d.t AND e.id=d.id AND e.col='' WHERE d.t=$1 AND d.id=$2 AND d.data COLLATE pg_catalog.\"C\"=e.data COLLATE pg_catalog.\"C\"",&[&t,&id])?[0].get(0);
    expected(n, 1, relation)
}
fn page(
    tx: &Tx<'_>,
    sql: &str,
    args: &[&(dyn postgres::types::ToSql + Sync)],
) -> Result<Vec<super::flight::Row>, RuntimeError> {
    #[cfg(test)]
    if fault::slow_pages() {
        return Ok(tx
            .flight(
                &[(&format!("SELECT q.*,pg_sleep(0.002) FROM ({sql}) q"), args)],
                "",
            )?
            .remove(0)
            .rows);
    }
    Ok(tx.flight(&[(sql, args)], "")?.remove(0).rows)
}

pub(super) fn image(
    tx: &Tx<'_>,
    relation: &str,
    t: &str,
    id: &str,
    column: Option<&str>,
    image: &Value,
) -> Result<(), RuntimeError> {
    assert!(matches!(
        relation,
        "r" | "_dormant_rows" | "_dormant_narrow_rows" | "_dormant_values"
    ));
    #[cfg(test)]
    fault::run(tx, relation, t, id, column)?;
    let sql = match relation {
        "r" => {
            "SELECT COUNT(*) FROM r WHERE t=$1 AND id=$2 AND data COLLATE pg_catalog.\"C\"=$3 AND $4::text IS NULL"
        }
        "_dormant_rows" => {
            "SELECT COUNT(*) FROM _dormant_rows WHERE t=$1 AND id=$2 AND data COLLATE pg_catalog.\"C\"=$3 AND $4::text IS NULL"
        }
        "_dormant_narrow_rows" => {
            "SELECT COUNT(*) FROM _dormant_narrow_rows WHERE t=$1 AND id=$2 AND data COLLATE pg_catalog.\"C\"=$3 AND $4::text IS NULL"
        }
        "_dormant_values" => {
            "SELECT COUNT(*) FROM _dormant_values WHERE t=$1 AND id=$2 AND data COLLATE pg_catalog.\"C\"=$3 AND column_name=$4"
        }
        _ => unreachable!(),
    };
    remember(tx, relation, t, id, column, image)?;
    let n = tx.query(sql, &[&t, &id, &canonical_json(image), &column])?[0].get::<_, i64>(0);
    expected(n, 1, relation)
}

pub(super) fn population(
    tx: &Tx<'_>,
    source: &str,
    destination: &str,
    t: &str,
    copied: i64,
) -> Result<(), RuntimeError> {
    assert!(matches!(
        (source, destination),
        ("r", "_dormant_rows") | ("_dormant_rows", "r")
    ));
    expected(rows(tx, destination, t)?, copied, destination)?;
    let sql = format!(
        "SELECT s.id,COALESCE(d.data COLLATE pg_catalog.\"C\"=e.data COLLATE pg_catalog.\"C\",false) FROM (SELECT id FROM {source} WHERE t=$1 AND id>=COALESCE($2,'') AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT $3) s LEFT JOIN LATERAL (SELECT data FROM {destination} WHERE t=$1 AND id=s.id LIMIT 1) d ON true LEFT JOIN LATERAL (SELECT data FROM pg_temp._activation_images WHERE relation=$4 AND t=$1 AND id=s.id AND col='' LIMIT 1) e ON true ORDER BY s.id"
    );
    let mut after: Option<String> = None;
    let mut count = 0;
    loop {
        let batch = page(tx, &sql, &[&t, &after, &PAGE, &destination])?;
        if batch.is_empty() {
            break;
        }
        for row in batch {
            after = Some(row.get(0));
            expected(i64::from(row.get::<_, bool>(1)), 1, destination)?;
            count += 1;
        }
    }
    expected(count, copied, destination)
}

fn expected(actual: i64, expected: i64, relation: &str) -> Result<(), RuntimeError> {
    if actual != expected {
        return Err(RuntimeError::Store(format!(
            "SNAPBACK_ACTIVATION_COPY_MISMATCH: {relation} destination verification expected {expected}, observed {actual}; source retained"
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod fault {
    use super::*;
    thread_local! {static SLOW:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
    pub fn slow_pages() -> bool {
        SLOW.with(|f| f.get())
    }
    pub fn set_slow_pages(slow: bool) {
        SLOW.with(|f| f.set(slow));
    }
    thread_local! { static ERASE: std::cell::RefCell<Option<(String,bool)>> = const {std::cell::RefCell::new(None)}; }
    pub fn arm(relation: &str, corrupt: bool) {
        ERASE.with(|f| *f.borrow_mut() = Some((relation.into(), corrupt)));
    }
    pub fn run(
        tx: &Tx<'_>,
        relation: &str,
        t: &str,
        id: &str,
        _: Option<&str>,
    ) -> Result<(), RuntimeError> {
        let action = ERASE.with(|f| {
            let mut f = f.borrow_mut();
            if f.as_ref().is_some_and(|(r, _)| r == relation) {
                f.take().map(|(_, corrupt)| corrupt)
            } else {
                None
            }
        });
        if let Some(corrupt) = action {
            let sql = match (relation, corrupt) {
                ("r", false) => "DELETE FROM r WHERE t=$1 AND id=$2",
                ("r", true) => "UPDATE r SET data='{}' WHERE t=$1 AND id=$2",
                ("_dormant_rows", false) => "DELETE FROM _dormant_rows WHERE t=$1 AND id=$2",
                ("_dormant_rows", true) => {
                    "UPDATE _dormant_rows SET data='{}' WHERE t=$1 AND id=$2"
                }
                ("_dormant_narrow_rows", false) => {
                    "DELETE FROM _dormant_narrow_rows WHERE t=$1 AND id=$2"
                }
                ("_dormant_narrow_rows", true) => {
                    "UPDATE _dormant_narrow_rows SET data='{}' WHERE t=$1 AND id=$2"
                }
                ("_dormant_values", false) => "DELETE FROM _dormant_values WHERE t=$1 AND id=$2",
                ("_dormant_values", true) => {
                    "UPDATE _dormant_values SET data='{}' WHERE t=$1 AND id=$2"
                }
                _ => unreachable!(),
            };
            tx.execute(sql, &[&t, &id])?;
        }
        Ok(())
    }
    thread_local! {static LATE:std::cell::Cell<Option<bool>>=const{std::cell::Cell::new(None)};}
    pub fn arm_late() {
        LATE.with(|f| f.set(Some(false)));
    }
    pub fn arm_late_payload() {
        LATE.with(|f| f.set(Some(true)));
    }
    pub fn late(tx: &Tx<'_>, t: &str) -> Result<(), RuntimeError> {
        if let Some(payload) = LATE.with(|f| f.replace(None)) {
            tx.execute(
                if payload {
                    r#"UPDATE r SET data=replace(data,'"Int":7','"Int":8') WHERE t=$1"#
                } else {
                    "DELETE FROM r WHERE t=$1"
                },
                &[&t],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn test_payload(
    tx: &Tx<'_>,
    table: &str,
    id: &str,
    expected: &Value,
) -> Result<(), RuntimeError> {
    image(tx, "r", table, id, None, expected)
}

// Count pages contain keys only; payload pages return one equality bit per key.
pub(super) fn rows(tx: &Tx<'_>, relation: &str, t: &str) -> Result<i64, RuntimeError> {
    assert!(matches!(relation, "r" | "_dormant_rows"));
    let sql = format!(
        "SELECT id FROM {relation} WHERE t=$1 AND id>=COALESCE($2,'') AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT $3"
    );
    let mut after: Option<String> = None;
    let mut count = 0;
    loop {
        let batch = page(tx, &sql, &[&t, &after, &PAGE])?;
        if batch.is_empty() {
            break;
        }
        count += batch.len() as i64;
        after = Some(batch.last().unwrap().get(0));
    }
    Ok(count)
}
fn cell_pages(tx: &Tx<'_>, t: &str, column: &str, verify: bool) -> Result<i64, RuntimeError> {
    let mut after: Option<String> = None;
    let mut col: Option<String> = None;
    let mut count = 0;
    loop {
        let batch = page(
            tx,
            "SELECT v.id,v.column_name,(v.column_name=$2 AND r.id IS NOT NULL AND n.id IS NULL),COALESCE(r.data COLLATE pg_catalog.\"C\"=e.data COLLATE pg_catalog.\"C\",false) FROM (SELECT id,column_name FROM _dormant_values WHERE t=$1 AND (id,column_name)>=(COALESCE($3,''),COALESCE($4,'')) AND ($3::text IS NULL OR (id,column_name)>($3,$4)) ORDER BY id,column_name LIMIT $5) v LEFT JOIN LATERAL (SELECT id,data FROM r WHERE t=$1 AND id=v.id LIMIT 1) r ON true LEFT JOIN LATERAL (SELECT id FROM _dormant_narrow_rows WHERE t=$1 AND id=v.id LIMIT 1) n ON true LEFT JOIN LATERAL (SELECT data FROM pg_temp._activation_images WHERE relation='r' AND t=$1 AND id=v.id AND col='' LIMIT 1) e ON true ORDER BY v.id,v.column_name",
            &[&t, &column, &after, &col, &PAGE],
        )?;
        if batch.is_empty() {
            break;
        }
        for row in batch {
            after = Some(row.get(0));
            col = Some(row.get(1));
            if row.get::<_, bool>(2) {
                count += 1;
                if verify {
                    expected(i64::from(row.get::<_, bool>(3)), 1, "r cell restoration")?;
                }
            }
        }
    }
    Ok(count)
}

pub(super) fn cells(tx: &Tx<'_>, t: &str, column: &str) -> Result<i64, RuntimeError> {
    cell_pages(tx, t, column, false)
}
pub(super) fn verify_cells(
    tx: &Tx<'_>,
    t: &str,
    column: &str,
    copied: i64,
) -> Result<(), RuntimeError> {
    #[cfg(test)]
    if copied > 0 {
        fault::late(tx, t)?;
    }
    expected(
        cell_pages(tx, t, column, true)?,
        copied,
        "r cell restoration",
    )
}
fn narrowed_pages(
    tx: &Tx<'_>,
    verify: bool,
) -> Result<std::collections::BTreeMap<String, i64>, RuntimeError> {
    #[cfg(test)]
    if verify {
        if let Some(row) = tx
            .query(
                "SELECT n.t FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id LIMIT 1",
                &[],
            )?
            .first()
        {
            let t: String = row.get(0);
            fault::late(tx, &t)?;
        }
    }
    let mut t: Option<String> = None;
    let mut id: Option<String> = None;
    let mut counts = std::collections::BTreeMap::new();
    loop {
        let batch = page(
            tx,
            "SELECT n.t,n.id,r.id IS NOT NULL,COALESCE(r.data COLLATE pg_catalog.\"C\"=e.data COLLATE pg_catalog.\"C\",false) FROM (SELECT t,id FROM _dormant_narrow_rows WHERE (t,id)>=(COALESCE($1,''),COALESCE($2,'')) AND ($1::text IS NULL OR (t,id)>($1,$2)) ORDER BY t,id LIMIT $3) n LEFT JOIN LATERAL (SELECT id,data FROM r WHERE t=n.t AND id=n.id LIMIT 1) r ON true LEFT JOIN LATERAL (SELECT data FROM pg_temp._activation_images WHERE relation='r' AND t=n.t AND id=n.id AND col='' LIMIT 1) e ON true ORDER BY n.t,n.id",
            &[&t, &id, &PAGE],
        )?;
        if batch.is_empty() {
            break;
        }
        for row in batch {
            t = Some(row.get(0));
            id = Some(row.get(1));
            if row.get::<_, bool>(2) {
                *counts.entry(t.clone().unwrap()).or_insert(0) += 1;
                if verify {
                    expected(
                        i64::from(row.get::<_, bool>(3)),
                        1,
                        "r narrowed restoration",
                    )?;
                }
            }
        }
    }
    Ok(counts)
}
pub(super) fn narrowed_counts(
    tx: &Tx<'_>,
) -> Result<std::collections::BTreeMap<String, i64>, RuntimeError> {
    narrowed_pages(tx, false)
}
pub(super) fn verify_narrowed(tx: &Tx<'_>, copied: i64) -> Result<(), RuntimeError> {
    expected(
        narrowed_pages(tx, true)?.values().sum(),
        copied,
        "r narrowed restoration",
    )
}
