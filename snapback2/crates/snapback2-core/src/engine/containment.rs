//! Runtime containment of rules, physical writes, and receipt authority.
use super::*;

impl Runner<'_> {
    pub(super) fn assert_rule_bounds(&self) -> Result<(), RuntimeError> {
        let certificate = self
            .rule_certificate
            .expect("certified rule execution has a certificate");
        if self.trace.rule_probes > certificate.max_rule_probes {
            return Err(RuntimeError::TraceSubset(format!(
                "rule probes {} > certificate {}",
                self.trace.rule_probes, certificate.max_rule_probes
            )));
        }
        if self.trace.steps.saturating_add(self.trace.derived_steps) > certificate.max_steps {
            return Err(RuntimeError::TraceSubset(format!(
                "steps {} > certificate {}",
                self.trace.steps, certificate.max_steps
            )));
        }
        Ok(())
    }

    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — this
    // derived range spends no second authored read call and cannot broaden a
    // point's actual physical absence. A receipt-only store cannot mint it.
    fn count_range_is_proved(&self, range: &ReceiptRange) -> bool {
        matches!(self.rule_authority, RuleAuthority::StoreAuthoritative)
            && self
                .trace
                .points
                .iter()
                .filter(|point| {
                    point.site == range.site
                        && point.table == range.table
                        && point.index == range.index
                        && point.key.len() == range.prefix.len()
                        && crate::search_key::scalar_key_starts_with(&point.key, &range.prefix)
                })
                .any(|point| {
                    let Some(proof) = crate::cap::count_absence_evidence(
                        self.schema,
                        point,
                        self.hashes.table(&point.table, Effect::Read),
                    ) else {
                        return false;
                    };
                    proof.range == *range
                        && self.trace.absences.contains(&(
                            point.table.clone(),
                            point.index.clone(),
                            point.key.clone(),
                        ))
                        && self.trace.absences.contains(&proof.primary)
                        && self.trace.constraint_inputs.iter().any(|input| {
                            input.table == point.table
                                && input.check == "public-count-absence"
                                && input.index == "byId"
                                && input.prefix == proof.primary.2
                                && input.examined_ids.is_empty()
                        })
                })
    }

    pub(super) fn assert_bounds(&self) -> Result<(), RuntimeError> {
        let certificate = self
            .certificate
            .expect("ordinary program execution has a certificate");
        if self.trace.derived_steps > certificate.derived_steps
            || self.trace.derived_scratch_bytes > certificate.derived_scratch_bytes
        {
            return Err(RuntimeError::TraceSubset(format!(
                "derived work {}/{} scratch {}/{}",
                self.trace.derived_steps,
                certificate.derived_steps,
                self.trace.derived_scratch_bytes,
                certificate.derived_scratch_bytes
            )));
        }
        if self.trace.examined > certificate.max_examined {
            return Err(RuntimeError::TraceSubset(format!(
                "examined {} > certificate {}",
                self.trace.examined, certificate.max_examined
            )));
        }
        if self.trace.rule_probes > certificate.max_rule_probes {
            return Err(RuntimeError::TraceSubset(format!(
                "rule probes {} > certificate {}",
                self.trace.rule_probes, certificate.max_rule_probes
            )));
        }
        let mut calls = BTreeMap::<&str, u64>::new();
        for point in &self.trace.points {
            let site = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|site| site.site == point.site)
                .ok_or_else(|| {
                    RuntimeError::TraceSubset(format!("undeclared point site {}", point.site))
                })?;
            if site.table != point.table || site.index != point.index || site.take != 1 {
                return Err(RuntimeError::TraceSubset(format!(
                    "point site {} does not match its certificate",
                    point.site
                )));
            }
            *calls.entry(&point.site).or_default() += 1;
        }
        for range in &self.trace.ranges {
            let site = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|site| site.site == range.site)
                .ok_or_else(|| {
                    RuntimeError::TraceSubset(format!("undeclared read site {}", range.site))
                })?;
            if site.table != range.table || site.index != range.index {
                return Err(RuntimeError::TraceSubset(format!(
                    "range site {} does not match its certificate",
                    range.site
                )));
            }
            *calls.entry(&range.site).or_default() += 1;
            let maximum = certificate.max_examined;
            if range.examined_ids.len() as u64 > maximum {
                return Err(RuntimeError::TraceSubset(format!(
                    "site {} examined {} > certificate {}",
                    range.site,
                    range.examined_ids.len(),
                    maximum
                )));
            }
        }
        for (site, actual) in calls {
            let maximum = self
                .certificate
                .expect("checked above")
                .read_sites
                .iter()
                .find(|read| read.site == site)
                .expect("checked above")
                .max_calls;
            if actual > maximum {
                return Err(RuntimeError::TraceSubset(format!(
                    "site {site} calls {actual} > {maximum}"
                )));
            }
        }
        // @ref LLP 1001#2-what-a-commit-records — direct and maintained
        // physical writes are contained per target table, including both
        // old/new aggregate applications for update and upsert.
        let mut declared_by_table = BTreeMap::<&str, u64>::new();
        let mut derived_maintained_writes = BTreeMap::<String, u64>::new();
        let mut derived_maintained_amplification = 0_u64;
        for site in &certificate.write_sites {
            let direct = declared_by_table.entry(site.table.as_str()).or_default();
            *direct = direct.saturating_add(site.max_rows);
            for maintain in self
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == site.table)
            {
                let applications = site
                    .max_rows
                    .saturating_mul(site.kind.maintained_applications());
                let target = declared_by_table
                    .entry(maintain.target.as_str())
                    .or_default();
                *target = target.saturating_add(applications);
                let certified_target = derived_maintained_writes
                    .entry(maintain.target.clone())
                    .or_default();
                *certified_target = certified_target.saturating_add(applications);
                derived_maintained_amplification =
                    derived_maintained_amplification.saturating_add(applications);
            }
        }
        if certificate.maintained_writes != derived_maintained_writes {
            return Err(RuntimeError::TraceSubset(format!(
                "maintained writes {:?} != derived {:?}",
                certificate.maintained_writes, derived_maintained_writes
            )));
        }
        if certificate.maintained_amplification != derived_maintained_amplification {
            return Err(RuntimeError::TraceSubset(format!(
                "maintained amplification {} != derived {}",
                certificate.maintained_amplification, derived_maintained_amplification
            )));
        }
        for (table, writes) in &self.trace.writes {
            let declared = declared_by_table.get(table.as_str()).copied().unwrap_or(0);
            if *writes > declared {
                return Err(RuntimeError::TraceSubset(format!(
                    "writes to {table} {writes} > {declared}"
                )));
            }
        }
        for row in &self.receipt.rows {
            if !self
                .row_membership
                .contains(&self.trace.rows, &row.table, &row.id)
            {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt row {}.{} absent from trace",
                    row.table, row.id
                )));
            }
        }
        for range in &self.receipt.ranges {
            if !self
                .trace
                .ranges
                .iter()
                .any(|trace| trace.site == range.site)
                && !self.count_range_is_proved(range)
            {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt range {} absent from trace",
                    range.site
                )));
            }
        }
        // @ref LLP 1001#2-what-a-commit-records — receipt absences stay inside the server trace.
        // issues/shelved/20260829-bounded-programs-receipt-absences-unvalidated.md
        for absence in &self.receipt.absences {
            if !self.trace.absences.contains(absence) {
                return Err(RuntimeError::TraceSubset(format!(
                    "receipt absence {absence:?} absent from trace"
                )));
            }
        }
        for verdict in &self.receipt.verdicts {
            if !self
                .certificate
                .expect("checked above")
                .rule_hashes
                .values()
                .any(|hash| hash == &verdict.rule_hash)
            {
                return Err(RuntimeError::TraceSubset(
                    "receipt verdict rule hash absent from certificate".to_owned(),
                ));
            }
            if !self.trace.rule_inputs.iter().any(|input| {
                input.rule_hash == verdict.rule_hash
                    && input.pinned_inputs_digest == verdict.pinned_inputs_digest
                    && input.hidden
            }) {
                return Err(RuntimeError::TraceSubset(
                    "receipt verdict absent from authoritative hidden input".to_owned(),
                ));
            }
        }
        for constraint in &self.trace.constraint_inputs {
            if !certificate.constraint_checks.iter().any(|declared| {
                declared.starts_with(&format!("{}:", constraint.table))
                    && declared.contains(&constraint.check)
            }) {
                return Err(RuntimeError::TraceSubset(format!(
                    "constraint trace {}:{} absent from certificate",
                    constraint.table, constraint.check
                )));
            }
        }
        Ok(())
    }
}
