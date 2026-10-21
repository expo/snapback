//! Release activation extends the existing engine transaction and generation.
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — CAS includes every activation, not only semantic changes.
use super::*;

#[derive(Clone, Debug)]
pub struct ReleaseActivation {
    pub release: u64,
    pub expected_previous: Option<u64>,
    pub expected_revision: Option<u64>,
    pub restore_dormant: bool,
    pub native_digest: Option<String>,
    pub operation: String,
}
pub(crate) trait ReleaseTransaction {
    fn selected_release(&self) -> Result<Option<String>, RuntimeError>;
    fn release_revision(&self) -> Result<Option<String>, RuntimeError>;
}

impl ReleaseActivation {
    pub fn new(release: u64, expected_previous: Option<u64>) -> Self {
        Self {
            release,
            expected_previous,
            expected_revision: None,
            restore_dormant: true,
            native_digest: None,
            operation: "activate".into(),
        }
    }
    pub(crate) fn validate(&self) -> Result<(), RuntimeError> {
        if self.operation.contains('\0') || self.native_digest.as_deref().is_some_and(|s| s.contains('\0')) {
            return Err(RuntimeError::Input("release operation and native digest cannot contain U+0000".into()));
        }
        crate::release_history::counter(self.release)?;
        self.expected_previous.map(crate::release_history::counter).transpose()?;
        self.expected_revision.map(crate::release_history::counter).transpose()?;
        Ok(())
    }
    pub(crate) fn check(&self, tx: &impl ReleaseTransaction) -> Result<(), RuntimeError> {
        self.validate()?;
        let actual = tx.selected_release()?;
        if actual
            .as_ref()
            .is_some_and(|s| s.parse::<u64>().ok() != self.expected_previous)
        {
            return Err(RuntimeError::Generation("current release changed; run `snapback4 releases <dir>` and retry the selected release".into()));
        }
        let revision = tx.release_revision()?;
        let revision = revision.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        if self.expected_revision.is_some_and(|n| n != revision) {
            return Err(RuntimeError::Generation("activation revision changed (including rollback/equal-content activation); run `snapback4 releases <dir>` and retry".into()));
        }
        Ok(())
    }
}

impl Engine {
    pub fn new_release(
        store: Store,
        schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        release: u64,
        expected_previous: Option<u64>,
    ) -> Result<Self, RuntimeError> {
        Self::new_release_with_feed_adoption(
            store,
            schema,
            programs,
            release,
            expected_previous,
            false,
        )
    }
    pub fn new_release_with_feed_adoption(
        store: Store,
        schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        release: u64,
        expected_previous: Option<u64>,
        allow_feed_adoption: bool,
    ) -> Result<Self, RuntimeError> {
        Self::new_release_prepared(
            store,
            schema,
            programs,
            &ReleaseActivation::new(release, expected_previous),
            allow_feed_adoption,
        )
    }
    pub fn new_release_prepared(
        store: Store, schema: Schema, programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation, allow_feed_adoption: bool,
    ) -> Result<Self, RuntimeError> {
        Self::new_release_prepared_at(store,schema,programs,options,allow_feed_adoption,crate::now_ms())
    }
    pub fn new_release_prepared_at(
        mut store: Store,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
        allow_feed_adoption: bool,
        now: i64,
    ) -> Result<Self, RuntimeError> {
        prepare(&mut schema)?;
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let (generation, metadata) = Self::activate(
            &mut store,
            &schema,
            &programs,
            Some(options),
            now,
            allow_feed_adoption,
            None,
            None,
        )?.into_inner();
        store.exclude_ephemeral(&schema);
        Ok(Self {
            timeline_schedule: timeline::Schedule::default(),
            ephemeral: std::sync::Arc::new(ephemeral::Hub::new(
                metadata.store_id,
                generation,
                &schema,
            )),
            store,
            schema,
            programs,
            generation,
            expiry_after: BTreeMap::new(),
            dev_effects: false,
            ceilings: Ceilings::default(),
            entropy: crate::ids::seed(),
            minter: crate::ids::Mint::default(),
            #[cfg(feature = "native")]
            native: None,
            #[cfg(feature = "native")]
            native_logs: native::Logs::default(),
            presence: None,
        })
    }
    /// No replacement engine, post-commit SQL read, or fallible ephemeral swap.
    pub fn adopt_release(
        &mut self, schema: Schema, programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation, allow_feed_adoption: bool,
    ) -> Result<u64, RuntimeError> {
        self.adopt_release_at(schema,programs,options,allow_feed_adoption,crate::now_ms())
    }
    pub fn adopt_release_at(
        &mut self,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
        allow_feed_adoption: bool,
        now: i64,
    ) -> Result<u64, RuntimeError> {
        prepare(&mut schema)?;
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        drop(self.ephemeral.lock()?);
        Ok(Committer::run_committed_with(self, |engine| {
            Self::activate(
            &mut engine.store,
            &schema,
            &programs,
            Some(options),
            now,
            allow_feed_adoption,
            None,
            None,
            ).map(|committed| committed.pending((schema, programs)))
        }, |engine, (schema, programs), (generation, metadata)| {
            engine.store.exclude_ephemeral(&schema);
            engine.timeline_schedule = timeline::Schedule::default();
            engine.schema = schema;
            engine.programs = programs;
            engine.generation = generation;
            engine.expiry_after.clear();
            engine.dev_effects = false;
            engine.ephemeral
                .rebind_committed(metadata.store_id, generation, &engine.schema);
            Ok(generation)
        })?.into_inner())
    }
    #[cfg(feature = "native")]
    pub fn set_prepared_native(&mut self, module: Option<std::sync::Arc<native::Module>>) {
        self.native = module;
    }
}

fn prepare(schema: &mut Schema) -> Result<(), RuntimeError> {
    columns::validate_before_prepare(schema)?;
    schema.check_row_view_audiences()?;
    schema.prepare_contribution_indexes();
    schema.prepare_delivery_lookup();
    if let Some(issue) = crate::schema::validate(schema).first() {
        return Err(RuntimeError::Schema(format!(
            "{}: {}",
            issue.path, issue.message
        )));
    }
    Ok(())
}
