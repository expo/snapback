//! Platform-owned Expo push transport and product authorization adapter.

use crate::auth::wire::SecretInput;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::io::Read;
use std::net::IpAddr;

#[cfg(test)]
use crate::ids::{self, Kind};
#[cfg(test)]
use rusqlite::{Connection, params};
#[cfg(test)]
use sha2::{Digest as _, Sha256};

pub use crate::contract_types::{PushAudienceReferenceV1, PushDeferredGrantV1};
pub use snapback_kernel::push::PushRegistryInspectionV1;
pub(crate) use snapback_kernel::push::{
    PUSH_BATCH_MESSAGES_MAX, PUSH_PROVIDER_RESPONSE_MAX_BYTES, PUSH_RECEIPT_BATCH_MAX,
    PUSH_RECEIPT_FIRST_POLL_MS, PUSH_RECEIPT_WINDOW_MS, PushBatchClaimV1,
    PushBatchSettlementV1, PushDeferredGrantRequestV1, PushLedgerRowV1,
    PushReceiptOutcomeV1, PushReceiptPollClaimV1, PushRecoveredBatchV1, PushSendRequestV1,
    PushSendReservationResponseV1, PushStorageAuthority, PushTicketOutcomeV1,
    PushTokenRegistrationResponse, PushTokenUnregisterResponse, PushTriggerModeV1,
    REGISTRY_TABLE_SQL, ReservedPushAttemptV1, capture_deferred_grant, expo_receipt_payload,
    expo_send_payload_from_parts, parse_expo_receipt_response, resolve_audience_in,
    validate_audience_args, validate_config_uses, validate_declaration_against_schema,
    validate_exact_ledger_schema, validate_provider_id, validate_receipt_error_code,
    validate_ticket_error_code, validate_token,
};
pub use snapback_types::push::*;

/// The sole adapter from admitted invocation authority to the kernel's
/// storage-only push fact. The kernel fact is intentionally not re-exported
/// through the public façade, so callers cannot assert `System` themselves.
///
/// @ref LLP 0276#phases — port inversion must preserve compiler-enforced
/// admission rather than accept a caller assertion.
pub(crate) fn admitted_push_storage_authority(
    authority: &crate::auth::invocation::PreparedAuthority,
) -> PushStorageAuthority {
    if matches!(
        authority.resolved(),
        crate::auth::invocation::ResolvedAppAuthority::System
    ) {
        PushStorageAuthority::System
    } else if let Some(user_id) = authority.projection().user_id() {
        PushStorageAuthority::User(user_id.to_owned())
    } else {
        PushStorageAuthority::Other
    }
}

/// Crate-private commit adapter: every call must supply the unforgeable
/// prepared invocation carrier, and only this adapter projects the kernel
/// authority fact consumed by the transaction.
pub(crate) trait PreparedPushRegistryExt {
    #[allow(clippy::too_many_arguments)]
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1>;
}

impl PreparedPushRegistryExt for crate::storage::PushRegistryKernel<'_> {
    fn reserve_send(
        &mut self,
        declaration: &PushSeamDeclarationV1,
        schema: &crate::manifest::SchemaManifest,
        authority: impl FnOnce() -> crate::auth::invocation::PreparedAuthority,
        trigger_mode: PushTriggerModeV1,
        deferred_grant: Option<&PushDeferredGrantV1>,
        request: &PushSendRequestV1,
        now_ms: u64,
    ) -> SnapbackResult<ReservedPushAttemptV1> {
        let authority = authority();
        authority.validate_admission("push durable reservation")?;
        self.reserve_send_admitted_storage(
            declaration,
            schema,
            admitted_push_storage_authority(&authority),
            trigger_mode,
            deferred_grant,
            request,
            now_ms,
        )
    }
}

pub(crate) fn read_ledger_projection_for_prepared(
    db: &crate::storage::DbRead<'_>,
    declaration: &PushSeamDeclarationV1,
    schema: &crate::manifest::SchemaManifest,
    authority: &crate::auth::invocation::PreparedAuthority,
    intent_id: &str,
) -> SnapbackResult<(
    Vec<PushLedgerRowV1>,
    Option<crate::storage::CapturedReadDependency>,
)> {
    authority.validate_admission("push ledger projection")?;
    snapback_kernel::push::read_ledger_projection(
        db,
        declaration,
        schema,
        &admitted_push_storage_authority(authority),
        intent_id,
    )
}

#[cfg(test)]
fn authorize_send_for_prepared(
    tx: &rusqlite::Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    audience: &PushAudienceDeclarationV1,
    authority: &crate::auth::invocation::PreparedAuthority,
    trigger_mode: PushTriggerModeV1,
    deferred_grant: Option<&PushDeferredGrantV1>,
    request: &PushSendRequestV1,
) -> SnapbackResult<()> {
    authority.validate_admission("push send authorization")?;
    snapback_kernel::push::authorize_send_in(
        tx,
        schema,
        audience,
        &admitted_push_storage_authority(authority),
        trigger_mode,
        deferred_grant,
        request,
    )
}

pub(crate) struct ExpoHttpResponseV1 {
    pub(crate) status: u16,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExpoHttpUncertaintyV1 {
    Transport,
    ResponseRead,
    ResponseTooLarge,
}

/// The one bounded HTTP carrier shared by send tickets and receipt polling.
/// It deliberately returns no transport prose: callers can persist only a
/// closed uncertainty class or parse the bounded response through the
/// stage-specific allowlists below.
pub(crate) fn post_expo_json(
    endpoint: &str,
    access_token: Option<&str>,
    payload: Value,
    timeout: std::time::Duration,
) -> Result<ExpoHttpResponseV1, ExpoHttpUncertaintyV1> {
    // @ref LLP 0251#consumerprofile-contract — Expo production is one exact
    // HTTPS authority. The pre-existing local/test override is admitted only
    // when it names a literal loopback HTTP authority; neither branch can be
    // widened by a redirect or inherited proxy.
    let target_policy =
        expo_http_target_policy(endpoint).ok_or(ExpoHttpUncertaintyV1::Transport)?;
    let prepared_target =
        crate::outbound_policy::prepare_http_target(endpoint, target_policy, 4_096)
            .map_err(|_| ExpoHttpUncertaintyV1::Transport)?;
    let agent = crate::outbound_policy::pinned_http_agent(&prepared_target, timeout)
        .map_err(|_| ExpoHttpUncertaintyV1::Transport)?;
    let mut outbound = agent
        .post(prepared_target.authored_url())
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .timeout(timeout);
    if let Some(access_token) = access_token {
        outbound = outbound.set("Authorization", &format!("Bearer {access_token}"));
    }
    let response = match outbound.send_json(payload) {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(_)) => return Err(ExpoHttpUncertaintyV1::Transport),
    };
    let status = response.status();
    let mut body = Vec::new();
    let mut reader = response
        .into_reader()
        .take(PUSH_PROVIDER_RESPONSE_MAX_BYTES + 1);
    if reader.read_to_end(&mut body).is_err() {
        return Err(ExpoHttpUncertaintyV1::ResponseRead);
    }
    if body.len() as u64 > PUSH_PROVIDER_RESPONSE_MAX_BYTES {
        return Err(ExpoHttpUncertaintyV1::ResponseTooLarge);
    }
    Ok(ExpoHttpResponseV1 { status, body })
}

fn expo_http_target_policy(endpoint: &str) -> Option<crate::outbound_policy::HttpTargetPolicy> {
    let parsed = ureq::get(endpoint).request_url().ok()?;
    let url = parsed.as_url();
    if url.username() != "" || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    let host = parsed.host().trim_start_matches('[').trim_end_matches(']');
    let port = parsed
        .port()
        .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
    if parsed.scheme() == "https" && host.eq_ignore_ascii_case("exp.host") && port == 443 {
        return Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly);
    }
    if parsed.scheme() == "http"
        && host
            .parse::<IpAddr>()
            .ok()
            .is_some_and(|address| address.is_loopback())
    {
        return Some(crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp);
    }
    None
}

pub(crate) fn expo_send_payload(claim: &PushBatchClaimV1, request: &PushSendRequestV1) -> Value {
    expo_send_payload_from_parts(claim, &request.title, &request.body, request.data.as_ref())
}

/// Convert one bounded Expo send response into the closed request/ticket
/// outcome vocabulary. Provider prose is deliberately ignored; only the
/// stage-specific allowlisted code or ticket id crosses into settlement.
pub(crate) fn classify_expo_send_response(
    http_status: u16,
    body: &[u8],
    retry_at_ms: u64,
) -> PushBatchSettlementV1 {
    if http_status == 200 {
        let parse = || -> SnapbackResult<Vec<PushTicketOutcomeV1>> {
            let value: Value = serde_json::from_slice(body).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                    "push",
                    "Expo returned invalid ticket JSON",
                )
            })?;
            let tickets = value.get("data").and_then(Value::as_array).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                    "push",
                    "Expo ticket response omitted its data array",
                )
            })?;
            tickets
                .iter()
                .map(
                    |ticket| match ticket.get("status").and_then(Value::as_str) {
                        Some("ok") => {
                            let id = ticket.get("id").and_then(Value::as_str).ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                                    "push",
                                    "Expo ok ticket omitted its id",
                                )
                            })?;
                            validate_provider_id(id)?;
                            Ok(PushTicketOutcomeV1::Ok {
                                ticket_id: id.to_owned(),
                            })
                        }
                        Some("error") => {
                            let code = ticket
                                .get("details")
                                .and_then(|details| details.get("error"))
                                .and_then(Value::as_str)
                                .ok_or_else(|| {
                                    SnapbackError::error(
                                        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                                        "push",
                                        "Expo error ticket omitted its allowlisted code",
                                    )
                                })?;
                            validate_ticket_error_code(code)?;
                            Ok(PushTicketOutcomeV1::Error {
                                code: code.to_owned(),
                            })
                        }
                        _ => Err(SnapbackError::error(
                            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                            "push",
                            "Expo ticket status is outside the closed vocabulary",
                        )),
                    },
                )
                .collect()
        };
        return match parse() {
            Ok(outcomes) => PushBatchSettlementV1::Tickets {
                http_status,
                outcomes,
            },
            Err(_) => PushBatchSettlementV1::Ambiguous {
                code: "provider-shape-invalid".into(),
            },
        };
    }

    let unauthorized = (http_status == 400 || http_status == 401)
        && serde_json::from_slice::<Value>(body)
            .ok()
            .is_some_and(|value| {
                value
                    .get("errors")
                    .and_then(Value::as_array)
                    .is_some_and(|errors| {
                        errors.iter().any(|error| {
                            error.get("code").and_then(Value::as_str) == Some("UNAUTHORIZED")
                        })
                    })
            });
    if unauthorized || http_status == 401 {
        PushBatchSettlementV1::FailedConfig {
            http_status: Some(http_status),
            code: "UNAUTHORIZED".into(),
        }
    } else if http_status == 400 {
        PushBatchSettlementV1::FailedPermanent {
            http_status: Some(http_status),
            code: "http-400".into(),
        }
    } else if http_status == 429 {
        PushBatchSettlementV1::FailedRetryable {
            http_status: Some(http_status),
            code: "http-429".into(),
            retry_at_ms,
        }
    } else if (500..=599).contains(&http_status) {
        PushBatchSettlementV1::FailedRetryable {
            http_status: Some(http_status),
            code: "http-5xx".into(),
            retry_at_ms,
        }
    } else {
        PushBatchSettlementV1::FailedPermanent {
            http_status: Some(http_status),
            code: "http-400".into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterPushTokenRequest {
    pub(crate) installation_id: String,
    pub(crate) token: SecretInput,
}

impl std::fmt::Debug for RegisterPushTokenRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RegisterPushTokenRequest")
            .field("installation_id", &self.installation_id)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UnregisterPushTokenRequest {
    pub(crate) installation_id: String,
}

#[cfg(test)]
mod fake_expo;

#[cfg(test)]
mod tests {
    use super::fake_expo::{FakeExpo, FakeExpoStep};
    use super::*;
    use crate::auth::invocation::{
        InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
    };
    use crate::contract_types::ServerProfile;
    use crate::manifest::{AuthMode, MembershipManifest, MembershipScope, TableManifest};
    use crate::storage::{DbRead, LocalDatabase};

    fn declaration(environment: &str, idle_retention_ms: u64) -> PushSeamDeclarationV1 {
        PushSeamDeclarationV1 {
            app_scope: PushAppScopeV1 {
                eas_project_id: "eas-fixture".into(),
                application_id: "com.example.fixture".into(),
                environment: environment.into(),
            },
            registry: PushRegistryDeclarationV1 { idle_retention_ms },
            audiences: BTreeMap::new(),
            uses: Vec::new(),
            ledger: None,
        }
    }

    fn send_declaration() -> PushSeamDeclarationV1 {
        let mut declaration = declaration("test", 86_400_000);
        declaration.audiences.insert(
            "guests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::Membership {
                    declaration: "event_members".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["guest".into()],
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        );
        declaration.ledger = Some(PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        });
        declaration
    }

    fn registry_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let declaration = declaration("preview", 86_400_000);
        db.push_registry()
            .activate_push_registry_for_test(declaration)
            .expect("push registry activation");
        db
    }

    fn system_ledger_declaration() -> PushSeamDeclarationV1 {
        let mut declaration = declaration("test", 86_400_000);
        declaration.audiences.insert(
            "selectedGuests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principalIds".into(),
                    max_items: 10,
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        );
        declaration.ledger = Some(PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        });
        declaration
    }

    #[test]
    fn expo_http_transport_is_exact_authority_or_literal_loopback_fixture_only() {
        assert_eq!(
            expo_http_target_policy("https://exp.host/--/api/v2/push/send"),
            Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly)
        );
        assert_eq!(
            expo_http_target_policy("https://exp.host:443/--/api/v2/push/getReceipts"),
            Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly)
        );
        assert_eq!(
            expo_http_target_policy("http://127.0.0.1:43123/--/api/v2/push/send"),
            Some(crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp)
        );
        for endpoint in [
            "https://exp.host.example/--/api/v2/push/send",
            "https://exp.host:444/--/api/v2/push/send",
            "https://93.184.216.34/--/api/v2/push/send",
            "http://10.0.0.1/--/api/v2/push/send",
        ] {
            assert_eq!(expo_http_target_policy(endpoint), None, "{endpoint}");
        }
    }

    fn app_membership_schema() -> crate::manifest::SchemaManifest {
        let mut schema = crate::manifest::SchemaManifest::default();
        schema.tables.push(TableManifest {
            name: "app_members".into(),
            fields: Vec::new(),
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: Some(MembershipManifest {
                id: Some("app_members".into()),
                principal: "principal".into(),
                resource: None,
                role: "role".into(),
                roles: vec!["sender".into()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: None,
                transitions: Vec::new(),
                principal_addressed_writes: None,
                scope: MembershipScope::App,
                resource_table: None,
            }),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        });
        schema
    }

    fn push_acceptance_schema(
        declaration: PushSeamDeclarationV1,
    ) -> crate::manifest::SchemaManifest {
        let mut schema = crate::manifest::SchemaManifest {
            push_seam: Some(declaration),
            ..Default::default()
        };
        for (table_name, declaration_id, roles) in [
            ("event_members", "event_members", vec!["guest".to_owned()]),
            ("event_senders", "event_senders", vec!["sender".to_owned()]),
        ] {
            schema.tables.push(TableManifest {
                name: table_name.into(),
                fields: Vec::new(),
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: Some(MembershipManifest {
                    id: Some(declaration_id.into()),
                    principal: "principal".into(),
                    resource: Some("event_id".into()),
                    role: "role".into(),
                    roles,
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    principal_addressed_writes: None,
                    scope: MembershipScope::Resource,
                    resource_table: Some("events".into()),
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            });
        }
        schema
    }

    fn acceptance_request(audience: &str, event_id: &str, dedupe_key: &str) -> PushSendRequestV1 {
        PushSendRequestV1 {
            to: PushAudienceReferenceV1 {
                audience: audience.into(),
                args: Map::from_iter([("eventId".into(), Value::String(event_id.into()))]),
            },
            title: "Fixture title".into(),
            body: "Fixture body".into(),
            data: Some(Map::from_iter([("route".into(), json!("/fixture"))])),
            dedupe_key: dedupe_key.into(),
            redrive_ambiguous: false,
        }
    }

    fn session_authority(user_id: &str) -> crate::auth::invocation::PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::HttpAction,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: user_id.into(),
                session_id: ids::mint(Kind::Session).expect("session id"),
                provider: "email-code".into(),
                generation: 1,
                authority_instance_id: ids::mint(Kind::AuthorityInstance)
                    .expect("authority instance id"),
                session_not_after_ms: 4_000_000_000_000,
                provider_not_after_ms: None,
                rehearsal_provenance: None,
            },
        )
        .expect("prepared session authority")
    }

    fn system_authority() -> crate::auth::invocation::PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::Cron,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::System,
        )
        .expect("prepared system authority")
    }

    fn insert_session(
        db: &mut LocalDatabase,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        expires_at_ms: u64,
        discriminator: u8,
    ) {
        db.push_registry()
            .insert_session_for_test(
                principal_id,
                session_id,
                generation,
                expires_at_ms,
                discriminator,
            )
            .expect("insert session");
    }

    // Keep every registration security field explicit at the call site: these
    // vectors exercise generation fencing and token custody as one tuple.
    #[allow(clippy::too_many_arguments)]
    fn register(
        db: &mut LocalDatabase,
        declaration: &PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<PushTokenRegistrationResponse> {
        db.push_registry().register(
            declaration,
            principal_id,
            session_id,
            session_generation,
            installation_id,
            token,
            now_ms,
        )
    }

    #[test]
    fn token_validator_is_closed_and_never_echoes_bytes() {
        assert!(validate_token("ExponentPushToken[fixture_123]").is_ok());
        assert!(validate_token("ExpoPushToken[fixture-123]").is_ok());
        let secret = "ExponentPushToken[do-not-echo]";
        let error = validate_token(secret.trim_end_matches(']')).unwrap_err();
        assert!(!format!("{error:?}").contains("do-not-echo"));
    }

    #[test]
    fn ledger_projection_is_authorized_and_never_releases_payload_or_token_bytes() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let declaration = system_ledger_declaration();
        db.push_registry()
            .activate_push_registry_for_test(declaration.clone())
            .expect("push ledger");
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let batch_id = ids::mint_time_ordered(Kind::PushBatch);
        let message_id = ids::mint_time_ordered(Kind::PushMessage);
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        let principal_id = ids::mint(Kind::User).expect("principal id");
        let audience_args = serde_json::to_string(&json!({
            "principalIds": [principal_id],
        }))
        .unwrap();
        db.push_registry()
            .seed_ledger_projection_for_test(
                &declaration,
                &intent_id,
                &batch_id,
                &message_id,
                &token_id,
                &audience_args,
            )
            .expect("ledger fixture");

        let system = system_authority();
        let (rows, dependency) = read_ledger_projection_for_prepared(
            &DbRead::Live(&db),
            &declaration,
            db.schema(),
            &system,
            &intent_id,
        )
        .expect("system ledger read");
        assert!(dependency.is_none());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].message_id.as_deref(), Some(message_id.as_str()));
        assert_eq!(rows[0].token_id.as_deref(), Some(token_id.as_str()));
        assert_eq!(rows[0].message_state.as_deref(), Some("handed-to-expo"));
        let wire = serde_json::to_string(&rows[0].to_row_value()).unwrap();
        assert!(!wire.contains("payload-secret"));
        assert!(!wire.contains("token-secret"));
        assert!(!wire.contains("dedupe-secret"));

        let user = session_authority(&principal_id);
        assert_eq!(
            read_ledger_projection_for_prepared(
                &DbRead::Live(&db),
                &declaration,
                db.schema(),
                &user,
                &intent_id,
            )
            .expect_err("system audience is not session-readable")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED",
        );
    }

    #[test]
    fn provider_error_allowlists_are_stage_specific() {
        validate_ticket_error_code("DeviceNotRegistered").expect("ticket retirement code");
        for receipt_code in [
            "DeviceNotRegistered",
            "MessageTooBig",
            "MessageRateExceeded",
            "InvalidCredentials",
        ] {
            validate_receipt_error_code(receipt_code).expect("receipt error code");
        }
        assert_eq!(
            validate_ticket_error_code("MessageTooBig")
                .expect_err("receipt-only code refuses at ticket stage")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            validate_receipt_error_code("InvalidExpoPushToken")
                .expect_err("undeclared provider prose/code refuses")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            classify_expo_send_response(
                200,
                br#"{"data":[{"status":"error","details":{"error":"MessageTooBig"}}]}"#,
                123,
            ),
            PushBatchSettlementV1::Ambiguous {
                code: "provider-shape-invalid".into(),
            }
        );
        assert_eq!(
            classify_expo_send_response(
                400,
                br#"{"errors":[{"code":"UNAUTHORIZED","message":"secret prose"}]}"#,
                123,
            ),
            PushBatchSettlementV1::FailedConfig {
                http_status: Some(400),
                code: "UNAUTHORIZED".into(),
            }
        );
    }

    #[test]
    fn packaged_push_schema_stages_before_the_sessions_catalog_exists() {
        let mut schema: crate::manifest::SchemaManifest = serde_json::from_str(include_str!(
            "../../../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/schema.manifest.json"
        ))
        .unwrap();
        // This fixture proves pre-catalog staging, not remote governance
        // custody. The generated policy remains owner/membership-shaped while
        // its optional deployment-governance carrier is out of scope here.
        schema.visibility_governance = None;
        let functions = serde_json::from_str(include_str!(
            "../../../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json"
        ))
        .unwrap();
        let mut snapback = crate::local::LocalSnapback::memory().unwrap();
        let prepared = snapback
            .prepare_auth_provision(
                crate::local::EnsureAppMode::Sessions,
                Some(schema),
                Some(functions),
                None,
            )
            .unwrap();
        snapback.commit_auth_provision(prepared, "test").unwrap();
    }

    #[test]
    fn expo_receipt_fixture_maps_only_the_closed_outcome_vocabulary() {
        let parsed = parse_expo_receipt_response(
            br#"{
              "data": {
                "ticket_ok": {"status":"ok"},
                "ticket_device": {"status":"error","message":"must not persist","details":{"error":"DeviceNotRegistered"}},
                "ticket_big": {"status":"error","details":{"error":"MessageTooBig"}},
                "ticket_credentials": {"status":"error","details":{"error":"InvalidCredentials"}},
                "ticket_rate": {"status":"error","details":{"error":"MessageRateExceeded"}}
              }
            }"#,
        )
        .expect("closed Expo receipt fixture");
        assert_eq!(parsed.get("ticket_ok"), Some(&PushReceiptOutcomeV1::Ok));
        for (ticket, code) in [
            ("ticket_device", "DeviceNotRegistered"),
            ("ticket_big", "MessageTooBig"),
            ("ticket_credentials", "InvalidCredentials"),
            ("ticket_rate", "MessageRateExceeded"),
        ] {
            assert_eq!(
                parsed.get(ticket),
                Some(&PushReceiptOutcomeV1::Error { code: code.into() })
            );
        }
        assert_eq!(
            parse_expo_receipt_response(
                br#"{"data":{"ticket":{"status":"error","message":"prose only"}}}"#,
            )
            .expect_err("provider prose is not a receipt classification")
            .diagnostic
            .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            parse_expo_receipt_response(
                br#"{"data":{"ticket":{"status":"error","details":{"error":"UnknownProviderCode"}}}}"#,
            )
            .expect_err("unknown provider codes fail closed")
            .diagnostic
            .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
    }

    #[test]
    fn fake_expo_acceptance_covers_tickets_receipts_dedupe_ambiguity_and_authorization() {
        const SEND_PATH: &str = "/--/api/v2/push/send";
        const RECEIPT_PATH: &str = "/--/api/v2/push/getReceipts";
        const ACCESS_TOKEN: &str = "fixture-secret";

        let mut declaration = send_declaration();
        declaration.audiences.insert(
            "authorizedGuests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::Membership {
                    declaration: "event_members".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["guest".into()],
                },
                authorize: PushAudienceAuthorizeV1::Membership {
                    declaration: "event_senders".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["sender".into()],
                },
            },
        );
        let schema = push_acceptance_schema(declaration.clone());
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration.clone())
            .expect("push ledger");

        let principal_ok = ids::mint(Kind::User).expect("ok principal");
        let principal_ticket_dnr = ids::mint(Kind::User).expect("ticket DNR principal");
        let principal_receipt_dnr = ids::mint(Kind::User).expect("receipt DNR principal");
        let (token_ok, token_ticket_dnr, token_receipt_dnr) = db
            .push_registry()
            .seed_acceptance_audience_and_tokens_for_test(
                &declaration,
                &principal_ok,
                &principal_ticket_dnr,
                &principal_receipt_dnr,
            )
            .expect("acceptance audience and token custody");

        let request = acceptance_request("guests", "event-main", "acceptance-main");
        let attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &request,
                100,
            )
            .expect("reserve fixture send");
        assert_eq!(attempt.response.target_count, 3);
        assert_eq!(attempt.response.batch_count, 1);
        let claim = db
            .push_registry()
            .claim_batch(&attempt.batches[0].batch_id, 101)
            .expect("claim fixture batch")
            .expect("fixture batch exists");
        db.push_registry()
            .mark_batch_transmitting(&claim, 102)
            .expect("durable fixture transmit cut");

        let tickets = claim
            .messages
            .iter()
            .map(|message| {
                if message.token_id == token_ok {
                    json!({"status": "ok", "id": "ticket-ok"})
                } else if message.token_id == token_ticket_dnr {
                    json!({
                        "status": "error",
                        "message": "secret-provider-prose-must-not-persist",
                        "details": {"error": "DeviceNotRegistered"}
                    })
                } else {
                    assert_eq!(message.token_id, token_receipt_dnr);
                    json!({"status": "ok", "id": "ticket-receipt-dnr"})
                }
            })
            .collect::<Vec<_>>();
        let mut receipts = Map::new();
        receipts.insert("ticket-ok".into(), json!({"status": "ok"}));
        receipts.insert(
            "ticket-receipt-dnr".into(),
            json!({
                "status": "error",
                "message": "different-secret-provider-prose-must-not-persist",
                "details": {"error": "DeviceNotRegistered"}
            }),
        );
        let provider = FakeExpo::start(vec![
            FakeExpoStep::Json {
                path: SEND_PATH,
                status: 200,
                body: json!({"data": tickets}),
                bearer: Some(ACCESS_TOKEN),
            },
            FakeExpoStep::Json {
                path: RECEIPT_PATH,
                status: 200,
                body: json!({"data": receipts}),
                bearer: Some(ACCESS_TOKEN),
            },
        ]);
        let send_response = post_expo_json(
            &provider.endpoint(SEND_PATH),
            Some(ACCESS_TOKEN),
            expo_send_payload(&claim, &request),
            std::time::Duration::from_secs(5),
        )
        .expect("fixture ticket response");
        let settlement =
            classify_expo_send_response(send_response.status, &send_response.body, 60_000);
        db.push_registry()
            .settle_batch(&claim, &settlement, 103)
            .expect("settle fixture tickets");

        let receipt_due = 103 + PUSH_RECEIPT_FIRST_POLL_MS;
        let receipt_claim = db
            .push_registry()
            .claim_due_receipts(receipt_due)
            .expect("claim fixture receipts");
        assert_eq!(receipt_claim.entries.len(), 2);
        let receipt_response = post_expo_json(
            &provider.endpoint(RECEIPT_PATH),
            Some(ACCESS_TOKEN),
            expo_receipt_payload(&receipt_claim),
            std::time::Duration::from_secs(5),
        )
        .expect("fixture receipt response");
        assert_eq!(receipt_response.status, 200);
        let receipt_outcomes =
            parse_expo_receipt_response(&receipt_response.body).expect("closed receipt response");
        db.push_registry()
            .settle_receipt_poll(&receipt_claim, &receipt_outcomes, receipt_due + 1)
            .expect("settle fixture receipts");

        db.push_registry()
            .assert_acceptance_ledger_outcomes_for_test(&[
                (&token_ok, "expo-accepted", false),
                (&token_ticket_dnr, "failed-permanent", true),
                (&token_receipt_dnr, "expo-error", true),
            ])
            .expect("fixture ledger outcomes");

        let requests = provider.finish();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].path, SEND_PATH);
        assert_eq!(requests[0].body.as_array().map(Vec::len), Some(3));
        assert_eq!(requests[1].path, RECEIPT_PATH);
        let mut receipt_ids = requests[1].body["ids"]
            .as_array()
            .expect("fixture receipt ids")
            .iter()
            .map(|value| value.as_str().expect("ticket id").to_owned())
            .collect::<Vec<_>>();
        receipt_ids.sort();
        assert_eq!(receipt_ids, ["ticket-ok", "ticket-receipt-dnr"]);

        let duplicate = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &request,
                receipt_due + 2,
            )
            .expect("duplicate intent lookup");
        assert!(duplicate.response.deduplicated);
        assert!(duplicate.batches.is_empty());

        let zero_target = acceptance_request("guests", "event-empty", "acceptance-zero");
        let zero_attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &zero_target,
                receipt_due + 3,
            )
            .expect("zero-target intent");
        assert_eq!(zero_attempt.response.state, "zero-target");
        assert_eq!(zero_attempt.response.target_count, 0);
        assert!(zero_attempt.batches.is_empty());

        let unauthorized = ids::mint(Kind::User).expect("unauthorized principal");
        let unauthorized_request =
            acceptance_request("authorizedGuests", "event-main", "acceptance-unauthorized");
        let authorization_error = match db.push_registry().reserve_send(
            &declaration,
            &schema,
            || session_authority(&unauthorized),
            PushTriggerModeV1::Immediate,
            None,
            &unauthorized_request,
            receipt_due + 4,
        ) {
            Ok(_) => panic!("unauthorized push send must refuse"),
            Err(error) => error,
        };
        assert_eq!(
            authorization_error.diagnostic.code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );

        let drop_principal = ids::mint(Kind::User).expect("drop principal");
        db.push_registry()
            .seed_drop_audience_for_test(&declaration, &drop_principal)
            .expect("drop fixture audience");
        let drop_request = acceptance_request("guests", "event-drop", "acceptance-drop");
        let drop_attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &drop_request,
                2_000_000,
            )
            .expect("reserve drop fixture");
        let drop_claim = db
            .push_registry()
            .claim_batch(&drop_attempt.batches[0].batch_id, 2_000_001)
            .expect("claim drop fixture")
            .expect("drop batch exists");
        db.push_registry()
            .mark_batch_transmitting(&drop_claim, 2_000_002)
            .expect("drop fixture transmit cut");
        let dropping_provider =
            FakeExpo::start(vec![FakeExpoStep::DropAfterRequest { path: SEND_PATH }]);
        let uncertainty = post_expo_json(
            &dropping_provider.endpoint(SEND_PATH),
            None,
            expo_send_payload(&drop_claim, &drop_request),
            std::time::Duration::from_secs(5),
        )
        .err()
        .expect("lost response is transport uncertainty");
        assert_eq!(uncertainty, ExpoHttpUncertaintyV1::Transport);
        db.push_registry()
            .settle_batch(
                &drop_claim,
                &PushBatchSettlementV1::Ambiguous {
                    code: "transport-error".into(),
                },
                2_000_003,
            )
            .expect("settle response-loss ambiguity");
        assert_eq!(dropping_provider.finish().len(), 1);
        db.push_registry()
            .assert_no_expired_batch_recovery_for_test(2_100_000)
            .expect("ambiguous settlement has no automatic redrive");

        let implicit_retry = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &drop_request,
                2_100_001,
            )
            .expect("same key remains a deduplicated lookup");
        assert!(implicit_retry.response.deduplicated);
        assert!(implicit_retry.batches.is_empty());

        let mut explicit_redrive = drop_request.clone();
        explicit_redrive.redrive_ambiguous = true;
        let redriven = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &explicit_redrive,
                2_100_002,
            )
            .expect("explicit duplicate-risk redrive");
        assert_eq!(redriven.response.attempt, 2);
        assert!(!redriven.response.deduplicated);
        assert_eq!(redriven.batches.len(), 1);
        db.push_registry()
            .redrive_previous_ambiguous_for_test(&redriven.batches[0].batch_id)
            .expect("redrive provenance marker");
    }

    #[test]
    fn deferred_grant_binds_request_and_revalidates_producer_membership() {
        let producer = ids::mint(Kind::User).expect("producer id");
        let audience = PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
            authorize: PushAudienceAuthorizeV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
        };
        let schema = app_membership_schema();
        let connection = Connection::open_in_memory().expect("sqlite");
        connection
            .execute_batch("CREATE TABLE app_members(principal TEXT, role TEXT);")
            .expect("membership table");
        connection
            .execute(
                "INSERT INTO app_members(principal, role) VALUES(?1, 'sender')",
                params![producer],
            )
            .expect("producer membership");
        let request = PushSendRequestV1 {
            to: PushAudienceReferenceV1 {
                audience: "members".into(),
                args: Map::new(),
            },
            title: "title".into(),
            body: "body".into(),
            data: None,
            dedupe_key: "deferred-1".into(),
            redrive_ambiguous: false,
        };
        let grant = PushDeferredGrantV1 {
            producer_principal: producer.clone(),
            to: request.to.clone(),
            dedupe_key: request.dedupe_key.clone(),
        };
        let authority = system_authority();
        let tx = connection.unchecked_transaction().expect("transaction");
        authorize_send_for_prepared(
            &tx,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Deferred,
            Some(&grant),
            &request,
        )
        .expect("exact grant and current membership authorize");

        let mut divergent = request.clone();
        divergent.dedupe_key = "deferred-2".into();
        assert_eq!(
            authorize_send_for_prepared(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                Some(&grant),
                &divergent,
            )
            .expect_err("grant is bound to one exact dedupe key")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
        tx.execute(
            "DELETE FROM app_members WHERE principal = ?1",
            params![producer],
        )
        .expect("revoke producer membership");
        assert_eq!(
            authorize_send_for_prepared(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                Some(&grant),
                &request,
            )
            .expect_err("execution revalidates current producer membership")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
    }

    #[test]
    fn explicit_principals_and_membership_authorize_consume_their_declared_argument_union() {
        let sender = ids::mint(Kind::User).expect("sender id");
        let recipient = ids::mint(Kind::User).expect("recipient id");
        let audience = PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::ExplicitPrincipals {
                principals_arg: "principalIds".into(),
                max_items: 12,
            },
            authorize: PushAudienceAuthorizeV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
        };
        let mut args = Map::new();
        args.insert("principalIds".into(), json!([recipient]));
        validate_audience_args(&audience, &args).expect("exact declared union");

        let connection = Connection::open_in_memory().expect("sqlite");
        connection
            .execute_batch("CREATE TABLE app_members(principal TEXT, role TEXT);")
            .expect("membership table");
        connection
            .execute(
                "INSERT INTO app_members(principal, role) VALUES(?1, 'sender')",
                params![sender],
            )
            .expect("sender membership");
        let schema = app_membership_schema();
        let authority = session_authority(&sender);
        let tx = connection.unchecked_transaction().expect("transaction");
        authorize_send_for_prepared(
            &tx,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Immediate,
            None,
            &PushSendRequestV1 {
                to: PushAudienceReferenceV1 {
                    audience: "explicitAudience".into(),
                    args: args.clone(),
                },
                title: "title".into(),
                body: "body".into(),
                data: None,
                dedupe_key: "dedupe".into(),
                redrive_ambiguous: false,
            },
        )
        .expect("immediate explicit-principal send is membership-authorized");
        assert_eq!(
            resolve_audience_in(&tx, &schema, &audience.resolve, &args)
                .expect("explicit-principal resolution"),
            vec![recipient]
        );

        let mut extra_args = args.clone();
        extra_args.insert("escapeHatch".into(), json!([sender]));
        assert_eq!(
            validate_audience_args(&audience, &extra_args)
                .expect_err("extra argument refuses")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_SEND_INVALID"
        );
        assert_eq!(
            authorize_send_for_prepared(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                None,
                &PushSendRequestV1 {
                    to: PushAudienceReferenceV1 {
                        audience: "explicitAudience".into(),
                        args,
                    },
                    title: "title".into(),
                    body: "body".into(),
                    data: None,
                    dedupe_key: "dedupe".into(),
                    redrive_ambiguous: false,
                },
            )
            .expect_err("deferred raw principal list refuses")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
    }

    #[test]
    fn undeclared_database_has_no_registry_storage_or_lifecycle_triggers() {
        let mut db = LocalDatabase::memory().expect("undeclared database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let push_objects = |db: &mut LocalDatabase| -> Vec<String> {
            db.push_registry()
                .object_names_for_test()
                .expect("push object inventory")
        };
        assert!(push_objects(&mut db).is_empty());
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .expect("zero-cost inspection projection"),
            PushRegistryInspectionV1::default()
        );

        db.push_registry()
            .activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("declared activation");
        assert!(!push_objects(&mut db).is_empty());
        db.push_registry()
            .activate_manifest(None)
            .expect("declaration removal");
        assert!(push_objects(&mut db).is_empty());
    }

    #[test]
    fn send_declaration_owns_exact_normalized_ledger_and_registry_only_does_not() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration("test", 86_400_000))
            .expect("registry-only activation");
        let ledger_tables = |db: &mut LocalDatabase| -> Vec<String> {
            db.push_registry()
                .ledger_table_names_for_test()
                .expect("ledger table inventory")
        };
        assert!(ledger_tables(&mut db).is_empty());

        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send activation");
        assert_eq!(ledger_tables(&mut db).len(), 3);
        db.push_registry()
            .validate_exact_ledger_schema()
            .expect("exact ledger");

        db.push_registry()
            .tamper_ledger_index_for_test()
            .expect("tamper ledger index");
        let error = db
            .push_registry()
            .validate_exact_ledger_schema()
            .expect_err("tampered physical ledger index refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PUSH_REGISTRY_CORRUPT");
    }

    #[test]
    fn mixed_batch_aggregate_never_hides_ambiguity_or_a_pending_sibling() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send ledger");
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let ambiguous_batch = ids::mint_time_ordered(Kind::PushBatch);
        let pending_batch = ids::mint_time_ordered(Kind::PushBatch);
        let failed_batch = ids::mint_time_ordered(Kind::PushBatch);
        let ambiguous_message = ids::mint_time_ordered(Kind::PushMessage);
        let pending_message = ids::mint_time_ordered(Kind::PushMessage);
        let failed_message = ids::mint_time_ordered(Kind::PushMessage);
        db.push_registry()
            .seed_mixed_batch_aggregate_for_test(
                &intent_id,
                &ambiguous_batch,
                &pending_batch,
                &failed_batch,
                &ambiguous_message,
                &pending_message,
                &failed_message,
            )
            .expect("mixed aggregate fixture");
    }

    #[test]
    fn reserved_recovery_rebinds_rotation_drops_retirement_and_never_redrives_transmitting() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send ledger");
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let batch_id = ids::mint_time_ordered(Kind::PushBatch);
        let message_id = ids::mint_time_ordered(Kind::PushMessage);
        let installation_id = ids::mint(Kind::Installation).unwrap();
        let first_hash = Sha256::digest(b"ExponentPushToken[first]").to_vec();
        db.push_registry()
            .seed_reserved_recovery_for_test(
                &token_id,
                &intent_id,
                &batch_id,
                &message_id,
                &installation_id,
                &first_hash,
            )
            .unwrap();

        assert!(
            db.push_registry()
                .claim_recovered_batch_for_transmit(9)
                .unwrap()
                .is_none(),
            "maintenance must not race a fresh fence-zero action reservation"
        );

        let first_claim = db
            .push_registry()
            .claim_batch(&batch_id, 10)
            .unwrap()
            .expect("first claim");
        assert_eq!(first_claim.messages[0].token, "ExponentPushToken[first]");
        let rotated_hash = Sha256::digest(b"ExponentPushToken[rotated]").to_vec();
        db.push_registry()
            .rotate_token_and_recover_reserved_for_test(&token_id, &rotated_hash)
            .unwrap();
        let recovered = db
            .push_registry()
            .claim_recovered_batch_for_transmit(31_001)
            .unwrap()
            .expect("safe recovery claim");
        assert_eq!(
            recovered.claim.messages[0].token,
            "ExponentPushToken[rotated]"
        );
        assert_eq!(
            recovered.payload,
            json!([{
                "to": "ExponentPushToken[rotated]",
                "title": "hello",
                "body": "world",
                "data": null,
            }])
        );

        // Recovery committed the durable transmit cut with the new claim; a
        // second crash from this point is never redriven.
        db.push_registry()
            .assert_transmitting_recovery_ambiguous_for_test(&batch_id)
            .unwrap();

        // A separately reserved batch whose registry row retires before its
        // first byte becomes a settled no-handoff, with custody erased.
        let retired_intent = ids::mint_time_ordered(Kind::PushIntent);
        let retired_batch = ids::mint_time_ordered(Kind::PushBatch);
        let retired_message = ids::mint_time_ordered(Kind::PushMessage);
        let live_message = ids::mint_time_ordered(Kind::PushMessage);
        let live_token_id = ids::mint_time_ordered(Kind::PushToken);
        let live_installation_id = ids::mint(Kind::Installation).unwrap();
        let live_hash = Sha256::digest(b"ExponentPushToken[live]").to_vec();
        db.push_registry()
            .seed_retired_recovery_for_test(
                &retired_intent,
                &retired_batch,
                &retired_message,
                &live_message,
                &live_token_id,
                &live_installation_id,
                &live_hash,
                &token_id,
                &rotated_hash,
            )
            .unwrap();
        let mixed_claim = db
            .push_registry()
            .claim_batch(&retired_batch, 70_001)
            .unwrap()
            .expect("the live sibling remains claimable");
        assert_eq!(mixed_claim.messages.len(), 1);
        assert_eq!(mixed_claim.messages[0].message_id, live_message);
        db.push_registry()
            .settle_mixed_retired_recovery_for_test(&mixed_claim, &retired_batch)
            .unwrap();
    }

    #[test]
    fn activation_refuses_a_preexisting_non_exact_registry_table() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let tampered_table = REGISTRY_TABLE_SQL.replace(
            "retirement_reference TEXT,",
            "retirement_reference TEXT, tampered_column TEXT,",
        );
        db.push_registry()
            .create_lookalike_registry_for_test(&tampered_table)
            .expect("preexisting lookalike table");

        let error = db
            .push_registry()
            .activate_manifest_with_for_test(|| declaration("preview", 86_400_000))
            .expect_err("CREATE IF NOT EXISTS must not adopt a lookalike table");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PUSH_REGISTRY_CORRUPT");
    }

    #[test]
    fn inspection_refuses_tampered_registry_index_and_trigger() {
        let mut index_db = registry_database();
        index_db
            .push_registry()
            .tamper_registry_index_for_test()
            .expect("tamper physical registry index while forging expected SQL text");
        let index_error = index_db
            .push_registry()
            .push_registry_inspection()
            .expect_err("physical index shape defeats forged sqlite_schema text");
        assert_eq!(
            index_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );

        let mut trigger_db = registry_database();
        trigger_db
            .push_registry()
            .tamper_lifecycle_trigger_for_test()
            .expect("tamper lifecycle trigger");
        let trigger_error = trigger_db
            .push_registry()
            .push_registry_inspection()
            .expect_err("non-exact attached trigger refuses");
        assert_eq!(
            trigger_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );
    }

    #[test]
    fn provider_retirement_is_idempotent_and_erases_token_bytes() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("push registry");
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        db.push_registry()
            .provider_retirement_for_test(&token_id)
            .expect("retirement transaction");
    }

    #[test]
    fn registration_is_idempotent_rotates_atomically_and_enforces_single_owner() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "session-a", 1, 1_000_000_000, 1);
        insert_session(&mut db, "user-b", "session-b", 1, 1_000_000_000, 2);
        let scope = declaration("preview", 86_400_000);
        let installation_a = ids::mint(Kind::Installation).expect("installation a");
        let installation_b = ids::mint(Kind::Installation).expect("installation b");
        let first_token = "ExponentPushToken[first_secret]";
        let rotated_token = "ExponentPushToken[rotated_secret]";

        let first = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            100,
        )
        .expect("first registration");
        let repeated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            101,
        )
        .expect("idempotent registration");
        assert_eq!(repeated.token_id, first.token_id);
        assert!(!repeated.rotated);

        let rotated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            102,
        )
        .expect("atomic rotation");
        assert_eq!(rotated.token_id, first.token_id);
        assert!(rotated.rotated);

        let transferred = register(
            &mut db,
            &scope,
            "user-b",
            "session-b",
            1,
            &installation_b,
            rotated_token,
            103,
        )
        .expect("same-scope ownership transfer");
        assert_ne!(transferred.token_id, first.token_id);
        assert!(transferred.ownership_transferred);

        let (live, predecessor): (i64, (String, String)) = db
            .push_registry()
            .registry_facts_for_test(&first.token_id)
            .expect("registry facts");
        assert_eq!(live, 1);
        assert_eq!(predecessor, (String::new(), "ownership-transferred".into()));

        let other_scope = declaration("production", 86_400_000);
        let activation_error = db
            .push_registry()
            .activate_manifest(Some(&other_scope))
            .expect_err("live old scope blocks schema activation");
        assert_eq!(
            activation_error.diagnostic.code,
            "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED"
        );
        let collision = register(
            &mut db,
            &other_scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            104,
        )
        .expect_err("cross-scope token collision refuses");
        assert_eq!(
            collision.diagnostic.code,
            "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION"
        );
        assert_eq!(
            collision.diagnostic.details,
            json!({
                "indicator": "push-token-cross-app-scope-collision",
                "action": "registration-refused",
            })
        );
        let encoded = serde_json::to_string(&collision).expect("diagnostic serialization");
        assert!(!encoded.contains("rotated_secret"));

        let inspection = db
            .push_registry()
            .push_registry_inspection()
            .expect("operator inspection");
        assert_eq!(inspection.live_tokens, 1);
        assert_eq!(inspection.retired_tokens, 1);
        assert_eq!(inspection.retirement_reasons["ownership-transferred"], 1);
        let inspection_json = serde_json::to_string(&inspection).expect("inspection json");
        assert!(!inspection_json.contains("PushToken"));
        assert!(!inspection_json.contains("secret"));
    }

    #[test]
    fn durable_session_end_retires_exact_generation_and_stale_registration_cannot_resurrect() {
        let mut db = registry_database();
        let logout_session = ids::mint(Kind::Session).expect("logout session");
        let sibling_session = ids::mint(Kind::Session).expect("sibling session");
        insert_session(&mut db, "user-a", &logout_session, 1, 1_000_000_000, 3);
        insert_session(&mut db, "user-a", &sibling_session, 1, 1_000_000_000, 4);
        let scope = declaration("preview", 86_400_000);
        let logout_installation = ids::mint(Kind::Installation).expect("logout installation");
        let sibling_installation = ids::mint(Kind::Installation).expect("sibling installation");
        register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[logout_secret]",
            100,
        )
        .expect("logout registration");
        register(
            &mut db,
            &scope,
            "user-a",
            &sibling_session,
            1,
            &sibling_installation,
            "ExponentPushToken[sibling_secret]",
            100,
        )
        .expect("sibling registration");

        db.push_registry()
            .logout_session_for_test(&logout_session)
            .expect("logout commit");

        let facts: Vec<(String, Option<String>, String)> = db
            .push_registry()
            .session_retirement_facts_for_test()
            .expect("session retirement facts");
        let facts = facts
            .into_iter()
            .map(|(session_id, reason, bytes)| (session_id, (reason, bytes)))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            facts[logout_session.as_str()],
            (Some("session-ended".into()), String::new())
        );
        assert_eq!(
            facts[sibling_session.as_str()],
            (None, "ExponentPushToken[sibling_secret]".into())
        );
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[resurrection_secret]",
            201,
        )
        .expect_err("stale generation loses to logout");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");

        // The same storage hook owns an administrator/durable revocation;
        // exact predecessor generation remains the invariant, not the cause.
        db.push_registry()
            .durable_revoke_session_for_test(&sibling_session)
            .expect("administrator durable-revocation commit");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .expect("inspection after durable revocation")
                .retirement_reasons["session-ended"],
            2
        );
    }

    #[test]
    fn auth_clock_frontier_retires_expiry_in_its_exact_commit() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "expiring-session", 1, 500, 5);
        let scope = declaration("preview", 86_400_000);
        let installation = ids::mint(Kind::Installation).expect("expiry installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_secret]",
            100,
        )
        .expect("expiry registration");
        db.advance_auth_session_clock_floor(499)
            .expect("pre-expiry frontier");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .unwrap()
                .live_tokens,
            1
        );
        db.advance_auth_session_clock_floor(500)
            .expect("expiry frontier commit");
        let inspection = db.push_registry().push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["session-expired"], 1);
        let bytes: String = db.push_registry().token_bytes_for_test().unwrap();
        assert!(bytes.is_empty());
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_resurrection_secret]",
            499,
        )
        .expect_err("durable expiry floor blocks registration after wall-clock rollback");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .unwrap()
                .live_tokens,
            0
        );
    }

    #[test]
    fn declared_idle_retention_retires_only_outside_the_window() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "idle-session", 1, 1_000_000_000, 6);
        let retention = 86_400_000;
        let scope = declaration("preview", retention);
        let installation = ids::mint(Kind::Installation).expect("idle installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "idle-session",
            1,
            &installation,
            "ExponentPushToken[idle_secret]",
            100,
        )
        .expect("idle registration");
        db.push_registry()
            .assert_idle_retention_for_test(&scope, retention)
            .expect("idle maintenance");
        let inspection = db.push_registry().push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["idle-retention"], 1);
    }
}
