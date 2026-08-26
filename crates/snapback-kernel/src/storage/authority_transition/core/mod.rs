//! Connection-owned protected-effect scope.

use rusqlite::Connection;

mod evidence;
mod registry;
mod writers;

#[derive(Debug)]
enum AuthorityTransitionError {
    Sqlite(rusqlite::Error),
    CorruptResourceGuard,
    ResourceGuardChanged,
    ProofRefused,
    ScopeAlreadyActive,
    ScopeGenerationExhausted,
    ScopeStatePoisoned,
    SharedFileCustodyUnproven,
    HostileSchema(&'static str),
    UnexpectedWriteCount { expected: usize, actual: usize },
}

impl From<rusqlite::Error> for AuthorityTransitionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

type AuthorityTransitionResult<T> = Result<T, AuthorityTransitionError>;

#[derive(Clone, Eq, PartialEq)]
struct DurableOrigin([u8; 32]);

#[derive(Clone, Eq, PartialEq)]
struct ResourceBinding([u8; 32]);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RegisteredOperation {
    IssuePasswordSession,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScopePhase {
    Idle {
        generation: u64,
    },
    Active {
        generation: u64,
        operation: RegisteredOperation,
    },
    Committing {
        generation: u64,
    },
}

struct AuthorizerCell {
    phase: ScopePhase,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StatementCachePolicy {
    Disabled,
}

#[allow(unexpected_cfgs)]
mod compile_fail {
    #[cfg(snapback_authority_compile_fail)]
    use super::evidence::ProtectedTx;
    #[cfg(snapback_authority_compile_fail)]
    use super::*;

    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_writer_raw_access),
        not(snapback_authority_mutation_expose_initialized_limbs)
    ))]
    include!("compile_fail/commit_protected_tx.rs");
    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_writer_raw_access),
        not(snapback_authority_mutation_expose_initialized_limbs)
    ))]
    include!("compile_fail/deref_protected_tx.rs");
    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_writer_raw_access),
        not(snapback_authority_mutation_expose_initialized_limbs)
    ))]
    include!("compile_fail/open_effect_scope_from_writer.rs");
    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_expose_initialized_limbs)
    ))]
    include!("compile_fail/raw_connection_accessor.rs");
    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_writer_raw_access)
    ))]
    include!("compile_fail/clone_writer_policy.rs");
    #[cfg(all(
        snapback_authority_compile_fail,
        not(snapback_authority_mutation_writer_raw_access)
    ))]
    include!("compile_fail/swap_initialized_writer_policy.rs");
}
