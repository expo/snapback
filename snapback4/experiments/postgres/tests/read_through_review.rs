#[path = "../../../crates/snapback4-lang/tests/read_through/review_cases.rs"]
mod cases;
use cases::{Backend, Outcome};
use snapback4_core::{
    Context,
    engine::WriteState, Engine,
    meter::Ceilings,
};
use snapback4_postgres_evaluation::{create, namespace};

struct Pg(Engine);
impl Backend for Pg {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome {
        self.0.set_ceilings(ceilings);
        if self.0.programs().find(|p| p.name == op).unwrap().kind == snapback4_core::ir::ProgramKind::Query {
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
    Box::new(Pg(create(
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
#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn expected_unsupported_release_activation_expiry_default() {
    let original = cases::expiry_default_source();
    let b = cases::bound(original);
    let mut engine = create(&namespace("expiry_default_unsupported"), b.schema,
        b.programs.into_iter().map(|p| p.program)).unwrap();
    let context = cases::ctx("alice", 50, &[]);
    assert!(matches!(engine.mutate("setup", None, context).unwrap().state, WriteState::Sent { .. }));
    let generation = engine.generation();
    for now in [100, 200] {
        for deadline in [300, 150] {
            let source = original.replace("immutable owner", &format!(
                "immutable owner, until\n  until: time default {deadline}\n  expire at .until"));
            let b = cases::bound(&source);
            let result = engine.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), now);
            assert!(matches!(result, Err(snapback4_core::RuntimeError::StoreUnsupported {
                family: "evolution-authority"
            })), "expected-unsupported:evolution-authority; admission needs oracle expiry_default: {result:?}");
            assert_eq!(engine.generation(), generation);
            for op in ["parent", "middle", "child"] {
                assert_ne!(engine.query(op, cases::ctx("alice", 400, &[])).unwrap().data,
                    snapback4_core::Value::Null, "refused activation changed {op}");
            }
        }
    }
    println!("expected-unsupported:evolution-authority:expiry-default=4; admitted expiry evolution scenarios=0");
}
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
