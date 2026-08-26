use snapback_kernel::storage::{
    LocalDatabase,
    commit_capsule_prototype::{
        PrototypeIntent, PrototypeIntendedRows, exact_reconciliation,
    },
};

fn attempt_cross_intent_staple(
    database: &mut LocalDatabase,
    independent_intent: &PrototypeIntent,
    intended: &PrototypeIntendedRows,
) {
    // @attack
    let _ = exact_reconciliation(database, independent_intent, intended);
}

fn main() {
    let _ = attempt_cross_intent_staple;
}
