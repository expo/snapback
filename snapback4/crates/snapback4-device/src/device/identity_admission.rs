//! Native custody and ordinary admission share one exact-input identity check.
// @ref LLP 3000.007#20.4 — no accepted deferred intent may overwrite an outbox owner.
use super::*;

pub(super) fn entries(value: Option<&str>) -> Result<Vec<Queued>, RuntimeError> {
    #[derive(Deserialize)]
    struct Record { entry: Queued }
    let records: Vec<Record> = decoded(value.unwrap_or("[]"))?;
    Ok(records.into_iter().map(|record| record.entry).collect())
}

pub(super) fn same_input(original: &Queued, entry: &Queued) -> Result<(), RuntimeError> {
    if original.op != entry.op || original.args != entry.args || original.viewer != entry.viewer {
        return Err(RuntimeError::Structural { code: "E_WRITE_ID_REUSE", message: "write id already belongs to a different operation or arguments; retry the original input or use a new id".into() });
    }
    Ok(())
}
