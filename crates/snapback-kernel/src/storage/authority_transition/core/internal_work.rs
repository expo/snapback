use super::{AuthorityClass, AuthorityPurpose};

pub(super) fn accepts(purpose: &AuthorityPurpose, class: &AuthorityClass) -> bool {
    matches!(purpose, AuthorityPurpose::InternalWorkTransition)
        && matches!(
            class,
            AuthorityClass::DelegatedService
                | AuthorityClass::AutonomousService
                | AuthorityClass::InternalWork
        )
}
