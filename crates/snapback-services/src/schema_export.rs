//! Schema registrations for background-service carriers.

use snapback_types::schema_export::{SchemaArtifact, finish, instance};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "telemetry.events.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryEventsRequestV1),
        ),
        finish(
            "telemetry.events.response.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryEventsResponseV1),
        ),
        finish(
            "telemetry.stats.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryStatsRequestV1),
        ),
        finish(
            "telemetry.stats.response.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryStatsResponseV1),
        ),
        finish(
            "telemetry.export.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportRequestV1),
        ),
        finish(
            "telemetry.export.header.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportHeaderV1),
        ),
        finish(
            "telemetry.export.event.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportEventV1),
        ),
        finish(
            "telemetry.export.page.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportPageV1),
        ),
        finish(
            "telemetry.agent-export.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryAgentExportRequestV1),
        ),
        finish(
            "telemetry.agent-export.page.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryAgentExportPageV1),
        ),
        finish(
            "telemetry.sql-result.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetrySqlResultV1),
        ),
        finish(
            "errors.issues.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssuesRequestV1),
        ),
        finish(
            "errors.issues.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssuesResponseV1),
        ),
        finish(
            "errors.issue.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssueRequestV1),
        ),
        finish(
            "errors.issue.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssueResponseV1),
        ),
        finish(
            "errors.transition.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsTransitionRequestV1),
        ),
        finish(
            "errors.transition.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsTransitionResponseV1),
        ),
    ]
}

pub fn artifact_instances() -> Vec<SchemaArtifact> {
    let mut artifacts = vec![
        instance(
            crate::telemetry_query::QUERY_FIXTURE_CORPUS_FILE,
            crate::telemetry_query::query_fixture_corpus(),
        ),
        instance(
            crate::errors_query::ERRORS_FIXTURE_CORPUS_FILE,
            crate::errors_query::errors_fixture_corpus(),
        ),
    ];
    artifacts.extend(
        crate::error_tracking::artifact_instances()
            .into_iter()
            .map(|(file, schema)| instance(file, schema)),
    );
    artifacts
}
