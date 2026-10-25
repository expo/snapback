//! Verify copied rows independently before destroying their source.
// @ref LLP 3000.009.001.000.002#6 — exact expected destinations, in activation's transaction on both stores.
use super::store::Tx;
use crate::{RuntimeError, Value, value::canonical_json};

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
    expected(rows(tx, destination, t)?, copied, destination)?;
    assert!(matches!(source, "r" | "_dormant_rows"));
    assert!(matches!(destination, "r" | "_dormant_rows"));
    let (missing_sql, extra_sql) = match (source, destination) {
        ("r", "_dormant_rows") => (
            "SELECT (SELECT count(*) FROM r WHERE t=$1) - (SELECT count(*) FROM r s JOIN _dormant_rows d ON d.t=s.t AND d.id=s.id WHERE s.t=$1)",
            "SELECT (SELECT count(*) FROM _dormant_rows WHERE t=$1) - (SELECT count(*) FROM r WHERE t=$1)",
        ),
        ("_dormant_rows", "r") => (
            "SELECT (SELECT count(*) FROM _dormant_rows WHERE t=$1) - (SELECT count(*) FROM _dormant_rows s JOIN r d ON d.t=s.t AND d.id=s.id WHERE s.t=$1)",
            "SELECT (SELECT count(*) FROM r WHERE t=$1) - (SELECT count(*) FROM _dormant_rows WHERE t=$1)",
        ),
        _ => unreachable!(),
    };
    let missing = tx.query(missing_sql, &[&t])?[0].get::<_, i64>(0);
    expected(missing, 0, destination)?;
    let extra = tx.query(extra_sql, &[&t])?[0].get::<_, i64>(0);
    expected(extra, 0, destination)?;
    if source == "_dormant_rows" {
        let matched=tx.query("SELECT count(*) FROM _dormant_rows s JOIN r d ON d.t=s.t AND d.id=s.id AND d.data COLLATE pg_catalog.\"C\"=s.data COLLATE pg_catalog.\"C\" WHERE s.t=$1",&[&t])?[0].get::<_,i64>(0);
        expected(matched, copied, destination)?;
    }
    Ok(())
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
    thread_local! {static LATE:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
    pub fn arm_late() {
        LATE.with(|f| f.set(true));
    }
    pub fn late(tx: &Tx<'_>, t: &str) -> Result<(), RuntimeError> {
        if LATE.with(|f| f.replace(false)) {
            tx.execute("DELETE FROM r WHERE t=$1", &[&t])?;
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

// Expected counts are captured before restoration markers can execute any code.
// Recheck immediately before deleting the retained source, not just after INSERT.
pub(super) fn rows(tx: &Tx<'_>, relation: &str, t: &str) -> Result<i64, RuntimeError> {
    let sql = match relation {
        "r" => "SELECT count(*) FROM r WHERE t=$1",
        "_dormant_rows" => "SELECT count(*) FROM _dormant_rows WHERE t=$1",
        _ => unreachable!(),
    };
    Ok(tx.query(sql, &[&t])?[0].get(0))
}
pub(super) fn cells(tx: &Tx<'_>, t: &str, column: &str) -> Result<i64, RuntimeError> {
    Ok(tx.query("SELECT count(*) FROM _dormant_values v JOIN r ON r.t=v.t AND r.id=v.id WHERE v.t=$1 AND column_name=$2 AND NOT EXISTS(SELECT 1 FROM _dormant_narrow_rows n WHERE n.t=v.t AND n.id=v.id)", &[&t,&column])?[0].get::<_,i64>(0))
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
    expected(cells(tx, t, column)?, copied, "r cell restoration")
}
pub(super) fn verify_narrowed(tx: &Tx<'_>, copied: i64) -> Result<(), RuntimeError> {
    let actual = tx.query(
        "SELECT count(*) FROM _dormant_narrow_rows n JOIN r ON r.t=n.t AND r.id=n.id",
        &[],
    )?[0]
        .get::<_, i64>(0);
    expected(actual, copied, "r narrowed restoration")
}
