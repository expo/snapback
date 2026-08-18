use super::*;
use crate::manifest::FunctionDefinition;
use crate::telemetry::CallerAttributionLocalExt as _;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EffectApprovalRequest {
    step_up: Option<StepUpProofRequest>,
}

fn require_effect_session(authority: &PreparedAuthority) -> Result<(String, String), ApiError> {
    require_provider_session_authority(authority, InvocationSource::EffectManagement)?;
    let ResolvedAppAuthority::Session {
        user_id,
        session_id,
        ..
    } = authority.resolved()
    else {
        unreachable!("effect management source requires session authority")
    };
    Ok((user_id.clone(), session_id.clone()))
}

pub(super) async fn effect_list(
    State(runtime): State<AppState>,
    Extension(authority): Extension<PreparedAuthority>,
    OriginalUri(uri): OriginalUri,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Vec<crate::storage::pending_effects::PendingEffectRecord>>, ApiError> {
    let (user_id, _) = require_effect_session(&authority)?;
    let body = body.map_err(|_| auth_request_invalid())?;
    if uri.query().is_some() || !body.is_empty() {
        return Err(auth_request_invalid());
    }
    let now_ms = installed_auth_provider(&runtime)?.now_ms();
    let management = authority.clone();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            let effects = snapback
                .auth_database_mut()
                .pending_effects_for_approver(&user_id, now_ms)?;
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
    management: &PreparedAuthority,
    effect: &crate::storage::pending_effects::PendingEffectRecord,
    approver: &str,
) -> Result<PreparedAuthority, ApiError> {
    let provider = installed_auth_provider(runtime)?;
    let now_ms = provider.now_ms();
    let monotonic_now = provider.monotonic_now();
    let coordinator = installed_auth_coordinator(runtime)?;
    let (resolved, publication, service_publication) = match &effect.authority {
        crate::storage::pending_effects::PendingEffectAuthority::Anonymous => (
            ResolvedAppAuthority::Anonymous,
            coordinator
                .prepare_anonymous_publication()
                .map_err(ApiError::from)?,
            None,
        ),
        crate::storage::pending_effects::PendingEffectAuthority::Session {
            user_id,
            session_id,
            provider: session_provider,
            generation,
            authority_instance_id,
            authorization_stream_incarnation,
        } => {
            let prepared = coordinator
                .prepare_retained_effect_session(
                    authorization_stream_incarnation,
                    session_id,
                    user_id,
                    session_provider,
                    *generation,
                    now_ms,
                    monotonic_now,
                )
                .map_err(ApiError::from)?;
            let (resolved, publication) = prepared.into_parts();
            if !matches!(
                &resolved,
                ResolvedAppAuthority::Session { authority_instance_id: current, .. }
                    if current == authority_instance_id
            ) {
                return Err(effect_binding_stale(
                    "the original session authority instance is no longer current",
                )
                .into());
            }
            (resolved, publication, None)
        }
        crate::storage::pending_effects::PendingEffectAuthority::ServicePrincipal {
            actor_user_id,
            credential_id,
            credential_generation,
            grant_id,
            token_id,
            effective_user_id,
            token_expires_at_ms,
        } => {
            let stream_publication = coordinator
                .prepare_anonymous_publication()
                .map_err(ApiError::from)?;
            let actor_user_id = actor_user_id.clone();
            let credential_id = credential_id.clone();
            let grant_id = grant_id.clone();
            let token_id = token_id.clone();
            let effective_user_id = effective_user_id.clone();
            let credential_generation = *credential_generation;
            let expected_expires_at_ms = *token_expires_at_ms;
            let fences = runtime.service_authority_fences.clone();
            let service_clock = provider.clone();
            let (resolved, service_publication) =
                with_snapback(&runtime.snapback, move |snapback| {
                    let resolved = snapback
                        .auth_database_mut()
                        .resolve_retained_service_authority(
                            crate::storage::auth_agent_credentials::RetainedServiceAuthority {
                                actor_user_id: &actor_user_id,
                                credential_id: &credential_id,
                                credential_generation,
                                grant_id: &grant_id,
                                token_id: &token_id,
                                effective_user_id: effective_user_id.as_deref(),
                            },
                            now_ms,
                        )?;
                    if resolved.expires_at_ms != expected_expires_at_ms {
                        return Err(effect_binding_stale(
                            "the scoped-token deadline differs from the frozen authority",
                        ));
                    }
                    let publication = fences
                        .register(resolved.service_authority_witness(), now_ms, monotonic_now)?
                        .with_provider_clock(service_clock);
                    Ok::<_, SnapbackError>((resolved, publication))
                })
                .await?;
            (
                ResolvedAppAuthority::from_scoped_token(resolved),
                stream_publication,
                Some(service_publication),
            )
        }
    };
    let profile = runtime.server.profile;
    let admission = management.admission_lease().clone();
    let prepared = with_snapback(&runtime.snapback, move |snapback| {
        snapback.prepare_resolved_authority(
            InvocationSource::EffectExecution,
            AuthMode::Sessions,
            profile,
            admission,
            &WireAuthorityFields::default(),
            resolved,
            now_ms,
        )
    })
    .await?
    .with_fenced_publication(publication)
    .with_caller_attribution(
        crate::telemetry::CallerAttributionV1::from_effect(
            &effect.caller_lane,
            effect.caller_key.clone(),
        )
        .with_approver(approver.to_owned()),
    );
    Ok(match service_publication {
        Some(publication) => prepared.with_service_publication(publication),
        None => prepared,
    })
}

fn effect_binding_stale(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_EFFECT_BINDING_STALE", "effects", message)
}

fn current_effect_gate(function: &FunctionDefinition, approval_per_use: bool) -> bool {
    function.api_exposure.as_ref().is_some_and(|exposure| {
        exposure.expose && (exposure.approval.is_some() || approval_per_use)
    })
}

async fn refuse_after_revalidation(runtime: &AppState, effect_id: String, code: String) {
    let _ = with_snapback(&runtime.snapback, move |snapback| {
        snapback
            .auth_database_mut()
            .refuse_pending_effect(&effect_id, &code, now_millis())
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
        let (approver_id, _) = require_effect_session(&management)?;
        let provider = installed_auth_provider(&runtime)?;
        let request: EffectApprovalRequest = parse_auth_json(&headers, body)?;
        let now_ms = provider.now_ms();
        let lookup_id = effect_id.clone();
        let effect = with_snapback(&runtime.snapback, move |snapback| {
            snapback
                .auth_database_mut()
                .pending_effect(&lookup_id, now_ms)
        })
        .await?;
        let original =
            match prepare_original_authority(&runtime, &management, &effect, &approver_id).await {
                Ok(authority) => authority,
                Err(error) => {
                    let code = error.0.diagnostic.code.clone();
                    refuse_after_revalidation(&runtime, effect_id.clone(), code).await;
                    return Err(error);
                }
            };
        let proof_admission = match request.step_up {
            Some(step_up) => {
                let binding = effect_step_up_binding(&management, effect_id.clone())?;
                let admission = provider.admit().await;
                let challenge_id = step_up.challenge_id.clone();
                let (admission, coordination) = with_snapback(&runtime.snapback, move |snapback| {
                    let coordination =
                        admission.step_up_coordination(snapback.auth_database_mut(), &challenge_id);
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
        let check_effect = effect.clone();
        let check_original = original.clone();
        let check_management = management.clone();
        let check_approver = approver_id.clone();
        let decided = with_snapback(&runtime.snapback, move |snapback| {
            let function = snapback
                .function_definition(&check_effect.function_name)
                .cloned()
                .ok_or_else(|| effect_binding_stale("the approved function no longer exists"))?;
            if function.id != check_effect.function_id
                || function.kind != check_effect.function_kind
            {
                return Err(effect_binding_stale(
                    "the approved function identity or kind changed",
                ));
            }
            let facts = snapback
                .function_invocation_facts(AuthMode::Sessions)?
                .ok_or_else(|| effect_binding_stale("the current generation is unavailable"))?;
            if facts.active_generation != check_effect.generation {
                return Err(effect_binding_stale(
                    "the active function generation changed after intent creation",
                ));
            }
            let mut approval_per_use = false;
            if let Some(link_id) = check_effect.link_origin_id.as_deref() {
                let link = snapback
                    .auth_database_mut()
                    .capability_link_effect_origin(link_id, now_ms)?;
                if link.minter_principal_id != check_approver || link.function_id != function.id {
                    return Err(effect_binding_stale(
                        "the capability-link minter or function binding changed",
                    ));
                }
                approval_per_use = link.approval_per_use;
            }
            if !current_effect_gate(&function, approval_per_use) {
                return Err(effect_binding_stale(
                    "the function is unexposed or no longer approval gated",
                ));
            }
            crate::args_contract::validate_function_args(&function, &check_effect.args)?;
            InvocationGate::validate_current_function_policy(&check_original, &function)?;
            InvocationGate::validate_current_function_policy(&check_management, &function)?;
            let _effect = check_management.effect_guard("pending-effect approval transaction")?;
            snapback.auth_database_mut().decide_pending_effect(
                &check_effect.id,
                &check_approver,
                true,
                function.authority_creating,
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
                    refuse_after_revalidation(&runtime, effect_id.clone(), code).await;
                }
                return Err(error.into());
            }
        };
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
        let settle_id = effect_id.clone();
        with_snapback(&runtime.snapback, move |snapback| {
            snapback.auth_database_mut().settle_pending_effect(
                &settle_id,
                executed,
                Some(&outcome),
                now_millis(),
            )
        })
        .await?;
        response.headers_mut().insert(
            HeaderName::from_static("x-snapback-effect-id"),
            HeaderValue::from_str(&effect_id)
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
    let (approver_id, _) = require_effect_session(&authority)?;
    let _: EmptyAuthRequest = parse_auth_json(&headers, body)?;
    let now_ms = installed_auth_provider(&runtime)?.now_ms();
    let effect_authority = authority.clone();
    Ok(Json(
        with_snapback(&runtime.snapback, move |snapback| {
            let _effect = effect_authority.effect_guard("pending-effect denial transaction")?;
            snapback.auth_database_mut().decide_pending_effect(
                &effect_id,
                &approver_id,
                false,
                false,
                None,
                now_ms,
            )
        })
        .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        ApiFunctionApproval, ApiFunctionExposure, FunctionRuntime, HandlerPlan, MutationPlan,
    };

    #[test]
    fn current_gate_requires_live_exposure_even_for_per_use_links() {
        let mut function = FunctionDefinition::new(
            "write",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            })),
        );
        function.api_exposure = Some(ApiFunctionExposure {
            expose: true,
            since: None,
            approval: Some(ApiFunctionApproval::Required),
        });
        assert!(current_effect_gate(&function, false));
        function.api_exposure.as_mut().unwrap().approval = None;
        assert!(!current_effect_gate(&function, false));
        assert!(current_effect_gate(&function, true));
        function.api_exposure.as_mut().unwrap().expose = false;
        assert!(!current_effect_gate(&function, true));
    }
}
