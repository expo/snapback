use snapback_engine::{
    local::{EnsureAppMode, LocalSnapback},
    test_support,
};
use snapback_kernel::{
    auth::{
        crypto::OsRandom,
        mode::{AuthProgramReadiness, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX},
    },
    contract_types::{
        AgentsManifest, AgentsMode, ApiManifest, ApiOAuthManifest, AuthManifest, AuthMode,
        InvitedBy, ServerProfile,
    },
    manifest::{FunctionManifest, SchemaManifest},
    storage::auth_integrations::{AgentRegistrationClass, IntegrationRegistrationFacts},
};
use std::{
    fs::{self, OpenOptions},
    sync::atomic::{AtomicU64, Ordering},
};

static IMAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn sessions_pair() -> (SchemaManifest, FunctionManifest) {
    let app_id = "f170-raw-engine-registration".to_owned();
    let inputs_hash = format!("{}{}", INPUTS_V1_PREFIX, "a".repeat(64));
    let schema = SchemaManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id: app_id.clone(),
        auth: Some(AuthManifest {
            mode: AuthMode::Sessions,
            agents: Some(AgentsManifest::explicit(
                AgentsMode::Open,
                InvitedBy::Operators,
            )),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        api: Some(ApiManifest {
            enabled: true,
            oauth: Some(ApiOAuthManifest {
                enabled: true,
                bearer: true,
                ..ApiOAuthManifest::default()
            }),
            ..ApiManifest::default()
        }),
        required_capabilities: vec!["auth.sessions.v1".to_owned()],
        schema_hash: Some(format!("{}{}", SCHEMA_V1_PREFIX, "b".repeat(64))),
        inputs_hash: Some(inputs_hash.clone()),
        ..SchemaManifest::default()
    };
    let functions = FunctionManifest {
        schema_version: "snapback.v1".to_owned(),
        app_id,
        bundle_hash: Some(format!("{}{}", FUNCTION_V1_PREFIX, "c".repeat(64))),
        inputs_hash: Some(inputs_hash),
        ..FunctionManifest::default()
    };
    (schema, functions)
}

fn settled_sessions_target() -> LocalSnapback {
    let (schema, functions) = sessions_pair();
    let mut target = LocalSnapback::memory().expect("create target engine");
    let prepared = target
        .prepare_auth_provision(
            EnsureAppMode::Sessions,
            Some(schema),
            Some(functions.clone()),
            None,
        )
        .expect("prepare sessions target");
    let committed = target
        .commit_auth_provision_classified(prepared, "test", None)
        .map_err(|failure| failure.into_error())
        .expect("commit sessions target");
    let (_, pending, _) = committed.into_parts();
    assert_eq!(pending.active, AuthMode::Dev);
    let readiness = AuthProgramReadiness::new(true, true, true, true, true, true, true);
    let settled = target
        .consume_sessions_auth_mode_with_functions(&readiness, &functions)
        .expect("settle sessions target");
    assert_eq!(settled.active, AuthMode::Sessions);
    target
}

fn database_image(target: &LocalSnapback) -> Vec<u8> {
    let sequence = IMAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "snapback-f170-{}-{sequence}.sqlite",
        std::process::id()
    ));
    let image = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .expect("create image file");
    target
        .backup_database_image_into(&image)
        .expect("capture target image");
    drop(image);
    let bytes = fs::read(&path).expect("read target image");
    fs::remove_file(&path).expect("remove target image");
    bytes
}

fn main() {
    let mut target = settled_sessions_target();
    let before = database_image(&target);

    // @attack
    let database = test_support::auth_database_mut(&mut target);
    let issued = database
        .register_agent_principal_with_class(
            None,
            Some("raw dependent OAuth client".to_owned()),
            Some("attacker@example.test".to_owned()),
            AgentRegistrationClass::Integration,
            IntegrationRegistrationFacts {
                origin: Some("https://attacker.example".to_owned()),
                redirect_uris: vec!["https://attacker.example/callback".to_owned()],
            },
            ServerProfile::Test,
            10_000,
            &OsRandom,
        )
        .expect("raw registration writes without an admission lease");
    let client_id = database
        .integration_record_if_present(&issued.user_id)
        .expect("read integration record")
        .expect("integration record exists")
        .integration_id;
    let after = database_image(&target);

    assert!(!issued.user_id.is_empty());
    assert!(!issued.credential_id.is_empty());
    assert!(!client_id.is_empty());
    assert_ne!(
        before, after,
        "raw registration must change the target image"
    );
}
