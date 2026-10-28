//! Query continuations return their detached reader before waiting for RI.
use super::*;
use snapback4_core::engine::DeliveryManifest;
#[cfg(feature="postgres")]
use snapback4_core::engine::revision_cache::ReadIndexProof;

pub(super) struct Query {
    op: String, principal: String, credential_kind: String,
    scope: snapback4_core::identity::SessionScope,
    payload: Json, args_json: Json, context: Context, manifest: DeliveryManifest,
    settlement_started: Option<Instant>, handoffs: usize,
}
pub(super) fn start(request: Request, shared: &Shared, resume: Arc<read_index::Resume>,
    op: String, principal: String, credential_kind: String, scope: snapback4_core::identity::SessionScope,
    payload: Json, args_json: Json, context: Context, manifest: DeliveryManifest,
) {
    trace::mark("parsed");
    run(request, shared, resume, Query {op,principal,credential_kind,scope,payload,args_json,context,manifest,settlement_started:None,handoffs:0}, None);
}
fn run(request: Request, shared: &Shared, resume: Arc<read_index::Resume>, query: Query,
    #[cfg(feature="postgres")] mut proof: Option<ReadIndexProof>,
    #[cfg(not(feature="postgres"))] _proof: Option<()>,
) {
    let Query {op,principal,credential_kind,scope,payload,args_json,mut context,manifest,settlement_started,mut handoffs}=query;
    #[cfg(feature="postgres")]
    let already_parked=proof.is_some();
    let viewer=principal.clone();
    let presence_of = |engine: &Engine, name: &str| engine.schema().operations.get(name).is_some_and(|fact| fact.sites.iter().any(|site| site.kind == "presence"));
                let provenance = payload.get("provenance").and_then(Json::as_bool) == Some(true);
                if provenance { context = context.with_row_provenance(); }
                let retained: Option<Vec<String>> = match payload.get("searchRetained") {
                    Some(value) => match serde_json::from_value(value.clone()) {
                        Ok(ids) => Some(ids),
                        Err(_) => return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "searchRetained must be a page of IDs")),
                    },
                    None => None,
                };
                if let Some(value) = payload.get("searchRetainedOrder") {
                    let order: Vec<i64> = match value.as_array().and_then(|values| values.iter().map(snapback4_core::search_decoration::order_key).collect()) {
                        Some(order) => order,
                        None => return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "searchRetainedOrder must contain integer ordering keys")),
                    };
                    if retained.as_ref().is_none_or(|ids| ids.len() != order.len()) {
                        return operation_refusal(request, shared, 400, Refusal::new("E_INPUT", "input", "retained search ordering keys require matching candidate IDs"));
                    }
                    context.search_retained_order = Some((order, payload.get("searchRetainedMore").and_then(Json::as_bool).unwrap_or(false)));
                }
                let settlement_started = settlement_started.unwrap_or_else(Instant::now);
                let (outcome, cut, metadata, reads_presence, query_generation, search_current, scopes, decoration_paths) = loop {
                let reader = if handoffs == 0 { shared.reader() } else { shared.reader_after_handoff() };
                let evaluated = match reader {
                    Ok((epoch, mut reader)) => {
                        #[cfg(test)] test_work(&shared.query_wait);
                        let admission = match session_identity::Admission::capture(&request, shared) { Ok(value) => value, Err(why) => return respond_timed(request, shared, 401, json!({"denied":why})) };
                        #[cfg(feature="postgres")]
                        let pending = if !already_parked {
                            trace::mark("lookup_start");
                            let candidate=reader.prepare_read_index(&op, &context, retained.as_deref(), manifest, &admission.digest());
                            trace::mark("lookup_end"); candidate
                        } else {None};
                        #[cfg(feature="postgres")]
                        if let Some(candidate) = pending {
                            lock(&shared.readers).put(&epoch, reader.into_inner());
                            let query=Query {op,principal,credential_kind,scope,payload,args_json,context,manifest,settlement_started:Some(settlement_started),handoffs};
                            let sample=latency::suspend();
                            let mut trace=trace::suspend();
                            let continuation=resume.clone();
                            resume.park(candidate, request, Box::new(move |request, proof| {
                                trace::unpark(&mut trace);
                                let shared=continuation.shared.clone();
                                let _scope=crate::release_requests::Scope::begin(*lock(&shared.generation));
                                if !shared.personas {crate::release_requests::Scope::admit(&shared.release_requests,||*lock(&shared.generation));}
                                let execute=||run(request, &shared, continuation, query, Some(proof));
                                let measured=||if let Some(sample)=sample {sample.run(execute)} else {execute()};
                                if let Some(trace)=trace {trace.run(measured)} else {measured()}
                            }));
                            return;
                        }
                        let persona = admission.persona(shared, &reader);
                        let expected = (principal.clone(), credential_kind.clone(), scope);
                        // Take identity from the same reader that evaluates the query,
                        // never from an engine that may have replaced it meanwhile.
                        let context = match query_readers::query_context(&reader, shared, &op, &args_json, context.clone()) { Ok(context) => context, Err(_) => return operation_request::query_argument_refusal(request, shared, op.clone(), args_json.clone(), context.clone()) };
                        let reads_presence = presence_of(&reader, &op);
                        let context = dev_refusals::response::context(context.clone(), reader.refusal_sites.clone(), &reader);
                        let query_generation = reader.generation();
                        let decoration_paths = reader.program(&op).filter(|_| reader.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(&reader, &op, &context);
                        trace::mark("query_start");
                        let mut metadata = None;
                        let mut authorize = |snapshot: &snapback4_core::store_port::ReadSnapshot<'_>, head| {
                            let authority = snapshot.request_authority(&admission.digest(), admission.sample(shared)).map_err(|e| e.refusal()).and_then(|facts| {
                                persona.clone().and_then(|persona| admission.check_bound_facts(shared, &expected, &facts, persona, None))?;
                                Ok((facts.store_id, head))
                            });
                            let result = authority.as_ref().map(|_| ()).map_err(Clone::clone);
                            metadata = Some(authority); result
                        };
                        #[cfg(feature="postgres")]
                        let indexed=proof.take();
                        #[cfg(feature="postgres")]
                        let (outcome, cut, current)=if let Some(proof)=indexed {
                            reader.query_materialized_search_with_read_index(&op, context, retained.as_deref(), manifest, &admission.digest(), proof, &mut authorize)
                        } else {
                            reader.query_materialized_search_without_read_index(&op, context, retained.as_deref(), manifest, &admission.digest(), &mut authorize)
                        };
                        #[cfg(not(feature="postgres"))]
                        let (outcome, cut, current)=reader.query_materialized_search_with_request(&op, context, retained.as_deref(), manifest, &admission.digest(), &mut authorize);
                        let metadata = head::query_response_head(&mut reader, metadata, &outcome);
                        if let Err(why) = &metadata && why.code == "E_GENERATION" {
                            if handoffs < 2 { handoffs += 1; continue; }
                            // @ref LLP 3000.018#3.2 — a refused query has no complete answer or certified cut.
                            // RT3b generation refusals remain metadata-free after handoff exhaustion.
                            return respond_timed(request, shared, 503, latency::Unobserved(json!({"denied":why,"complete":false})));
                        }
                        trace::mark("query_end");
                        let scopes = read_scopes::complete(scopes, reader.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        if outcome.is_ok() && metadata.is_ok() { lock(&shared.readers).put(&epoch, reader.into_inner()); }
                        (outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths)
                    },
                    // Only memory stores lack detached readers by construction.
                    Err(error) if !shared.memory_store() => {
                        if matches!(error.underlying(), snapback4_core::RuntimeError::Generation(_)) && handoffs < 2 {
                            handoffs += 1;
                            continue;
                        }
                        let why = error.refusal();
                        let reply = if why.code == "E_GENERATION" { json!({"denied":why,"complete":false}) } else { json!({"denied":why}) };
                        return respond_timed(request, shared, 503, latency::Unobserved(reply));
                    }
                    Err(_) => {
                        let admission = session_identity::Admission::capture(&request, shared);
                        let (op, context, retained, args_json) = (op.clone(), context.clone(), retained.clone(), args_json.clone());
                        let refused = (op.clone(), args_json.clone(), context.clone());
                        let credential_kind = credential_kind.clone();
                        let result = shared.engine.attempt(move |engine, shared| {
                            let admission = admission?;
                            let persona = admission.persona(shared, engine);
                            let expected = (context.viewer.clone(), credential_kind, scope);
                        let reads_presence = presence_of(engine, &op);
                        let mut context = context.clone();
                        context = query_readers::query_context(engine, shared, &op, &args_json, context)?;
                        if shared.personas { context = dev_refusals::response::context(context, Arc::new(lock(&shared.bound).refusal_sites.clone()), engine); }
                        let query_generation = engine.generation();
                        let decoration_paths = engine.program(&op).filter(|_| engine.schema().operations.get(&op).is_some_and(|f| f.search_decoration)).map(snapback4_core::search_decoration::paths);
                        let scopes = read_scopes::dependencies(engine, &op, &context);
                        let mut metadata = None;
                        let (outcome, cut, current) = engine.query_materialized_search_with_request(&op, context, retained.as_deref(), manifest, &admission.digest(), |snapshot, head| {
                            let authority = snapshot.request_authority(&admission.digest(), admission.sample(shared)).map_err(|e| e.refusal()).and_then(|facts| {
                                persona.clone().and_then(|persona| admission.check_bound_facts(shared, &expected, &facts, persona, None))?;
                                Ok((facts.store_id, head))
                            });
                            let result = authority.as_ref().map(|_| ()).map_err(Clone::clone);
                            metadata = Some(authority); result
                        });
                        let metadata = head::query_response_head(engine, metadata, &outcome);
                        let scopes = read_scopes::complete(scopes, engine.schema(), outcome.as_ref().map_or(&[], |o| &o.tables));
                        Ok::<_, Refusal>((outcome, cut, metadata, reads_presence, query_generation, current, scopes, decoration_paths))
                        });
                        match result { Ok(value) => value, Err(why) if matches!(why.code.as_str(), "E_INPUT" | "E_OP") => return operation_request::query_argument_refusal(request, shared, refused.0, refused.1, refused.2), Err(why) => return respond_timed(request, shared, 401, json!({"denied":why})) }

                    },
                };
                if evaluated.0.as_ref().is_err_and(|error| error.code == "E_GENERATION") && handoffs < 2 {
                    handoffs += 1;
                    continue;
                }
                if let Some((table, id)) = evaluated.0.as_ref().ok().and_then(|outcome| outcome.pending_opening.as_ref()) {
                    if settlement_started.elapsed() >= Duration::from_secs(30) || crate::lifecycle::stopping() {
                        let mut why = Refusal::new("E_QUERY_RETRY", "client", "timed disclosure did not settle within the query wait; retry the query").guide("client");
                        why.retryable = true;
                        return respond_timed(request, shared, 503, json!({"denied":why}));
                    }
                    let (table, id, requested) = (table.clone(), id.clone(), context.now);
                    let result = shared.engine.attempt(move |engine, shared| {
                        let now = engine.materialize_time_audience_at(&table, &id, requested.unwrap_or_else(|| shared.now()))?;
                        shared.refresh_time_audience_clock(engine, now);
                        shared.durable_committed(engine);
                        Ok::<_, snapback4_core::RuntimeError>(())
                    });
                    if let Err(error) = result { return respond_timed(request, shared, 503, json!({"denied":error.refusal()})); }
                    if let Err(why) = session_identity::principal_of(&request, shared) {
                        return respond_timed(request, shared, 401, json!({"denied":why}));
                    }
                    std::thread::yield_now();
                    continue;
                }
                break evaluated;
                };
                let (store_id, head) = match metadata { Ok(head) => head, Err(why) => {
                    let status = operation_request::authority_status(&why, 503);
                    let reply = if why.code == "E_GENERATION" { json!({"denied":why,"complete":false}) } else { json!({"denied":why}) };
                    respond_timed(request, shared, status, latency::Unobserved(reply)); return;
                } };
                match outcome {
                    Ok(outcome) => {
                        #[derive(serde::Serialize)]
                        struct QueryReply<'a> {
                            #[serde(skip_serializing_if = "Option::is_none")]
                            scopes: &'a Option<Json>,
                            #[serde(rename = "searchScopes", skip_serializing_if = "Option::is_none")]
                            search_scopes: &'a Option<Vec<String>>,
                            #[serde(rename = "searchRows", skip_serializing_if = "Option::is_none")]
                            search_rows: Option<wire::Plain<'a>>,
                            #[serde(rename = "searchCurrent", skip_serializing_if = "Option::is_none")]
                            search_current: &'a Option<Vec<String>>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            delivery: &'a Option<snapback4_core::engine::delivery::Manifest>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            ephemeral: &'a Option<snapback4_core::schema::ephemeral::Version>,
                            generation: u64,
                            complete: bool,
                            cut: Option<snapback4_core::engine::ReadCut>,
                            data: wire::QueryData<'a>,
                            next: &'a Option<String>,
                            #[serde(rename = "nextExpiry")]
                            next_expiry: Option<i64>,
                            #[serde(rename = "decorationPaths", skip_serializing_if = "Option::is_none")]
                            decoration_paths: Option<Vec<Vec<String>>>,
                            #[serde(rename = "decorationExpiry", skip_serializing_if = "Option::is_none")]
                            decoration_expiry: Option<Option<i64>>,
                            seq: u64,
                            store_id: String,
                            tables: &'a [String],
                            viewer: &'a str,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            meter: Option<Json>,
                            #[serde(rename = "rowProvenance", skip_serializing_if = "Option::is_none")]
                            row_provenance: Option<wire::Plain<'a>>,
                            #[serde(skip_serializing_if = "Option::is_none")]
                            refresh: Option<u64>,
                        }
                        impl latency::Reply for QueryReply<'_> { fn generation(&self)->Option<u64>{Some(self.generation)} }
                        // @ref LLP 3000.018#3 — an answer of a query that may read presence asks its client to re-run it: no change feed names presence.
                        let refresh = reads_presence.then(|| PRESENCE_REFRESH.as_millis() as u64);
                        // @ref LLP 3000#7-decisions-during-execution — loopback dev returns read counters by default; releases never disclose them.
                        let meter = shared.personas.then(|| {
                            if let Some(line) = lock(&shared.read_cuts).line(&op, &viewer, &outcome, Instant::now()) { snapback4_core::diagnostic!("{line}"); }
                            let m = outcome.metered;
                            let cut = if outcome.capped_at.is_some() { Some("meter") } else if outcome.word_cut_at.is_some() { Some("words") } else { None };
                            let mut meter = json!({ "examined": m.examined, "indexEntries": m.index_entries, "probes": m.rule_probes, "steps": m.steps, "heapBytes": m.heap_bytes, "outputBytes": m.output_bytes, "rowsWritten": m.rows_written, "cut": cut });
                            if let Some(delivery) = &outcome.delivery_meter { meter["delivery"] = json!(delivery); }
                            meter
                        });
                        if outcome.unavailable {
                            let mut reply = json!({ "loading": true, "generation": query_generation, "data": null, "complete": false, "nextExpiry": outcome.next_expiry, "seq": outcome.seq, "store_id": store_id, "tables": outcome.tables, "viewer": viewer });
                            if let Some(version) = &outcome.ephemeral { reply["ephemeral"] = json!(version); }
                            if let Some(meter) = meter { reply["meter"] = meter; }
                            if let Some(refresh) = refresh { reply["refresh"] = json!(refresh); }
                            respond_timed(request, shared, 200, reply);
                        } else {
                            let row_provenance = provenance.then(|| outcome.data.retained_rows_mask());
                            respond_timed(request, shared, 200, QueryReply { scopes: &scopes, search_current: &search_current, generation: query_generation, search_scopes: &outcome.search_scopes, search_rows: outcome.search_rows.as_ref().map(wire::Plain), delivery: &outcome.delivery, ephemeral: &outcome.ephemeral, row_provenance: row_provenance.as_ref().map(wire::Plain), complete: outcome.complete, cut: outcome.cut, data: wire::QueryData(&outcome), next: &outcome.next, next_expiry: outcome.next_expiry, decoration_expiry: decoration_paths.is_some().then_some(outcome.decoration_expiry), decoration_paths, seq: outcome.seq, store_id, tables: &outcome.tables, viewer: &viewer, meter, refresh });
                        }
                    }
                    Err(refusal) => {
                        let mut reply = json!({ "denied": refusal_json(&refusal), "generation": query_generation, "complete": false, "store_id": store_id, "head": head });
                        // @ref LLP 3000.018#3.2 — a refusal names its evaluation cut so a client
                        // can order it against a remembered answer; its head now shares that snapshot.
                        if let Some(cut) = cut { reply["seq"] = json!(cut); }
                        // A refusal can depend on presence too: its watch keeps refreshing (LLP 3000.018 §3.2).
                        if reads_presence && !refusal.retryable { reply["refresh"] = json!(PRESENCE_REFRESH.as_millis() as u64); }
                        respond_timed(request, shared, if refusal.retryable || refusal.code == "E_GENERATION" { 503 } else if refusal.code=="E_INPUT" && refusal.family=="input" {400} else {200}, reply);
                    }
                }

}
