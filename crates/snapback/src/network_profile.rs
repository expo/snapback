pub use snapback_types::network_profile::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::deployment::AuthDeploymentTarget;
    use crate::contract_types::ServerProfile;

    fn local_authority(profile: ServerProfile) -> NetworkProfileAuthority {
        NetworkProfileAuthority::classified(profile, AuthDeploymentTarget::Local, false, false)
    }

    #[test]
    fn activation_matrix_is_identical_for_every_selector() {
        for source in [
            NetworkProfileSource::Env,
            NetworkProfileSource::Api,
            NetworkProfileSource::Console,
            NetworkProfileSource::HostOps,
            NetworkProfileSource::Mcp,
        ] {
            for profile in [ServerProfile::Dev, ServerProfile::Demo, ServerProfile::Test] {
                NetworkProfileState::new()
                    .activate(
                        NetworkConditionProfile::optimistic(),
                        local_authority(profile),
                        source,
                        None,
                    )
                    .unwrap();
            }
            NetworkProfileState::new()
                .activate(
                    NetworkConditionProfile::optimistic(),
                    NetworkProfileAuthority::classified(
                        ServerProfile::Dev,
                        AuthDeploymentTarget::Local,
                        false,
                        true,
                    ),
                    source,
                    None,
                )
                .expect("a local derived instance retains the local allowance");
            NetworkProfileState::new()
                .activate(
                    NetworkConditionProfile::optimistic(),
                    NetworkProfileAuthority::classified(
                        ServerProfile::Dev,
                        AuthDeploymentTarget::Hosted,
                        true,
                        true,
                    ),
                    source,
                    None,
                )
                .expect("boot-validated derived identity is the hosted exception");

            for (case, authority) in [
                ("explicit prod", local_authority(ServerProfile::Prod)),
                (
                    "defaulted prod",
                    // The non-loopback fail-closed default resolves to Prod
                    // before it reaches this gate.
                    NetworkProfileAuthority::classified(
                        crate::admin::resolve_profile(None, false, false),
                        AuthDeploymentTarget::Local,
                        false,
                        false,
                    ),
                ),
                (
                    "primary hosted",
                    NetworkProfileAuthority::classified(
                        ServerProfile::Dev,
                        AuthDeploymentTarget::Hosted,
                        true,
                        false,
                    ),
                ),
                (
                    "derived prod",
                    NetworkProfileAuthority::classified(
                        ServerProfile::Prod,
                        AuthDeploymentTarget::Hosted,
                        true,
                        true,
                    ),
                ),
                (
                    "missing server profile",
                    NetworkProfileAuthority {
                        server_profile: None,
                        deployment: Some(AuthDeploymentTarget::Local),
                        hosted_serving_present: Some(false),
                        derived_instance_present: Some(false),
                    },
                ),
                (
                    "missing deployment",
                    NetworkProfileAuthority {
                        server_profile: Some(ServerProfile::Dev),
                        deployment: None,
                        hosted_serving_present: Some(false),
                        derived_instance_present: Some(false),
                    },
                ),
                (
                    "missing hosted-serving fact",
                    NetworkProfileAuthority {
                        server_profile: Some(ServerProfile::Dev),
                        deployment: Some(AuthDeploymentTarget::Local),
                        hosted_serving_present: None,
                        derived_instance_present: Some(false),
                    },
                ),
                (
                    "missing derived-instance fact",
                    NetworkProfileAuthority {
                        server_profile: Some(ServerProfile::Dev),
                        deployment: Some(AuthDeploymentTarget::Local),
                        hosted_serving_present: Some(false),
                        derived_instance_present: None,
                    },
                ),
                (
                    "local target with hosted serving",
                    NetworkProfileAuthority::classified(
                        ServerProfile::Dev,
                        AuthDeploymentTarget::Local,
                        true,
                        true,
                    ),
                ),
                (
                    "hosted target without hosted serving",
                    NetworkProfileAuthority::classified(
                        ServerProfile::Dev,
                        AuthDeploymentTarget::Hosted,
                        false,
                        true,
                    ),
                ),
            ] {
                let error = NetworkProfileState::new()
                    .activate(
                        NetworkConditionProfile::optimistic(),
                        authority,
                        source,
                        None,
                    )
                    .unwrap_err();
                assert_eq!(
                    error.diagnostic.code, NETWORK_PROFILE_FORBIDDEN_CODE,
                    "{source:?}: {case}"
                );
            }
        }
    }
}
