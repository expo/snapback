// Keep the complete RBAC qualification in one integration-test crate. This
// preserves independent modules while avoiding four redundant test-binary
// links in the measured edit-to-test loop.

#[path = "rbac_cases/adversarial.rs"]
mod adversarial;
#[path = "rbac_cases/certificate_branch_writes.rs"]
mod certificate_branch_writes;
#[path = "rbac_cases/rule_types.rs"]
mod rule_types;
#[path = "rbac_cases/schema_maintains.rs"]
mod schema_maintains;
#[path = "rbac_cases/text_constraints.rs"]
mod text_constraints;
#[path = "rbac_cases/tier0_authorization.rs"]
mod tier0_authorization;
