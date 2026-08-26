//! Private verification, derivation, scoped effect, and commit choreography.
#![allow(unexpected_cfgs)]

use super::*;
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};
use std::sync::Arc;

mod protected_tx;

use protected_tx::CompositePolicyState;
#[cfg(test)]
use protected_tx::guarded_from_hostile_schema_for_effect_time_test;
pub(super) use protected_tx::{DerivedPasswordSession, GuardedConnection, ProtectedTx};

pub(super) struct RawPasswordProof {
    pub(super) user_selector: String,
    pub(super) presented_secret: Vec<u8>,
}

struct ScopeReset {
    state: Arc<CompositePolicyState>,
    generation: u64,
}

impl Drop for ScopeReset {
    fn drop(&mut self) {
        if let Ok(mut cell) = self.state.transition.lock() {
            if matches!(
                cell.phase,
                ScopePhase::Active { generation, .. }
                    | ScopePhase::Committing { generation }
                    if generation == self.generation
            ) {
                cell.phase = ScopePhase::Idle {
                    generation: self.generation,
                };
            }
        }
    }
}

// @ref LLP 0303#the-governing-principle — the exact ceremony accepts raw
// selector/proof only. Subject, operation, write shape,
// successor columns, and scope generation are derived below this boundary.
pub(super) fn issue_password_session(
    guarded: &mut GuardedConnection,
    proof: RawPasswordProof,
) -> AuthorityTransitionResult<()> {
    execute_verified_effect(
        guarded,
        move |transaction| verify_and_derive_password_session(transaction, proof),
        |protected, derived| {
            let affected = writers::insert_password_session(protected, derived)?;
            #[cfg(not(snapback_authority_mutation_ignore_write_count))]
            if affected != 1 {
                return Err(AuthorityTransitionError::UnexpectedWriteCount {
                    expected: 1,
                    actual: affected,
                });
            }
            #[cfg(snapback_authority_mutation_ignore_write_count)]
            let _ = affected;
            Ok(())
        },
    )
}

// This is deliberately private to `evidence`: `core::writers` cannot open a
// scope. The higher-ranked writer borrow cannot be returned or retained by a
// safe caller, and this function alone finalizes the transaction.
fn execute_verified_effect<T, Verify, Write>(
    guarded: &mut GuardedConnection,
    verify_and_derive: Verify,
    writer: Write,
) -> AuthorityTransitionResult<T>
where
    Verify: for<'transaction> FnOnce(
        &Transaction<'transaction>,
    ) -> AuthorityTransitionResult<DerivedPasswordSession>,
    Write: for<'scope> FnOnce(
        &mut ProtectedTx<'scope>,
        &DerivedPasswordSession,
    ) -> AuthorityTransitionResult<T>,
{
    debug_assert_eq!(
        guarded.statement_cache_policy,
        StatementCachePolicy::Disabled
    );
    let transaction = guarded
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;

    // @ref LLP 0311#4-requirements — R2: the durable resource fact is read from
    // this exact connection inside the same IMMEDIATE effect transaction.
    registry::guard_matches_connection(
        &transaction,
        &guarded.durable_origin,
        &guarded.resource_binding,
    )?;
    let derived = verify_and_derive(&transaction)?;

    let generation = {
        let mut cell = guarded
            .authorizer_state
            .transition
            .lock()
            .map_err(|_| AuthorityTransitionError::ScopeStatePoisoned)?;
        let ScopePhase::Idle {
            generation: previous_generation,
        } = cell.phase
        else {
            return Err(AuthorityTransitionError::ScopeAlreadyActive);
        };
        let generation = previous_generation
            .checked_add(1)
            .ok_or(AuthorityTransitionError::ScopeGenerationExhausted)?;
        cell.phase = ScopePhase::Active {
            generation,
            operation: RegisteredOperation::IssuePasswordSession,
        };
        generation
    };
    let reset = ScopeReset {
        state: Arc::clone(&guarded.authorizer_state),
        generation,
    };

    let result = {
        let mut protected = ProtectedTx::new(
            &transaction,
            &guarded.authorizer_state,
            generation,
            RegisteredOperation::IssuePasswordSession,
        );
        writer(&mut protected, &derived)
    };

    {
        let mut cell = guarded
            .authorizer_state
            .transition
            .lock()
            .map_err(|_| AuthorityTransitionError::ScopeStatePoisoned)?;
        if !matches!(
            cell.phase,
            ScopePhase::Active {
                generation: active_generation,
                operation: RegisteredOperation::IssuePasswordSession,
            } if active_generation == generation
        ) {
            return Err(AuthorityTransitionError::ScopeAlreadyActive);
        }
        cell.phase = ScopePhase::Committing { generation };
    }

    let finalized = match result {
        Ok(value) => {
            transaction.commit()?;
            Ok(value)
        }
        Err(error) => {
            transaction.rollback()?;
            Err(error)
        }
    };
    drop(reset);
    finalized
}

fn verify_and_derive_password_session(
    transaction: &Transaction<'_>,
    proof: RawPasswordProof,
) -> AuthorityTransitionResult<DerivedPasswordSession> {
    let credential = transaction
        .query_row(
            "SELECT user_id, secret_digest, assurance_generation
             FROM _auth_password_credentials
             WHERE user_id = ?1",
            [&proof.user_selector],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or(AuthorityTransitionError::ProofRefused)?;
    let presented_digest: [u8; 32] = Sha256::digest(&proof.presented_secret).into();
    if credential.0.is_empty() || credential.1.as_slice() != presented_digest || credential.2 < 0 {
        return Err(AuthorityTransitionError::ProofRefused);
    }

    // @ref LLP 0303#the-governing-principle — both the exact durable key and
    // canonical subject come from the verified credential row. The caller's
    // selector locates a candidate but never becomes successor state.
    #[allow(unexpected_cfgs)]
    let (session_id, subject_user_id) = if cfg!(snapback_authority_mutation_supply_selector) {
        (proof.user_selector.clone(), proof.user_selector)
    } else {
        (
            derive_session_id(&credential.0, &credential.1, credential.2),
            credential.0,
        )
    };
    Ok(DerivedPasswordSession::new(
        session_id,
        subject_user_id,
        credential.2,
    ))
}

fn derive_session_id(
    canonical_user_id: &str,
    secret_digest: &[u8],
    assurance_generation: i64,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback-password-session-v1\0");
    digest.update((canonical_user_id.len() as u64).to_be_bytes());
    digest.update(canonical_user_id.as_bytes());
    digest.update(secret_digest);
    digest.update(assurance_generation.to_be_bytes());
    let bytes: [u8; 32] = digest.finalize().into();
    let mut encoded = String::with_capacity(67);
    encoded.push_str("ps_");
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests;
