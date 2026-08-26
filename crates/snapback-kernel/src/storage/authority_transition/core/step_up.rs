use super::{AuthorityClass, AuthorityPurpose};

pub(super) fn accepts(purpose: &AuthorityPurpose, class: &AuthorityClass) -> bool {
    matches!(purpose, AuthorityPurpose::StepUpTransition)
        && matches!(class, AuthorityClass::Human | AuthorityClass::Operator)
}
