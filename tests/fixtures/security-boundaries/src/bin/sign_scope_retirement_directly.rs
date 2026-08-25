use snapback_auth::auth::invalidation::{
    AuthenticatedBootIssuer, IssuerAuthenticator, QueryNamespace,
};
use snapback_kernel::storage::AuthorizationVersion;

fn attack(
    signer: &IssuerAuthenticator,
    issuer: &AuthenticatedBootIssuer,
    namespace: QueryNamespace,
    authorization: AuthorizationVersion,
) {
    // @attack
    let _ = signer.authenticate_scope_retirement(
        issuer,
        namespace,
        1,
        authorization,
        "target-profile",
        "app-id",
    );
}

fn main() {}
