//! Schema registrations for engine-composition carriers.

use snapback_types::schema_export::{SchemaArtifact, finish_type};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish_type::<crate::local::InspectState>("inspect.schema.json"),
        finish_type::<crate::local::PublicInspect>("inspect.public.schema.json"),
        finish_type::<crate::local::EnsureAppRequest>("app.ensure.input.schema.json"),
        finish_type::<crate::local::EnsureAppResponse>("app.ensure.output.schema.json"),
        finish_type::<snapback_types::manifest::FunctionResponse<crate::local::FunctionRunResult>>(
            "action.output.schema.json",
        ),
    ]
}
