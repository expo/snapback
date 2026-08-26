//! Transaction-lifetime permit activation and cleanup.

use super::*;

pub(super) fn activate<'tx>(
    transaction: &'tx TransactionIdentity,
    nonce: NonZeroU128,
    mutation: AuthorityMutation,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
) -> AuthorityTransitionResult<AuthorityWritePermit<'tx>> {
    let mut cell = transaction
        .authorizer_permit_cell
        .lock()
        .map_err(|_| AuthorityTransitionError::AuthorizerPoisoned)?;
    if cell.active.is_some() {
        return Err(AuthorityTransitionError::PermitAlreadyActive);
    }
    cell.active = Some(ActivePermit {
        connection_epoch: transaction.connection_epoch,
        nonce,
        mutation,
        write_set,
        successor_digest,
    });
    drop(cell);
    Ok(AuthorityWritePermit {
        transaction,
        nonce,
        mutation,
        successor_digest,
        _not_send_sync: PhantomData,
    })
}

impl Drop for AuthorityWritePermit<'_> {
    fn drop(&mut self) {
        let Ok(mut cell) = self.transaction.authorizer_permit_cell.lock() else {
            return;
        };
        let owns_active = cell.active.as_ref().is_some_and(|active| {
            active.connection_epoch == self.transaction.connection_epoch
                && active.nonce == self.nonce
                && active.mutation == self.mutation
                && active.successor_digest == self.successor_digest
        });
        if owns_active {
            cell.active = None;
        }
    }
}
