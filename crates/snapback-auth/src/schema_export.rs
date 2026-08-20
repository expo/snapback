//! Schema registrations for authentication-policy carriers.

use snapback_types::schema_export::{SchemaArtifact, finish};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "auth.hosted-admission.schema.json",
            schemars::schema_for!(crate::auth::deployment::HostedAdmission),
        ),
        finish(
            "auth.hosted-admission-envelope.schema.json",
            schemars::schema_for!(crate::auth::deployment::HostedAdmissionEnvelope),
        ),
        finish(
            "auth.hosted-admission-key.schema.json",
            schemars::schema_for!(crate::auth::deployment::HostedAdmissionKeyFile),
        ),
    ]
}
