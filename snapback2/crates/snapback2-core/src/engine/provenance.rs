use std::collections::BTreeMap;

/// Runtime-only provenance for row values that survive into an execution result.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — pooled row references preserve the identity of the engine read that produced them without guessing from body equality.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ResultProvenance {
    #[default]
    None,
    Row {
        table: String,
        id: String,
    },
    Array(Vec<ResultProvenance>),
    Object(BTreeMap<String, ResultProvenance>),
}
