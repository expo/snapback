//! One adoption decision for opening and replacing a live backend.
use super::*;
use store_identity::HISTORY_OWNER;

pub(super) struct Adoption {
    metadata: BTreeMap<String, String>,
    pub expected: BTreeMap<String, Option<String>>,
    pub clear: bool,
    pub invalidate_native: bool,
}

pub(super) enum Entry {
    Open,
    Adopt,
}

impl Adoption {
    // Return the binding from the exact metadata installed, only after commit.
    // The caller's requested principal is no longer an ownership record here.
    pub(super) fn install<S: DeviceStore>(
        &self,
        store: &mut S,
        schema: &Schema,
    ) -> Result<String, RuntimeError> {
        store.install_checked(schema, &self.metadata, self.clear, &self.expected)?;
        Ok(self.metadata[HISTORY_OWNER].clone())
    }
}

pub(super) fn owner_refusal() -> RuntimeError {
    RuntimeError::Structural {
        code: "SNAPBACK_HISTORY_OWNER",
        message: "this store belongs to another or unknown principal and holds delivered history that cannot be reacquired; open a different device store for this principal, preserving this store for its original owner".into(),
    }
}

// A live handle cannot acquire or observe on a binding another opener changed.
// This is independent of backend/native incarnation; re-adoption is not its remedy.
pub(super) fn require_binding<T: DeviceTx>(tx: &T, viewer: &str) -> Result<(), RuntimeError> {
    if tx.meta(HISTORY_OWNER)?.as_deref() != Some(viewer) {
        return Err(owner_refusal());
    }
    Ok(())
}

// Inspect physical rows before installing a schema (memory has no indexes yet).
// A predicted deletion cannot hide the confirmed copy beneath it. Missing group
// evidence is not proof that an old delivered copy can be reacquired.
fn has_retained<T: DeviceTx>(tx: &T, previous: Option<&Schema>, incoming: &Schema) -> Result<bool, RuntimeError> {
    let groups = history::classified(tx)?;
    let bases: BTreeMap<_, _> = tx.base_entries()?.into_iter()
        .map(|(name, id, image)| ((name, id), image)).collect();
    let retained = |name: &str, row: &Value| -> Result<bool, RuntimeError> {
        // Only the persisted schema can classify the old physical copy. An
        // incoming rename/drop/retention change supplies no evidence about it.
        let Some(old) = previous.and_then(|schema| schema.table(name)) else {
            return Ok(true);
        };
        for table in std::iter::once(old).chain(incoming.table(name)) {
            if table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory
                && groups.get(name).and_then(|g| g.get(&history::row_key(table, row).ok()?))
                    != Some(&history::Membership::Held)
            {
                return Ok(true);
            }
        }
        Ok(false)
    };
    for name in tx.stored_tables()? {
        let mut after: Option<String> = None;
        loop {
            let rows = tx.stored_rows_after(&name, after.as_deref(), 256)?;
            if rows.is_empty() {
                break;
            }
            let finished = rows.len() < 256;
            for row in rows {
                let id = row.field("id")?.as_str()?.to_owned();
                // A base (including absence) supersedes the predicted image.
                // Non-null bases are classified below, including deleted rows.
                if !bases.contains_key(&(name.clone(), id.clone())) && retained(&name, &row)? {
                    return Ok(true);
                }
                after = Some(id);
            }
            if finished {
                break;
            }
        }
    }
    for ((name, _), image) in bases {
        if let Some(image) = image {
            if retained(&name, &decoded::<Value>(&image)?)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

// @ref LLP 3000.001#reliability-retention — ownership, preservation and read authority are separate decisions.
pub(super) fn plan<S: DeviceStore>(
    store: &mut S,
    backend: &Backend,
    viewer: &str,
    entry: Entry,
    mut expected: BTreeMap<String, Option<String>>,
) -> Result<Adoption, RuntimeError> {
    if viewer.is_empty() {
        return Err(RuntimeError::Input(
            "opening a device requires its principal".into(),
        ));
    }
    let tx = store.read_transaction()?;
    // Compare the facts used for this decision in the installation transaction.
    // Another native owner cannot change ownership or acquisition between them.
    for key in [
        BACKEND,
        GENERATION,
        ACQUIRED,
        BACKEND_REQUIRED,
        STORE_ID,
        SEND_REVISION,
        WATERMARK,
        HISTORY_OWNER,
        history::GROUPS,
        history::CLASSIFIED_GROUPS,
        NATIVE_DIGEST,
        SNAPSHOT_OWNER,
        SNAPSHOT_NEXT,
    ] {
        let value = tx.meta(key)?;
        if expected.get(key).is_some_and(|captured| captured != &value) {
            return Err(RuntimeError::Generation(
                "the backend adoption capture is obsolete; retry sync".into(),
            ));
        }
        expected.insert(key.to_owned(), value);
    }
    let previous: Option<Backend> = tx.meta(BACKEND)?.map(|text| decoded(&text)).transpose()?;
    let owner = tx.meta(HISTORY_OWNER)?;
    let owner_changed = owner.as_deref() != Some(viewer);
    let schemas = previous
        .iter()
        .map(|old| &old.schema)
        .chain(std::iter::once(&backend.schema));
    if owner_changed && has_retained(&tx, previous.as_ref().map(|old| &old.schema), &backend.schema).unwrap_or(true) {
        // An incomplete or unreadable physical inventory cannot authorize reuse.
        return Err(owner_refusal());
    }
    // Unknown provenance cannot become trusted just by writing the binding.
    let unknown_history = owner.is_none()
        && schemas.clone().any(|schema| {
            schema
                .tables
                .values()
                .any(|table| table.sync.is_some() && table.leave == LeavePolicy::DeliveredHistory)
        });
    let principal_changed =
        owner.as_deref().is_some_and(|owner| owner != viewer) || unknown_history;
    let held = meta_u64(&tx, GENERATION)?;
    let generation_changed = held != 0 && held != backend.generation;
    let replacement = tx.meta(BACKEND_REQUIRED)?.is_some_and(|v| !v.is_empty());
    let reset = generation_changed || principal_changed || replacement;
    // The literal-default lifecycle is unchanged, including added-table
    // acquisition and its cleared held/left map. Only a whole-schema equality
    // on a changed generation adds preservation of that map.
    let program_only = generation_changed
        && !principal_changed
        && !replacement
        && previous
            .as_ref()
            .is_some_and(|old| old.schema == backend.schema);
    let literal = previous.as_ref().is_some_and(|old| {
        snapback4_core::successor::keeps_literal_default_images(&old.schema, &backend.schema)
    });
    let keep_images = !principal_changed && ((program_only && !replacement) || literal);
    // @ref LLP 3000.007#18.3 — added tables still require acquisition.
    let keep_acquired = keep_images
        && previous
            .as_ref()
            .is_some_and(|old| old.schema.tables.len() == backend.schema.tables.len())
        && tx.meta(ACQUIRED)? == Some(held.to_string());
    let revision = meta_u64(&tx, SEND_REVISION)?;
    let classification = if reset && keep_images && !program_only {
        Some(encoded(&history::classified(&tx)?)?)
    } else { None };
    tx.rollback()?;
    let mut metadata = BTreeMap::from([
        (BACKEND.to_owned(), encoded(backend)?),
        (GENERATION.to_owned(), backend.generation.to_string()),
        (
            BACKEND_IDENTITY.to_owned(),
            store_identity::backend_identity(backend),
        ),
        // Reserve the owner before the first acquisition can publish any rows.
        (HISTORY_OWNER.to_owned(), viewer.to_owned()),
    ]);
    if owner_changed && (previous.is_some() || held != 0 || revision != 0) {
        // Fence captures even when generation and watermark are unchanged.
        let revision = revision
            .checked_add(1)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(|| RuntimeError::Store("send revision overflow".into()))?;
        metadata.insert(SEND_REVISION.into(), revision.to_string());
    }
    if reset {
        metadata.insert(WATERMARK.into(), "0".into());
        metadata.insert(
            ACQUIRED.into(),
            if keep_acquired {
                backend.generation.to_string()
            } else {
                String::new()
            },
        );
        invalidate_native(&mut metadata);
        if !program_only {
            metadata.insert(history::GROUPS.into(), "{}".into());
            metadata.insert(history::CLASSIFIED_GROUPS.into(), classification.unwrap_or_else(|| "{}".into()));
        }
        metadata.insert(history::STAGED_GROUPS.into(), "{}".into());
        metadata.insert(boundary::STAGED.into(), "{}".into());
        if !keep_acquired {
            metadata.insert(boundary::BOUNDARIES.into(), "{}".into());
        }
    }
    if replacement {
        invalidate_native(&mut metadata);
    }
    if matches!(entry, Entry::Adopt) {
        // Opening (including offline restart) retains a pending replacement
        // obligation. Explicit adoption completes it with this same decision
        // about replacement and image preservation, in the checked install.
        metadata.insert(BACKEND_REQUIRED.into(), String::new());
    }
    Ok(Adoption {
        metadata,
        expected,
        clear: reset && !keep_images,
        invalidate_native: reset || replacement,
    })
}

#[cfg(test)]
mod tests;
