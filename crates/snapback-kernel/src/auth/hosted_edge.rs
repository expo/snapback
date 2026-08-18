//! Durable hosted-admission high-water commit.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::diagnostic::{SnapbackError, SnapbackResult};

const ADMISSION_WATERMARK_TABLE: &str = "_snapback_hosted_admission_watermark";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostedAdmissionCommit {
    pub admission_epoch: u64,
    pub sender_replay_epoch_floor: u64,
}

fn refuse(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "auth", message)
}

pub fn initialize_hosted_admission_watermark(connection: &Connection) -> SnapbackResult<()> {
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {ADMISSION_WATERMARK_TABLE} (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 admission_epoch INTEGER NOT NULL,
                 sender_replay_epoch_floor INTEGER NOT NULL
             ) STRICT;"
        ))
        .map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted admission watermark could not be initialized",
            )
        })
}

pub fn install_hosted_admission_commit(
    connection: &mut Connection,
    commit: HostedAdmissionCommit,
) -> SnapbackResult<()> {
    initialize_hosted_admission_watermark(connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted admission watermark could not be advanced",
            )
        })?;
    let current: Option<(i64, i64)> = transaction
        .query_row(
            &format!(
                "SELECT admission_epoch, sender_replay_epoch_floor \
                 FROM {ADMISSION_WATERMARK_TABLE} WHERE id = 1"
            ),
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted admission watermark could not be read",
            )
        })?;
    if let Some((durable_epoch, durable_floor)) = current
        && (commit.admission_epoch < durable_epoch as u64
            || commit.sender_replay_epoch_floor < durable_floor as u64)
    {
        return Err(refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK",
            "hosted admission is older than the durable high-water mark",
        ));
    }
    transaction
        .execute(
            &format!(
                "INSERT INTO {ADMISSION_WATERMARK_TABLE} \
                     (id, admission_epoch, sender_replay_epoch_floor) \
                 VALUES (1, ?1, ?2) \
                 ON CONFLICT(id) DO UPDATE SET \
                     admission_epoch = MAX(admission_epoch, excluded.admission_epoch), \
                     sender_replay_epoch_floor = \
                         MAX(sender_replay_epoch_floor, excluded.sender_replay_epoch_floor)"
            ),
            params![
                commit.admission_epoch as i64,
                commit.sender_replay_epoch_floor as i64
            ],
        )
        .map_err(|_| {
            refuse(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "hosted admission watermark could not be written",
            )
        })?;
    transaction.commit().map_err(|_| {
        refuse(
            "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
            "hosted admission watermark could not be committed",
        )
    })
}
