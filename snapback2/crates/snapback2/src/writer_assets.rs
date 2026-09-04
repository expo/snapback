//! Asset-specific actions kept off the already dense sole-writer loop.

use super::*;
use crate::project::seed_rows;
use snapback2_core::{ArgType, ColumnType};

impl State {
    pub(super) fn reset(&mut self) -> Result<Json, Refusal> {
        // @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — reset clears staging and uses the fork-aware sweep, never a blob wipe.
        self.staging.clear()?;
        let seed = self.seed.clone();
        let rows = seed_rows(&seed, &self.compiled)?;
        let now = self.now();
        for persona in &seed.personas {
            self.runtime_mut()
                .ensure_persona(persona, now)
                .map_err(|error| Refusal::from_identity(&error))?;
        }
        let reset = self
            .runtime_mut()
            .reset_and_seed(&rows)
            .map_err(|error| Refusal::from_runtime(&error))?;
        let runtime_ids = self
            .live
            .values()
            .map(|client| client.runtime_id)
            .collect::<Vec<_>>();
        for id in runtime_ids {
            self.runtime_mut().unsubscribe(id);
        }
        self.live.clear();
        self.channels.clear();
        self.ledger.clear();
        self.wake_effects();
        // Core returns the cleared ids and the owner still sees them; the
        // fork-aware sweep — never a blob wipe — deletes the bytes
        // (LLP 1006 §9a).
        let asset_ids = reset.asset_ids.clone();
        self.pending_asset_deletes.extend(reset.asset_ids);
        self.sweep_asset_blobs()?;
        Ok(reset_response(reset.seq, asset_ids))
    }

    pub(super) fn reclaim_assets(&mut self) -> Result<Json, Refusal> {
        let now = self.now();
        let asset_ids = self
            .runtime_mut()
            .reclaim_assets(now)
            .map_err(|error| Refusal::from_runtime(&error))?;
        // Reclaimed rows are `reclaiming` tombstones until the fork-aware blob
        // deletion succeeds; finish them here rather than on the next sweep.
        self.pending_asset_deletes.extend(asset_ids.iter().cloned());
        self.sweep_asset_blobs()?;
        Ok(reclaim_response(asset_ids))
    }

    pub(super) fn sweep_assets_on_boot(&mut self) -> Result<(), Refusal> {
        self.sweep_assets_now()
    }

    pub(super) fn sweep_assets_now(&mut self) -> Result<(), Refusal> {
        let now = self.now();
        let ids = self
            .runtime_mut()
            .reclaim_assets(now)
            .map_err(|error| Refusal::from_runtime(&error))?;
        self.pending_asset_deletes.extend(ids);
        self.sweep_asset_blobs()
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

    pub(super) fn sweep_asset_blobs(&mut self) -> Result<(), Refusal> {
        let live_ids = self
            .runtime()
            .asset_ids()
            .map_err(|error| Refusal::from_runtime(&error))?
            .into_iter()
            .collect();
        let remaining = crate::asset_gc::sweep_asset_blobs(
            &self.root,
            self.blobs.as_ref(),
            &live_ids,
            &self.pending_asset_deletes,
        )?;
        let finished = self
            .pending_asset_deletes
            .difference(&remaining)
            .cloned()
            .collect::<Vec<_>>();
        self.runtime_mut()
            .finish_asset_reclaims(&finished)
            .map_err(|error| Refusal::from_runtime(&error))?;
        self.pending_asset_deletes = remaining;
        Ok(())
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
        let delivery = if let Some(authority) = authority {
            let context = self.execution_context(&authority, BTreeMap::new())?;
            self.runtime_mut().asset_delivery(id, context)
        } else {
            self.runtime_mut().public_asset_delivery(id)
        }
        .map_err(|error| Refusal::from_runtime(&error))?;
        if carrier && !delivery.public && delivery.kind == AssetKind::Image {
            return Err(Refusal::from_runtime(
                &snapback2_core::RuntimeError::AssetNotReady("asset is unavailable".to_owned()),
            ));
        }
        serde_json::to_value(delivery).map_err(|error| {
            Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                error.to_string(),
            ))
        })
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
        Ok(json!({ "id": id, "maxBytes": max }))
    }
}

fn reset_response(seq: u64, asset_ids: Vec<String>) -> Json {
    json!({ "ok": true, "seq": seq, "assetIds": asset_ids })
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
        ColumnType::Image { max } => maxima.0 = maxima.0.max(u64::from(*max)),
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
            runtime: Some(runtime),
            compiled: CompiledProject {
                project,
                generation,
                api_dts: String::new(),
                compiler_ms: 0.0,
                quarry: Vec::new(),
            },
            seed: SeedData::default(),
            root: root.clone(),
            mode: "dev".to_owned(),
            phase: json!("ready"),
            live: BTreeMap::new(),
            channels: BTreeMap::new(),
            ledger: VecDeque::new(),
            next_channel: 0,
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
            asset_carriers: BTreeMap::new(),
            blobs,
            staging,
            pending_asset_deletes: std::collections::BTreeSet::new(),
            next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
        }
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

        fn enumerate(
            &self,
            prefix: &str,
            visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
        ) -> Result<(), Refusal> {
            self.enumerations.fetch_add(1, Ordering::SeqCst);
            self.inner.enumerate(prefix, visitor)
        }
    }

    #[test]
    fn reset_and_reclaim_return_asset_ids_to_the_owner() {
        assert_eq!(
            reset_response(7, vec!["asset-reset".to_owned()]),
            json!({ "ok": true, "seq": 7, "assetIds": ["asset-reset"] })
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
                    columns: vec!["id".to_owned()],
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
        };
        let insert = Program {
            name: "media.insert".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("rowId".to_owned(), ArgType::Id),
                ("asset".to_owned(), ArgType::Image { max: 1_000 }),
            ]),
            read_time_granularity_ms: None,
            result_page_site: None,
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
                    ("photo".to_owned(), ColumnType::Image { max: 1_000 }),
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
        let asset = Value::Map(BTreeMap::from([
            ("id".to_owned(), Value::String(asset_id.clone())),
            ("width".to_owned(), Value::Int(10)),
            ("height".to_owned(), Value::Int(20)),
        ]));
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
    fn reset_of_200_assets_performs_one_blob_enumeration() {
        let table = Table {
            columns: BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("photo".to_owned(), ColumnType::Image { max: 1_000 }),
            ]),
            indexes: BTreeMap::from([(
                "byId".to_owned(),
                Index {
                    columns: vec!["id".to_owned()],
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
        };
        let insert = Program {
            name: "media.insert".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("rowId".to_owned(), ArgType::Id),
                ("asset".to_owned(), ArgType::Image { max: 1_000 }),
            ]),
            read_time_granularity_ms: None,
            result_page_site: None,
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
                                Value::Map(BTreeMap::from([
                                    ("id".to_owned(), Value::String(id)),
                                    ("width".to_owned(), Value::Int(1)),
                                    ("height".to_owned(), Value::Int(1)),
                                ])),
                            ),
                        ]),
                    ),
                )
                .unwrap();
        }

        let trait_store: Arc<dyn BlobStore> = blobs.clone();
        let mut state = state_with_assets(root.clone(), runtime, project, generation, trait_store);
        let reset = state.reset().unwrap();
        assert_eq!(reset["assetIds"].as_array().unwrap().len(), 200);
        assert_eq!(blobs.enumerations.load(Ordering::SeqCst), 1);
        assert!(state.runtime().asset_ids().unwrap().is_empty());
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }
}
