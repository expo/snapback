//! Authority facts that exist only after kernel verification.

use super::super::DatabaseBinding;
use std::cell::RefCell;
use std::collections::BTreeSet;
use std::marker::PhantomData;
use std::num::{NonZeroU64, NonZeroU128, NonZeroUsize};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

mod administrator;
mod bearer;
mod delivery;
mod evidence;
mod internal_work;
mod password;
mod permit;
mod recovery;
mod registry;
mod step_up;
mod verifier;
mod writers;

#[derive(Eq, PartialEq)]
enum ProofKind {
    Bearer,
    Password,
    RecoveryCode,
    DeliveryProof,
    StepUpProof,
    AdministratorAnchor,
    SealedInternalService,
}

#[derive(Eq, PartialEq)]
enum AuthorityClass {
    Human,
    DelegatedService,
    AutonomousService,
    Operator,
    InternalWork,
    NonProductionRehearsal,
}

#[derive(Eq, PartialEq)]
enum AuthorityPurpose {
    BearerSessionRotation,
    PasswordSessionIssuance,
    RecoveryCredentialRotation,
    DeliveryIdentityConfirmation,
    StepUpTransition,
    AdministratorRestore,
    InternalWorkTransition,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum AuthorityMutation {
    RotateBearerSession,
    IssuePasswordSession,
    RotateRecoveryCredential,
    ConfirmDeliveredIdentity,
    CommitStepUpTransition,
    RestoreAuthorityStore,
    CommitInternalWork,
}

#[derive(Eq, PartialEq)]
enum VerifiedSubject {
    Human([u8; 32]),
    DelegatedService([u8; 32]),
    AutonomousService([u8; 32]),
    Operator([u8; 32]),
    InternalWork([u8; 32]),
    NonProductionRehearsal([u8; 32]),
}

#[derive(Eq, PartialEq)]
struct DurablePredecessor {
    object: ProtectedObject,
    generation: NonZeroU64,
    digest: [u8; 32],
}

#[derive(Eq, PartialEq)]
struct NonEmpty<T> {
    head: T,
    tail: Vec<T>,
}

struct VerifiedTime {
    durable_floor_ms: u64,
    verified_at_ms: u64,
    not_after_ms: u64,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
enum ProtectedObject {
    AuthUsers,
    AuthIdentities,
    AuthSessions,
    AuthSessionTokens,
    AuthCredentials,
    AuthPasswordCredentials,
    AuthPasskeyCredentials,
    AuthRecoveryCodeSets,
    AuthRecoveryCodes,
    AuthAssurances,
    AuthAgentCredentials,
    AuthGrants,
    AuthGrantTokens,
    AuthAgentInvitations,
    AuthPairingRequests,
    AuthScopeBases,
    AuthVerificationCodes,
    AuthPasswordAttempts,
    AuthProvisioningReceipts,
    AuthSecurityEvents,
    AuthorizationInvalidation,
    AuthorizedLeaseReservations,
    CapabilityLinks,
    IntegrationRecords,
    JobAuthority,
    PendingEffects,
    PushAuthority,
    RehearsalProvenance,
    Watches,
    WatchFirings,
    DynamicMembership(String),
    Connection,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
enum ProtectedWriteOperation {
    Insert,
    Update(&'static str),
    Delete,
    Replace,
    CreateTrigger(&'static str),
    DropTrigger(&'static str),
    Schema,
    AttachDatabase,
    DetachDatabase,
    DynamicMembership,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
enum ProtectedWriteAccessor {
    Direct,
    Trigger(&'static str),
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
struct ProtectedWrite {
    object: ProtectedObject,
    operation: ProtectedWriteOperation,
    accessor: ProtectedWriteAccessor,
}

#[derive(Eq, PartialEq)]
struct ProtectedWriteSet {
    writes: BTreeSet<ProtectedWrite>,
}

#[derive(Clone)]
struct DatabaseOrigin {
    binding: DatabaseBinding,
    durable_store_identity: [u8; 32],
    connection_identity: ConnectionIdentity,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct ConnectionIdentity(NonZeroUsize);

struct TransactionIdentity {
    database_origin: DatabaseOrigin,
    connection_epoch: NonZeroU64,
    nonce_registry: RefCell<BTreeSet<NonZeroU128>>,
    authorizer_permit_cell: Arc<Mutex<AuthorizerPermitCell>>,
    _not_send_sync: PhantomData<Rc<()>>,
}

struct AuthorityTransaction<'conn> {
    sqlite_transaction: rusqlite::Transaction<'conn>,
    identity: TransactionIdentity,
}

struct ConnectionAuthorizer {
    binding: DatabaseBinding,
    durable_store_identity: [u8; 32],
    permit_cell: Arc<Mutex<AuthorizerPermitCell>>,
}

struct AuthorizerPermitCell {
    database_origin: Option<DatabaseOrigin>,
    connection_epoch: Option<NonZeroU64>,
    protected_tables: BTreeSet<&'static str>,
    dynamic_membership_tables: BTreeSet<String>,
    active: Option<ActivePermit>,
    execution_violation: bool,
    transaction_tainted: bool,
}

struct ActivePermit {
    connection_epoch: NonZeroU64,
    nonce: NonZeroU128,
    mutation: AuthorityMutation,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
}

struct AuthorityWritePermit<'tx, 'conn> {
    transaction: &'tx TransactionIdentity,
    // @ref LLP 0313#4-private-evidence-and-permits — commit consumes the
    // borrowed SQLite transaction, so a permit cannot survive that commit.
    _sqlite_transaction: &'tx rusqlite::Transaction<'conn>,
    nonce: NonZeroU128,
    mutation: AuthorityMutation,
    successor_digest: [u8; 32],
    _not_send_sync: PhantomData<Rc<()>>,
}

struct ConsumptionExpectation<'a> {
    transaction: &'a TransactionIdentity,
    database_origin: &'a DatabaseOrigin,
    mutation: AuthorityMutation,
    write_set: ProtectedWriteSet,
    successor_digest: [u8; 32],
    commit_time_ms: u64,
}

#[derive(Debug, Eq, PartialEq)]
enum AuthorityTransitionError {
    AuthorizerPoisoned,
    CurrentProcessMismatch,
    AuthorizerConnectionMismatch,
    AuthorizerNotInstalled,
    ConnectionEpochExhausted,
    DatabaseOriginMismatch,
    TransactionMismatch,
    NonceGenerationFailed,
    NonceMissingOrConsumed,
    ProofRelationMismatch,
    SubjectClassMismatch,
    PredecessorMismatch,
    TimeInvalid,
    MutationMismatch,
    WriteSetMismatch,
    SuccessorDigestMismatch,
    PermitAlreadyActive,
    SqliteAuthorizationUnavailable,
}

type AuthorityTransitionResult<T> = Result<T, AuthorityTransitionError>;
