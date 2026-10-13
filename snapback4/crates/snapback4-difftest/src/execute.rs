//! Same compilation, typed JSON inputs and in-memory SQLite as paired_worlds::Pair.
use crate::generate::Case;
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Refusal, Store, ir::ProgramKind, wire};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Outcome {
    pub kind: String,
    pub value: Json,
}
impl Outcome {
    pub fn meter(&self, field: &str) -> Option<u64> {
        self.value.get("metered")?.get(field)?.as_u64()
    }
    pub fn refusal(&self) -> Option<&Json> {
        self.value.get("refusal").or_else(|| self.value.get("why"))
    }
    pub fn next(&self) -> Option<&str> {
        self.value.get("next")?.as_str()
    }
    pub fn data(&self) -> Option<&Json> {
        self.value.get("data").or_else(|| self.value.get("result"))
    }
    pub fn cut(&self) -> bool {
        self.refusal().is_some_and(|r| r["code"] == "E_BOUND")
            || self.value.get("capped_at").is_some_and(|x| !x.is_null())
    }
}
pub fn compile(source: &str) -> Result<snapback4_lang::Bound, Json> {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    if bound.diagnostics.is_empty() {
        Ok(bound)
    } else {
        Err(serde_json::to_value(&bound.diagnostics).unwrap())
    }
}
/// The clock the rows are seeded at.
pub fn seed_clock(case: &Case) -> i64 {
    case.seeded_at.unwrap_or(case.clock)
}
/// The seeded world before its prelude, at the case's budget.
pub fn seeded(case: &Case, source: &str) -> Result<Engine, String> {
    let b = compile(source).map_err(|e| format!("binder: {e}"))?;
    let rows = case
        .rows
        .iter()
        .map(|(name, r)| {
            let table = b
                .schema
                .tables
                .get(name)
                .ok_or_else(|| format!("no table {name}"))?;
            wire::row_from_json(table, r)
                .map(|r| (name.clone(), r))
                .map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut engine = Engine::new_at(
        Store::memory().map_err(|e| e.to_string())?,
        b.schema,
        b.programs.into_iter().map(|p| p.program),
        seed_clock(case),
    )
        .map_err(|e| e.to_string())?;
    engine
        .seed_at(rows, seed_clock(case))
        .map_err(|e| e.to_string())?;
    engine.set_ceilings(case.budget);
    Ok(engine)
}
/// The seeded world after its prelude, and the prelude's outcomes.
pub fn world(case: &Case, source: &str) -> Result<(Engine, Vec<Outcome>), String> {
    let mut engine = seeded(case, source)?;
    let outcomes = prelude(&mut engine, case);
    Ok((engine, outcomes))
}
pub fn engine(case: &Case, source: &str) -> Result<Engine, String> {
    world(case, source).map(|w| w.0)
}
/// Run the prelude in order on `engine`, each step at its clock and at the
/// default ceilings, sweeping first where the step says so, then sweep at
/// `clock` if the case says so. Returns one outcome per step and sweep (a
/// sweep's is the number of rows it removed). Leaves the case's budget set.
pub fn prelude(engine: &mut impl Executor, case: &Case) -> Vec<Outcome> {
    let mut out = vec![];
    for (i, step) in case.steps.iter().enumerate() {
        if step.sweep {
            out.push(sweep(engine, step.at));
        }
        engine.set_ceilings(snapback4_core::Ceilings::default());
        let viewer = step.viewer.as_deref().unwrap_or(&case.principal);
        out.push(execute_as(engine, case, &format!("prep{i}"), &step.args, viewer, step.at));
    }
    if case.sweep {
        out.push(sweep(engine, case.clock));
    }
    engine.set_ceilings(case.budget);
    out
}
fn sweep(engine: &mut impl Executor, now: i64) -> Outcome {
    Outcome {
        kind: "sweep".into(),
        value: match engine.sweep(now) {
            Ok(n) => json!({"at": now, "swept": n}),
            Err(e) => json!({"at": now, "error": e}),
        },
    }
}
pub trait Executor {
    fn program(&self, name: &str) -> &snapback4_core::ir::Program;
    fn query(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::QueryOutcome, Refusal>;
    fn mutate(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::MutationOutcome, snapback4_core::RuntimeError>;
    fn set_ceilings(&mut self, ceilings: snapback4_core::Ceilings);
    /// `sweep_expired` at `now`: rows physically removed.
    fn sweep(&mut self, now: i64) -> Result<u64, String>;
}
impl Executor for Engine {
    fn program(&self, name: &str) -> &snapback4_core::ir::Program {
        self.programs()
            .find(|p| p.name == name)
            .expect("generated entry point")
    }
    fn query(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::QueryOutcome, Refusal> {
        Engine::query(self, name, context)
    }
    fn mutate(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::MutationOutcome, snapback4_core::RuntimeError> {
        Engine::mutate(self, name, None, context)
    }
    fn set_ceilings(&mut self, ceilings: snapback4_core::Ceilings) {
        Engine::set_ceilings(self, ceilings);
    }
    fn sweep(&mut self, now: i64) -> Result<u64, String> {
        Engine::sweep_expired(self, now, 10_000).map_err(|e| e.to_string())
    }
}
#[cfg(feature = "postgres")]
impl Executor for snapback4_core::engine::postgres::PostgresEngine {
    fn program(&self, name: &str) -> &snapback4_core::ir::Program {
        &self.programs()[name]
    }
    fn query(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::QueryOutcome, Refusal> {
        Self::query(self, name, context)
    }
    fn mutate(
        &mut self,
        name: &str,
        context: Context,
    ) -> Result<snapback4_core::MutationOutcome, snapback4_core::RuntimeError> {
        Self::mutate(self, name, None, context)
    }
    fn set_ceilings(&mut self, ceilings: snapback4_core::Ceilings) {
        Self::set_ceilings(self, ceilings);
    }
    fn sweep(&mut self, now: i64) -> Result<u64, String> {
        Self::sweep_expired(self, now, 10_000).map_err(|e| e.to_string())
    }
}
pub fn execute(engine: &mut impl Executor, case: &Case, name: &str, args: &Json) -> Outcome {
    execute_as(engine, case, name, args, &case.principal, case.clock)
}
pub fn execute_as(engine: &mut impl Executor, case: &Case, name: &str, args: &Json, viewer: &str, at: i64) -> Outcome {
    let _ = case;
    let p = engine.program(name);
    let input = p
        .args
        .iter()
        .map(|(n, t)| {
            wire::from_json(t, args.get(n).unwrap_or(&Json::Null)).map(|v| (n.clone(), v))
        })
        .collect::<Result<BTreeMap<_, _>, _>>();
    let input = match input {
        Ok(v) => v,
        Err(e) => {
            return Outcome {
                kind: "input".into(),
                value: json!({"error":e.to_string()}),
            };
        }
    };
    let kind = p.kind.clone();
    let context = Context::new(viewer, input)
        .at(at)
        .with_ids(["minted-0".into(), "minted-1".into()]);
    if kind == ProgramKind::Query {
        match engine.query(name, context) {
            Ok(v) => Outcome {
                kind: "query".into(),
                value: serde_json::to_value(v).unwrap(),
            },
            Err(e) => Outcome {
                kind: "query".into(),
                value: json!({"refusal":e}),
            },
        }
    } else {
        match engine.mutate(name, context) {
            Ok(v) => {
                let receipt_only = v.receipt_only;
                let mut value = serde_json::to_value(v).unwrap();
                value["receipt_only"] = json!(receipt_only);
                Outcome {
                    kind: "mutation".into(),
                    value,
                }
            }
            Err(e) => Outcome {
                kind: "mutation".into(),
                value: json!({"refusal":Refusal::from(e)}),
            },
        }
    }
}
