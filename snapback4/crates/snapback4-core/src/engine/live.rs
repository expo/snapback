//! Atomic maintenance of bounded live-parent authority copies.
// @ref LLP 3000.014.000#4-atomic-maintenance-algorithm — one source attempt owns the complete fanout reservation.
use super::{runner::Runner, write::Origin};
use crate::{
    error::{MeterKind, RuntimeError},
    meter::{Ceilings, Cut, Meter},
    rows::{Bounds, Dir},
    schema::{live, through::LIVE_CHILDREN},
    value::Value,
};

impl Runner<'_> {
    pub(super) fn live_read_dependency(&mut self, name: &str) {
        if let Some(edge) = self
            .schema
            .tables
            .get(name)
            .and_then(|t| t.through.as_ref())
            .filter(|t| t.live.is_some())
        {
            self.read_tables.insert(edge.parent.clone());
            self.rule_dependencies(&self.schema.tables[&edge.parent].rules.read);
        }
    }

    pub(super) fn reserve_live(&mut self, source: &str) -> Result<(), RuntimeError> {
        if self.live_prepaid {
            return Ok(());
        }
        let plan = self.schema.write_reservation(source);
        #[cfg(feature = "sqlite")]
        let plan = if self.device {
            plan
        } else {
            crate::schema::reservations::reservation(self.schema, source)
        };
        let price = plan.and_then(|p| p.live);
        if self.device && (price.is_some() || live::parent(self.schema, source)) {
            return Err(RuntimeError::Prediction("live parent authority changes need atomic server maintenance; queued without predictions".into()));
        }
        if let Some(price) = price {
            self.charge_price(price.price)?;
            // Schema-selected disclosure mask, independent of live occupancy.
            self.action_tables.extend(price.children.iter().cloned());
            self.live_heap = price.price[4].saturating_sub(price.retained_heap);
            self.live_prepaid = true;
        } else if live::parent(self.schema, source) {
            return Err(RuntimeError::Schema(
                "live parent has no complete source reservation".into(),
            ));
        }
        Ok(())
    }

    #[cfg(feature = "sqlite")]
    pub(super) fn maintain_live(
        &mut self,
        source: &str,
        image: &Value,
    ) -> Result<(), RuntimeError> {
        if !live::parent(self.schema, source) {
            return Ok(());
        }
        if self.device {
            return Err(RuntimeError::Prediction(
                "live parent maintenance runs on the server".into(),
            ));
        }
        if !self.live_prepaid {
            return Err(RuntimeError::Store(
                "live parent write bypassed its source reservation".into(),
            ));
        }
        let children: Vec<_> = self
            .schema
            .children(source)
            .filter(|(_, _, t)| t.live.is_some())
            .map(|(n, _, _)| n.clone())
            .collect();
        for name in children {
            self.written_tables.insert(name.clone());
            let table = &self.schema.tables[&name];
            let edge = table.through.as_ref().expect("live edge");
            let n = edge.live.expect("live bound") as usize;
            let price = live::edge_price(self.schema, &name)
                .ok_or_else(|| RuntimeError::Schema("invalid live maintenance price".into()))?;
            if !self.context.is_system() {
                self.tx.draw(&name, price[2])?;
            }
            let ceiling = Ceilings {
                steps: price[0],
                index_entries: price[1],
                examined: price[2],
                rows_written: price[3],
                heap_bytes: price[4],
                output_bytes: price[5],
                rule_probes: price[6],
            };
            let saved = std::mem::replace(&mut self.meter, Meter::new(ceiling, Cut::Abort));
            let prepaid = self.tx.reference_prepaid(true);
            let result = (|| {
                // Price includes retained scan, all simultaneous key vectors and
                // event bookkeeping before any private image is materialized.
                self.meter.heap(price[4])?;
                self.meter.charge(MeterKind::Examined, price[2])?;
                let id = image.field("id")?.clone();
                let found = self.metered_scan(|r, scope| {
                    r.tx.scan(
                        scope,
                        &name,
                        LIVE_CHILDREN,
                        &[id],
                        &Bounds::default(),
                        Dir::Asc,
                        n + 1,
                    )
                })?;
                if found.len() > n {
                    return Err(RuntimeError::Store(
                        "live parent physical cap invariant failed".into(),
                    ));
                }
                for (old, _) in found {
                    self.meter
                        .step(edge.fields.len() as u64 + table.columns.len() as u64 + 8)?;
                    let mut new = old.clone();
                    super::through::stamp(&self.schema.tables[source], edge, image, &mut new)?;
                    table.recompute_deadline(&mut new)?;
                    if old == new {
                        continue;
                    }
                    // All authored cells and constraint keys are unchanged.
                    // Only this origin can replace mapped engine inputs.
                    let entries = self.tx.put(&name, table, &new, Some(&old))?;
                    self.meter.charge(MeterKind::IndexEntries, entries)?;
                    self.row_changed(&name, Some(&old), Some(&new), Origin::LiveAuthority)?;
                }
                Ok(())
            })();
            self.tx.reference_prepaid(prepaid);
            self.meter = saved;
            if result.is_err() {
                return Err(RuntimeError::Store("live parent authority invariant or maintenance reservation failed; transaction rolled back".into()));
            }
        }
        Ok(())
    }
    #[cfg(not(feature = "sqlite"))]
    pub(super) fn maintain_live(
        &mut self,
        source: &str,
        _image: &Value,
    ) -> Result<(), RuntimeError> {
        if live::parent(self.schema, source) {
            Err(RuntimeError::Prediction(
                "live parent maintenance runs on the server".into(),
            ))
        } else {
            Ok(())
        }
    }
}
