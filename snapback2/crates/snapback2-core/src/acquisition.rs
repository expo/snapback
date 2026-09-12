//! Native acquisition keeps generated custody and ordinary product replay separate.
// @ref LLP 1019#native-acquisition-restart — bounded native pages and receipt
// transitions use current authority and the existing physical write lifecycle.
use crate::*;
use serde::Serialize;
use std::collections::BTreeMap;

pub const ACQUISITION_PAGE: u32 = 50;

#[derive(Debug, Serialize)]
pub struct AcquisitionEvent {
    pub id: String,
    pub row: String,
    pub disposition: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AcquisitionPage {
    pub after: Option<String>,
    pub cursor: Option<String>,
    pub next: Option<String>,
    pub exhausted: bool,
    pub events: Vec<AcquisitionEvent>,
    pub receipt: DeliveryReceipt,
}

pub struct AcquisitionRead {
    pub page: AcquisitionPage,
    pub rows: Vec<DeliveryRow>,
    pub seq: u64,
}

pub(crate) fn scan(log: &str) -> Scan {
    Scan {
        site: format!("_acquire.{log}.page"), table: log.into(), index: "byRecipient".into(),
        prefix: vec![IndexKeyExpr::Scalar(Expr::Input(Input::Viewer))], order: Order::Asc,
        take: Bound::Literal(ACQUISITION_PAGE), after: Some(Box::new(Expr::Variable("after".into()))),
        before: None, range: None, opaque_cursor: true, merge_site: None,
        provenance: KeyProvenance::Shape,
    }
}

pub(crate) fn get(table: &str, index: &str, key: Vec<Expr>, site: String) -> Expr {
    Expr::Get(Read { site, table: table.into(), index: index.into(), key, provenance: KeyProvenance::Shape })
}

fn page_program(content: &str, log: &str) -> Program {
    let event = Expr::Variable("event".into());
    Program {
        name: format!("_acquire.{log}"), kind: ProgramKind::Query,
        args: BTreeMap::from([("after".into(), ArgType::Optional(Box::new(ArgType::Cursor)))]),
        read_time_granularity_ms: Some(1),
        body: vec![
            Stmt::Let { name: "rows".into(), value: Expr::Array(vec![]) },
            Stmt::For { binding: "event".into(), domain: LoopDomain::Page(scan(log)), body: vec![
                Stmt::Let { name: "body".into(), value: get(content, "byId", vec![Expr::Field {
                    base: Box::new(event.clone()), name: "row".into(),
                }], format!("_acquire.{log}.body")) },
                Stmt::Push { target: "rows".into(), value: Expr::Array(vec![event, Expr::Variable("body".into())]) },
            ] },
            Stmt::Return(Expr::Variable("rows".into())),
        ],
    }
}

// Optional native admission must not make an otherwise valid existing project
// uninstallable. A log whose bounded page cannot certify is refused by this API.
pub(crate) fn certify(schema: &Schema, ceilings: &Ceilings) -> BTreeMap<String, Result<(Program, Certificate), CheckError>> {
    delivery::declarations(schema).map(|(content, _, d)| {
        let program = page_program(content, &d.log);
        (d.log.clone(), Checker::new(schema, ceilings.clone()).check(&program)
            .map(|certificate| (program, certificate)))
    }).collect()
}

impl Runtime {
    pub fn acquisition_content(&self, log: &str) -> Result<&str, RuntimeError> {
        let (content, _, _) = delivery::declarations(self.generation.schema())
            .find(|(_, _, d)| d.log == log)
            .ok_or_else(|| RuntimeError::Input("acquisition requires a generated deliver log".into()))?;
        self.generation.acquisition_bindings[log].as_ref().map_err(|error| RuntimeError::Refusal(Box::new(error.clone())))?;
        Ok(content)
    }

    pub fn acquire_page(&mut self, log: &str, after: Option<String>, mut context: Context) -> Result<AcquisitionRead, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
        let content = self.acquisition_content(log)?.to_owned();
        context.args = BTreeMap::from([("after".into(), after.clone().map(Value::String).unwrap_or(Value::Null))]);
        let (program, certificate) = self.generation.acquisition_bindings[log].as_ref().expect("native page admitted");
        let (execution, events, cursor, exhausted) = self.engine.acquire_page(program, certificate, context, &content, log, after.clone())?;
        let rows = offline::row_pool(&execution, self.generation.schema())
            .map_err(|e| RuntimeError::Input(e.to_string()))?;
        let receipt = DeliveryReceipt {
            ranges: execution.receipt.ranges.iter().map(offline::delivery_range).collect(),
            absences: execution.receipt.absences.iter().map(|(table, index, key)|
                (table.clone(), index.clone(), key.iter().map(value_to_wire_json).collect())).collect(),
            verdicts: execution.receipt.verdicts.iter().map(offline::delivery_verdict).collect(),
        };
        Ok(AcquisitionRead { rows, seq: execution.seq, page: AcquisitionPage {
            after, next: (!exhausted).then(|| cursor.clone()).flatten(), cursor, exhausted, events, receipt,
        } })
    }

    pub fn acquire_receipts(&mut self, log: &str, events: Vec<String>, mut context: Context) -> Result<Execution, RuntimeError> {
        self.executions = self.executions.saturating_add(1);
        self.acquisition_content(log)?;
        let (content, _, d) = delivery::declarations(self.generation.schema()).find(|(_, _, d)| d.log == log).unwrap();
        if !d.receipts { return Err(RuntimeError::Input("this deliver log has no receipts".into())); }
        let (program, certificate) = &self.generation.programs()[&delivery::ack_name(d)];
        context.args = BTreeMap::from([("events".into(), Value::Array(events.into_iter().map(Value::Id).collect::<Vec<_>>().into()))]);
        self.engine.acquire_receipts(program, certificate, context, content, d)
    }
}
