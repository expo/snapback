//! The publication record a durable commit carries to the host, and the
//! interest a held poll registers against it.
//! @ref LLP 3000.041#41-w1-a-publication-contract-and-the-server-answers-by-audience — wake by audience.
use super::Engine;
use super::effects::OutboxTransaction;
use crate::{RuntimeError, partition, partition::PartitionRows};
use std::collections::{BTreeMap, BTreeSet};

/// What the commits in one published interval touched, derived from the
/// store after the fact. A reader that cannot attribute an interval (no
/// summaries kept, an overflowed summary, a saturated commit page) reports
/// it as global, and the host wakes every held poll as it does today.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PublicationRecord {
    pub global: bool,
    /// Per visible table, the partitions whose rows or memberships changed.
    pub partitions: BTreeMap<String, BTreeSet<String>>,
    /// Every visible table touched: the commits' touched sets united with the
    /// content tables the events name, so a membership event's table is in it.
    pub tables: BTreeSet<String>,
    /// Principals with an unconfirmed presence dependency still inside its
    /// deadline; None when the store cannot say.
    pub presence: Option<BTreeSet<String>>,
}

/// The bounded commit page an interval is read in; past it the record is global.
const COMMIT_PAGE: usize = 500;

impl Engine {
    /// The record for commits in `(after, through]`.
    pub fn publication_record(&self, after: u64, through: u64, now: i64) -> Result<PublicationRecord, RuntimeError> {
        let schema = &self.schema;
        self.store.with_authority_snapshot(|tx| {
            let mut record = PublicationRecord::default();
            if through <= after { return Ok(record); }
            let commits = tx.commits_after(after, COMMIT_PAGE)?;
            let mut covered = after;
            for (seq, tables) in &commits {
                if *seq > through { break; }
                covered = *seq;
                record.tables.extend(tables.iter().filter(|name| schema.visible(name)).cloned());
            }
            if covered < through && commits.len() >= COMMIT_PAGE { record.global = true; }
            match tx.commit_partitions_between(after, through, COMMIT_PAGE)? {
                None => record.global = true,
                Some(summaries) => {
                    if summaries.len() >= COMMIT_PAGE { record.global = true; }
                    for (_, summary) in summaries {
                        match partition::parse_commit_partitions(&summary) {
                            None => { record.global = true; break; }
                            Some(by_table) => for (table, partitions) in by_table {
                                if !schema.visible(&table) { continue; }
                                record.tables.insert(table.clone());
                                record.partitions.entry(table).or_default().extend(partitions);
                            },
                        }
                    }
                }
            }
            record.presence = tx.pending_effect_presence_principals(now)?.map(|principals| principals.into_iter().collect());
            Ok(record)
        })
    }

    /// The partitions `principal` holds right now: its own, the public one and
    /// one per published group membership (a held poll's durable interest).
    pub fn held_partitions(&self, principal: &str, now: i64) -> Result<BTreeSet<String>, RuntimeError> {
        self.store.with_authority_snapshot(|tx| partition::held_partitions(tx, &self.schema, principal, now))
    }
}
