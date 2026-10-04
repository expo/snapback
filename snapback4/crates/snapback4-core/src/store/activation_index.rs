//! Ordered activation keys retain the ordinary insert's refusal point.
// @ref LLP 3000.000#implementation-follow-up — staging must refuse duplicates at the original walk step.
use super::*;

pub(super) fn create(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    // The clustered key also supplies ORDER BY ti,k without a separate sorter.
    tx.conn().execute_batch("CREATE TEMP TABLE _adoption_index (ti INTEGER NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL, PRIMARY KEY(ti, k)) WITHOUT ROWID;")?;
    Ok(())
}

pub(super) fn insert(tx: &Tx<'_>, ordered: bool, ti: i64, key: &[u8], id: &str) -> Result<(), RuntimeError> {
    let sql = if ordered { "INSERT INTO temp._adoption_index(ti, k, id) VALUES (?1, ?2, ?3)" }
        else { "INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)" };
    tx.conn().prepare_cached(sql)?.execute(params![ti, key, id]).map_err(|error| {
        // Keep the predecessor's native SQLite error and public message. The
        // private staging table's name is an implementation detail.
        match error {
            rusqlite::Error::SqliteFailure(code, _) if ordered && code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY =>
                rusqlite::Error::SqliteFailure(code, Some("UNIQUE constraint failed: i.ti, i.k".into())),
            error => error,
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_key_precedes_later_validation_with_identical_refusal_and_charges() {
        let bound = snapback4_lang::compile(&[("schema.q".into(),
            "table entries:\n  n: int\n  public\n".into())]);
        assert!(bound.diagnostics.is_empty());
        let schema: Schema = serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap();
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        let mut outcomes = Vec::new();
        for ordered in [false, true] {
            let tx = store.transaction().unwrap();
            for (id, n) in [("a", Value::Int(1)), ("b", Value::Int(2)), ("c", Value::String("invalid int".into()))] {
                let row = crate::value::object([("id", Value::Id(id.into())), ("n", n)]);
                tx.conn().execute("INSERT INTO r(t,id,data) VALUES(?1,?2,?3)",
                    params![tx.num("entries").unwrap(), id, canonical_json(&row)]).unwrap();
            }
            if ordered { create(&tx).unwrap(); }
            let mut visits = Vec::new();
            let mut used = None;
            let error = super::super::activation_walk::walk_metered(&tx, tx.num("entries").unwrap(),
                crate::rows::adoption::Work::DECODE, None, |id, row, meter| {
                    visits.push(id.to_owned());
                    crate::engine::validate::validate_row(&schema, "entries", &row)?;
                    // Real index generation appends row IDs and deduplicates
                    // word tokens. Inject a repeated physical key stream to
                    // exercise its defensive refusal before row c is visited.
                    used = Some(meter.used.clone());
                    insert(&tx, ordered, tx.num("entries.byId")?, &[1, 2, 3], id)
                }).unwrap_err();
            assert_eq!(visits, ["a", "b"]);
            assert_eq!(error.code(), "E_STORE");
            assert_eq!(error.to_string(), "E_STORE: UNIQUE constraint failed: i.ti, i.k");
            outcomes.push((error.to_string(), used));
            tx.rollback().unwrap();
        }
        assert_eq!(outcomes[0], outcomes[1]);
    }
}
