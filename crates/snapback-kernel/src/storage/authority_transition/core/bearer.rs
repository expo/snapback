use super::{AuthorityClass, AuthorityPurpose};

pub(super) fn accepts(purpose: &AuthorityPurpose, class: &AuthorityClass) -> bool {
    matches!(purpose, AuthorityPurpose::BearerSessionRotation)
        && matches!(
            class,
            AuthorityClass::Human
                | AuthorityClass::DelegatedService
                | AuthorityClass::AutonomousService
        )
}
