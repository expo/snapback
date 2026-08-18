pub use snapback_types::auth::handshake::*;

pub fn lease_error(
    code: &'static str,
    message: impl Into<String>,
) -> crate::diagnostic::SnapbackError {
    snapback_types::auth::handshake::lease_error(code, message).into()
}
