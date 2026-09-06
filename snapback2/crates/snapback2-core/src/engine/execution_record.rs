use super::*;

pub(super) fn query_state(
    trace: &AuthoritativeTrace,
    certificate: &Certificate,
    system: bool,
) -> ExecutionState {
    // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — exhausted owner ranges are complete even at capped-only rule sites: no rule filtered them. Merge union and execution bounds still bind.
    if (!system && certificate.completeness == crate::certificate::Completeness::Capped)
        || trace.ranges.iter().any(|range| {
            range.stop == StopReason::Limit
                || (!system
                    && certificate
                        .read_sites
                        .iter()
                        .find(|site| site.site == range.site)
                        .is_none_or(|site| !site.hoist))
        })
        || certificate.merge_sites.iter().any(|site| {
            let union_too_large = trace
                .merges
                .iter()
                .find(|entry| entry.site == site.site)
                .is_some_and(|entry| entry.deduplicated_union_len > site.take);
            let lane_limited = trace.ranges.iter().any(|range| {
                site.lane_sites.contains(&range.site) && range.stop != StopReason::Exhausted
            });
            union_too_large || lane_limited
        })
    {
        return ExecutionState::Capped;
    }
    ExecutionState::Complete
}

pub(super) fn next_cursor(
    state: &ExecutionState,
    trace: &AuthoritativeTrace,
    certificate: &Certificate,
) -> Result<Option<String>, RuntimeError> {
    if !matches!(state, ExecutionState::Capped) {
        return Ok(None);
    }
    let Some(page) = trace
        .result_page_return
        .as_ref()
        .and_then(|path| certificate.result_pages.get(path))
    else {
        return Ok(None);
    };
    let values = if page.merge {
        trace
            .merges
            .iter()
            .rev()
            .find(|entry| entry.site == page.site)
            .and_then(|entry| entry.last_returned_suffix.clone())
    } else {
        let Some(row_id) = trace
            .ranges
            .iter()
            .rev()
            .find(|range| range.site == page.site)
            .and_then(|range| range.returned_ids.last())
        else {
            return Ok(None);
        };
        trace
            .rows
            .iter()
            .rev()
            .find(|row| row.table == page.table && &row.id == row_id)
            .and_then(|row| {
                page.suffix
                    .iter()
                    .map(|column| row.row.field(&column.name).cloned().ok())
                    .collect::<Option<Vec<_>>>()
            })
    };
    let Some(values) = values else {
        return Ok(None);
    };
    encode_cursor(&CursorPosition {
        table: page.table.clone(),
        index: page.index.clone(),
        order: page.order,
        suffix: page.suffix.clone(),
        values,
    })
    .map(Some)
    .map_err(|error| RuntimeError::Serialization(error.to_string()))
}

pub(crate) fn append_commit(
    transaction: &Transaction<'_>,
    record: &CommitRecord,
) -> Result<(), RuntimeError> {
    transaction.execute(
        "INSERT INTO _commits(seq, at, program, principal, kind, touched, writes, emits, by, job, job_chunk, schedule)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            record.seq as i64,
            record.at,
            record.program,
            record.principal,
            record.kind,
            serde_json::to_string(&record.touched)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
            serde_json::to_string(&record.writes)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
            record.emits as i64,
            record.by,
            record.job,
            record.job_chunk.as_ref().map(crate::store_jobs::encode).transpose()?,
            record.schedule.as_ref().map(crate::store_jobs::encode).transpose()?,
        ],
    )?;
    transaction.execute(
        "DELETE FROM _commits
         WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - 10000 FROM _commits)",
        [],
    )?;
    Ok(())
}
