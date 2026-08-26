//! Private verification, derivation, scoped effect, and commit choreography.

use super::*;
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};

pub(super) struct RawPasswordProof {
    pub(super) user_selector: String,
    pub(super) presented_secret: Vec<u8>,
}

pub(super) struct PasswordSessionPayload {
    pub(super) session_id: String,
}

struct DerivedPasswordSession {
    session_id: String,
    subject_user_id: String,
    assurance_generation: i64,
}

struct ScopeReset {
    cell: Arc<Mutex<AuthorizerCell>>,
    generation: u64,
}

impl Drop for ScopeReset {
    fn drop(&mut self) {
        if let Ok(mut cell) = self.cell.lock() {
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
// selector/proof and ordinary payload only. Subject, operation, write shape,
// successor columns, and scope generation are derived below this boundary.
pub(super) fn issue_password_session(
    guarded: &mut GuardedConnection,
    proof: RawPasswordProof,
    payload: PasswordSessionPayload,
) -> AuthorityTransitionResult<()> {
    execute_verified_effect(
        guarded,
        move |transaction| verify_and_derive_password_session(transaction, proof, payload),
        |protected, derived| {
            writers::insert_password_session(
                protected,
                &derived.session_id,
                &derived.subject_user_id,
                derived.assurance_generation,
            )?;
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
            .authorizer_cell
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
        cell: Arc::clone(&guarded.authorizer_cell),
        generation,
    };

    let result = {
        let mut protected = ProtectedTx {
            connection: &transaction,
            authorizer_cell: &guarded.authorizer_cell,
            generation,
            operation: RegisteredOperation::IssuePasswordSession,
            _scope: PhantomData,
            _not_send_sync: PhantomData,
        };
        writer(&mut protected, &derived)
    };

    {
        let mut cell = guarded
            .authorizer_cell
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
    payload: PasswordSessionPayload,
) -> AuthorityTransitionResult<DerivedPasswordSession> {
    let credential = transaction
        .query_row(
            "SELECT secret_digest, assurance_generation
             FROM _auth_password_credentials
             WHERE user_id = ?1",
            [&proof.user_selector],
            |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
        .ok_or(AuthorityTransitionError::ProofRefused)?;
    let presented_digest: [u8; 32] = Sha256::digest(&proof.presented_secret).into();
    if credential.0.as_slice() != presented_digest {
        return Err(AuthorityTransitionError::ProofRefused);
    }
    Ok(DerivedPasswordSession {
        session_id: payload.session_id,
        subject_user_id: proof.user_selector,
        assurance_generation: credential.1,
    })
}

#[cfg(test)]
mod tests;
