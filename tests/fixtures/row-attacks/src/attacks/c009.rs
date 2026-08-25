use snapback_auth::auth::invalidation::{
    AUTH_INVALIDATION_PROTOCOL_VERSION, AuthorizationInvalidationConnection, IssuerId,
};
use snapback_kernel::storage::AuthorizationVersion;
use snapback_row_attack_fixtures::report_observation;
use snapback_types::ephemeral::ConnectionEffectFence;

fn forge_invalidation_connection(effect_fence: ConnectionEffectFence) {
    // @attack
    let _ = AuthorizationInvalidationConnection {
        protocol_version: AUTH_INVALIDATION_PROTOCOL_VERSION,
        issuer_id: IssuerId {
            authorization_incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            boot_sequence: 1,
            boot_nonce: "AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
        },
        connection_generation: 10_001,
        authorization: AuthorizationVersion {
            incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            epoch: 1,
        },
        version_stream: "attacker-stream".to_owned(),
        issuer_retirement: None,
        // `issuer_state` holds a crate-private type that a dependent cannot name; the
        // diverging expression keeps this a *privacy* probe rather than a type probe.
        issuer_state: unimplemented!(),
        effect_fence,
    };
}

fn main() {
    let _ = forge_invalidation_connection;
    report_observation(
        "C009",
        Ok("dependent forged an invalidation connection with a never-issued generation".to_owned()),
    );
}
