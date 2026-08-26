use super::{AuthorityClass, AuthorityPurpose};

pub(super) fn accepts(purpose: &AuthorityPurpose, class: &AuthorityClass) -> bool {
    matches!(purpose, AuthorityPurpose::DeliveryIdentityConfirmation)
        && matches!(class, AuthorityClass::Human)
}
