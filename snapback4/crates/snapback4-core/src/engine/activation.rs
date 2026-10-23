//! Server activation builder; all fallible work precedes commit.
use super::*;
use crate::activation::{ActivationReader, ActivationTransaction, ActivationPreparation};
use crate::metadata::RestoredPopulation;
impl Engine {
    pub(super) fn activate(
        store: &mut AnyStore,
        schema: &Schema,
        programs: &BTreeMap<String, Program>,
        release: Option<&release::ReleaseActivation>,
        now: i64,
        allow_feed_adoption: bool,
        expected_release: Option<u64>,
        expected_backend: Option<&crate::activation::Backend>,
    ) -> Result<Committed<(u64, crate::store_port::OpeningMetadata)>, RuntimeError> {
        store.admit(schema, programs)?;
        if let Some(release) = release { release.validate()?; }
        schema.validate_column_owners()?;
        for program in programs.values() {
            crate::schema::ephemeral::admit_program(schema, program)?;
            admission::check_state_predicates(schema, program)?;
        }
        for program in programs.values() {
            for table in crate::ir::read_sites(program)
                .into_iter()
                .map(|s| s.table)
                .chain(crate::ir::write_tables(program).into_iter().map(|(t, _)| t))
            {
                schema.refuse_private(&table)?;
            }
        }
        for schedule in &schema.schedules {
            if !schedule.valid()
            {
                return Err(RuntimeError::Schema(format!(
                    "schedule {} has an invalid period or offset",
                    schedule.name
                )));
            }
            let Some(program) = programs
                .get(&schedule.target)
                .filter(|p| matches!(p.kind, ProgramKind::Job | ProgramKind::Action))
            else {
                return Err(RuntimeError::Schema(format!(
                    "schedule {} names missing job or action {}; restore or remove the schedule",
                    schedule.name, schedule.target
                )));
            };
            if program.kind == ProgramKind::Action {
                let seat = schedule
                    .service
                    .as_deref()
                    .filter(|seat| crate::identity::is_service(seat))
                    .ok_or_else(|| {
                        RuntimeError::Schema(
                            "a scheduled action requires its declared service seat".into(),
                        )
                    })?;
                actions::authorize(program, seat)?;
            } else if schedule.service.is_some() {
                return Err(RuntimeError::Schema(
                    "a scheduled job cannot name a service seat".into(),
                ));
            }
            if program.args.iter().any(|(name, kind)| {
                !matches!(name.as_str(), "periodStart" | "periodEnd")
                    || *kind != crate::ir::ArgType::Time
            }) {
                return Err(RuntimeError::Schema(
                    "scheduled work takes periodStart: time and periodEnd: time, or nothing".into(),
                ));
            }
        }
        let prior_items = std::cell::RefCell::new(Vec::new());
        let population=std::cell::Cell::new(None);
        Committer::run_committed_with(store, |store| {
        let outcome=store.activate_at_with_launch(schema, Some(programs), false, now, allow_feed_adoption, |release_check| {
            release_check.check_selected_release(expected_release)?;
            if let Some(backend) = expected_backend { release_check.check_backend(backend)?; }
            if let Some(options)=release {
                options.check(release_check)?;
                *prior_items.borrow_mut()=release_check.activation_inventory()?;
                release_check.enable_dormant()?;
                release_check.prepare_release_metadata(options.native_digest.as_deref().unwrap_or(""), options.restore_dormant,options.visibility.as_ref())?;
            }
            Ok(())
        }, |tx, changed, report| {
            let now=now.max(ActivationReader::time_audience_clock(tx)?);
            if let Some(options)=release {tx.set_active_release(options.release)?;}
            let repair_live_sums = tx.live_sum_marker()?.as_deref() != Some("1");
            let previous: Option<String> = tx.previous_schema()?;
            let previous: Option<Schema> = previous.map(|text| serde_json::from_str(&text).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))).transpose()?;
            if let Some(previous) = &previous {
                let backend = tx.opening_backend()?;
                let previous_programs = serde_json::from_str(&backend.2).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))?;
                super::activation_facts::check_operations(previous, schema, &previous_programs, programs)?;
            }
            let needs_maintained_id_marker = (schema.maintains.iter().any(|maintain| maintain.row_key.is_none())
                || previous.as_ref().is_some_and(|old| old.maintains.iter().any(|maintain| maintain.row_key.is_none())))
                && tx.schema_marker(crate::metadata::SchemaMarker::MaintainedIds)?.as_deref() != Some(crate::schema::MAINTAINED_ID_VERSION);
            if !changed && !repair_live_sums && !needs_maintained_id_marker { return Ok(()); }
            let repair_maintained_ids = needs_maintained_id_marker
                && previous.as_ref().is_some_and(|old| old.maintains.iter().any(|maintain| maintain.row_key.is_none()));
            if changed {
                let epoch = tx.next_seq()?;
                for table in partition::changed_group_audiences(previous.as_ref(), schema) {
                    tx.set_audience_epoch(&table, epoch, now)?;
                }
            }
            let population_changed=tx.activation_population()?.as_deref()==Some("true");
            let rebuild: Vec<_> = schema.maintains.iter().filter(|m| {
                (changed && (population_changed || previous.as_ref().is_none_or(|old| crate::successor::maintain_rebuild_needed(old, schema, m))))
                    || (repair_maintained_ids && m.row_key.is_none())
                    || (repair_live_sums && matches!(m.kind, crate::schema::MaintainKind::Sum { .. }) && schema.table(&m.source).is_some_and(|source| source.is_expiring()))
            }).collect();
            tx.mark_live_sum_candidates()?;
            if needs_maintained_id_marker {
                // This write is inside the activation transaction: a failed
                // rebuild leaves both old rows and the old/missing marker. A
                // first aggregate has no legacy target identity to rewrite,
                // but records the current address function for later opens.
                tx.mark_maintained_ids()?;
            }
            let attribution = recorded::paths_changed(schema, previous.as_ref());
            let columns = column_activation::changed_parents(schema, if population_changed {None} else {previous.as_ref()});
            if rebuild.is_empty() && !attribution && columns.is_empty() && !repair_maintained_ids { return Ok(()); }
            let seq = tx.next_seq()?;
            let phase = std::time::Instant::now();
            if attribution {
                // This runner owns only activation rewrites; ordinary rebuilds
                // below retain their commit and partition accounting.
                let mut capture = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
                capture.capture_activation(previous.as_ref(), Some(report))?;
                report.detail("capture recorded paths", phase);
                // A newly introduced aggregate has no legacy identity map to
                // preserve. Keep its event-free recorded-path rebuild out of
                // commit accounting, as activation did before the address
                // migration existed.
                if !repair_maintained_ids {
                    capture.rebuild_recorded_activation(previous.as_ref(), &rebuild.iter().copied().filter(|m| m.private.is_none()).collect::<Vec<_>>(), report)?;
                }
            }
            let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
            if repair_maintained_ids {
                let started = std::time::Instant::now();
                let rewritten = runner.rewrite_legacy_maintained_references(&rebuild.iter().copied().cloned().collect::<Vec<_>>(), previous.as_ref(), Some(tx))?;
                if rewritten != 0 { report.changes.push(format!("rewrote {rewritten} legacy aggregate references")); }
                report.detail("rewrite legacy aggregate references", started);
            }
            // Legacy maps must be captured before any activation rebuild can
            // remove their target rows. Recorded values themselves are
            // stamped first so their historical paths may still traverse the
            // predecessor addresses.
            if attribution && repair_maintained_ids {
                runner.rebuild_recorded_activation(previous.as_ref(), &rebuild.iter().copied().filter(|m| m.private.is_none()).collect::<Vec<_>>(), report)?;
            }
            runner.activate_columns(previous.as_ref(), &rebuild, &columns, Some(report))?;
            for maintain in rebuild.into_iter().filter(|m| m.private.is_none()) {
                if !recorded::table_paths_changed(schema.table(&maintain.source), previous.as_ref().and_then(|s| s.table(&maintain.source))) {
                    runner.rebuild_maintain_reported(maintain, report)?;
                }
            }
            let events = runner.events.take();
            let tables: Vec<String> = runner.written_tables.iter().cloned().collect();
            let written = runner.rows_written;
            drop(runner);
            if written > 0 || !columns.is_empty() {
                tx.record_commit(seq, now, "rebuild", crate::SYSTEM_PRINCIPAL, "rebuild", &tables, written)?;
                partition::append(tx, seq, &events)?;
            }
            Ok(())
        }, |tx| {
            if let Some(options)=release {
                crate::release_history::ReleaseHistoryTransaction::finalize_restorations(tx)?;
                let mut items=tx.activation_inventory()?;
                let dormant_items=items.len();
                let mut restored_items=0usize;
                for item in &mut items {
                    let before=prior_items.borrow().iter().find(|i|i.key==item.key).cloned();
                    let count=before.as_ref().map_or(0,|i|i.rows);
                    item.before_rows=Some(count);item.after_rows=Some(item.rows);
                    item.before_sample_ids=Some(before.map_or_else(Vec::new,|i|i.sample_ids));
                    let restored=if item.kind=="rows" {
                        tx.restored_population(RestoredPopulation::Rows, &item.path)?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else if item.kind=="column" {tx.restored_population(RestoredPopulation::Column, &item.path)?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)} else {0};
                    item.restored_rows=Some(restored);
                    if restored>0 {item.action="partially restored".into();restored_items+=1;}
                }
                let remaining:std::collections::BTreeSet<_>=items.iter().map(|i|i.key.clone()).collect();
                for mut item in prior_items.borrow().iter().filter(|i|!remaining.contains(&i.key)).cloned() {
                    let restored=if matches!(item.kind.as_str(),"rows"|"column") {
                        let kind=if item.kind=="rows" {RestoredPopulation::Rows} else {RestoredPopulation::Column};
                        tx.restored_population(kind, &item.path)?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else if item.kind=="table" {
                        tx.restored_population(RestoredPopulation::Table, &item.path)?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else {item.rows};
                    item.action=if restored>0 || item.definition_only {"restored"} else {"removed without restoration"}.into();
                    item.before_rows=Some(item.rows);item.after_rows=Some(0);item.restored_rows=Some(restored);item.before_sample_ids=Some(item.sample_ids.clone());
                    if restored>0 || item.definition_only {restored_items+=1;}
                    items.push(item);
                }
                population.set(Some((tx.narrowed_retained()?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0),tx.narrowed_restored()?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0))));
                crate::release_history::record_event(tx,crate::now_ms(),&options.operation,Some(options.release),options.expected_previous,serde_json::json!({"dormant_items":dormant_items,"restored_items":restored_items,"native_digest":options.native_digest,"narrowed_retained":tx.narrowed_retained()?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0),"narrowed_restored":tx.narrowed_restored()?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)}),&items)?;
                tx.clear_activation_metadata()?;
            }
            crate::store_port::OpeningMetadata::read(tx)
        });
        outcome.map(|committed| committed.pending((population.get(), release.is_some())))
        }, |store, (population, has_release), value| {
            if let Some((retained,restored))=population.filter(|(a,b)|*a>0 || *b>0) {
                store.adoption_report_mut().changes.insert(0,format!("{retained} newly dormant {}; {restored} narrowed {} restored", if retained == 1 { "row" } else { "rows" }, if restored == 1 { "row" } else { "rows" }));
            }

            if let Ok(items)=store.dormant_inventory(None,usize::MAX) {
                if has_release { store.adoption_report_mut().changes.insert(0, crate::store_port::report::AdoptionReport::dormant(&items)); }
            }
            Ok(value)
        })
    }
}
