//! Schema registrations for sync/realtime carriers.

use snapback_types::schema_export::{SchemaArtifact, finish, instance};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "live.subscribe.output.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveSubscribeOutput),
        ),
        finish(
            "live.subscribe.input.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveSubscribeRequest),
        ),
        finish(
            "live.resume.output.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveResumeOutput),
        ),
        finish(
            "live.resume.input.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveResumeInput),
        ),
        finish(
            "live.unsubscribe.output.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveUnsubscribeOutput),
        ),
        finish(
            "live.unsubscribe.input.schema.json",
            schemars::schema_for!(crate::local::live_protocol::LiveUnsubscribeInput),
        ),
        finish(
            "authorization-invalidation.ack.input.schema.json",
            schemars::schema_for!(crate::local::live_protocol::AuthorizationInvalidationAckInput),
        ),
        finish(
            "authorization-invalidation.ack.output.schema.json",
            schemars::schema_for!(crate::local::live_protocol::AuthorizationInvalidationAckOutput),
        ),
        finish(
            "authorization-invalidation.manual-retry.input.schema.json",
            schemars::schema_for!(
                crate::local::live_protocol::AuthorizationInvalidationManualRetryInput
            ),
        ),
        finish(
            "authorization-invalidation.manual-retry.output.schema.json",
            schemars::schema_for!(
                crate::local::live_protocol::AuthorizationInvalidationManualRetryOutput
            ),
        ),
        finish(
            "ephemeral.authority-instance-v1.schema.json",
            schemars::schema_for!(crate::ephemeral::EphemeralAuthorityInstanceV1),
        ),
        finish(
            "hosted-ephemeral.facts-v1.schema.json",
            schemars::schema_for!(crate::ephemeral::HostedEphemeralFactsV1),
        ),
        finish(
            "ephemeral.publish.output.schema.json",
            schemars::schema_for!(crate::ephemeral::PublishOutcome),
        ),
    ]
}

pub fn artifact_instances() -> Vec<SchemaArtifact> {
    vec![
        instance(
            "relational.result-encoding-v1.json",
            crate::rqs::relational_result_encoding_artifact(),
        ),
        instance("content-digest.v1.json", crate::rqs::content_digest_artifact()),
    ]
}
