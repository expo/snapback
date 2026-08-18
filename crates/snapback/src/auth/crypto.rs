pub use snapback_types::auth::crypto::*;

pub fn step_up_required_error() -> crate::diagnostic::SnapbackError {
    snapback_types::auth::crypto::step_up_required_error().into()
}
