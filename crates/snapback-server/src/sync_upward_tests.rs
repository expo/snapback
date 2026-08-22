use crate::contract_types::AuthMode;
use crate::ephemeral::{
    AccessPolicy, CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256,
    CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON, RoomPermissionProjection,
    validate_collection_definitions, validate_collection_permission_backing,
};
use crate::manifest::{SchemaManifest, SchemaManifestValidationExt as _};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;

#[test]
fn codegen_emitted_membership_projection_parses_and_activates_in_sessions() {
    fn canonical_json(value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Null
            | serde_json::Value::Bool(_)
            | serde_json::Value::Number(_)
            | serde_json::Value::String(_) => serde_json::to_string(value)
                .expect("canonical primitive JSON serialization succeeds"),
            serde_json::Value::Array(values) => format!(
                "[{}]",
                values
                    .iter()
                    .map(canonical_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            serde_json::Value::Object(entries) => {
                let mut keys = entries.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                let fields = keys
                    .into_iter()
                    .map(|key| {
                        format!(
                            "{}:{}",
                            serde_json::to_string(key)
                                .expect("canonical object key serialization succeeds"),
                            canonical_json(&entries[key])
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{{{fields}}}")
            }
        }
    }

    let embedded: serde_json::Value = serde_json::from_str(CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_JSON)
        .expect("codegen schema manifest is valid JSON");
    let digest = format!("{:x}", Sha256::digest(canonical_json(&embedded).as_bytes()));
    assert_eq!(
        digest, CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256,
        "embedded manifest drifted from the actual-codegen JS fixture"
    );

    let schema: SchemaManifest = serde_json::from_value(embedded)
        .expect("codegen schema manifest parses through the Rust carrier");
    schema
        .validate_artifact()
        .expect("slice-1 codegen schema artifact header is valid");
    assert_eq!(schema.effective_auth_mode(), AuthMode::Sessions);

    let collection = schema
        .ephemeral_collections
        .iter()
        .find(|collection| collection.name == "typing")
        .expect("codegen emitted the membership-backed collection");
    assert_eq!(
        collection.permission_backing,
        Some(RoomPermissionProjection {
            table: "conversationMembers".to_owned(),
            subject_field: "userId".to_owned(),
            scope_fields: BTreeMap::from([(
                "conversationId".to_owned(),
                "conversationId".to_owned(),
            )]),
            role_field: Some("role".to_owned()),
            allowed_roles: Some(vec!["owner".to_owned(), "member".to_owned()]),
        })
    );
    for policy in [&collection.publish, &collection.subscribe] {
        assert_eq!(
            policy,
            &AccessPolicy::RequireRoomPermission {
                prefix: "m_conversation_members".to_owned(),
            },
            "publish and subscribe must carry one generated membership authority"
        );
    }

    validate_collection_definitions(&schema.ephemeral_collections)
        .expect("codegen-emitted collection definitions are valid");
    validate_collection_permission_backing(
        &schema.ephemeral_collections,
        &schema.tables,
        schema.effective_auth_mode() == AuthMode::Sessions,
    )
    .expect("sessions activation accepts the codegen-emitted membership projection");

    for refused_role in ["invited", "ghost"] {
        let mut doctored = schema.clone();
        doctored.ephemeral_collections[0]
            .permission_backing
            .as_mut()
            .unwrap()
            .allowed_roles = Some(vec![refused_role.to_owned()]);
        let error = validate_collection_permission_backing(
            &doctored.ephemeral_collections,
            &doctored.tables,
            true,
        )
        .expect_err("artifact activation must refuse pending and unknown role grants");
        assert_eq!(
            error.code.diagnostic_code(),
            "SNAPBACK_EPHEMERAL_INCOMPATIBLE_COLLECTION_DEFINITION",
            "{refused_role}"
        );
        assert!(error.message.contains("active membership roles"));
    }
}
