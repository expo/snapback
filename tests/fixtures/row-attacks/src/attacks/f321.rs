use serde_json::{Map, json};
use snapback_kernel::manifest::{
    FieldManifest, FieldType, MembershipManifest, MembershipProvenance, MembershipScope,
    SchemaManifest, TableManifest, TableVisibilityV1,
};
use snapback_kernel::storage::{LocalDatabase, MembershipWriter, ServingDatabase};
use snapback_row_attack_fixtures::report_observation;

fn field(name: &str, field_type: FieldType) -> FieldManifest {
    FieldManifest {
        name: name.to_owned(),
        field_type,
        optional: false,
    }
}

fn main() -> Result<(), String> {
    let membership = MembershipManifest {
        id: Some("appRoles".to_owned()),
        principal: "userId".to_owned(),
        resource: None,
        role: "role".to_owned(),
        roles: vec!["admin".to_owned(), "moderator".to_owned()],
        pending_roles: None,
        bootstrap_role: None,
        last_holder: None,
        expiry: None,
        incidental: None,
        provenance: Some(MembershipProvenance::Creation),
        transitions: Vec::new(),
        principal_addressed_writes: None,
        scope: MembershipScope::App,
        resource_table: None,
    };
    let mut roles = TableManifest {
        name: "app_roles".to_owned(),
        fields: vec![
            field("userId", FieldType::Principal),
            field("role", FieldType::String),
        ],
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
    };
    roles.membership = Some(membership.clone());
    let mut database = LocalDatabase::memory().map_err(|error| format!("memory: {error:?}"))?;
    database
        .schema_seed()
        .apply_schema(SchemaManifest {
            tables: vec![roles],
            ..SchemaManifest::default()
        })
        .map_err(|error| format!("schema: {error:?}"))?;
    let mut database =
        ServingDatabase::adopt(database).map_err(|error| format!("adopt: {error:?}"))?;

    // @attack
    let result = (|| {
        let writer = MembershipWriter::Admin;
        let plan = database
            .membership_plans()
            .plan_privileged_membership_insert(
                &writer,
                "app_roles",
                Map::from_iter([
                    ("userId".to_owned(), json!("victim-principal")),
                    ("role".to_owned(), json!("admin")),
                ]),
            )
            .map_err(|error| format!("plan privileged insert: {error:?}"))?;
        let commit = database
            .membership_plans()
            .commit_membership_plan(&writer, plan)
            .map_err(|error| format!("commit membership plan: {error:?}"))?;
        let row_id = commit
            .changes
            .iter()
            .find(|change| change.table == "app_roles")
            .ok_or_else(|| "membership commit did not report its row".to_owned())?
            .id
            .clone();
        let (rows, _) = database
            .membership_reads()
            .read_my_memberships_projection(Some("victim-principal"), "app_roles", &membership)
            .map_err(|error| format!("membership projection readback: {error:?}"))?;
        let row = rows
            .iter()
            .find(|row| row["id"] == row_id)
            .ok_or_else(|| "membership row was not durable".to_owned())?;
        if row["role"] != "admin" {
            return Err(format!("unexpected durable membership row: {row:?}"));
        }
        Ok(format!(
            "durable row={} principal={} role={}",
            row_id, "victim-principal", row["role"]
        ))
    })();

    report_observation("F321", result);
    Ok(())
}
