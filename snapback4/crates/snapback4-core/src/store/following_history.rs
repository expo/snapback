//! Narrow reads for the server-owned Following history traversal.
// @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — birth witnesses never become ordinary reads.
use super::*;

/// Timeline-owned metadata is bounded independently of application card bodies.
/// Check the stored byte length before decoding, including on corrupt restores.
pub(crate) const HISTORY_ROW_BYTES: usize = 64 * 1024;

impl Tx<'_> {
    pub(crate) fn history_point(
        &self,
        table: &str,
        id: &str,
    ) -> Result<Option<Value>, RuntimeError> {
        let size: Option<i64> = self
            .tx
            .prepare_cached("SELECT octet_length(data) FROM r WHERE t = ?1 AND id = ?2")?
            .query_row(params![self.num(table)?, id], |r| r.get(0))
            .optional()?;
        let Some(size) = size else {
            return Ok(None);
        };
        envelope(size)?;
        let mut statement = self
            .tx
            .prepare_cached("SELECT data FROM r WHERE t = ?1 AND id = ?2")?;
        let mut rows = statement.query(params![self.num(table)?, id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let data = row
            .get_ref(0)?
            .as_str()
            .map_err(|e| RuntimeError::Store(e.to_string()))?;
        decode(data).map(Some)
    }

    pub(crate) fn history_head(
        &self,
        table: &str,
        index: &str,
        prefix: &[Value],
        after: Option<Vec<Value>>,
    ) -> Result<Option<Value>, RuntimeError> {
        let dir = if index == "byPair" {
            Dir::Asc
        } else {
            Dir::Desc
        };
        let Some((lo, hi)) = crate::rows::scan_range(
            prefix,
            &Bounds {
                after,
                ..Default::default()
            },
            dir,
        ) else {
            return Ok(None);
        };
        let sizes = match dir {
            Dir::Asc => {
                "SELECT octet_length(r.data) + length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT 1"
            }
            Dir::Desc => {
                "SELECT octet_length(r.data) + length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k DESC LIMIT 1"
            }
        };
        let size: Option<i64> = self
            .tx
            .prepare_cached(sizes)?
            .query_row(
                params![
                    self.num(table)?,
                    self.num(&format!("{table}.{index}"))?,
                    lo,
                    hi
                ],
                |r| r.get(0),
            )
            .optional()?;
        let Some(size) = size else {
            return Ok(None);
        };
        envelope(size)?;
        let mut statement = self.tx.prepare_cached(scan_sql(dir))?;
        let mut rows = statement.query(params![
            self.num(table)?,
            self.num(&format!("{table}.{index}"))?,
            lo,
            hi,
            1
        ])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let data = row
            .get_ref(0)?
            .as_str()
            .map_err(|e| RuntimeError::Store(e.to_string()))?;
        decode(data).map(Some)
    }
}

// SQLite's BYTELENARG/LENGTHARG preflight avoids loading overflow payloads.
// It and the payload statement share the same read transaction snapshot.
fn envelope(bytes: i64) -> Result<(), RuntimeError> {
    if bytes < 0 || bytes as u64 > HISTORY_ROW_BYTES as u64 {
        return Err(RuntimeError::Store(
            "Following owned metadata exceeds its internal row envelope".into(),
        ));
    }
    Ok(())
}

fn decode(data: &str) -> Result<Value, RuntimeError> {
    if data.len() > HISTORY_ROW_BYTES {
        return Err(RuntimeError::Store(
            "Following owned metadata exceeds its internal row envelope".into(),
        ));
    }
    serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))
}
