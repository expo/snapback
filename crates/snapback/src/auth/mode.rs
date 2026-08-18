pub use snapback_types::auth::mode::*;

pub fn mode_corrupt(message: &'static str) -> crate::diagnostic::SnapbackError {
    snapback_types::auth::mode::mode_corrupt(message).into()
}
