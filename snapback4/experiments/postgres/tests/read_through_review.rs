#[path = "../../../crates/snapback4-lang/tests/read_through/review_cases.rs"]
mod cases;
use cases::{Backend, Outcome};
use snapback4_core::{
    Context,
    engine::{WriteState, postgres::PostgresEngine},
    meter::Ceilings,
};
use snapback4_postgres_evaluation::{connect, namespace};

struct Pg(PostgresEngine);
impl Backend for Pg {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome {
        self.0.set_ceilings(ceilings);
        if self.0.programs()[op].kind == snapback4_core::ir::ProgramKind::Query {
            let o = self.0.query(op, context).unwrap();
            assert!(o.complete && !o.unavailable, "{op}: {o:?}");
            (Ok(o.data), o.metered)
        } else {
            let o = self.0.mutate(op, None, context).unwrap();
            (
                match o.state {
                    WriteState::Sent { result, .. } => Ok(result),
                    WriteState::Failed { why, .. } => Err(why),
                },
                o.metered,
            )
        }
    }
    fn query(
        &mut self,
        op: &str,
        context: Context,
        ceilings: Ceilings,
    ) -> Option<snapback4_core::engine::QueryOutcome> {
        self.0.set_ceilings(ceilings);
        Some(self.0.query(op, context).unwrap())
    }
    fn refused_query(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Option<snapback4_core::error::Refusal> {
        self.0.set_ceilings(ceilings);
        self.0.query(op, context).err()
    }
    fn adopt(&mut self, source: &str, now: i64) {
        let b = cases::bound(source);
        self.0
            .adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), now)
            .unwrap();
    }
}
fn factory(source: &str) -> Box<dyn Backend> {
    let b = cases::bound(source);
    Box::new(Pg(PostgresEngine::create(
        connect(),
        &namespace("through_review"),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap()))
}
macro_rules! scenario {
    ($name:ident) => {
        #[test]
        #[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
        fn $name() {
            cases::$name(factory);
        }
    };
}
scenario!(aggregate_actual_row);
scenario!(aggregate_existence);
scenario!(expiry_default);
scenario!(reuse_refusal);
scenario!(delete_refusal);
scenario!(probe_meter_equivalence);

scenario!(aggregate_denial_work);
scenario!(aggregate_denial_dependencies);

scenario!(aggregate_sequential_reads);
scenario!(aggregate_multi_batch);

scenario!(aggregate_tables_constant);
scenario!(aggregate_denied_gate_expiry);
scenario!(ordinary_expiring_page_recounts);
scenario!(authorized_expiring_sum_overflow);
scenario!(authorized_expired_backlog_stays_metered);

scenario!(aggregate_page_cut_expiry);
scenario!(aggregate_inherited_only_dependencies);
scenario!(aggregate_live_recount_cut_expiry);
scenario!(aggregate_authorized_shortcut_cut);

scenario!(admitted_aggregate_emission_expiry);
scenario!(uniform_prefix_emission_expiry);
scenario!(partial_page_keeps_emitted_expiry);
scenario!(unreturned_candidates_discard_expiry);

scenario!(predicate_id_expiry);
scenario!(predicate_index_expiry);
scenario!(predicate_point_expiry);
scenario!(predicate_private_authorization_expiry);
scenario!(streaming_count_expiry);

scenario!(predicate_cut_discards_expiry);

scenario!(predicate_kept_row_expiry);
