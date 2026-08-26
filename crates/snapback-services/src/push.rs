//! Platform-owned Expo push transport and product authorization adapter.

use crate::auth::wire::SecretInput;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::net::IpAddr;

#[cfg(test)]
use crate::ids::{self, Kind};
#[cfg(test)]
use sha2::{Digest as _, Sha256};

pub use crate::contract_types::{PushAudienceReferenceV1, PushDeferredGrantV1};
pub use snapback_kernel::push::PushRegistryInspectionV1;
pub(crate) use snapback_kernel::push::PushSendRequestV1;
pub(crate) use snapback_kernel::push::{
    PUSH_BATCH_MESSAGES_MAX, PUSH_PROVIDER_RESPONSE_MAX_BYTES, PUSH_RECEIPT_BATCH_MAX,
    PUSH_RECEIPT_FIRST_POLL_MS, PUSH_RECEIPT_WINDOW_MS, PushBatchClaimV1, PushBatchSettlementV1,
    PushDeferredGrantRequestV1, PushLedgerRowV1, PushReceiptOutcomeV1, PushReceiptPollClaimV1,
    PushRecoveredBatchV1, PushSendReservationResponseV1, PushTicketOutcomeV1,
    PushTokenRegistrationResponse, PushTokenUnregisterResponse, PushTriggerModeV1,
    REGISTRY_TABLE_SQL, ReservedPushAttemptV1, capture_deferred_grant, expo_receipt_payload,
    expo_send_payload_from_parts, parse_expo_receipt_response, validate_audience_args,
    validate_config_uses, validate_declaration_against_schema, validate_provider_id,
    validate_receipt_error_code, validate_ticket_error_code, validate_token,
};
pub use snapback_types::push::*;

pub struct ExpoHttpResponseV1 {
    pub status: u16,
    pub body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExpoHttpUncertaintyV1 {
    Transport,
    ResponseRead,
    ResponseTooLarge,
}

/// The one bounded HTTP carrier shared by send tickets and receipt polling.
/// It deliberately returns no transport prose: callers can persist only a
/// closed uncertainty class or parse the bounded response through the
/// stage-specific allowlists below.
pub fn post_expo_json(
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

pub fn expo_send_payload(claim: &PushBatchClaimV1, request: &PushSendRequestV1) -> Value {
    expo_send_payload_from_parts(claim, &request.title, &request.body, request.data.as_ref())
}

/// Convert one bounded Expo send response into the closed request/ticket
/// outcome vocabulary. Provider prose is deliberately ignored; only the
/// stage-specific allowlisted code or ticket id crosses into settlement.
pub fn classify_expo_send_response(
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
pub struct RegisterPushTokenRequest {
    pub installation_id: String,
    pub token: SecretInput,
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
pub struct UnregisterPushTokenRequest {
    pub installation_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::keyring::AuthKeyringStore;
    use crate::auth::provider::{
        AuthProvider, PasswordIssuanceCustody, PlannedIssuanceCommit, ProviderGuestSessionPlan,
    };
    use crate::auth::throttle::RollingWindowBudgetTerms;
    use crate::contract_types::AuthProviderProfile;
    use crate::storage::LocalDatabase;
    use crate::storage::auth::AuthTransactionAttempt;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Arc;

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

    #[cfg(feature = "services-owner")]
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

    fn mint_session(
        db: &mut LocalDatabase,
        expires_at_ms: u64,
        idempotency_key: &str,
    ) -> crate::auth::wire::SessionResponse {
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(0, &crate::auth::crypto::OsRandom)
            .expect("initialize production guest keyring");
        let provider = AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct production auth provider");
        let planned = provider
            .plan_guest_session(
                db,
                0,
                expires_at_ms,
                RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                idempotency_key,
                "push-service-test-app",
                "push-service-test-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect("plan production guest session");
        let ProviderGuestSessionPlan::Planned(plan) = planned else {
            panic!("fresh idempotency key must plan a guest session");
        };
        let attempt = provider.commit_guest_issuance(db, &plan.commit_plan());
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { session, .. }) =
            attempt
        else {
            panic!("production guest session must commit");
        };
        session
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

    #[cfg(feature = "services-owner")]
    #[test]
    fn token_validator_is_closed_and_never_echoes_bytes() {
        assert!(validate_token("ExponentPushToken[fixture_123]").is_ok());
        assert!(validate_token("ExpoPushToken[fixture-123]").is_ok());
        let secret = "ExponentPushToken[do-not-echo]";
        let error = validate_token(secret.trim_end_matches(']')).unwrap_err();
        assert!(!format!("{error:?}").contains("do-not-echo"));
    }

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
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

    #[cfg(feature = "services-owner")]
    #[test]
    fn registration_is_idempotent_rotates_atomically_and_enforces_single_owner() {
        let mut db = registry_database();
        let session_a = mint_session(&mut db, 1_000_000_000, "push-registration-session-a");
        let session_b = mint_session(&mut db, 1_000_000_000, "push-registration-session-b");
        let scope = declaration("preview", 86_400_000);
        let installation_a = ids::mint(Kind::Installation).expect("installation a");
        let installation_b = ids::mint(Kind::Installation).expect("installation b");
        let first_token = "ExponentPushToken[first_secret]";
        let rotated_token = "ExponentPushToken[rotated_secret]";

        let first = register(
            &mut db,
            &scope,
            &session_a.user_id,
            &session_a.id,
            session_a.generation,
            &installation_a,
            first_token,
            100,
        )
        .expect("first registration");
        let repeated = register(
            &mut db,
            &scope,
            &session_a.user_id,
            &session_a.id,
            session_a.generation,
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
            &session_a.user_id,
            &session_a.id,
            session_a.generation,
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
            &session_b.user_id,
            &session_b.id,
            session_b.generation,
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
            &session_a.user_id,
            &session_a.id,
            session_a.generation,
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

    #[cfg(feature = "services-owner")]
    #[test]
    fn durable_session_end_retires_exact_generation_and_stale_registration_cannot_resurrect() {
        let mut db = registry_database();
        let logout_session = mint_session(&mut db, 1_000_000_000, "push-logout-session");
        let sibling_session = mint_session(&mut db, 1_000_000_000, "push-sibling-session");
        let scope = declaration("preview", 86_400_000);
        let logout_installation = ids::mint(Kind::Installation).expect("logout installation");
        let sibling_installation = ids::mint(Kind::Installation).expect("sibling installation");
        register(
            &mut db,
            &scope,
            &logout_session.user_id,
            &logout_session.id,
            logout_session.generation,
            &logout_installation,
            "ExponentPushToken[logout_secret]",
            100,
        )
        .expect("logout registration");
        register(
            &mut db,
            &scope,
            &sibling_session.user_id,
            &sibling_session.id,
            sibling_session.generation,
            &sibling_installation,
            "ExponentPushToken[sibling_secret]",
            100,
        )
        .expect("sibling registration");

        db.push_registry()
            .logout_session_for_test(&logout_session.id)
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
            facts[logout_session.id.as_str()],
            (Some("session-ended".into()), String::new())
        );
        assert_eq!(
            facts[sibling_session.id.as_str()],
            (None, "ExponentPushToken[sibling_secret]".into())
        );
        let stale = register(
            &mut db,
            &scope,
            &logout_session.user_id,
            &logout_session.id,
            logout_session.generation,
            &logout_installation,
            "ExponentPushToken[resurrection_secret]",
            201,
        )
        .expect_err("stale generation loses to logout");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");

        // The same storage hook owns an administrator/durable revocation;
        // exact predecessor generation remains the invariant, not the cause.
        db.push_registry()
            .durable_revoke_session_for_test(&sibling_session.id)
            .expect("administrator durable-revocation commit");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .expect("inspection after durable revocation")
                .retirement_reasons["session-ended"],
            2
        );
    }

    #[cfg(feature = "services-owner")]
    #[test]
    fn auth_clock_frontier_retires_expiry_in_its_exact_commit() {
        let mut db = registry_database();
        let expiring_session = mint_session(&mut db, 500, "push-expiring-session");
        let scope = declaration("preview", 86_400_000);
        let installation = ids::mint(Kind::Installation).expect("expiry installation");
        register(
            &mut db,
            &scope,
            &expiring_session.user_id,
            &expiring_session.id,
            expiring_session.generation,
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
            &expiring_session.user_id,
            &expiring_session.id,
            expiring_session.generation,
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

    #[cfg(feature = "services-owner")]
    #[test]
    fn declared_idle_retention_retires_only_outside_the_window() {
        let mut db = registry_database();
        let idle_session = mint_session(&mut db, 1_000_000_000, "push-idle-session");
        let retention = 86_400_000;
        let scope = declaration("preview", retention);
        let installation = ids::mint(Kind::Installation).expect("idle installation");
        register(
            &mut db,
            &scope,
            &idle_session.user_id,
            &idle_session.id,
            idle_session.generation,
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
