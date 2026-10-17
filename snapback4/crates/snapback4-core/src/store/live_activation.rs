//! File-backed, transaction-local restoration identities for live transitions.
// @ref LLP 3000.014.000#71-dormant-restoration-identities-are-a-relation — never construct a population-sized id vector.
use super::*;
pub(super) fn configure(conn: &Connection, next: &Schema) -> Result<(), RuntimeError> {
    let generations: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_generations')",
        [],
        |r| r.get(0),
    )?;
    let previous = if generations {
        conn.query_row(
            "SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .map(|s| serde_json::from_str::<Schema>(&s).map_err(|e| RuntimeError::Store(e.to_string())))
        .transpose()?
    } else {
        None
    };
    let mut dormant_live = false;
    for (table, path) in [
        ("_dormant_tables", "$.through.live"),
        ("_dormant_columns", "$.capture_source.through.live"),
        ("_dormant_narrow_rows", "$.through.live"),
    ] {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",
            [table],
            |r| r.get(0),
        )?;
        if exists {
            dormant_live |= conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE json_extract(definition,?1) IS NOT NULL)"),[path],|r|r.get::<_,bool>(0))?;
        }
    }
    if super::dormant::live_cells_column(conn)? {
        dormant_live |= conn.query_row("SELECT EXISTS(SELECT 1 FROM _dormant_values WHERE live_source=1)",[],|r|r.get::<_,bool>(0))?;
    }
    if dormant_live
        || crate::schema::live::has_live(next)
        || previous.as_ref().is_some_and(crate::schema::live::has_live)
    {
        conn.execute_batch("DROP TABLE IF EXISTS temp._live_restored;")?;
        conn.pragma_update(None, "temp_store", "FILE")?;
        conn.execute_batch("CREATE TEMP TABLE _live_restored(kind TEXT NOT NULL,t INTEGER NOT NULL,col TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(kind,t,col,id)) WITHOUT ROWID;")?;
    } else {
        conn.execute_batch("DROP TABLE IF EXISTS temp._live_restored;")?;
    }
    Ok(())
}
pub(super) fn active(tx: &Tx<'_>) -> Result<bool, RuntimeError> {
    Ok(tx.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_temp_schema WHERE name='_live_restored')",
        [],
        |r| r.get(0),
    )?)
}
pub(super) fn clear_stale(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    if active(tx)? {
        tx.conn().execute("DELETE FROM _meta WHERE key LIKE 'activation_table_restored_ids:%' OR key LIKE 'activation_column_restored_ids:%' OR key LIKE 'activation_narrowed_restored_ids:%'",[])?;
    }
    Ok(())
}
pub(super) fn finalize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    if !active(tx)? {
        return Ok(());
    }
    // Declaration-sized iteration, never restored-row identities.
    let declarations: Vec<(String, i64, String)> = tx
        .conn()
        .prepare("SELECT DISTINCT kind,t,col FROM temp._live_restored WHERE kind!='live-authority' ORDER BY kind,t,col")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let mut narrowed = 0_u64;
    for (kind, t, col) in declarations {
        let name: String =
            tx.conn()
                .query_row("SELECT name FROM _catalog WHERE num=?1", [t], |r| r.get(0))?;
        let count:u64=tx.conn().query_row("SELECT COUNT(*) FROM temp._live_restored x JOIN r ON r.t=x.t AND r.id=x.id WHERE x.kind=?1 AND x.t=?2 AND x.col=?3",params![kind,t,col],|r|r.get::<_,i64>(0).map(|n|n as u64))?;
        let path = if col.is_empty() {
            name
        } else {
            format!("{name}.{col}")
        };
        tx.set_meta(
            &format!("activation_{kind}_restored:{path}"),
            &count.to_string(),
        )?;
        if kind == "narrowed" {
            narrowed += count;
        }
    }
    tx.set_meta("activation_narrowed_restored", &narrowed.to_string())?;
    Ok(())
}
pub(super) fn cleanup(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    tx.conn()
        .execute_batch("DROP TABLE IF EXISTS temp._live_restored;")?;
    Ok(())
}
