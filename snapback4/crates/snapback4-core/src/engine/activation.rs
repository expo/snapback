//! Server activation builder; all fallible work precedes commit.
use super::*;
impl Engine {
    pub(super) fn activate(
        store: &mut Store,
        schema: &Schema,
        programs: &BTreeMap<String, Program>,
        release: Option<&release::ReleaseActivation>,
        now: i64,
        allow_feed_adoption: bool,
        expected_release: Option<u64>,
        expected_backend: Option<&crate::store::opening::Backend>,
    ) -> Result<(u64, crate::store::opening::Metadata), RuntimeError> {
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
        let outcome=store.activate_at_with_launch(schema, Some(programs), false, now, allow_feed_adoption, |conn| {
            Store::check_selected_release(conn, expected_release)?;
            if let Some(backend) = expected_backend { backend.check(conn)?; }
            if let Some(options)=release {
                options.check(conn)?;
                *prior_items.borrow_mut()=crate::store::release_history::inventory(conn,None,usize::MAX)?;
                crate::store::dormant::enable(conn)?;
                conn.execute("INSERT INTO _meta(key,value) VALUES('release_native_digest',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[options.native_digest.as_deref().unwrap_or("")])?;
                conn.execute("INSERT INTO _meta(key,value) VALUES('activation_restore',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[if options.restore_dormant {"true"}else{"false"}])?;
            }
            Ok(())
        }, |tx, changed, report| {
            if let Some(options)=release {tx.set_meta("release",&options.release.to_string())?;}
            use rusqlite::OptionalExtension;
            let repair_live_sums = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'live_sum_candidates'", [], |row| row.get::<_, String>(0)).optional()?.as_deref() != Some("1");
            let repair_maintained_ids = schema.maintains.iter().any(|maintain| maintain.row_key.is_none())
                && tx.meta(crate::schema::MAINTAINED_ID_META)?.as_deref() != Some(crate::schema::MAINTAINED_ID_VERSION);
            if !changed && !repair_live_sums && !repair_maintained_ids { return Ok(()); }
            let previous: Option<String> = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |row| row.get(0)).optional()?;
            let previous: Option<Schema> = previous.map(|text| serde_json::from_str(&text).map_err(|e| RuntimeError::decode(e, RuntimeError::Store))).transpose()?;
            if changed {
                let epoch = tx.next_seq()?;
                for table in partition::changed_group_audiences(previous.as_ref(), schema) {
                    tx.set_meta(&partition::audience_epoch_key(&table), &epoch.to_string())?;
                    tx.set_meta(&partition::audience_epoch_time_key(&table), &now.to_string())?;
                }
            }
            let population_changed=tx.meta("activation_population")?.as_deref()==Some("true");
            let rebuild: Vec<_> = schema.maintains.iter().filter(|m| {
                (changed && (population_changed || previous.as_ref().is_none_or(|old| crate::successor::maintain_rebuild_needed(old, schema, m))))
                    || (repair_maintained_ids && m.row_key.is_none())
                    || (repair_live_sums && matches!(m.kind, crate::schema::MaintainKind::Sum { .. }) && schema.table(&m.source).is_some_and(|source| source.is_expiring()))
            }).collect();
            tx.set_meta("live_sum_candidates", "1")?;
            if repair_maintained_ids {
                // This write is inside the activation transaction: a failed
                // rebuild leaves both old rows and the old/missing marker.
                tx.set_meta(crate::schema::MAINTAINED_ID_META, crate::schema::MAINTAINED_ID_VERSION)?;
            }
            let attribution = recorded::paths_changed(schema, previous.as_ref());
            let columns = column_activation::changed_parents(schema, if population_changed {None} else {previous.as_ref()});
            if rebuild.is_empty() && !attribution && columns.is_empty() { return Ok(()); }
            let seq = tx.next_seq()?;
            let phase = std::time::Instant::now();
            if attribution {
                // This runner owns only activation rewrites; ordinary rebuilds
                // below retain their commit and partition accounting.
                let mut capture = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
                capture.capture_activation(previous.as_ref(), Some(report))?;
                report.detail("capture recorded paths", phase);
            }
            let mut runner = Runner::new(tx, schema, Context::system().at(now), Meter::new(Ceilings::unbounded(), Cut::Abort), seq);
            if repair_maintained_ids {
                let started = std::time::Instant::now();
                let rewritten = runner.rewrite_legacy_maintained_references(&rebuild.iter().copied().cloned().collect::<Vec<_>>(), previous.as_ref())?;
                if rewritten != 0 { report.changes.push(format!("rewrote {rewritten} legacy aggregate references")); }
                report.detail("rewrite legacy aggregate references", started);
            }
            // Legacy maps must be captured before any activation rebuild can
            // remove their target rows. Recorded values themselves are
            // stamped first so their historical paths may still traverse the
            // predecessor addresses.
            if attribution {
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
                crate::store::release_history::finalize_restorations(tx)?;
                let mut items=crate::store::release_history::inventory(tx.conn(),None,usize::MAX)?;
                let dormant_items=items.len();
                let mut restored_items=0usize;
                for item in &mut items {
                    let before=prior_items.borrow().iter().find(|i|i.key==item.key).cloned();
                    let count=before.as_ref().map_or(0,|i|i.rows);
                    item.before_rows=Some(count);item.after_rows=Some(item.rows);
                    item.before_sample_ids=Some(before.map_or_else(Vec::new,|i|i.sample_ids));
                    let restored=if item.kind=="rows" {
                        tx.meta(&format!("activation_narrowed_restored:{}",item.path))?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else if item.kind=="column" {tx.meta(&format!("activation_column_restored:{}",item.path))?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)} else {0};
                    item.restored_rows=Some(restored);
                    if restored>0 {item.action="partially restored".into();restored_items+=1;}
                }
                let remaining:std::collections::BTreeSet<_>=items.iter().map(|i|i.key.clone()).collect();
                for mut item in prior_items.borrow().iter().filter(|i|!remaining.contains(&i.key)).cloned() {
                    let restored=if matches!(item.kind.as_str(),"rows"|"column") {
                        let prefix=if item.kind=="rows" {"activation_narrowed_restored"} else {"activation_column_restored"};
                        tx.meta(&format!("{prefix}:{}",item.path))?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else if item.kind=="table" {
                        tx.meta(&format!("activation_table_restored:{}",item.path))?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)
                    } else {item.rows};
                    item.action=if restored>0 || item.definition_only {"restored"} else {"removed without restoration"}.into();
                    item.before_rows=Some(item.rows);item.after_rows=Some(0);item.restored_rows=Some(restored);item.before_sample_ids=Some(item.sample_ids.clone());
                    if restored>0 || item.definition_only {restored_items+=1;}
                    items.push(item);
                }
                population.set(Some((tx.meta("activation_narrowed_retained")?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0),tx.meta("activation_narrowed_restored")?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0))));
                crate::store::release_history::event(tx,&options.operation,Some(options.release),options.expected_previous,serde_json::json!({"dormant_items":dormant_items,"restored_items":restored_items,"native_digest":options.native_digest,"narrowed_retained":tx.meta("activation_narrowed_retained")?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0),"narrowed_restored":tx.meta("activation_narrowed_restored")?.and_then(|s|s.parse::<u64>().ok()).unwrap_or(0)}),&items)?;
                tx.conn().execute("DELETE FROM _meta WHERE key IN ('activation_restore','activation_population','activation_narrowed_retained','activation_narrowed_restored') OR key LIKE 'activation_narrowed_restored:%' OR key LIKE 'activation_column_restored:%' OR key LIKE 'activation_table_restored:%' OR key LIKE 'activation_table_restored_ids:%' OR key LIKE 'activation_narrowed_restored_ids:%' OR key LIKE 'activation_column_restored_ids:%'",[])?;
            }
            crate::store::opening::Metadata::read(tx)
        });
        if outcome.is_ok() {
            if let Some((retained,restored))=population.get().filter(|(a,b)|*a>0 || *b>0) {
                store.adoption_report.changes.insert(0,format!("{retained} newly dormant {}; {restored} narrowed {} restored", if retained == 1 { "row" } else { "rows" }, if restored == 1 { "row" } else { "rows" }));
            }
        }
        if outcome.is_ok() {
            if let Ok(items)=store.dormant_inventory(None,usize::MAX) {
                if release.is_some() { store.adoption_report.changes.insert(0, crate::store::adoption_report::AdoptionReport::dormant(&items)); }
            }
        }
        outcome
    }
}
