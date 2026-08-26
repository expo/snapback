use super::AuthorityMutation;

pub(super) fn matches(mutation: &AuthorityMutation) -> bool {
    matches!(mutation, AuthorityMutation::CommitInternalWork)
}
