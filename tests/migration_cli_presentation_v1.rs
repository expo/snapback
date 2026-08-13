//! @ref LLP 0160#2-the-ideal-experience-moment-by-moment — real CLI witnesses
//! for Moment 3's observation-labeled estimates and Moment 4's render-first
//! approval, face redaction, and structured/human stream split.

use std::collections::BTreeMap;
use std::process::Command;

use serde_json::Value;
use snapback::manifest::{
    FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest, ValueExpr,
};
use snapback::migration::{
    MigrationIntent, MigrationPlanArtifactV1, MigrationPreviewObservationV1,
};
use snapback::storage::LocalDatabase;

fn schema(include_provider: bool) -> SchemaManifest {
    let mut fields = vec![FieldManifest {
        name: "name".to_owned(),
        field_type: FieldType::String,
        optional: false,
    }];
    if include_provider {
        fields.push(FieldManifest {
            name: "provider".to_owned(),
            field_type: FieldType::String,
            optional: true,
        });
    }
    SchemaManifest {
        tables: vec![TableManifest {
            name: "models".to_owned(),
            fields,
            indexes: Vec::new(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn snapback() -> Command {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
}

#[test]
fn migrate_preview_renders_bounded_precondition_observations() {
    let directory = tempfile::tempdir().expect("tempdir");
    let db = directory.path().join("app.sqlite");
    let successor_path = directory.path().join("successor.json");
    let intents_path = directory.path().join("intents.json");
    let preview_path = directory.path().join("preview.json");

    let mut predecessor = schema(false);
    predecessor.tables[0].fields[0].optional = false;
    let mut successor = predecessor.clone();
    successor.tables[0].fields.push(FieldManifest {
        name: "provider".to_owned(),
        field_type: FieldType::String,
        optional: false,
    });
    let intents = vec![MigrationIntent::AddRequiredField {
        table: "models".to_owned(),
        field: "provider".to_owned(),
        field_type: FieldType::String,
        backfill: ValueExpr::Literal(serde_json::json!("openai")),
    }];
    {
        let mut database = LocalDatabase::open(&db).expect("open predecessor");
        database
            .schema_seed()
            .apply_schema(predecessor)
            .expect("apply predecessor");
        let rows = (0..7)
            .map(|index| {
                serde_json::json!({
                    "_id": format!("model-{index}"),
                    "name": format!("Model {index}"),
                })
                .as_object()
                .cloned()
                .unwrap()
            })
            .collect();
        database
            .schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([("models".to_owned(), rows)]),
            })
            .expect("seed predecessor rows");
    }
    std::fs::write(
        &successor_path,
        serde_json::to_string_pretty(&successor).unwrap(),
    )
    .unwrap();
    std::fs::write(
        &intents_path,
        serde_json::to_string_pretty(&intents).unwrap(),
    )
    .unwrap();

    let preview = snapback()
        .args([
            "migrate",
            "preview",
            "--db",
            db.to_str().unwrap(),
            "--schema",
            successor_path.to_str().unwrap(),
            "--intents",
            intents_path.to_str().unwrap(),
            "--publication-timestamp-ms",
            "2000000000000",
            "--max-affected-rows",
            "2",
            "--out",
            preview_path.to_str().unwrap(),
        ])
        .output()
        .expect("run preview");
    assert!(
        preview.status.success(),
        "{}",
        String::from_utf8_lossy(&preview.stderr)
    );
    let stderr = String::from_utf8(preview.stderr).expect("utf8 stderr");
    assert!(stderr.contains("preflight: ~3 rows"));
    assert!(stderr.contains("review context, not plan authority"));

    let preview_file: Value =
        serde_json::from_str(&std::fs::read_to_string(&preview_path).unwrap()).unwrap();
    let observation: MigrationPreviewObservationV1 =
        serde_json::from_value(preview_file["observation"].clone()).unwrap();
    assert_eq!(observation.precondition_rows.len(), 2);
    assert!(
        observation
            .precondition_rows
            .values()
            .all(|rows| *rows == 3),
        "preview stops at the reviewed ceiling plus one"
    );
}

#[test]
fn migrate_streams_redaction_json_silence_and_render_first_approval() {
    let directory = tempfile::tempdir().expect("tempdir");
    let db = directory.path().join("app.sqlite");
    let successor_path = directory.path().join("successor.json");
    let preview_path = directory.path().join("preview.json");
    let refused_approval_path = directory.path().join("refused-approved.json");
    let approved_path = directory.path().join("approved.json");
    let json_approved_path = directory.path().join("approved-json.json");

    {
        let mut database = LocalDatabase::open(&db).expect("open predecessor");
        database
            .schema_seed()
            .apply_schema(schema(false))
            .expect("apply predecessor");
    }
    std::fs::write(
        &successor_path,
        serde_json::to_string_pretty(&schema(true)).unwrap(),
    )
    .unwrap();

    let preview = snapback()
        .args([
            "migrate",
            "preview",
            "--db",
            db.to_str().unwrap(),
            "--schema",
            successor_path.to_str().unwrap(),
            "--publication-timestamp-ms",
            "2000000000000",
            "--out",
            preview_path.to_str().unwrap(),
        ])
        .output()
        .expect("run preview");
    assert!(
        preview.status.success(),
        "{}",
        String::from_utf8_lossy(&preview.stderr)
    );
    let stdout: Value = serde_json::from_slice(&preview.stdout).expect("stdout envelope");
    assert_eq!(stdout["ok"], true);
    let stderr = String::from_utf8(preview.stderr).expect("utf8 stderr");
    assert!(stderr.contains("Migration plan"));
    assert!(stderr.contains("Presentation contract: migration-presentation-v1"));
    assert!(stderr.contains("Narration face — constants redacted"));

    let preview_file: Value =
        serde_json::from_str(&std::fs::read_to_string(&preview_path).unwrap()).unwrap();
    let artifact: MigrationPlanArtifactV1 =
        serde_json::from_value(preview_file["artifact"].clone()).unwrap();
    let observation: MigrationPreviewObservationV1 =
        serde_json::from_value(preview_file["observation"].clone()).unwrap();
    let acknowledgement =
        snapback::migration_presentation::approval_acknowledgement_token(&artifact, &observation);

    let refused = snapback()
        .args([
            "migrate",
            "approve",
            preview_path.to_str().unwrap(),
            "--db",
            db.to_str().unwrap(),
            "--out",
            refused_approval_path.to_str().unwrap(),
        ])
        .output()
        .expect("run refused approve");
    assert_eq!(refused.status.code(), Some(1));
    assert!(
        !refused_approval_path.exists(),
        "render-first gate precedes write"
    );
    let refused_stderr = String::from_utf8(refused.stderr).unwrap();
    assert!(refused_stderr.contains("Approval binding"));
    assert!(refused_stderr.contains("SNAPBACK_MIGRATION_APPROVAL_REQUIRED"));

    let approved = snapback()
        .args([
            "migrate",
            "approve",
            preview_path.to_str().unwrap(),
            "--db",
            db.to_str().unwrap(),
            "--out",
            approved_path.to_str().unwrap(),
            "--acknowledge-digests",
            &acknowledgement,
        ])
        .output()
        .expect("run acknowledged approve");
    assert!(
        approved.status.success(),
        "{}",
        String::from_utf8_lossy(&approved.stderr)
    );
    assert!(approved_path.is_file());
    assert!(
        String::from_utf8(approved.stderr)
            .unwrap()
            .contains("Approval binding")
    );

    let json_approved = snapback()
        .args([
            "migrate",
            "--json",
            "approve",
            preview_path.to_str().unwrap(),
            "--db",
            db.to_str().unwrap(),
            "--out",
            json_approved_path.to_str().unwrap(),
            "--acknowledge-digests",
            &acknowledgement,
        ])
        .output()
        .expect("run JSON-only approve");
    assert!(
        json_approved.status.success(),
        "{}",
        String::from_utf8_lossy(&json_approved.stderr)
    );
    assert!(
        json_approved.stderr.is_empty(),
        "--json silences human rendering"
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&json_approved.stdout).unwrap()["ok"],
        true
    );
    assert!(json_approved_path.is_file());

    let usage = snapback()
        .args(["migrate", "preview"])
        .output()
        .expect("run clap usage refusal");
    assert_eq!(usage.status.code(), Some(2), "Clap usage failures exit 2");
}
