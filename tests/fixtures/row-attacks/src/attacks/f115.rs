use snapback_kernel::storage::ServingDatabase;
use snapback_row_attack_fixtures::report_observation;

fn install_fact_asserting_terminal(database: &ServingDatabase) {
    // @attack
    let _ = (|| {
        let factory = database.service_authority_terminal_factory();
        database.service_authority_commit_interlock(move |_, _| {
            Ok(factory.prepared(|| Ok(()), || {}, || {}))
        })
    })();
}

fn main() {
    let _ = install_fact_asserting_terminal;
    report_observation(
        "F115",
        Ok(
            "dependent installed arbitrary committed, rolled-back, and ambiguous callbacks"
                .to_owned(),
        ),
    );
}
