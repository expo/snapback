use serde::{Deserialize, Serialize};


/// The bounded per-enqueue fact echoed on the producing mutation's receipt —
/// the mutation-side half of the association (jobId/action/availableAt only;
/// never argument values).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct JobEnqueueFact {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub action: String,
    #[serde(rename = "availableAtMs")]
    pub available_at_ms: u64,
}
