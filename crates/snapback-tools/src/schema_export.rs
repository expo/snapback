//! Downward-only assembly of schema registrations owned beside their carriers.
//!
//! @ref LLP 0283#f-5--named-exceptions-with-burn-down-tickets — rank-7
//!   tooling may compose registrations from every lower rank without pulling
//!   any carrier upward into the product facade.

pub use snapback_types::schema_export::{EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS, SchemaArtifact};

/// Assemble every owner registration through rank-7 downward dependencies.
pub fn artifact_schemas() -> Vec<SchemaArtifact> {
    let mut artifacts = snapback_types::schema_export::schema_registrations();
    artifacts.extend(snapback_kernel::schema_export::schema_registrations());
    artifacts.extend(snapback_auth::schema_export::schema_registrations());
    artifacts.extend(snapback_activation::schema_export::schema_registrations());
    artifacts.extend(snapback_services::schema_export::schema_registrations());
    artifacts.extend(snapback_sync::schema_export::schema_registrations());
    artifacts.extend(snapback_engine::schema_export::schema_registrations());
    artifacts.extend(snapback_server::schema_export::schema_registrations());
    artifacts
}

/// Assemble every generated instance beside the schema registry.
pub fn artifact_instances() -> Vec<SchemaArtifact> {
    let mut artifacts = snapback_types::schema_export::artifact_instances();
    artifacts.extend(snapback_kernel::schema_export::artifact_instances());
    artifacts.extend(snapback_services::schema_export::artifact_instances());
    artifacts.extend(snapback_sync::schema_export::artifact_instances());
    artifacts.extend(snapback_server::schema_export::artifact_instances());
    artifacts
}

pub use snapback_server::schema_export::{
    http_routes_artifact, vite_first_party_auth_relay_routes_artifact,
};
