//! Asset-specific actions kept off the already dense sole-writer loop.

use super::*;
use crate::project::seed_rows;
use snapback2_core::{ArgType, ColumnType};

pub(super) struct PendingAssetSweep {
    reclaimed: BTreeSet<String>,
    orphan_keys: Vec<String>,
    forks: crate::asset_gc::ForkReferenceScan,
}

impl State {
    pub(super) fn operation_has_asset_args(&self, op: &str) -> bool {
        self.compiled
            .project
            .programs
            .iter()
            .find(|program| program.name == op)
            .is_some_and(|program| program.args.values().any(arg_contains_asset))
    }

    pub(super) fn reset(&mut self, empty: bool) -> Result<Json, Refusal> {
        let seed = self.seed.clone();
        let rows = if empty {
            Vec::new()
        } else {
            seed_rows(&seed, &self.compiled)?
        };
        let now = self.now();
        if !empty {
            for persona in &seed.personas {
                self.runtime_mut()
                    .ensure_persona(persona, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
            }
        }
        let reset = if empty {
            self.runtime_mut().reset_empty_at(now)
        } else {
            self.runtime_mut().reset_and_seed_at(&rows, now)
        }
        .map_err(|error| Refusal::from_runtime(&error))?;
        let live_ids = self.live.keys().copied().collect::<Vec<_>>();
        for id in live_ids {
            self.runtime_mut().unsubscribe(id);
        }
        self.live.clear();
        self.reset_channels();
        self.ledger.clear();
        self.operator_rejection = None;
        self.wake_effects();
        // Core returns the cleared ids and the owner still sees them; the
        // fork-aware sweep — never a blob wipe — deletes the bytes
        // (LLP 1006 §9a).
        let asset_ids = reset.asset_ids.clone();
        // @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — only a
        // committed reset may clear staging. Active upload custody defers that
        // physical clear, and the fork-aware sweep below never performs a blob wipe.
        self.staging.clear_after_reset()?;
        self.sweep_asset_blobs()?;
        let seed = if empty {
            json!("skipped")
        } else {
            json!({"rows":rows.len(), "personas":seed.personas.len()})
        };
        Ok(reset_response(reset.seq, asset_ids, seed))
    }

    pub(super) fn reclaim_assets(&mut self) -> Result<Json, Refusal> {
        let asset_ids = self.sweep_asset_blobs()?;
        Ok(reclaim_response(asset_ids))
    }

    pub(super) fn sweep_assets_on_boot(&mut self) -> Result<(), Refusal> {
        self.sweep_assets_now()
    }

    pub(super) fn sweep_assets_now(&mut self) -> Result<(), Refusal> {
        self.sweep_asset_blobs().map(|_| ())
    }

    pub(super) fn asset_poll_timeout(&self) -> Duration {
        self.next_asset_sweep
            .saturating_duration_since(Instant::now())
    }

    pub(super) fn sweep_assets_if_due(&mut self) -> Result<(), Refusal> {
        if Instant::now() < self.next_asset_sweep {
            return Ok(());
        }
        self.next_asset_sweep = Instant::now() + ASSET_SWEEP_INTERVAL;
        self.sweep_assets_now()
    }

    pub(super) fn sweep_asset_blobs(&mut self) -> Result<Vec<String>, Refusal> {
        const RECLAIM_PAGE: usize = 32;
        const BLOB_PAGE: usize = 64;
        const FORK_PAGE: usize = 8;
        let mut reported = Vec::new();
        let active_media = self.media_jobs.active_asset_ids();
        if self.asset_sweep_pending.is_none() {
            let now = self.now();
            let reclaim_after = self.asset_reclaim_after.clone();
            let page = self
                .runtime_mut()
                .reclaim_assets_page(now, &reclaim_after, RECLAIM_PAGE)
                .map_err(|error| Refusal::from_runtime(&error))?;
            self.asset_reclaim_after = page.continuation.clone().unwrap_or_default();
            reported = page.ids;
            let reclaimed = reported.iter().cloned().collect::<BTreeSet<_>>();
            let blobs = crate::asset_gc::enumerate_blob_page(
                self.blobs.as_ref(),
                self.asset_blob_continuation.as_deref(),
                BLOB_PAGE,
            )?;
            self.asset_blob_continuation = blobs.continuation;
            let mut checked = BTreeMap::new();
            let mut orphan_keys = Vec::new();
            for key in blobs.keys {
                let id = key.split_once(".w").map_or(key.as_str(), |(id, _)| id);
                if active_media.contains(id) {
                    continue;
                }
                let live = match checked.get(id) {
                    Some(live) => *live,
                    None => {
                        let live = self
                            .runtime()
                            .store()
                            .asset(id)
                            .map_err(|error| Refusal::from_runtime(&error))?
                            .is_some();
                        checked.insert(id.to_owned(), live);
                        live
                    }
                };
                if !live {
                    orphan_keys.push(key);
                }
            }
            let candidates = reclaimed
                .iter()
                .cloned()
                .chain(orphan_keys.iter().map(|key| {
                    key.split_once(".w")
                        .map_or(key.as_str(), |(id, _)| id)
                        .to_owned()
                }))
                .collect();
            self.asset_sweep_pending = Some(PendingAssetSweep {
                reclaimed,
                orphan_keys,
                forks: crate::asset_gc::ForkReferenceScan::open(&self.root, candidates)?,
            });
        }
        let Some(fork_ids) = self
            .asset_sweep_pending
            .as_mut()
            .expect("pending asset sweep")
            .forks
            .advance(FORK_PAGE)?
        else {
            self.staging.resume_reset_clear()?;
            return Ok(reported);
        };
        let pending = self
            .asset_sweep_pending
            .take()
            .expect("pending asset sweep");
        let mut deletable = BTreeSet::new();
        // @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation —
        // final GC shares the media-flight guard, so a rung cannot publish and
        // a once-view cannot record history after its ledger row disappears.
        for id in &pending.reclaimed {
            if active_media.contains(id) {
                continue;
            }
            // Running finalizers and failed unlinks stay pending and charged.
            // Retry next interval without stopping the writer or sibling GC;
            // explicit discard still reports the per-upload I/O refusal.
            if matches!(self.staging.cancel_upload(id), Ok(true)) {
                deletable.insert(id.clone());
            }
        }
        let sweep = crate::asset_gc::sweep_reclaimed_asset_blobs(
            self.blobs.as_ref(),
            &deletable,
            &active_media,
            &fork_ids,
        )?;
        let finished = deletable
            .difference(&sweep.remaining)
            .cloned()
            .collect::<Vec<_>>();
        self.runtime_mut()
            .finish_asset_reclaims(&finished)
            .map_err(|error| Refusal::from_runtime(&error))?;
        for id in finished {
            self.staging.finish_upload(&id);
        }
        let orphan_refusal = crate::asset_gc::delete_orphan_blob_keys(
            self.blobs.as_ref(),
            &pending.orphan_keys,
            &active_media,
            &fork_ids,
        );
        self.staging.resume_reset_clear()?;
        sweep.refusal.or(orphan_refusal).map_or(Ok(reported), Err)
    }

    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — asset
    // authorization stays on the sole Runtime owner and returns only certified
    // point-read facts.
    pub(super) fn asset_delivery(&mut self, id: &str, identity: Identity) -> Result<Json, Refusal> {
        let carrier = matches!(identity, Identity::Carrier(_));
        let authority = match identity {
            Identity::Anonymous => None,
            Identity::Carrier(token) => self.resolve_asset_carrier(&token)?,
            identity => Some(self.resolve_authority(identity)?),
        };
        let principal = authority
            .as_ref()
            .map(|authority| authority.principal.id.to_string());
        let delivery = if let Some(authority) = authority {
            let context = self.execution_context(&authority, BTreeMap::new())?;
            self.runtime_mut().asset_delivery(id, context)
        } else {
            self.runtime_mut().public_asset_delivery(id)
        }
        .map_err(|error| Refusal::from_runtime(&error))?;
        if delivery.once
            && let Some(principal) = &principal
        {
            if self
                .runtime()
                .store()
                .asset_viewed(id, principal)
                .map_err(|error| Refusal::from_runtime(&error))?
            {
                return Err(Refusal::from_runtime(
                    &snapback2_core::RuntimeError::AssetViewed(id.to_owned()),
                ));
            }
        }
        if carrier && (!delivery.public || delivery.once) && delivery.kind == AssetKind::Image {
            return Err(Refusal::from_runtime(
                &snapback2_core::RuntimeError::AssetNotReady("asset is unavailable".to_owned()),
            ));
        }
        let once = delivery.once;
        let mut result = serde_json::to_value(delivery).map_err(|error| {
            Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                error.to_string(),
            ))
        })?;
        if once {
            result["principal"] = json!(principal.expect("authorized once principal"));
        }
        Ok(result)
    }

    pub(super) fn asset_consume(&mut self, id: &str, principal: &str) -> Result<Json, Refusal> {
        let now = self.now();
        let result = self.runtime_mut().record_asset_view(id, principal, now);
        // A failed durable commit after bytes moved must not allow a retry in this owner.
        if matches!(
            &result,
            Err(snapback2_core::RuntimeError::Sql(_)
                | snapback2_core::RuntimeError::Serialization(_))
        ) {
            self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        result.map_err(|error| Refusal::from_runtime(&error))?;
        // @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction — publish this principal after its durable consumption commit.
        let seq = self.runtime().store().commit_seq().map_err(|error| Refusal::from_runtime(&error))?;
        self.after_commit(seq)?;
        let clients = self.live.iter()
            .filter(|(_, client)| client.context.viewer() == principal)
            .map(|(id, _)| *id).collect::<Vec<_>>();
        let deliveries = self.rerun_live(&clients, false);
        let ledger = self.ledger.back_mut().expect("consumption commit was recorded");
        ledger.invalidated.extend(clients);
        ledger.deliveries.extend(deliveries);
        Ok(json!(null))
    }

    pub(super) fn list_uploads(
        &mut self,
        identity: Identity,
        after: &str,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let actor = actor(&authority.principal)?;
        let usage = self
            .runtime()
            .asset_staging_usage(&actor)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let mut uploads = self
            .runtime()
            .store()
            .unclaimed_uploads(actor.id(), after)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let next = (uploads.len() > 100).then(|| uploads[99].id.clone());
        uploads.truncate(100);
        Ok(
            json!({ "uploads": uploads, "usage": usage.creator, "next": next,
            "limits": { "objects": snapback2_core::STAGING_PER_PRINCIPAL_OBJECTS,
                        "bytes": snapback2_core::STAGING_PER_PRINCIPAL_BYTES } }),
        )
    }

    pub(super) fn discard_upload(&mut self, identity: Identity, id: &str) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let actor = actor(&authority.principal)?;
        let discarded = self
            .runtime_mut()
            .discard_upload(&actor, id)
            .map_err(|error| Refusal::from_runtime(&error))?;
        if discarded {
            // Receiving tombstones remain charged until the shared handle has
            // closed/unlinked staging, or the finalizer reports physical release.
            if self.staging.cancel_upload(id)?
                && self
                    .runtime()
                    .store()
                    .asset(id)
                    .map_err(|error| Refusal::from_runtime(&error))?
                    .is_some_and(|row| row.state == snapback2_core::AssetState::Receiving)
            {
                self.runtime_mut()
                    .mark_asset_failed(id)
                    .map_err(|error| Refusal::from_runtime(&error))?;
            }
            self.sweep_asset_blobs()?;
        }
        Ok(json!({ "discarded": discarded }))
    }

    pub(super) fn asset_upload_authorize(
        &mut self,
        bytes: u64,
        identity: Identity,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let (image_max, video_max) = generation_asset_maxima(self.runtime().generation());
        let max = image_max.max(video_max);
        if max == 0 {
            return Err(asset_type(
                "the active generation declares no image or video asset bound",
            ));
        }
        if bytes > max {
            return Err(asset_too_large(format!(
                "Content-Length {bytes} exceeds the generation's {max} byte asset ceiling"
            )));
        }
        self.runtime()
            .store()
            .enforce_staging_caps(authority.principal.id.as_str(), bytes)
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(json!({
            "principal": authority.principal.id,
            "maxBytes": max,
            "imageMaxBytes": image_max,
            "videoMaxBytes": video_max,
        }))
    }

    pub(super) fn asset_upload_begin(
        &mut self,
        kind: AssetKind,
        bytes: u64,
        identity: Identity,
        custody: crate::blob_store::UploadCustody,
    ) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let (image_max, video_max) = generation_asset_maxima(self.runtime().generation());
        let max = match kind {
            AssetKind::Image => image_max,
            AssetKind::Video => video_max,
        };
        if max == 0 {
            return Err(asset_type(format!(
                "the active generation declares no {kind} asset bound"
            )));
        }
        let actor = actor(&authority.principal)?;
        let now = self.now();
        let id = self
            .runtime_mut()
            .begin_asset_charged(kind, &actor, now, bytes)
            .map_err(|error| Refusal::from_runtime(&error))?;
        self.staging.register_upload(id.clone(), custody);
        Ok(json!({ "id": id, "maxBytes": max }))
    }
}

fn reset_response(seq: u64, asset_ids: Vec<String>, seed: Json) -> Json {
    json!({ "ok": true, "seq": seq, "assetIds": asset_ids, "seed": seed })
}

fn reclaim_response(asset_ids: Vec<String>) -> Json {
    json!({ "ok": true, "assetIds": asset_ids })
}

pub(super) fn asset_record(id: &str, facts: &AssetReadyFacts) -> Json {
    let mut record = serde_json::Map::from_iter([
        ("id".to_owned(), json!(id)),
        ("width".to_owned(), json!(facts.width)),
        ("height".to_owned(), json!(facts.height)),
    ]);
    if let Some(duration) = facts.duration {
        record.insert("duration".to_owned(), json!(duration));
    }
    Json::Object(record)
}

fn generation_asset_maxima(generation: &Generation) -> (u64, u64) {
    let mut maxima = (0_u64, 0_u64);
    for kind in generation
        .schema()
        .tables
        .values()
        .flat_map(|table| table.columns.values())
    {
        column_asset_maxima(kind, &mut maxima);
    }
    for kind in generation
        .programs()
        .values()
        .flat_map(|(program, _)| program.args.values())
    {
        arg_asset_maxima(kind, &mut maxima);
    }
    maxima
}

fn column_asset_maxima(kind: &ColumnType, maxima: &mut (u64, u64)) {
    match kind {
        ColumnType::Image { max, .. } => maxima.0 = maxima.0.max(u64::from(*max)),
        ColumnType::Video { max } => maxima.1 = maxima.1.max(u64::from(*max)),
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => {
            column_asset_maxima(inner, maxima)
        }
        _ => {}
    }
}

fn arg_asset_maxima(kind: &ArgType, maxima: &mut (u64, u64)) {
    match kind {
        ArgType::Image { max } => maxima.0 = maxima.0.max(u64::from(*max)),
        ArgType::Video { max } => maxima.1 = maxima.1.max(u64::from(*max)),
        ArgType::Optional(inner) => arg_asset_maxima(inner, maxima),
        ArgType::List {
            of: Some(inner), ..
        } => arg_asset_maxima(inner, maxima),
        _ => {}
    }
}

fn arg_contains_asset(kind: &ArgType) -> bool {
    match kind {
        ArgType::Image { .. } | ArgType::Video { .. } => true,
        ArgType::Optional(inner) => arg_contains_asset(inner),
        ArgType::List {
            of: Some(inner), ..
        } => arg_contains_asset(inner),
        _ => false,
    }
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "declare an image or video column and upload bytes of that detected kind",
        "assets/upload",
    )
}

fn asset_too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload bytes within the largest generated asset bound",
        "assets/upload",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob_store::{BlobRead, BlobStore, ByteRange, FileBlobStore, LocalStaging};
    use crate::owner::OwnerInfo;
    use crate::project::{CompiledProject, SeedData};
    use crate::writer::{Action, State};
    use crate::writer_util::unix_millis;
    use snapback2_core::{
        ASSET_RECLAIM_GRACE_MS, ArgType, AssetKind, AssetReadyFacts, Auth, Ceilings, ColumnType,
        Context, Drop, Expr, Generation, Index, MigrationPlan, Program, ProgramKind, ProjectJson,
        RuleExpr, Rules, Runtime, Schema, Stmt, Store, Table, Value,
    };
    use std::collections::{BTreeMap, VecDeque};
    use std::io::{Cursor, Read};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn state_with_assets(
        root: PathBuf,
        runtime: Runtime,
        project: ProjectJson,
        generation: Generation,
        blobs: Arc<dyn BlobStore>,
    ) -> State {
        let staging = Arc::new(LocalStaging::open(&root).unwrap());
        State {
            connected: Default::default(),
            runtime: Some(runtime),
            compiled: CompiledProject {
                project,
                generation,
                api_dts: String::new(),
                compiler_ms: 0.0,
                quarry: Vec::new(),
                sources: Default::default(),
            },
            seed: SeedData::default(),
            root: root.clone(),
            mode: "dev".to_owned(),
            phase: json!("ready"),
            live: BTreeMap::new(),
            last_live_dispatch_work: 0,
            channels: BTreeMap::new(),
            ledger: VecDeque::new(),
            operator_rejection: None,
            next_channel: 0,
            channel_dirty: BTreeSet::new(),
            clock_offset_ms: 0,
            restarted_through_seq: 0,
            stop: Arc::new(AtomicBool::new(false)),
            owner: OwnerInfo {
                pid: 0,
                port: 0,
                url: String::new(),
                secret: String::new(),
                generation: String::new(),
                started_at: unix_millis(),
                mode: "dev".to_owned(),
                project: root,
            },
            exited: false,
            effects_wake: None,
            outbox_observation: Default::default(),
            effect_bindings: None,
            asset_carriers: BTreeMap::new(),
            blobs,
            staging,
            media_jobs: Default::default(),
            asset_reclaim_after: String::new(),
            asset_blob_continuation: None,
            asset_sweep_pending: None,
            next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
        }
    }

    fn once_state(root: &std::path::Path) -> (State, String) {
        let case: Json =
            serde_json::from_str(include_str!("../../../corpus/asset-once-image-insert.json"))
                .unwrap();
        let project = ProjectJson {
            version: 1,
            schema: serde_json::from_value(case["schema"].clone()).unwrap(),
            programs: vec![serde_json::from_value(case["program"].clone()).unwrap()],
            effects: vec![],
            auth: Auth::default(),
        };
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        std::fs::create_dir_all(root.join(".snapback")).unwrap();
        let mut runtime = Runtime::open(
            Store::open(&root.join("store.db")).unwrap(),
            generation.clone(),
        )
        .unwrap();
        let actor = snapback2_core::Actor::persona("alice").unwrap();
        let id = runtime
            .begin_asset(AssetKind::Image, &actor, unix_millis())
            .unwrap();
        runtime.reserve_asset_finalized_bytes(&id, 2).unwrap();
        runtime
            .mark_asset_ready(
                &id,
                &AssetReadyFacts {
                    media_type: "image/png".into(),
                    bytes: 2,
                    width: 1,
                    height: 1,
                    duration: None,
                },
            )
            .unwrap();
        let blobs = Arc::new(FileBlobStore::open(root).unwrap());
        blobs.put(&id, &mut Cursor::new(b"xy")).unwrap();
        runtime
            .execute(
                "media.insertOnceImage",
                Context::mutation(
                    actor,
                    BTreeMap::from([
                        ("rowId".into(), Value::Id("row1".into())),
                        (
                            "asset".into(),
                            Value::Map(
                                BTreeMap::from([
                                    ("id".into(), Value::String(id.clone())),
                                    ("width".into(), Value::Int(1)),
                                    ("height".into(), Value::Int(1)),
                                ])
                                .into(),
                            ),
                        ),
                    ]),
                ),
            )
            .unwrap();
        (
            state_with_assets(root.to_path_buf(), runtime, project, generation, blobs),
            id,
        )
    }

    fn once_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "snapback2-once-{label}-{}-{}",
            std::process::id(),
            unix_millis()
        ))
    }

    // Raw TCP sees any accidental HEAD/body bytes; no HTTP client discards them for us.
    fn socket_request(server: &tiny_http::Server) -> std::thread::JoinHandle<Vec<u8>> {
        let address = server.server_addr().to_ip().unwrap();
        std::thread::spawn(move || {
            use std::io::Write;
            let mut socket = std::net::TcpStream::connect(address).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            socket
                .write_all(
                    b"GET /api/asset/test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            let mut response = Vec::new();
            socket.read_to_end(&mut response).unwrap();
            response
        })
    }

    #[test]
    fn duplicate_once_consume_refuses_410_without_stopping_owner() {
        let root = once_root("duplicate");
        let (mut state, id) = once_state(&root);
        let action = || Action::AssetConsume {
            id: id.clone(),
            principal: "dev:alice".into(),
        };
        state.handle(action()).unwrap();
        let error = state.handle(action()).unwrap_err();
        assert_eq!(error.code, "E_ASSET_VIEWED");
        assert!(
            !state.stop.load(Ordering::SeqCst),
            "duplicate claim stopped the owner"
        );
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let client = socket_request(&server);
        crate::asset_http::respond_once_refusal(server.recv().unwrap(), error, "dev");
        let response = String::from_utf8(client.join().unwrap()).unwrap();
        assert!(response.starts_with("HTTP/1.1 410"), "{response}");
        // A second principal still receives a delivery from the same owner state.
        assert!(
            state
                .handle(Action::AssetDelivery {
                    id,
                    identity: Identity::Persona("bob".into())
                })
                .is_ok()
        );
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    // @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction —
    // the view ledger commit replaces query validators without changing source rows.
    #[test]
    fn once_consumption_republishes_only_this_principals_live_and_conditional_query() {
        let root = once_root("query-publication");
        let (mut state, id) = once_state(&root);
        let mut project = state.compiled.project.clone();
        project.programs.push(Program {
            name: "media.view".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("rowId".into(), ArgType::Id)]),
            read_time_granularity_ms: None,
            body: vec![
                Stmt::Let {
                    name: "row".into(),
                    value: Expr::Get(snapback2_core::Read {
                        site: "view.row".into(),
                        table: "media".into(),
                        index: "byId".into(),
                        key: vec![Expr::Variable("rowId".into())],
                        provenance: snapback2_core::KeyProvenance::Arg,
                    }),
                },
                Stmt::Return(Expr::Object(BTreeMap::from([
                    ("row".into(), Expr::Variable("row".into())),
                    (
                        "alias".into(),
                        Expr::Field {
                            base: Box::new(Expr::Variable("row".into())),
                            name: "photo".into(),
                        },
                    ),
                ]))),
            ],
        });
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        state
            .runtime_mut()
            .apply_successor(generation.clone())
            .unwrap();
        state.compiled.project = project;
        state.compiled.generation = generation;
        let query = |state: &mut State, user: &str, validator: Option<String>| {
            state
                .execute(
                    "media.view",
                    json!({"rowId":"row1"}),
                    Identity::Persona(user.into()),
                    Some(ProgramKind::Query),
                    crate::writer::writer_offline::OfflineOptions {
                        receipt: true,
                        validator,
                        ..Default::default()
                    },
                    None,
                )
                .unwrap()
        };
        let open = |state: &mut State, user: &str| {
            let (events, receiver) = crate::writer::sse_queue();
            state
                .subscribe(
                    "media.view".into(),
                    json!({"rowId":"row1"}),
                    Identity::Persona(user.into()),
                    crate::writer::writer_offline::OfflineOptions {
                        receipt: true,
                        ..Default::default()
                    },
                    events,
                )
                .unwrap();
            let frame = receiver.recv_timeout(Duration::ZERO).unwrap().data;
            (receiver, frame)
        };
        let (alice, before) = open(&mut state, "alice");
        let (bob, other) = open(&mut state, "bob");
        assert_eq!(before["data"]["alias"]["id"], id);
        assert_eq!(
            query(
                &mut state,
                "alice",
                Some(before["validator"].as_str().unwrap().into())
            )["state"],
            "unchanged"
        );
        state.asset_consume(&id, "dev:alice").unwrap();
        let live = alice.recv_timeout(Duration::ZERO).unwrap().data;
        assert_eq!(live["seq"].as_u64().unwrap(), before["seq"].as_u64().unwrap() + 1);
        assert_eq!(live["data"], json!({"row":null,"alias":null}));
        assert!(
            bob.recv_timeout(Duration::ZERO).is_err(),
            "another principal was republished"
        );
        assert_eq!(state.last_live_dispatch_work, 1);
        let conditional = query(
            &mut state,
            "alice",
            Some(before["validator"].as_str().unwrap().into()),
        );
        assert_eq!(conditional["state"], "complete");
        assert_eq!(conditional["data"], live["data"]);
        assert_eq!(conditional["rows"], before["rows"]);
        assert_eq!(
            query(
                &mut state,
                "alice",
                Some(conditional["validator"].as_str().unwrap().into())
            )["state"],
            "unchanged"
        );
        assert_eq!(
            query(
                &mut state,
                "bob",
                Some(other["validator"].as_str().unwrap().into())
            )["state"],
            "unchanged"
        );
        assert_eq!(query(&mut state, "bob", None)["data"]["alias"]["id"], id);
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn once_durable_write_failure_stops_owner() {
        for table in ["_asset_views", "_commits"] {
            let root = once_root("io-failure");
            let (state, id) = once_state(&root);
            let before = state.runtime().store().commit_seq().unwrap();
            let project = state.compiled.project.clone();
            let generation = state.compiled.generation.clone();
            let blobs = state.blobs.clone();
            drop(state); // The owner uses exclusive SQLite custody; install the fault while it is closed.
            let connection = rusqlite::Connection::open(root.join("store.db")).unwrap();
            connection.execute_batch(&format!("CREATE TRIGGER refuse_view BEFORE INSERT ON {table} BEGIN SELECT RAISE(FAIL, 'failed durable write'); END;")).unwrap();
            drop(connection);
            let runtime = Runtime::open(
                Store::open(&root.join("store.db")).unwrap(),
                generation.clone(),
            )
            .unwrap();
            let mut state = state_with_assets(root.clone(), runtime, project, generation, blobs);
            let error = state
                .handle(Action::AssetConsume {
                    id: id.clone(),
                    principal: "dev:alice".into(),
                })
                .unwrap_err();
            assert_eq!(error.code, "E_CONSTRAINT");
            assert!(
                state.stop.load(Ordering::SeqCst),
                "failed durable write left the owner retryable"
            );
            assert!(!state.runtime().store().asset_viewed(&id, "dev:alice").unwrap());
            assert_eq!(state.runtime().store().commit_seq().unwrap(), before);
            drop(state);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn once_commit_survives_owner_restart_while_completion_is_withheld() {
        let root = once_root("fence");
        let (mut state, id) = once_state(&root);
        let project = state.compiled.project.clone();
        let generation = state.compiled.generation.clone();
        let blobs = state.blobs.clone();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let client = socket_request(&server);
        let delivery = state
            .handle(Action::AssetDelivery {
                id: id.clone(),
                identity: Identity::Persona("alice".into()),
            })
            .unwrap();
        let (consumed, finish) = crate::asset_http::write_once_body(
            server.recv().unwrap(),
            blobs.get(&id, None).unwrap(),
            &delivery,
            "dev",
        );
        assert!(consumed);
        state
            .handle(Action::AssetConsume {
                id: id.clone(),
                principal: "dev:alice".into(),
            })
            .unwrap();
        // The test owns the continuation: restart at the exact durable-claim / finish boundary,
        // without a production barrier, timing race, or sleep. All owner state and its DB close.
        drop(state);
        let runtime = Runtime::open(
            Store::open(&root.join("store.db")).unwrap(),
            generation.clone(),
        )
        .unwrap();
        let mut restarted = state_with_assets(root.clone(), runtime, project, generation, blobs);
        drop(finish); // The old HTTP worker dies with the owner; the last byte never escapes.
        let response = client.join().unwrap();
        let start = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert!(response.starts_with(b"HTTP/1.1 200"));
        assert!(String::from_utf8_lossy(&response[..start]).contains("Content-Length: 2"));
        assert_eq!(
            &response[start..],
            b"x",
            "client observed a complete body before finish"
        );
        let retry = socket_request(&server);
        let error = restarted
            .handle(Action::AssetDelivery {
                id,
                identity: Identity::Persona("alice".into()),
            })
            .unwrap_err();
        assert_eq!(error.code, "E_ASSET_VIEWED");
        crate::asset_http::respond_once_refusal(server.recv().unwrap(), error, "dev");
        assert!(retry.join().unwrap().starts_with(b"HTTP/1.1 410"));
        drop(restarted);
        std::fs::remove_dir_all(root).unwrap();
    }

    struct CountingBlobStore {
        inner: FileBlobStore,
        enumerations: AtomicUsize,
    }

    impl BlobStore for CountingBlobStore {
        fn put(&self, key: &str, source: &mut dyn Read) -> Result<u64, Refusal> {
            self.inner.put(key, source)
        }

        fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BlobRead, Refusal> {
            self.inner.get(key, range)
        }

        fn delete(&self, key: &str) -> Result<(), Refusal> {
            self.inner.delete(key)
        }

        fn enumerate_page(
            &self,
            prefix: &str,
            continuation: Option<&str>,
            limit: usize,
            visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
        ) -> Result<Option<String>, Refusal> {
            self.enumerations.fetch_add(1, Ordering::SeqCst);
            self.inner
                .enumerate_page(prefix, continuation, limit, visitor)
        }
    }

    #[test]
    fn a_discarded_finalizer_retains_charge_and_survives_sweeps_until_bytes_close() {
        use crate::blob_store::UploadCustody;
        let root = once_root("discard-finalizing");
        let (mut state, _) = once_state(&root);
        let mut file = state.staging.create().unwrap();
        std::io::Write::write_all(file.file_mut(), &[0_u8; 100]).unwrap();
        let custody = UploadCustody::new(file);
        let begun = state
            .asset_upload_begin(
                AssetKind::Image,
                100,
                Identity::Persona("alice".into()),
                custody.clone(),
            )
            .unwrap();
        let id = begun["id"].as_str().unwrap();
        let mut finalizing = custody.finalize().unwrap();
        state
            .discard_upload(Identity::Persona("alice".into()), id)
            .unwrap();
        let actor = snapback2_core::Actor::persona("alice").unwrap();
        assert_eq!(
            state
                .runtime()
                .asset_staging_usage(&actor)
                .unwrap()
                .creator
                .bytes,
            100
        );
        state.sweep_assets_now().unwrap();
        assert!(state.runtime().store().asset(id).unwrap().is_some());
        assert_eq!(std::fs::metadata(finalizing.path()).unwrap().len(), 100);
        finalizing.discard().unwrap();
        custody.finish(Some(finalizing)).unwrap();
        state
            .handle(Action::AssetUploadFailed { id: id.into() })
            .unwrap();
        assert_eq!(
            state
                .runtime()
                .asset_staging_usage(&actor)
                .unwrap()
                .creator
                .bytes,
            0
        );
        state.sweep_assets_now().unwrap();
        assert!(state.runtime().store().asset(id).unwrap().is_none());
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn failed_finalizer_cleanup_is_retryable_after_worker_exit_by_disposal_and_sweep() {
        use crate::blob_store::UploadCustody;
        use std::os::unix::fs::PermissionsExt;
        for dispose in [true, false] {
            let root = once_root(if dispose {
                "retry-disposal"
            } else {
                "retry-sweep"
            });
            let (mut state, _) = once_state(&root);
            let mut file = state.staging.create().unwrap();
            std::io::Write::write_all(file.file_mut(), &[0_u8; 100]).unwrap();
            let path = file.path().to_owned();
            let custody = UploadCustody::new(file);
            let begun = state
                .asset_upload_begin(
                    AssetKind::Image,
                    100,
                    Identity::Persona("alice".into()),
                    custody.clone(),
                )
                .unwrap();
            let id = begun["id"].as_str().unwrap();
            let mut finalizing = custody.finalize().unwrap();
            finalizing.sync_and_close().unwrap();
            state
                .runtime_mut()
                .reserve_asset_finalized_bytes(id, 100)
                .unwrap();
            state.blobs.put(id, &mut Cursor::new([0_u8; 100])).unwrap();
            let actor = snapback2_core::Actor::persona("alice").unwrap();
            let now = state.now();
            let sibling = state
                .runtime_mut()
                .begin_asset(AssetKind::Image, &actor, now)
                .unwrap();
            state
                .runtime_mut()
                .reserve_asset_finalized_bytes(&sibling, 2)
                .unwrap();
            state
                .runtime_mut()
                .mark_asset_ready(
                    &sibling,
                    &AssetReadyFacts {
                        media_type: "image/png".into(),
                        bytes: 2,
                        width: 1,
                        height: 1,
                        duration: None,
                    },
                )
                .unwrap();
            state.blobs.put(&sibling, &mut Cursor::new(b"xy")).unwrap();
            state
                .discard_upload(Identity::Persona("alice".into()), &sibling)
                .unwrap();
            let directory = root.join(".snapback/staging");
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500)).unwrap();
            let failed = custody.finish(Some(finalizing));
            let (requests, incoming) = mpsc::channel();
            let handle = OwnerHandle { tx: requests };
            let upload_id = id.to_owned();
            let worker = std::thread::spawn(move || {
                crate::asset_http::drop_failed_upload(handle, upload_id, custody)
            });
            let request = incoming.recv().unwrap();
            assert!(matches!(&request.action, Action::AssetUploadFailed { .. }));
            request.reply.send(state.handle(request.action)).unwrap();
            worker.join().unwrap();
            assert_eq!(
                state.runtime().store().asset(id).unwrap().unwrap().state,
                snapback2_core::AssetState::Failed
            );
            let charged = state
                .runtime()
                .asset_staging_usage(&actor)
                .unwrap()
                .creator
                .bytes;
            let retry = if dispose {
                state
                    .discard_upload(Identity::Persona("alice".into()), id)
                    .map(|_| ())
            } else {
                state.clock_offset_ms = ASSET_RECLAIM_GRACE_MS + 1;
                state.sweep_assets_now()
            };
            // Exercise the real background failure boundary, then a queued read.
            // Closing admission lets drive return after servicing that request.
            let (requests, incoming) = mpsc::channel();
            let (reply, response) = mpsc::channel();
            requests
                .send(Request {
                    action: Action::Status,
                    reply,
                })
                .unwrap();
            drop(requests);
            state.next_asset_sweep = Instant::now();
            writer_jobs::drive(&mut state, incoming);
            let served = response.try_recv();
            let stopped = state.stop.load(Ordering::SeqCst);
            let sibling_reclaimed = state.runtime().store().asset(&sibling).unwrap().is_none()
                && state.blobs.get(&sibling, None).is_err();
            let retained = path.exists()
                && state.blobs.get(id, None).is_ok()
                && state.runtime().store().asset(id).unwrap().is_some();
            let still_charged = state
                .runtime()
                .asset_staging_usage(&actor)
                .unwrap()
                .creator
                .bytes;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(failed.unwrap_err().code, "E_OWNER_ASSET_IO");
            assert!(!stopped, "a per-upload unlink failure stopped the writer");
            assert!(
                matches!(served, Ok(Ok(_))),
                "the writer must still serve its queued read: {served:?}"
            );
            assert!(
                sibling_reclaimed,
                "one failed unlink must not block sibling reclamation"
            );
            assert!(
                retained,
                "failed cleanup must retain the path, blob and pending id"
            );
            assert_eq!((charged, still_charged), (100, 100));
            if dispose {
                state
                    .discard_upload(Identity::Persona("alice".into()), id)
                    .unwrap();
            }
            state.sweep_assets_now().unwrap();
            assert_eq!(
                state
                    .runtime()
                    .asset_staging_usage(&actor)
                    .unwrap()
                    .creator
                    .bytes,
                0
            );
            assert!(
                !path.exists(),
                "the exited worker's staging path must be retried"
            );
            assert!(state.blobs.get(id, None).is_err());
            assert!(state.runtime().store().asset(id).unwrap().is_none());
            if dispose {
                assert_eq!(retry.unwrap_err().code, "E_OWNER_ASSET_IO");
            } else {
                retry.unwrap();
            }
            drop(state);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn reset_and_reclaim_return_asset_ids_to_the_owner() {
        assert_eq!(
            reset_response(
                7,
                vec!["asset-reset".to_owned()],
                json!({"rows":2,"personas":3})
            ),
            json!({ "ok": true, "seq": 7, "assetIds": ["asset-reset"], "seed":{"rows":2,"personas":3} })
        );
        assert_eq!(
            reclaim_response(vec!["asset-reclaim".to_owned()]),
            json!({ "ok": true, "assetIds": ["asset-reclaim"] })
        );
    }

    #[test]
    fn advanced_dev_clock_governs_successor_release_grace() {
        let table = |columns| Table {
            columns,
            indexes: BTreeMap::from([(
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            )]),
            rules: Rules {
                read: RuleExpr::Public {
                    reason: "clock test".to_owned(),
                },
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
            retain: Default::default(),
            tombstones: Vec::new(),
            deliver: None,
        };
        let insert = Program {
            name: "media.insert".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("rowId".to_owned(), ArgType::Id),
                ("asset".to_owned(), ArgType::Image { max: 1_000 }),
            ]),
            read_time_granularity_ms: None,
            body: vec![Stmt::Insert {
                table: "media".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), Expr::Variable("rowId".to_owned())),
                    ("photo".to_owned(), Expr::Variable("asset".to_owned())),
                ])),
            }],
        };
        let schema = Schema {
            tables: BTreeMap::from([(
                "media".to_owned(),
                table(BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    (
                        "photo".to_owned(),
                        ColumnType::Image {
                            max: 1_000,
                            once: false,
                        },
                    ),
                ])),
            )]),
            ..Schema::default()
        };
        let project = ProjectJson {
            version: 1,
            schema,
            programs: vec![insert],
            effects: Vec::new(),
            auth: Auth::default(),
        };
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
        let alice = snapback2_core::Actor::user("alice").unwrap();
        let asset_id = runtime
            .begin_asset(AssetKind::Image, &alice, unix_millis())
            .unwrap();
        runtime
            .reserve_asset_finalized_bytes(&asset_id, 50)
            .unwrap();
        runtime
            .mark_asset_ready(
                &asset_id,
                &AssetReadyFacts {
                    media_type: "image/png".to_owned(),
                    bytes: 50,
                    width: 10,
                    height: 20,
                    duration: None,
                },
            )
            .unwrap();
        let asset = Value::Map(
            BTreeMap::from([
                ("id".to_owned(), Value::String(asset_id.clone())),
                ("width".to_owned(), Value::Int(10)),
                ("height".to_owned(), Value::Int(20)),
            ])
            .into(),
        );
        runtime
            .execute(
                "media.insert",
                Context::mutation(
                    alice,
                    BTreeMap::from([
                        ("rowId".to_owned(), Value::Id("row-1".to_owned())),
                        ("asset".to_owned(), asset),
                    ]),
                ),
            )
            .unwrap();

        let next_schema = Schema {
            tables: BTreeMap::from([(
                "media".to_owned(),
                table(BTreeMap::from([("id".to_owned(), ColumnType::Id)])),
            )]),
            ..Schema::default()
        };
        let next_project = ProjectJson {
            version: 1,
            schema: next_schema,
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        };
        let next_generation = Generation::certify(&next_project, Ceilings::default()).unwrap();
        let asset_root = std::env::temp_dir().join(format!(
            "snapback2-writer-assets-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        std::fs::create_dir_all(asset_root.join(".snapback")).unwrap();
        let blobs: Arc<dyn BlobStore> = Arc::new(FileBlobStore::open(&asset_root).unwrap());
        let mut state = state_with_assets(asset_root, runtime, project, generation, blobs);

        state
            .handle(Action::Clock {
                advance_ms: 2 * ASSET_RECLAIM_GRACE_MS,
            })
            .unwrap();
        state
            .apply(
                CompiledProject {
                    project: next_project,
                    generation: next_generation,
                    api_dts: String::new(),
                    compiler_ms: 0.0,
                    quarry: Vec::new(),
                    sources: Default::default(),
                },
                Some(MigrationPlan {
                    drops: vec![Drop::Column {
                        table: "media".to_owned(),
                        name: "photo".to_owned(),
                    }],
                }),
                None,
                None,
            )
            .unwrap();

        assert_eq!(
            state.handle(Action::ReclaimAssets).unwrap()["assetIds"],
            json!([])
        );
        assert!(state.runtime().store().asset(&asset_id).unwrap().is_some());
        state
            .handle(Action::Clock {
                advance_ms: ASSET_RECLAIM_GRACE_MS,
            })
            .unwrap();
        // Advancing the development clock sweeps in place: the released asset
        // is reclaimed and finished on the dev clock, not wall time, so an
        // explicit reclaim afterwards finds nothing left.
        assert!(state.runtime().store().asset(&asset_id).unwrap().is_none());
        assert_eq!(
            state.handle(Action::ReclaimAssets).unwrap()["assetIds"],
            json!([])
        );
    }

    #[test]
    fn reset_of_200_assets_reclaims_in_bounded_continuation_pages() {
        let table = Table {
            columns: BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                (
                    "photo".to_owned(),
                    ColumnType::Image {
                        max: 1_000,
                        once: false,
                    },
                ),
            ]),
            indexes: BTreeMap::from([(
                "byId".to_owned(),
                Index {
                    components: (vec!["id".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            )]),
            rules: Rules {
                read: RuleExpr::Public {
                    reason: "reset enumeration test".to_owned(),
                },
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
            retain: Default::default(),
            tombstones: Vec::new(),
            deliver: None,
        };
        let insert = Program {
            name: "media.insert".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("rowId".to_owned(), ArgType::Id),
                ("asset".to_owned(), ArgType::Image { max: 1_000 }),
            ]),
            read_time_granularity_ms: None,
            body: vec![Stmt::Insert {
                table: "media".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), Expr::Variable("rowId".to_owned())),
                    ("photo".to_owned(), Expr::Variable("asset".to_owned())),
                ])),
            }],
        };
        let project = ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::from([("media".to_owned(), table)]),
                ..Schema::default()
            },
            programs: vec![insert],
            effects: Vec::new(),
            auth: Auth::default(),
        };
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
        let actor = snapback2_core::Actor::user("reset-200").unwrap();
        let root = std::env::temp_dir().join(format!(
            "snapback2-reset-enumeration-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        std::fs::create_dir_all(root.join(".snapback")).unwrap();
        let blobs = Arc::new(CountingBlobStore {
            inner: FileBlobStore::open(&root).unwrap(),
            enumerations: AtomicUsize::new(0),
        });
        for index in 0..200 {
            let id = runtime
                .begin_asset(AssetKind::Image, &actor, unix_millis())
                .unwrap();
            runtime.reserve_asset_finalized_bytes(&id, 1).unwrap();
            runtime
                .mark_asset_ready(
                    &id,
                    &AssetReadyFacts {
                        media_type: "image/png".to_owned(),
                        bytes: 1,
                        width: 1,
                        height: 1,
                        duration: None,
                    },
                )
                .unwrap();
            blobs.put(&id, &mut Cursor::new(b"x")).unwrap();
            runtime
                .execute(
                    "media.insert",
                    Context::mutation(
                        actor.clone(),
                        BTreeMap::from([
                            ("rowId".to_owned(), Value::Id(format!("row-{index}"))),
                            (
                                "asset".to_owned(),
                                Value::Map(
                                    BTreeMap::from([
                                        ("id".to_owned(), Value::String(id)),
                                        ("width".to_owned(), Value::Int(1)),
                                        ("height".to_owned(), Value::Int(1)),
                                    ])
                                    .into(),
                                ),
                            ),
                        ]),
                    ),
                )
                .unwrap();
        }

        let trait_store: Arc<dyn BlobStore> = blobs.clone();
        let mut state = state_with_assets(root.clone(), runtime, project, generation, trait_store);
        let reset = state.reset(false).unwrap();
        assert_eq!(reset["assetIds"].as_array().unwrap().len(), 200);
        let mut turns = 1;
        while !state.runtime().asset_ids().unwrap().is_empty() {
            state.sweep_assets_now().unwrap();
            turns += 1;
            assert!(turns <= 8, "32-row pages must settle 200 rows in 7 turns");
        }
        assert_eq!(turns, 7);
        assert_eq!(blobs.enumerations.load(Ordering::SeqCst), turns);
        assert!(state.runtime().asset_ids().unwrap().is_empty());
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }
}
