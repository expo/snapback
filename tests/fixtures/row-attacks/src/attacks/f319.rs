use serde_json::{Map, json};
use snapback_kernel::manifest::{
    FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest, TableVisibilityV1,
};
use snapback_kernel::storage::{LocalDatabase, ServingDatabase};
use snapback_row_attack_fixtures::report_observation;
use std::collections::BTreeMap;

fn main() -> Result<(), String> {
    let schema = SchemaManifest {
        tables: vec![TableManifest {
            name: "items".to_owned(),
            fields: vec![FieldManifest {
                name: "visibility".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: Some(TableVisibilityV1::PublicRead),
            history: None,
        }],
        ..SchemaManifest::default()
    };
    let mut database = LocalDatabase::memory().map_err(|error| format!("memory: {error:?}"))?;
    database
        .schema_seed()
        .apply_schema(schema)
        .map_err(|error| format!("schema: {error:?}"))?;
    database
        .schema_seed()
        .seed(SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), json!("victim-row")),
                    ("visibility".to_owned(), json!("public")),
                ])],
            )]),
        })
        .map_err(|error| format!("seed: {error:?}"))?;
    let mut database =
        ServingDatabase::adopt(database).map_err(|error| format!("adopt: {error:?}"))?;

    // @attack
    let result = (|| {
        let request = database
            .admit_protected_record_erasure(
                "operation-f319".to_owned(),
                "items".to_owned(),
                "victim-row".to_owned(),
                "sessions",
                "caller-selected-principal",
                "admin-bypass",
                "production",
                41,
                "caller-selected-credential",
                &format!("sha256:{}", "a".repeat(64)),
                "caller-selected-stream",
                200,
            )
            .map_err(|error| format!("admit erasure: {error:?}"))?;
        let receipt = database
            .checkpoints()
            .erase_protected_record(&request)
            .map_err(|error| format!("erase: {error:?}"))?;
        let row = database
            .query_reads()
            .get("items", "victim-row")
            .map_err(|error| format!("readback: {error:?}"))?;
        if row.is_some() {
            return Err("protected row remained after accepted erasure".to_owned());
        }
        Ok(format!(
            "durable row_present=false delete_version={} authority={}",
            receipt.canonical_delete_version, receipt.authority.principal_id
        ))
    })();

    report_observation("F319", result);
    Ok(())
}
