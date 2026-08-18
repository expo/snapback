//! Compatibility façade for the services-owned cron runtime.

pub use snapback_services::cron::{
    CRON_MAX_ACTIVE_RUNS_PER_JOB, CronActivationState, CronInspectState, CronJobInspect,
    CronListJob, CronListState, CronRunClaim, CronRunMetadata, CronRunOutcome, CronRunRecord,
    CronRunTrigger, LocalCronRuntime, validate_cron_manifest,
};
pub(crate) use snapback_services::cron::{
    CronRunMetadataLocalExt, CronRunRecordLocalExt, civil_from_days,
};
