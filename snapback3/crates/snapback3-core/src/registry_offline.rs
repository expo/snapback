//! Narrow offline APIs over the runtime's private engine and store.
// @ref LLP 1012#7-writes-offline — allocator custody and replay execution stay
// behind the certified Runtime rather than exposing mutable storage.

use crate::engine::{Context, Execution, RuntimeError};
use crate::offline::{ReplayCommit, ReplayGrant};
use crate::registry::Runtime;

impl Runtime {
    /// Mint one principal-bound replay grant at server time `now`.
    pub fn mint_replay_grant(
        &mut self,
        principal: &str,
        now: i64,
    ) -> Result<ReplayGrant, RuntimeError> {
        self.engine.store_mut().mint_replay_grant(principal, now)
    }

    /// Age out grants past their expiry and intents older than the grant
    /// lifetime, in one statement batch.
    pub fn sweep_offline(&self, now: i64) -> Result<(), RuntimeError> {
        self.engine.store().sweep_offline(now)
    }

    /// Programs executed by this runtime since it opened: every query,
    /// mutation, and replay, counted once. Resume's cost is measured in these
    /// (LLP 1012 §14), never in held pages.
    pub fn executions(&self) -> u64 {
        self.executions
    }

    /// Execute a mutation under a replay envelope: pinned ids in `context`,
    /// trace validation and the intent ledger inside the mutation's transaction.
    pub fn execute_replay(
        &mut self,
        op: &str,
        context: Context,
        replay: &ReplayCommit,
    ) -> Result<Execution, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
        let (program, certificate) = self
            .generation
            .programs
            .get(op)
            .cloned()
            .ok_or_else(|| RuntimeError::OpUnknown(op.to_owned()))?;
        self.engine
            .execute_replay(&program, &certificate, context, replay)
    }
}

// @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction —
// final values may alias a once cell after field provenance has been consumed.
// Raw receipt rows remain the schema-valid custody proof; only the result changes.
impl Runtime {
    pub(super) fn redact_consumed_images(
        &self,
        execution: &mut Execution,
        principal: &str,
    ) -> Result<(), RuntimeError> {
        use crate::assets::column_asset_uses;
        let mut consumed = std::collections::BTreeMap::new();
        let mut exhausted = std::collections::BTreeSet::new();
        for row in &execution.receipt.rows {
            let Some(table) = self.generation.schema().tables.get(&row.table) else {
                continue;
            };
            let mut present = false;
            let mut all_viewed = true;
            for (column, kind) in table.columns.iter().filter(|(_, kind)| kind.is_once()) {
                for asset in column_asset_uses(kind, row.row.field(column).ok(), column)? {
                    present = true;
                    if self
                        .engine
                        .store()
                        .asset_viewed(&asset.record.id, principal)?
                    {
                        consumed.insert(asset.record.id.clone(), asset.record);
                    } else {
                        all_viewed = false;
                    }
                }
            }
            if present && all_viewed {
                exhausted.insert((row.table.clone(), row.id.clone()));
            }
        }
        if !consumed.is_empty() {
            redact_image_result(
                &mut execution.result,
                &mut execution.result_provenance,
                &consumed,
                &exhausted,
            );
        }
        Ok(())
    }
}

fn redact_image_result(
    value: &mut crate::Value,
    provenance: &mut crate::engine::ResultProvenance,
    consumed: &std::collections::BTreeMap<String, crate::assets::AssetRecord>,
    exhausted: &std::collections::BTreeSet<(String, String)>,
) -> bool {
    use crate::{Value, engine::ResultProvenance as Provenance};
    let row_exhausted = matches!(provenance, Provenance::Row { table, id } if exhausted.contains(&(table.clone(), id.clone())));
    let descriptor = if let Value::Map(fields) = value {
        fields
            .get("id")
            .and_then(|id| id.as_str().ok())
            .and_then(|id| consumed.get(id))
            .is_some_and(|record| {
                crate::assets::parse_asset_record(crate::AssetKind::Image, value, "result")
                    .ok()
                    .as_ref()
                    == Some(record)
            })
    } else {
        false
    };
    if row_exhausted || descriptor {
        *value = Value::Null;
        *provenance = Provenance::None;
        return true;
    }
    let mut changed = false;
    match value {
        Value::Row(fields) | Value::Map(fields) => {
            for (key, item) in fields {
                let mut none = Provenance::None;
                let child = match provenance {
                    Provenance::Object(children) => children.get_mut(key).unwrap_or(&mut none),
                    _ => &mut none,
                };
                changed |= redact_image_result(item, child, consumed, exhausted);
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter_mut().enumerate() {
                let mut none = Provenance::None;
                let child = match provenance {
                    Provenance::Array(children) => children.get_mut(index).unwrap_or(&mut none),
                    _ => &mut none,
                };
                changed |= redact_image_result(item, child, consumed, exhausted);
            }
        }
        _ => {}
    }
    // A partially consumed row must emit its redacted value, not a reference
    // that would expand back to the unchanged source image in the raw pool.
    if changed && matches!(provenance, Provenance::Row { .. }) {
        *provenance = Provenance::None;
    }
    changed
}
