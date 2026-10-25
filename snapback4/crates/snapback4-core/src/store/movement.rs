//! Verify copied rows independently before destroying their source.
// @ref LLP 3000.009.001.000.002#6 — exact expected destinations, in activation's transaction on both stores.
use super::*;

pub(super) fn image(
    tx: &Tx<'_>,
    relation: &str,
    t: i64,
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
    remember(tx, relation, t, id, column, image)?;
    check(tx, relation, t, id, column, image)
}

// Expected values come from the computed write, never from its physical result.
// Keep the population on disk and advance it only for intentional transforms.
pub(super) fn begin(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.conn().execute_batch("CREATE TEMP TABLE IF NOT EXISTS _activation_images(relation TEXT NOT NULL,t INTEGER NOT NULL,id TEXT NOT NULL,col TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(relation,t,id,col)) WITHOUT ROWID; DELETE FROM temp._activation_images;")?;
    if super::narrowed::present(tx.conn())? {
        tx.conn().execute("INSERT INTO temp._activation_images SELECT '_dormant_narrow_rows',t,id,'',data FROM _dormant_narrow_rows",[])?;
    }
    Ok(())
}
fn remember(
    tx: &Tx<'_>,
    relation: &str,
    t: i64,
    id: &str,
    col: Option<&str>,
    value: &Value,
) -> Result<(), RuntimeError> {
    tx.conn().execute("INSERT INTO temp._activation_images VALUES(?1,?2,?3,?4,?5) ON CONFLICT(relation,t,id,col) DO UPDATE SET data=excluded.data",params![relation,t,id,col.unwrap_or(""),canonical_json(value)])?;
    Ok(())
}
pub(super) fn rewrite(tx: &Tx<'_>, t: i64, id: &str, value: &Value) -> Result<(), RuntimeError> {
    rewrite_relation(tx, "r", t, id, value)
}
pub(super) fn rewrite_relation(
    tx: &Tx<'_>,
    relation: &str,
    t: i64,
    id: &str,
    value: &Value,
) -> Result<(), RuntimeError> {
    if tx.lifecycle
        && tx.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_temp_schema WHERE name='_activation_images')",
            [],
            |r| r.get::<_, bool>(0),
        )?
    {
        tx.conn().execute(
            "UPDATE temp._activation_images SET data=?3 WHERE relation=?4 AND t=?1 AND id=?2",
            params![t, id, canonical_json(value), relation],
        )?;
    }
    Ok(())
}
// Compare decoded JSON paths, node kinds and scalar values in SQLite. Neither
// document is loaded into Rust: a retained incompatible row can be larger than
// the active-row decoder budget and still needs to remain safely dormant.
fn equal_json(left: &str, right: &str) -> String {
    // json_tree.fullkey preserves source escapes. Build paths from decoded
    // keys, quoting each segment so map keys and array positions stay distinct.
    let tree = |name: &str, value: &str| {
        format!(
            "{name}_nodes AS MATERIALIZED (SELECT id,parent,key,type,atom FROM json_tree({value})), {name}(id,path,type,atom) AS (SELECT id,'$',type,atom FROM {name}_nodes WHERE parent IS NULL UNION ALL SELECT c.id,p.path||'/'||json_quote(c.key),c.type,c.atom FROM {name}_nodes c JOIN {name} p ON c.parent=p.id)"
        )
    };
    let a = tree("a", left);
    let b = tree("b", right);
    let nodes = |name: &str| {
        format!("SELECT path COLLATE BINARY,type COLLATE BINARY,atom COLLATE BINARY FROM {name}")
    };
    let ap = nodes("a");
    let bp = nodes("b");
    format!(
        "CASE WHEN {left} COLLATE BINARY={right} COLLATE BINARY THEN 1 WHEN json_valid({left}) AND json_valid({right}) THEN (WITH RECURSIVE {a},{b} SELECT NOT EXISTS({ap} EXCEPT {bp}) AND NOT EXISTS({bp} EXCEPT {ap})) ELSE 0 END"
    )
}

fn check(
    tx: &Tx<'_>,
    relation: &str,
    t: i64,
    id: &str,
    col: Option<&str>,
    value: &Value,
) -> Result<(), RuntimeError> {
    let tail = if relation == "_dormant_values" {
        "AND column_name=?4"
    } else {
        "AND ?4 IS NULL"
    };
    let same = equal_json("data", "?3");
    let n = tx.conn().query_row(
        &format!("SELECT count(*) FROM {relation} WHERE t=?1 AND id=?2 {tail} AND ({same})"),
        params![t, id, canonical_json(value), col],
        |r| r.get(0),
    )?;
    expected(n, 1, relation)
}
#[cfg(test)]
pub(super) fn test_payload(
    tx: &Tx<'_>,
    t: i64,
    id: &str,
    value: &Value,
) -> Result<(), RuntimeError> {
    check(tx, "r", t, id, None, value)
}

pub(super) fn snapshot_restore(tx: &Tx<'_>, t: i64) -> Result<(), RuntimeError> {
    tx.conn().execute("INSERT INTO temp._activation_images SELECT 'r',t,id,'',data FROM _dormant_rows WHERE t=?1 ON CONFLICT(relation,t,id,col) DO UPDATE SET data=excluded.data",[t])?;
    Ok(())
}
pub(super) fn verify_expected(
    tx: &Tx<'_>,
    relation: &str,
    t: i64,
    id: &str,
) -> Result<(), RuntimeError> {
    assert!(matches!(
        relation,
        "r" | "_dormant_rows" | "_dormant_narrow_rows"
    ));
    let same = equal_json("d.data", "e.data");
    let n=tx.conn().query_row(&format!("SELECT count(*) FROM {relation} d JOIN temp._activation_images e ON e.t=d.t AND e.id=d.id WHERE e.relation=?1 AND e.t=?2 AND e.id=?3 AND e.col='' AND ({same})"),params![relation,t,id],|r|r.get(0))?;
    expected(n, 1, relation)
}

/// Existing retained rows may be replaced by a newly projected live population.
/// Verify that every old source still has a live copy before clearing it.
pub(super) fn retained_coverage(tx: &Tx<'_>, t: i64) -> Result<(), RuntimeError> {
    let missing:i64=tx.conn().query_row("SELECT count(*) FROM _dormant_rows s WHERE t=?1 AND NOT EXISTS(SELECT 1 FROM r d WHERE d.t=s.t AND d.id=s.id)",[t],|r|r.get(0))?;
    expected(missing, 0, "r")
}

pub(super) fn population(
    tx: &Tx<'_>,
    source: &str,
    destination: &str,
    t: i64,
    copied: i64,
) -> Result<(), RuntimeError> {
    expected(rows(tx, destination, t)?, copied, destination)?;
    assert!(matches!(source, "r" | "_dormant_rows"));
    assert!(matches!(destination, "r" | "_dormant_rows"));
    let sql = format!(
        "SELECT (SELECT count(*) FROM {source} WHERE t=?1) - (SELECT count(*) FROM {source} s JOIN {destination} d ON d.t=s.t AND d.id=s.id WHERE s.t=?1)"
    );
    let missing = tx.conn().query_row(&sql, [t], |r| r.get::<_, i64>(0))?;
    expected(missing, 0, destination)?;
    let sql = format!(
        "SELECT (SELECT count(*) FROM {destination} WHERE t=?1) - (SELECT count(*) FROM {source} WHERE t=?1)"
    );
    let extra = tx.conn().query_row(&sql, [t], |r| r.get::<_, i64>(0))?;
    expected(extra, 0, destination)?;
    let mut stmt = tx
        .conn()
        .prepare(&format!("SELECT id FROM {source} WHERE t=?1 ORDER BY id"))?;
    let mut ids = stmt.query([t])?;
    while let Some(row) = ids.next()? {
        let id: String = row.get(0)?;
        verify_expected(tx, destination, t, &id)?;
    }
    Ok(())
}
pub(super) fn expected(actual: i64, expected: i64, relation: &str) -> Result<(), RuntimeError> {
    if actual != expected {
        return Err(RuntimeError::Store(format!(
            "SNAPBACK_ACTIVATION_COPY_MISMATCH: {relation} destination verification expected {expected}, observed {actual}; source retained"
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(super) mod fault {
    use super::*;
    thread_local! { static ERASE: std::cell::RefCell<Option<(String,bool)>> = const {std::cell::RefCell::new(None)}; }
    pub fn arm(relation: &str, corrupt: bool) {
        ERASE.with(|f| *f.borrow_mut() = Some((relation.into(), corrupt)));
    }
    pub fn run(
        tx: &Tx<'_>,
        relation: &str,
        t: i64,
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
            let sql = if corrupt {
                format!("UPDATE {relation} SET data='{{}}' WHERE t=?1 AND id=?2")
            } else {
                format!("DELETE FROM {relation} WHERE t=?1 AND id=?2")
            };
            tx.conn().execute(&sql, params![t, id])?;
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
    pub fn late(tx: &Tx<'_>, t: i64) -> Result<(), RuntimeError> {
        if let Some(payload) = LATE.with(|f| f.replace(None)) {
            tx.conn().execute(
                if payload {
                    "UPDATE r SET data=json_set(data,'$.Row.n.Int',8) WHERE t=?1"
                } else {
                    "DELETE FROM r WHERE t=?1"
                },
                [t],
            )?;
        }
        Ok(())
    }
}

// Expected counts are captured before restoration markers can execute any code.
// Recheck immediately before deleting the retained source, not just after INSERT.
pub(super) fn rows(tx: &Tx<'_>, relation: &str, t: i64) -> Result<i64, RuntimeError> {
    assert!(matches!(relation, "r" | "_dormant_rows"));
    Ok(tx.conn().query_row(
        &format!("SELECT count(*) FROM {relation} WHERE t=?1"),
        [t],
        |r| r.get(0),
    )?)
}
pub(super) fn cells(tx: &Tx<'_>, t: i64, column: &str) -> Result<i64, RuntimeError> {
    Ok(tx.conn().query_row("SELECT count(*) FROM _dormant_values v JOIN r ON r.t=v.t AND r.id=v.id WHERE v.t=?1 AND column_name=?2 AND NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=v.t AND n.id=v.id)",params![t,column],|r|r.get::<_,i64>(0))?)
}
pub(super) fn verify_cells(
    tx: &Tx<'_>,
    t: i64,
    column: &str,
    copied: i64,
) -> Result<(), RuntimeError> {
    #[cfg(test)]
    if copied > 0 {
        fault::late(tx, t)?;
    }
    expected(cells(tx, t, column)?, copied, "r cell restoration")?;
    let mut stmt=tx.conn().prepare("SELECT v.id FROM _dormant_values v JOIN r ON r.t=v.t AND r.id=v.id WHERE v.t=?1 AND column_name=?2 AND NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=v.t AND n.id=v.id)")?;
    let mut ids = stmt.query(params![t, column])?;
    while let Some(row) = ids.next()? {
        let id: String = row.get(0)?;
        verify_expected(tx, "r", t, &id)?;
    }
    Ok(())
}
pub(super) fn verify_narrowed(tx: &Tx<'_>, copied: i64) -> Result<(), RuntimeError> {
    let actual = tx.conn().query_row(
        "SELECT count(*) FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id",
        [],
        |r| r.get::<_, i64>(0),
    )?;
    #[cfg(test)]
    if copied > 0 {
        let t: i64 = tx.conn().query_row(
            "SELECT n.t FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id LIMIT 1",
            [],
            |r| r.get(0),
        )?;
        fault::late(tx, t)?;
    }
    expected(actual, copied, "r narrowed restoration")?;
    let mut stmt=tx.conn().prepare("SELECT n.t,n.id FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id ORDER BY n.t,n.id")?;
    let mut ids = stmt.query([])?;
    while let Some(row) = ids.next()? {
        let t: i64 = row.get(0)?;
        let id: String = row.get(1)?;
        verify_expected(tx, "r", t, &id)?;
    }
    Ok(())
}
