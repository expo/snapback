//! Atomic adoption of the maintained-row address function in the evaluation
//! adapter. The marker and generation publish in the same writer transaction
//! as the target rebuild, so no writer can observe mixed legacy/digest ids.
use super::*;

pub(super) fn install(
    tx: &store::Tx<'_>,
    schema: &Schema,
    creating: bool,
    generation: u64,
) -> Result<u64, RuntimeError> {
    let current = tx.query(
        "SELECT maintained_identity_version FROM _backend WHERE singleton",
        &[],
    )?[0].get::<_, Option<&str>>(0).map(str::to_owned);
    if current.as_deref() == Some(crate::schema::MAINTAINED_ID_VERSION) {
        return Ok(generation);
    }

    let aggregates: Vec<_> = schema.maintains.iter()
        .filter(|maintain| maintain.private.is_none() && maintain.row_key.is_none())
        .cloned()
        .collect();
    if !creating && !aggregates.is_empty() {
        let mut runner = Runner::new(
            tx,
            schema,
            Context::system().at(crate::now_ms()),
            Meter::new(Ceilings::unbounded(), Cut::Abort),
            tx.next_seq()?,
        );
        runner.event_free = true;
        runner.rewrite_legacy_maintained_references(&aggregates)?;
        for maintain in &aggregates {
            runner.rebuild_maintain(maintain)?;
        }
    }

    let generation = if creating || aggregates.is_empty() {
        generation
    } else {
        generation.checked_add(1)
            .ok_or_else(|| RuntimeError::Generation("generation overflow".into()))?
    };
    tx.execute(
        "UPDATE _backend SET maintained_identity_version=$1, generation=$2 WHERE singleton",
        &[&crate::schema::MAINTAINED_ID_VERSION, &store::signed(generation)?],
    )?;
    Ok(generation)
}
