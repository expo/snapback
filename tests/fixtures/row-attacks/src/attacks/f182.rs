use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::{NOW, report_observation};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::contract_types::{
    AgentsManifest, AgentsMode, AuthManifest, AuthMode, InvitedBy, ServerProfile,
};
use snapback_types::manifest::SchemaManifest;

fn dev_schema_with_agents(mode: AgentsMode) -> SchemaManifest {
    SchemaManifest {
        app_id: "f182-stale-schema".to_owned(),
        auth: Some(AuthManifest {
            mode: AuthMode::Dev,
            agents: Some(AgentsManifest::explicit(mode, InvitedBy::Operators)),
            password_identifier_mode: None,
            password_minimum_length: None,
        }),
        ..SchemaManifest::default()
    }
}

fn main() -> Result<(), String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = directory.path().join("f182.sqlite3");

    let mut stale = LocalDatabase::open(&path)
        .map_err(|error| format!("open pre-activation handle: {error:?}"))?;
    stale
        .activate_current_auth_catalog()
        .map_err(|error| format!("activate auth catalog: {error:?}"))?;
    stale
        .schema_seed()
        .apply_schema(dev_schema_with_agents(AgentsMode::Open))
        .map_err(|error| format!("publish open agents mode: {error:?}"))?;

    let mut publisher =
        LocalDatabase::open(&path).map_err(|error| format!("open activation handle: {error:?}"))?;
    publisher
        .schema_seed()
        .apply_schema(dev_schema_with_agents(AgentsMode::Disabled))
        .map_err(|error| format!("publish disabled agents mode: {error:?}"))?;

    // @ref LLP 0303#s-a-compile-fail-witness-proves-a-spelling-is-gone-not-a-capability — exercise an alternate effect route, not the removed partial APIs.
    // @attack
    let result = (|| {
        let issued = stale
            .register_agent_principal(
                None,
                Some("stale-open registration".to_owned()),
                None,
                ServerProfile::Test,
                NOW,
                &OsRandom,
            )
            .map_err(|error| format!("stale handle refused registration: {error:?}"))?;

        let mut readback = LocalDatabase::open(&path)
            .map_err(|error| format!("open durable readback handle: {error:?}"))?;
        let resolved = readback
            .resolve_agent_credential(&issued.secret, NOW + 1)
            .map_err(|error| format!("durable credential readback failed: {error:?}"))?;
        if resolved.user_id != issued.user_id
            || resolved.credential_id != issued.credential_id
            || resolved.generation != issued.generation
        {
            return Err(format!(
                "durable registration mismatch: issued={issued:?} resolved={resolved:?}"
            ));
        }

        Ok(format!(
            "pre-activation handle retained Open after a second handle published Disabled; durable user={} credential={} generation={}",
            resolved.user_id, resolved.credential_id, resolved.generation,
        ))
    })();

    report_observation("F182", result);
    Ok(())
}
