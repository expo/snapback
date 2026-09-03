use super::{Identity, State};
use crate::project::seed_rows;
use crate::protocol::Refusal;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

impl State {
    pub(super) fn reset(&mut self) -> Result<Json, Refusal> {
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
        // Lane B owns blob deletion; core returns the cleared ids without
        // touching shared fork-backed files (LLP 1006 §9a).
        Ok(reset_response(reset.seq, reset.asset_ids))
    }

    pub(super) fn reclaim_assets(&mut self) -> Result<Json, Refusal> {
        let now = self.now();
        let asset_ids = self
            .runtime_mut()
            .reclaim_assets(now)
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(reclaim_response(asset_ids))
    }

    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — asset authorization stays on the sole Runtime owner and returns only certified point-read facts.
    pub(super) fn asset_delivery(&mut self, id: &str, identity: Identity) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let context = self.execution_context(&authority, BTreeMap::new())?;
        let delivery = self
            .runtime_mut()
            .asset_delivery(id, context)
            .map_err(|error| Refusal::from_runtime(&error))?;
        serde_json::to_value(delivery).map_err(|error| {
            Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                error.to_string(),
            ))
        })
    }
}

fn reset_response(seq: u64, asset_ids: Vec<String>) -> Json {
    json!({ "ok": true, "seq": seq, "assetIds": asset_ids })
}

fn reclaim_response(asset_ids: Vec<String>) -> Json {
    json!({ "ok": true, "assetIds": asset_ids })
}

#[cfg(test)]
mod tests {
    use super::*;
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
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

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
        let mut state = State {
            runtime: Some(runtime),
            compiled: CompiledProject {
                project,
                generation,
                api_dts: String::new(),
                compiler_ms: 0.0,
                quarry: Vec::new(),
            },
            seed: SeedData::default(),
            root: PathBuf::new(),
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
                project: PathBuf::new(),
            },
            exited: false,
            effects_wake: None,
        };

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
        state
            .handle(Action::Clock {
                advance_ms: ASSET_RECLAIM_GRACE_MS,
            })
            .unwrap();
        assert_eq!(
            state.handle(Action::ReclaimAssets).unwrap()["assetIds"],
            json!([asset_id])
        );
    }
}
