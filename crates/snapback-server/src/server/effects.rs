use super::*;
use crate::local::{PreparedEffectApproval, PreparedEffectOriginalAuthority};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EffectApprovalRequest {
    step_up: Option<StepUpProofRequest>,
}

pub(super) async fn effect_list(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Vec<crate::storage::pending_effects::PendingEffectRecord>>, ApiError> {
    let (user_id, _) =
        LocalSnapback::require_effect_management_session(&authority).map_err(ApiError::from)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = installed_auth_provider(&runtime)?.now_ms();
    let management = authority.clone();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            let effects = snapback.pending_effects_for_approver(&management, &user_id, now_ms)?;
            Ok::<_, SnapbackError>(
                effects
                    .into_iter()
                    .filter(|effect| {
                        snapback
                            .function_definition(&effect.function_name)
                            .filter(|function| function.id == effect.function_id)
                            .is_some_and(|function| {
                                InvocationGate::validate_current_function_policy(
                                    &management,
                                    function,
                                )
                                .is_ok()
                            })
                    })
                    .collect(),
            )
        })
        .await?,
    ))
}

pub(super) async fn prepare_original_authority(
    runtime: &AppState,
    approval: &PreparedEffectApproval,
) -> Result<PreparedEffectOriginalAuthority, ApiError> {
    enum EffectAuthorityResolution {
        Anonymous(crate::auth::session_projection::FencedPublication),
        Session(crate::auth::coordinator::PreparedBearerAuthority),
        Service(
            crate::local::ResolvedServiceAuthority,
            crate::auth::session_projection::FencedPublication,
        ),
    }
    let provider = installed_auth_provider(runtime)?;
    let now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let coordinator = installed_auth_coordinator(runtime)?;
    let resolution = match approval.original_authority() {
        crate::storage::pending_effects::RetainedEffectOriginalAuthority::Anonymous => {
            EffectAuthorityResolution::Anonymous(
                coordinator
                    .prepare_anonymous_publication()
                    .map_err(ApiError::from)?,
            )
        }
        crate::storage::pending_effects::RetainedEffectOriginalAuthority::Session(retained) => {
            let prepared = coordinator
                .prepare_retained_effect_session(&retained, now_ms, monotonic_now)
                .map_err(ApiError::from)?;
            EffectAuthorityResolution::Session(prepared)
        }
        crate::storage::pending_effects::RetainedEffectOriginalAuthority::ServicePrincipal(_) => {
            let stream_publication = coordinator
                .prepare_anonymous_publication()
                .map_err(ApiError::from)?;
            let service_clock = provider.clone();
            let service_approval = approval.clone();
            let service_resolution = with_snapback(&runtime.snapback, move |snapback| {
                let crate::storage::pending_effects::RetainedEffectOriginalAuthority::ServicePrincipal(
                    retained,
                ) = service_approval.original_authority()
                else {
                    return Err(effect_binding_stale(
                        "the pending effect authority arm changed during reconstruction",
                    ));
                };
                snapback.resolve_retained_effect_service_authority(
                    &retained,
                    now_ms,
                    monotonic_now,
                    service_clock,
                )
            })
            .await?;
            EffectAuthorityResolution::Service(service_resolution, stream_publication)
        }
    };
    let prepared_approval = approval.clone();
    Ok(
        with_snapback(&runtime.snapback, move |snapback| match resolution {
            EffectAuthorityResolution::Anonymous(publication) => snapback
                .prepare_pending_effect_anonymous_original(&prepared_approval, publication, now_ms),
            EffectAuthorityResolution::Session(prepared) => snapback
                .prepare_pending_effect_session_original(&prepared_approval, prepared, now_ms),
            EffectAuthorityResolution::Service(resolution, publication) => snapback
                .prepare_pending_effect_service_original(
                    &prepared_approval,
                    resolution,
                    publication,
                    now_ms,
                ),
        })
        .await?,
    )
}

fn effect_binding_stale(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_EFFECT_BINDING_STALE", "effects", message)
}

async fn refuse_after_revalidation(
    runtime: &AppState,
    authority: PreparedAuthority,
    effect_id: String,
    code: String,
) {
    let _ = with_snapback(&runtime.snapback, move |snapback| {
        snapback.refuse_pending_effect(&authority, &effect_id, &code, now_millis())
    })
    .await;
}

fn decision_error_terminalizes(code: &str) -> bool {
    !matches!(
        code,
        "SNAPBACK_AUTH_STEP_UP_REQUIRED"
            | "SNAPBACK_EFFECT_APPROVAL_DENIED"
            | "SNAPBACK_EFFECT_STATE_INVALID"
            | "SNAPBACK_EFFECT_EXPIRED"
    )
}

/// The pending-effect sibling reuses the grant-request approve/deny ceremony:
/// a session-authorized inbox, an operation-bound step-up proof where needed,
/// and an atomic human veto/decision transition.
// @ref LLP 0150#2-the-approval-link-flow-agent-initiated-consent-without-the-oracle — effects share the
// established approval object and ceremony instead of defining a second UX.
// @ref LLP 0204#d95--approval-gated-effects — approval revalidates the frozen
// binding and executes only through the original caller's authority semantics.
pub(super) async fn effect_approve(
    State(runtime): State<AppState>,
    Extension(management): Extension<PreparedAuthority>,
    Extension(route): Extension<RouteSpec>,
    Path(effect_id): Path<String>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let result: Result<Response, ApiError> = async {
        let provider = installed_auth_provider(&runtime)?;
        let request: EffectApprovalRequest = parse_auth_json(&headers, body)?;
        let now_ms = provider.now_ms();
        let prepare_id = effect_id.clone();
        let prepare_management = management.clone();
        let approval = with_snapback(&runtime.snapback, move |snapback| {
            snapback.prepare_pending_effect_approval(&prepare_management, &prepare_id, now_ms)
        })
        .await;
        let approval = match approval {
            Ok(approval) => approval,
            Err(error) => {
                let code = error.diagnostic.code.clone();
                if decision_error_terminalizes(&code) {
                    refuse_after_revalidation(
                        &runtime,
                        management.clone(),
                        effect_id.clone(),
                        code,
                    )
                    .await;
                }
                return Err(error.into());
            }
        };
        let approved_effect_id = approval.effect_id().to_owned();
        let original = match prepare_original_authority(&runtime, &approval).await {
            Ok(authority) => authority,
            Err(error) => {
                let code = error.0.diagnostic.code.clone();
                refuse_after_revalidation(
                    &runtime,
                    management.clone(),
                    approved_effect_id.clone(),
                    code,
                )
                .await;
                return Err(error);
            }
        };
        let proof_admission = match request.step_up {
            Some(step_up) => {
                let binding = effect_step_up_binding(&management, approved_effect_id.clone())?;
                let admission = provider.admit().await;
                let challenge_id = step_up.challenge_id.clone();
                let (admission, coordination) = with_snapback(&runtime.snapback, move |snapback| {
                    let coordination = snapback
                        .execute_auth_plan(admission.step_up_coordination_plan(&challenge_id));
                    (admission, coordination)
                })
                .await;
                let coordination = coordination.map_err(map_provider_error)?;
                Some(
                    admission
                        .for_step_up(coordination, binding, step_up.code.as_str())
                        .await
                        .map_err(map_provider_error)?,
                )
            }
            None => None,
        };
        let decided = with_snapback(&runtime.snapback, move |snapback| {
            snapback.approve_pending_effect(
                approval,
                original,
                proof_admission.as_ref().map(|admission| admission.proof()),
                now_ms,
            )
        })
        .await;
        let decided = match decided {
            Ok(record) => record,
            Err(error) => {
                let code = error.diagnostic.code.clone();
                if decision_error_terminalizes(&code) {
                    refuse_after_revalidation(
                        &runtime,
                        management.clone(),
                        effect_id.clone(),
                        code,
                    )
                    .await;
                }
                return Err(error.into());
            }
        };
        let (decided, original, settlement) = decided.into_parts();
        let mut response = match decided.function_kind {
            FunctionKind::Mutation => {
                let mut request = MutationRequest::default();
                request.input.args = decided.args.clone();
                request.expected_generation = Some(decided.generation.clone());
                invoke_mutation(
                    State(runtime.clone()),
                    State(runtime.snapback.clone()),
                    Extension(original),
                    Extension(route),
                    None,
                    HeaderMap::new(),
                    Path(decided.function_name.clone()),
                    Ok(Json(request)),
                )
                .await
            }
            FunctionKind::Action => {
                let mut request = FunctionCallRequest::default();
                request.input.args = decided.args.clone();
                request.expected_generation = Some(decided.generation.clone());
                invoke_action(
                    State(runtime.clone()),
                    State(runtime.snapback.clone()),
                    HeaderMap::new(),
                    Extension(original),
                    Extension(route),
                    None,
                    Path(decided.function_name.clone()),
                    Ok(Json(request)),
                )
                .await
                .into_response()
            }
            FunctionKind::Query | FunctionKind::LiveQuery => {
                unreachable!("pending-effect storage admits only mutation/action kinds")
            }
        };
        let outcome = response
            .extensions()
            .get::<TelemetryDiagnosticCode>()
            .map(|code| code.0.as_str())
            .unwrap_or(if response.status().is_success() {
                "ok"
            } else {
                "execution-refused"
            })
            .to_owned();
        let executed = response.status().is_success();
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.settle_pending_effect(settlement, executed, Some(&outcome), now_millis())
        })
        .await?;
        response.headers_mut().insert(
            HeaderName::from_static("x-snapback-effect-id"),
            HeaderValue::from_str(&approved_effect_id)
                .map_err(|_| effect_binding_stale("the pending effect id cannot be published"))?,
        );
        Ok(response)
    }
    .await;
    result.into_response()
}

pub(super) async fn effect_deny(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    Path(effect_id): Path<String>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<crate::storage::pending_effects::PendingEffectRecord>, ApiError> {
    let (approver_id, _) =
        LocalSnapback::require_effect_management_session(&authority).map_err(ApiError::from)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let now_ms = installed_auth_provider(&runtime)?.now_ms();
    let effect_authority = authority.clone();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.deny_pending_effect(&effect_authority, &effect_id, &approver_id, now_ms)
        })
        .await?,
    ))
}
