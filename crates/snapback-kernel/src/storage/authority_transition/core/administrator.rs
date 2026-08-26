use super::{AuthorityClass, AuthorityPurpose};

pub(super) fn accepts(purpose: &AuthorityPurpose, class: &AuthorityClass) -> bool {
    matches!(purpose, AuthorityPurpose::AdministratorRestore)
        && matches!(
            class,
            AuthorityClass::Operator | AuthorityClass::NonProductionRehearsal
        )
}
