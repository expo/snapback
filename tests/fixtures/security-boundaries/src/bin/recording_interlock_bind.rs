use snapback_kernel::auth::service_fence::RecordingServiceAuthorityCommitInterlock;
use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let binding = database.claim_database_binding().unwrap();
    let recording = RecordingServiceAuthorityCommitInterlock::default();
    // @attack
    let _ = recording.bind(&binding);
}
