//! Schema registrations for activation and deployment carriers.

use snapback_types::schema_export::{SchemaArtifact, finish};

pub fn schema_registrations() -> Vec<SchemaArtifact> {
    vec![
        finish(
            "auth.external-replay-floor-advance.schema.json",
            schemars::schema_for!(crate::deploy::ExternalReplayFloorAdvanceReceipt),
        ),
        finish(
            "auth.hosted-admission-projection.schema.json",
            schemars::schema_for!(crate::deploy::HostedAdmissionProjectionReceipt),
        ),
        finish(
            "auth.hosted-admission-refresh.schema.json",
            schemars::schema_for!(crate::deploy::HostedAdmissionRefreshReceipt),
        ),
        finish("release.manifest.schema.json", schemars::schema_for!(crate::deploy::ReleaseManifest)),
        finish("target.descriptor.schema.json", schemars::schema_for!(crate::deploy::TargetDescriptor)),
        finish("remote-drill.plan.schema.json", schemars::schema_for!(crate::deploy::RemoteDrillPlan)),
        finish("vm-adapter.request.schema.json", schemars::schema_for!(crate::deploy::AdapterRequest)),
        finish("vm-adapter.response.schema.json", schemars::schema_for!(crate::deploy::AdapterResponse)),
        finish(
            "vm-adapter.lifecycle-request.schema.json",
            schemars::schema_for!(crate::deploy::AdapterLifecycleRequest),
        ),
        finish(
            "vm-adapter.lifecycle-response.schema.json",
            schemars::schema_for!(crate::deploy::AdapterLifecycleResponse),
        ),
        finish(
            "fly-target.binding-v2.schema.json",
            schemars::schema_for!(crate::deploy::FlyTargetBindingV2),
        ),
        finish(
            "vm-adapter.lifecycle-request-v2.schema.json",
            schemars::schema_for!(crate::deploy::AdapterLifecycleRequestV2),
        ),
        finish(
            "vm-adapter.lifecycle-response-v2.schema.json",
            schemars::schema_for!(crate::deploy::AdapterLifecycleResponseV2),
        ),
        finish(
            "provider-effect.intent-v1.schema.json",
            schemars::schema_for!(crate::deploy::ProviderEffectIntentV1),
        ),
        finish(
            "provider-effect.observation-v1.schema.json",
            schemars::schema_for!(crate::deploy::ProviderEffectObservationV1),
        ),
        finish(
            "provider-effect.terminal-v1.schema.json",
            schemars::schema_for!(crate::deploy::ProviderEffectTerminalV1),
        ),
        finish(
            "provider-effect.reconciliation-v1.schema.json",
            schemars::schema_for!(crate::deploy::ProviderEffectReconciliationV1),
        ),
        finish(
            "hosted-control-head-v2.schema.json",
            schemars::schema_for!(crate::deploy::HostedControlHeadV2),
        ),
        finish(
            "planned-binding.promotion-v1.schema.json",
            schemars::schema_for!(crate::deploy::PlannedBindingPromotionV1),
        ),
        finish(
            "hosted-spend-ledger-v1.schema.json",
            schemars::schema_for!(crate::deploy::HostedSpendLedgerV1),
        ),
        finish(
            "vm-adapter.cleanup-plan-v1.schema.json",
            schemars::schema_for!(crate::deploy::CleanupPlanV1),
        ),
        finish(
            "vm-adapter.cleanup-confirmation-v1.schema.json",
            schemars::schema_for!(crate::deploy::CleanupConfirmationV1),
        ),
        finish(
            "vm-adapter.cleanup-receipt-v1.schema.json",
            schemars::schema_for!(crate::deploy::CleanupReceiptV1),
        ),
        finish(
            "hosted-product-journey-v1.schema.json",
            schemars::schema_for!(crate::deploy::HostedProductJourneyV1),
        ),
        finish("backup.manifest.schema.json", schemars::schema_for!(crate::deploy::BackupManifest)),
        finish("backup.plan.schema.json", schemars::schema_for!(crate::deploy::BackupPlan)),
        finish(
            "control.audit-event.schema.json",
            schemars::schema_for!(crate::deploy::ControlAuditEvent),
        ),
        finish(
            "adapter.qualification.schema.json",
            schemars::schema_for!(crate::deploy::AdapterQualificationManifest),
        ),
        finish(
            "hosted-auth.drill-receipt.schema.json",
            schemars::schema_for!(crate::deploy::HostedAuthDrillReceipt),
        ),
        finish(
            "prepared-release.manifest.schema.json",
            schemars::schema_for!(crate::deploy::PreparedReleaseManifest),
        ),
        finish("deploy.plan.schema.json", schemars::schema_for!(crate::deploy::DeployPlan)),
        finish("deploy.receipt.schema.json", schemars::schema_for!(crate::deploy::DeployReceipt)),
        finish("rollback.plan.schema.json", schemars::schema_for!(crate::deploy::RollbackPlan)),
        finish("restore.plan.schema.json", schemars::schema_for!(crate::deploy::RestorePlan)),
        finish(
            "restore.activation-plan.schema.json",
            schemars::schema_for!(crate::deploy::RestoreActivationPlan),
        ),
        finish(
            "maintenance.receipt.schema.json",
            schemars::schema_for!(crate::deploy::MaintenanceReceipt),
        ),
        finish(
            "vm-adapter.query-request.schema.json",
            schemars::schema_for!(crate::deploy::AdapterQueryRequest),
        ),
        finish(
            "vm-adapter.query-response.schema.json",
            schemars::schema_for!(crate::deploy::AdapterQueryResponse),
        ),
        finish(
            "expected-activation-target.schema.json",
            schemars::schema_for!(crate::operational_readiness::ExpectedActivationTargetV1),
        ),
        finish(
            "operational-readiness.schema.json",
            schemars::schema_for!(crate::operational_readiness::OperationalReadinessV1),
        ),
        finish(
            "application-ready.schema.json",
            schemars::schema_for!(crate::operational_readiness::ApplicationReadyReceiptV1),
        ),
        finish("app.bundle.input.schema.json", schemars::schema_for!(crate::bundle::BundleRequest)),
        finish("app.bundle.output.schema.json", schemars::schema_for!(crate::bundle::BundleResponse)),
        finish("routes.manifest.schema.json", schemars::schema_for!(crate::bundle::RoutesManifest)),
    ]
}
