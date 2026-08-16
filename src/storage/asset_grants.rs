use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::json;

use super::SnapbackResult;
use crate::assets::{
    self, AssetAvailability, AssetGrantProvenanceV1, AssetGrantRecordV1, AssetGrantState,
    AssetReceiptEventV1, AssetReceiptV1, BufferedAssetGrantOp,
};
use crate::diagnostic::SnapbackError;

#[derive(Clone)]
struct StoredGrant {
    app_id: String,
    record: AssetGrantRecordV1,
}

fn invalid(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "assets", message)
}

fn decode_grant(json: &str) -> SnapbackResult<AssetGrantRecordV1> {
    serde_json::from_str(json).map_err(|error| {
        invalid(
            "SNAPBACK_ASSET_RECORD_INVALID",
            format!("stored asset grant does not decode: {error}"),
        )
    })
}

fn load_asset(conn: &Connection, asset_id: &str) -> SnapbackResult<assets::AssetRecordV1> {
    let json: Option<String> = conn
        .query_row(
            "SELECT record_json FROM _snapback_asset_records_v1 WHERE asset_id = ?1",
            [asset_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(json) = json else {
        return Err(
            invalid("SNAPBACK_ASSET_UNKNOWN", "the asset does not exist")
                .with_details(json!({ "assetId": asset_id })),
        );
    };
    serde_json::from_str(&json).map_err(|error| {
        invalid(
            "SNAPBACK_ASSET_RECORD_INVALID",
            format!("stored asset record does not decode: {error}"),
        )
    })
}

fn load_grants(conn: &Connection) -> SnapbackResult<BTreeMap<String, StoredGrant>> {
    let mut statement = conn
        .prepare("SELECT app_id, record_json FROM _snapback_asset_grants_v1 ORDER BY grant_id")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut grants = BTreeMap::new();
    for row in rows {
        let (app_id, json) = row?;
        let record = decode_grant(&json)?;
        grants.insert(record.grant_id.clone(), StoredGrant { app_id, record });
    }
    Ok(grants)
}

/// Return only grants minted by the generated collection custodian for the
/// exact collection generation and item identities. Authored handler mutation
/// names cannot contain the `|` separator, so they cannot alias this lineage.
pub(super) fn collection_managed_grants(
    conn: &Connection,
    generation: &str,
    item_ids: &BTreeSet<String>,
) -> SnapbackResult<Vec<AssetGrantRecordV1>> {
    let prefix = format!("asset-collection.v1|{generation}|");
    Ok(load_grants(conn)?
        .into_values()
        .map(|stored| stored.record)
        .filter(|record| {
            let Some(rest) = record.provenance.mutation.strip_prefix(&prefix) else {
                return false;
            };
            let Some((item_id, _)) = rest.split_once('|') else {
                return false;
            };
            item_ids.contains(item_id)
        })
        .collect())
}

/// Framework parent teardown is itself the authority to retire grants whose
/// lineage proves they belong to the deleted collection item. Grouping by the
/// live asset owner lets the ordinary closed revoke machine perform every
/// receipt, GC-clock, and state transition rather than introducing a second
/// deletion path.
pub(super) fn revoke_collection_managed_in_tx(
    tx: &Transaction<'_>,
    generation: &str,
    item_ids: &BTreeSet<String>,
    at_ms: u64,
) -> SnapbackResult<BTreeSet<String>> {
    let grants = collection_managed_grants(tx, generation, item_ids)?;
    let mut by_owner: BTreeMap<String, Vec<BufferedAssetGrantOp>> = BTreeMap::new();
    for grant in grants {
        let asset = load_asset(tx, &grant.asset_id)?;
        by_owner
            .entry(asset.owner_principal)
            .or_default()
            .push(BufferedAssetGrantOp::Revoke {
                grant_id: grant.grant_id,
                at_ms,
            });
    }
    let mut affected = BTreeSet::new();
    for (owner, ops) in by_owner {
        affected.extend(apply_in_tx(tx, &owner, &ops)?);
    }
    Ok(affected)
}

fn validate_principal(principal: &str) -> SnapbackResult<()> {
    if principal.trim().is_empty() || principal.len() > 512 {
        return Err(invalid(
            "SNAPBACK_ASSET_GRANT_INPUT_INVALID",
            "asset grant principal must be a non-empty string of at most 512 bytes",
        ));
    }
    Ok(())
}

fn apply_to_snapshot(
    conn: &Connection,
    caller: &str,
    grants: &mut BTreeMap<String, StoredGrant>,
    op: &BufferedAssetGrantOp,
) -> SnapbackResult<String> {
    // @ref LLP 0210#d5--recipient-scoped-authority-recipe-now-grant-ops-as-the-paved-spelling —
    // the closed v1 machine is owner-mint, principal-activate, and
    // owner-or-principal revoke; preview and final-lock validation share it.
    match op {
        BufferedAssetGrantOp::Grant {
            grant_id,
            asset_id,
            principal,
            state,
            mutation,
            at_ms,
        } => {
            validate_principal(principal)?;
            if grants.contains_key(grant_id) {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_CONFLICT",
                    "the generated asset grant id already exists",
                ));
            }
            let asset = load_asset(conn, asset_id)?;
            if !matches!(
                asset.availability,
                AssetAvailability::Pending | AssetAvailability::Ready
            ) {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_STATE_INVALID",
                    "only pending or ready assets can receive grants",
                )
                .with_details(json!({
                    "assetId": asset_id,
                    "availability": asset.availability,
                })));
            }
            if asset.owner_principal != caller {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                    "only the asset owner can mint a recipient grant",
                )
                .with_details(json!({ "assetId": asset_id })));
            }
            if !asset.grants_enabled {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANTS_UNDECLARED",
                    "the asset was admitted under an intent without grants: true",
                )
                .with_details(json!({ "assetId": asset_id, "intentId": asset.intent_id })));
            }
            let app_count = grants
                .values()
                .filter(|grant| grant.app_id == asset.app_id)
                .count() as u64;
            if app_count >= assets::ASSET_MAX_GRANTS_PER_APP {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED",
                    "the asset owner's app has reached its durable grant ceiling",
                )
                .with_details(json!({
                    "limit": assets::ASSET_MAX_GRANTS_PER_APP,
                    "observed": app_count,
                    "appId": asset.app_id,
                })));
            }
            grants.insert(
                grant_id.clone(),
                StoredGrant {
                    app_id: asset.app_id.clone(),
                    record: AssetGrantRecordV1 {
                        grant_id: grant_id.clone(),
                        asset_id: asset_id.clone(),
                        principal: principal.clone(),
                        state: *state,
                        provenance: AssetGrantProvenanceV1 {
                            minted_by: caller.to_owned(),
                            mutation: mutation.clone(),
                            at: *at_ms,
                        },
                    },
                },
            );
            Ok(asset_id.clone())
        }
        BufferedAssetGrantOp::Activate { grant_id, .. } => {
            let grant = grants.get_mut(grant_id).ok_or_else(|| {
                invalid(
                    "SNAPBACK_ASSET_GRANT_UNKNOWN",
                    "the asset grant does not exist",
                )
                .with_details(json!({ "grantId": grant_id }))
            })?;
            if grant.record.principal != caller {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                    "only the named grant principal can activate a pending grant",
                )
                .with_details(json!({ "grantId": grant_id })));
            }
            if grant.record.state != AssetGrantState::Pending {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_STATE_INVALID",
                    "only a pending asset grant can be activated",
                )
                .with_details(json!({ "grantId": grant_id })));
            }
            grant.record.state = AssetGrantState::Active;
            Ok(grant.record.asset_id.clone())
        }
        BufferedAssetGrantOp::Revoke { grant_id, .. } => {
            let grant = grants.get(grant_id).ok_or_else(|| {
                invalid(
                    "SNAPBACK_ASSET_GRANT_UNKNOWN",
                    "the asset grant does not exist",
                )
                .with_details(json!({ "grantId": grant_id }))
            })?;
            let asset = load_asset(conn, &grant.record.asset_id)?;
            if grant.record.principal != caller && asset.owner_principal != caller {
                return Err(invalid(
                    "SNAPBACK_ASSET_GRANT_FORBIDDEN",
                    "only the asset owner or named principal can revoke a grant",
                )
                .with_details(json!({ "grantId": grant_id })));
            }
            let asset_id = grant.record.asset_id.clone();
            grants.remove(grant_id);
            Ok(asset_id)
        }
    }
}

/// Handler-time refusal gives app code an immediate typed error. Every fact
/// is re-read by `apply_in_tx` under the final write lock, so this preview is
/// never treated as commit authority.
pub(crate) fn preview(
    conn: &Connection,
    caller: &str,
    staged: &[BufferedAssetGrantOp],
    proposed: &BufferedAssetGrantOp,
) -> SnapbackResult<()> {
    let mut grants = load_grants(conn)?;
    for op in staged {
        apply_to_snapshot(conn, caller, &mut grants, op)?;
    }
    apply_to_snapshot(conn, caller, &mut grants, proposed)?;
    Ok(())
}

fn receipt(grant: &AssetGrantRecordV1, event: AssetReceiptEventV1, at_ms: u64) -> AssetReceiptV1 {
    AssetReceiptV1 {
        receipt_id: assets::AssetFsStore::new_opaque_key(),
        operation_lineage: grant.provenance.mutation.clone(),
        event,
        asset_id: Some(grant.asset_id.clone()),
        attempt_id: None,
        at_ms,
        details: json!({
            "grantId": grant.grant_id,
            "principal": grant.principal,
            "state": grant.state,
        }),
    }
}

/// Revalidates and applies every staged edge in program order inside the
/// mutation transaction. A refusal aborts app writes, grant rows, receipts,
/// GC-clock changes, and the storage-version transition together.
pub(super) fn apply_in_tx(
    tx: &Transaction<'_>,
    caller: &str,
    ops: &[BufferedAssetGrantOp],
) -> SnapbackResult<BTreeSet<String>> {
    let mut snapshot = load_grants(tx)?;
    let mut affected = BTreeSet::new();
    for op in ops {
        let asset_id = apply_to_snapshot(tx, caller, &mut snapshot, op)?;
        affected.insert(asset_id.clone());
        match op {
            BufferedAssetGrantOp::Grant {
                grant_id,
                state,
                at_ms,
                ..
            } => {
                let stored = snapshot.get(grant_id).expect("validated grant is staged");
                let json = serde_json::to_string(&stored.record).map_err(|error| {
                    invalid(
                        "SNAPBACK_ASSET_RECORD_INVALID",
                        format!("asset grant does not serialize: {error}"),
                    )
                })?;
                tx.execute(
                    "INSERT INTO _snapback_asset_grants_v1
                         (grant_id, asset_id, app_id, principal, state, minted_by, record_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        stored.record.grant_id,
                        stored.record.asset_id,
                        stored.app_id,
                        stored.record.principal,
                        if *state == AssetGrantState::Active {
                            "active"
                        } else {
                            "pending"
                        },
                        stored.record.provenance.minted_by,
                        json,
                    ],
                )?;
                if *state == AssetGrantState::Active {
                    tx.execute(
                        "UPDATE _snapback_asset_records_v1 SET unreferenced_since_ms = NULL
                         WHERE asset_id = ?1",
                        [asset_id.as_str()],
                    )?;
                }
                assets::write_receipt(
                    tx,
                    &receipt(&stored.record, AssetReceiptEventV1::GrantMinted, *at_ms),
                )?;
            }
            BufferedAssetGrantOp::Activate { grant_id, at_ms } => {
                let stored = snapshot
                    .get(grant_id)
                    .expect("validated grant remains present");
                let json = serde_json::to_string(&stored.record).map_err(|error| {
                    invalid(
                        "SNAPBACK_ASSET_RECORD_INVALID",
                        format!("asset grant does not serialize: {error}"),
                    )
                })?;
                tx.execute(
                    "UPDATE _snapback_asset_grants_v1
                     SET state = 'active', record_json = ?2 WHERE grant_id = ?1",
                    params![grant_id, json],
                )?;
                tx.execute(
                    "UPDATE _snapback_asset_records_v1 SET unreferenced_since_ms = NULL
                     WHERE asset_id = ?1",
                    [asset_id.as_str()],
                )?;
                assets::write_receipt(
                    tx,
                    &receipt(&stored.record, AssetReceiptEventV1::GrantActivated, *at_ms),
                )?;
            }
            BufferedAssetGrantOp::Revoke { grant_id, at_ms } => {
                let json: String = tx.query_row(
                    "SELECT record_json FROM _snapback_asset_grants_v1 WHERE grant_id = ?1",
                    [grant_id],
                    |row| row.get(0),
                )?;
                let removed = decode_grant(&json)?;
                tx.execute(
                    "DELETE FROM _snapback_asset_grants_v1 WHERE grant_id = ?1",
                    [grant_id],
                )?;
                if removed.state == AssetGrantState::Active {
                    tx.execute(
                        "UPDATE _snapback_asset_records_v1
                         SET unreferenced_since_ms = ?2
                         WHERE asset_id = ?1 AND availability = 'ready'
                           AND NOT EXISTS (SELECT 1 FROM _snapback_asset_reference_edges_v1
                                           WHERE asset_id = ?1)
                           AND NOT EXISTS (SELECT 1 FROM _snapback_asset_grants_v1
                                           WHERE asset_id = ?1 AND state = 'active')",
                        params![asset_id, *at_ms as i64],
                    )?;
                }
                assets::write_receipt(
                    tx,
                    &receipt(&removed, AssetReceiptEventV1::GrantRevoked, *at_ms),
                )?;
            }
        }
    }
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use rusqlite::TransactionBehavior;

    use super::*;

    fn asset(asset_id: &str, availability: AssetAvailability) -> assets::AssetRecordV1 {
        assets::AssetRecordV1 {
            asset_id: asset_id.to_owned(),
            app_id: "app".to_owned(),
            intent_id: "app:upload".to_owned(),
            intent_name: "upload".to_owned(),
            intent_policy_hash: "sha256:grant-test".to_owned(),
            policy_generation: 1,
            owner_principal: "owner".to_owned(),
            delivery_profile: assets::AssetDeliveryProfile::PrivateStrict,
            read_access: assets::AssetReadAccessPolicy::OwnerOnly,
            grants_enabled: true,
            availability,
            primary_rendition_id: None,
            media_kind: None,
            lifecycle_generation: 1,
            created_at_ms: 1,
            updated_at_ms: 1,
            deleted_at_ms: None,
        }
    }

    fn grant_record(index: usize, asset_id: &str, state: AssetGrantState) -> AssetGrantRecordV1 {
        AssetGrantRecordV1 {
            grant_id: format!("agr_seed_{index}"),
            asset_id: asset_id.to_owned(),
            principal: "recipient".to_owned(),
            state,
            provenance: AssetGrantProvenanceV1 {
                minted_by: "owner".to_owned(),
                mutation: "mut_seed".to_owned(),
                at: 1,
            },
        }
    }

    fn insert_grant(tx: &Transaction<'_>, record: &AssetGrantRecordV1) {
        tx.execute(
            "INSERT INTO _snapback_asset_grants_v1
                 (grant_id, asset_id, app_id, principal, state, minted_by, record_json)
             VALUES (?1, ?2, 'app', ?3, ?4, ?5, ?6)",
            params![
                record.grant_id,
                record.asset_id,
                record.principal,
                if record.state == AssetGrantState::Active {
                    "active"
                } else {
                    "pending"
                },
                record.provenance.minted_by,
                serde_json::to_string(record).expect("encode grant"),
            ],
        )
        .expect("insert grant fixture");
    }

    #[test]
    fn asset_grant_gc_treats_only_active_edges_as_references() {
        let mut conn = Connection::open_in_memory().expect("memory sqlite");
        let tx = conn.transaction().expect("transaction");
        assets::create_infra(&tx).expect("asset infra");
        assets::insert_asset(&tx, &asset("pending-consent", AssetAvailability::Pending))
            .expect("pending asset");
        assets::insert_asset(&tx, &asset("pending-active", AssetAvailability::Pending))
            .expect("active pending asset");
        assets::insert_asset(&tx, &asset("ready-active", AssetAvailability::Ready))
            .expect("ready active asset");
        assets::insert_asset(&tx, &asset("ready-pending", AssetAvailability::Ready))
            .expect("ready pending asset");
        insert_grant(
            &tx,
            &grant_record(1, "pending-consent", AssetGrantState::Pending),
        );
        insert_grant(
            &tx,
            &grant_record(2, "pending-active", AssetGrantState::Active),
        );
        insert_grant(
            &tx,
            &grant_record(3, "ready-active", AssetGrantState::Active),
        );
        insert_grant(
            &tx,
            &grant_record(4, "ready-pending", AssetGrantState::Pending),
        );
        tx.execute(
            "UPDATE _snapback_asset_records_v1 SET unreferenced_since_ms = 1
             WHERE asset_id IN ('ready-active', 'ready-pending')",
            [],
        )
        .expect("start ready gc clock");

        let pending = assets::reclaimable_pending_assets(&tx, 2).expect("pending candidates");
        assert_eq!(
            pending
                .iter()
                .map(|record| record.asset_id.as_str())
                .collect::<Vec<_>>(),
            vec!["pending-consent"],
            "pending consent does not protect bytes; active authority does"
        );
        assert_eq!(
            assets::reclaimable_reference_gc_assets(&tx, 2)
                .expect("reference candidates")
                .into_iter()
                .map(|record| record.asset_id)
                .collect::<Vec<_>>(),
            vec!["ready-pending"],
            "active grants protect ready assets, while pending grants do not"
        );
        assets::insert_reference_edge(
            &tx,
            "app",
            "ready-pending",
            "messages",
            "message-1",
            "asset",
            3,
        )
        .expect("typed reference protects the pending window");
        apply_in_tx(
            &tx,
            "recipient",
            &[BufferedAssetGrantOp::Activate {
                grant_id: "agr_seed_4".to_owned(),
                at_ms: 3,
            }],
        )
        .expect("activation after the grace boundary succeeds with a typed reference");
    }

    #[test]
    fn asset_grant_quota_boundary_serializes_concurrent_mints() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("grant-quota.sqlite");
        {
            let mut conn = Connection::open(&path).expect("open fixture");
            let tx = conn.transaction().expect("fixture transaction");
            assets::create_infra(&tx).expect("asset infra");
            assets::insert_asset(&tx, &asset("quota-asset", AssetAvailability::Ready))
                .expect("quota asset");
            for index in 0..(assets::ASSET_MAX_GRANTS_PER_APP as usize - 1) {
                insert_grant(
                    &tx,
                    &grant_record(index, "quota-asset", AssetGrantState::Pending),
                );
            }
            tx.commit().expect("seed quota boundary");
        }

        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for index in 0..2 {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                let mut conn = Connection::open(path).expect("worker connection");
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .expect("busy timeout");
                barrier.wait();
                let tx = conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)
                    .expect("serialized write lock");
                let op = BufferedAssetGrantOp::Grant {
                    grant_id: format!("agr_concurrent_{index}"),
                    asset_id: "quota-asset".to_owned(),
                    principal: format!("recipient-{index}"),
                    state: AssetGrantState::Pending,
                    mutation: format!("mut_concurrent_{index}"),
                    at_ms: 2,
                };
                match apply_in_tx(&tx, "owner", &[op]) {
                    Ok(_) => {
                        tx.commit().expect("winner commit");
                        Ok(())
                    }
                    Err(error) => Err(error.diagnostic.code),
                }
            }));
        }
        barrier.wait();
        let outcomes = workers
            .into_iter()
            .map(|worker| worker.join().expect("quota worker"))
            .collect::<Vec<_>>();
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| {
                    matches!(outcome, Err(code) if code == "SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED")
                })
                .count(),
            1,
            "the final-lock quota check admits exactly one boundary contender"
        );
        let conn = Connection::open(&path).expect("inspect quota");
        let count: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_asset_grants_v1 WHERE app_id = 'app'",
                [],
                |row| row.get(0),
            )
            .expect("grant count");
        assert_eq!(count, assets::ASSET_MAX_GRANTS_PER_APP);

        let mut conn = Connection::open(path).expect("inspect quota transitions");
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("quota transition lock");
        let over = BufferedAssetGrantOp::Grant {
            grant_id: "agr_over_limit".to_owned(),
            asset_id: "quota-asset".to_owned(),
            principal: "recipient-over".to_owned(),
            state: AssetGrantState::Pending,
            mutation: "mut_over_limit".to_owned(),
            at_ms: 3,
        };
        assert_eq!(
            apply_in_tx(&tx, "owner", std::slice::from_ref(&over))
                .expect_err("over-limit mint refuses")
                .diagnostic
                .code,
            "SNAPBACK_ASSET_GRANT_QUOTA_EXCEEDED"
        );
        apply_in_tx(
            &tx,
            "owner",
            &[
                BufferedAssetGrantOp::Revoke {
                    grant_id: "agr_seed_0".to_owned(),
                    at_ms: 4,
                },
                BufferedAssetGrantOp::Grant {
                    grant_id: "agr_after_revoke".to_owned(),
                    asset_id: "quota-asset".to_owned(),
                    principal: "recipient-remint".to_owned(),
                    state: AssetGrantState::Active,
                    mutation: "mut_after_revoke".to_owned(),
                    at_ms: 4,
                },
            ],
        )
        .expect("revoke releases quota for a same-transaction remint");
        tx.commit().expect("commit revoke and remint");
    }

    #[test]
    fn asset_grant_activation_revoke_race_linearizes_without_resurrection() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("grant-race.sqlite");
        {
            let mut conn = Connection::open(&path).expect("open fixture");
            let tx = conn.transaction().expect("fixture transaction");
            assets::create_infra(&tx).expect("asset infra");
            assets::insert_asset(&tx, &asset("race-asset", AssetAvailability::Ready))
                .expect("race asset");
            insert_grant(
                &tx,
                &AssetGrantRecordV1 {
                    grant_id: "agr_race".to_owned(),
                    ..grant_record(0, "race-asset", AssetGrantState::Pending)
                },
            );
            tx.commit().expect("seed pending grant");
        }
        let barrier = Arc::new(Barrier::new(3));
        let participants = [
            (
                "recipient",
                BufferedAssetGrantOp::Activate {
                    grant_id: "agr_race".to_owned(),
                    at_ms: 2,
                },
            ),
            (
                "owner",
                BufferedAssetGrantOp::Revoke {
                    grant_id: "agr_race".to_owned(),
                    at_ms: 2,
                },
            ),
        ];
        let workers = participants.map(|(caller, op)| {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let mut conn = Connection::open(path).expect("race connection");
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .expect("busy timeout");
                barrier.wait();
                let tx = conn
                    .transaction_with_behavior(TransactionBehavior::Immediate)
                    .expect("serialized write lock");
                match apply_in_tx(&tx, caller, &[op]) {
                    Ok(_) => {
                        tx.commit().expect("race winner commit");
                        None
                    }
                    Err(error) => Some(error.diagnostic.code),
                }
            })
        });
        barrier.wait();
        let outcomes = workers.map(|worker| worker.join().expect("race worker"));
        assert!(
            outcomes.iter().all(|outcome| {
                outcome
                    .as_deref()
                    .is_none_or(|code| code == "SNAPBACK_ASSET_GRANT_UNKNOWN")
            }),
            "the only losing outcome is activation observing the prior revoke"
        );
        let conn = Connection::open(path).expect("inspect race");
        let count: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_asset_grants_v1 WHERE grant_id = 'agr_race'",
                [],
                |row| row.get(0),
            )
            .expect("race grant count");
        assert_eq!(
            count, 0,
            "revoke wins the final state and activation cannot resurrect"
        );
    }
}
