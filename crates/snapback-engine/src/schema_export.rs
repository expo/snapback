//! Schema registrations for engine-composition carriers.

use snapback_types::schema_export::{SchemaArtifact, finish};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "inspect.schema.json",
            schemars::schema_for!(crate::local::InspectState),
        ),
        finish(
            "inspect.public.schema.json",
            schemars::schema_for!(crate::local::PublicInspect),
        ),
        finish(
            "app.ensure.input.schema.json",
            schemars::schema_for!(crate::local::EnsureAppRequest),
        ),
        finish(
            "app.ensure.output.schema.json",
            schemars::schema_for!(crate::local::EnsureAppResponse),
        ),
        finish(
            "action.output.schema.json",
            schemars::schema_for!(snapback_types::manifest::FunctionResponse<
                crate::local::FunctionRunResult,
            >),
        ),
    ]
}
