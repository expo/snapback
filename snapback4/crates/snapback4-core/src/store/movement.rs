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
    let tail = if relation == "_dormant_values" {
        "(?4 IS NULL OR column_name=?4)"
    } else {
        "?4 IS NULL"
    };
    let sql =
        format!("SELECT COUNT(*) FROM {relation} WHERE t=?1 AND id=?2 AND data=?3 AND {tail}");
    let n = tx
        .conn()
        .query_row(&sql, params![t, id, canonical_json(image), column], |r| {
            r.get::<_, i64>(0)
        })?;
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
    if source == "_dormant_rows" {
        let matched=tx.conn().query_row("SELECT count(*) FROM _dormant_rows s JOIN r d ON d.t=s.t AND d.id=s.id AND d.data COLLATE BINARY=s.data COLLATE BINARY WHERE s.t=?1",[t],|r|r.get::<_,i64>(0))?;
        expected(matched, copied, destination)?;
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
    thread_local! {static LATE:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
    pub fn arm_late() {
        LATE.with(|f| f.set(true));
    }
    pub fn late(tx: &Tx<'_>, t: i64) -> Result<(), RuntimeError> {
        if LATE.with(|f| f.replace(false)) {
            tx.conn().execute("DELETE FROM r WHERE t=?1", [t])?;
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
    expected(cells(tx, t, column)?, copied, "r cell restoration")
}
pub(super) fn verify_narrowed(tx: &Tx<'_>, copied: i64) -> Result<(), RuntimeError> {
    let actual = tx.conn().query_row(
        "SELECT count(*) FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id",
        [],
        |r| r.get::<_, i64>(0),
    )?;
    expected(actual, copied, "r narrowed restoration")
}
