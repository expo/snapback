//! Release activation extends the existing engine transaction and generation.
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — CAS includes every activation, not only semantic changes.
use super::*;
use rusqlite::OptionalExtension;

#[derive(Clone, Debug)]
pub struct ReleaseActivation {
    pub release: u64,
    pub expected_previous: Option<u64>,
    pub expected_revision: Option<u64>,
    pub restore_dormant: bool,
    pub native_digest: Option<String>,
    pub operation: String,
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
    pub(crate) fn check(&self, conn: &rusqlite::Connection) -> Result<(), RuntimeError> {
        let actual: Option<String> = conn
            .query_row("SELECT value FROM _meta WHERE key='release'", [], |r| {
                r.get(0)
            })
            .optional()?;
        if actual
            .as_ref()
            .is_some_and(|s| s.parse::<u64>().ok() != self.expected_previous)
        {
            return Err(RuntimeError::Generation("current release changed; run `snapback4 releases <dir>` and retry the selected release".into()));
        }
        let revision: Option<String> = conn
            .query_row(
                "SELECT value FROM _meta WHERE key='release_revision'",
                [],
                |r| r.get(0),
            )
            .optional()?;
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
        mut store: Store,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
        allow_feed_adoption: bool,
    ) -> Result<Self, RuntimeError> {
        prepare(&mut schema)?;
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        let (generation, metadata) = Self::activate(
            &mut store,
            &schema,
            &programs,
            Some(options),
            crate::now_ms(),
            allow_feed_adoption,
            None,
            None,
        )?;
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
            #[cfg(feature = "native")]
            native: None,
            #[cfg(feature = "native")]
            native_logs: native::Logs::default(),
            presence: None,
        })
    }
    /// No replacement engine, post-commit SQL read, or fallible ephemeral swap.
    pub fn adopt_release(
        &mut self,
        mut schema: Schema,
        programs: impl IntoIterator<Item = Program>,
        options: &ReleaseActivation,
        allow_feed_adoption: bool,
    ) -> Result<u64, RuntimeError> {
        prepare(&mut schema)?;
        let programs = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
        drop(self.ephemeral.lock()?);
        let (generation, metadata) = Self::activate(
            &mut self.store,
            &schema,
            &programs,
            Some(options),
            crate::now_ms(),
            allow_feed_adoption,
            None,
            None,
        )?;
        self.store.exclude_ephemeral(&schema);
        self.timeline_schedule = timeline::Schedule::default();
        self.schema = schema;
        self.programs = programs;
        self.generation = generation;
        self.expiry_after.clear();
        self.dev_effects = false;
        self.ephemeral
            .rebind_committed(metadata.store_id, generation, &self.schema);
        Ok(generation)
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
